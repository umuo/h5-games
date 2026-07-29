import Phaser from "phaser";
import { createGameBridge, createGameStorage } from "@web-games/game-sdk";
import "./style.css";

const WIDTH = 390;
const HEIGHT = 844;
const CENTER_X = WIDTH / 2;
const CENTER_Y = 322;
const CORE_RADIUS = 70;
const PIN_RADIUS = 137;
const MIN_GAP = 0.18;

class PinGapScene extends Phaser.Scene {
  private pinLayer!: Phaser.GameObjects.Container;
  private queueGraphics!: Phaser.GameObjects.Graphics;
  private levelText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private remainingText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private shooter?: Phaser.GameObjects.Container;
  private localAngles: number[] = [];
  private level = 1;
  private score = 0;
  private remaining = 0;
  private spinSpeed = 0.9;
  private shooting = false;
  private ended = false;
  private changingLevel = false;
  private bridge = createGameBridge({ gameId: "pin-gap", version: "1.0.0" });
  private storage = createGameStorage("pin-gap", { highLevel: 1, highScore: 0 });

  constructor() { super("pin-gap"); }

  create() {
    this.cameras.main.setBackgroundColor("#f3f0e8");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 39, 39, 0xf3f0e8, 1, 0x101114, .07);
    this.add.rectangle(WIDTH / 2, 31, WIDTH - 36, 1, 0x101114, .25);
    this.add.text(22, 43, "PIN / GAP  ·  002", {
      fontFamily: "monospace", fontSize: "11px", color: "#101114", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "见缝插针", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#74726c",
    }).setOrigin(1, 0);

    this.scoreText = this.add.text(22, 76, "0000", {
      fontFamily: "monospace", fontSize: "42px", color: "#101114", fontStyle: "bold",
    });
    const saved = this.storage.load();
    this.add.text(WIDTH - 22, 87, `BEST  ${String(saved.highScore).padStart(4, "0")}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#74726c", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");

    this.add.circle(CENTER_X, CENTER_Y, CORE_RADIUS + 8, 0xff6a51, .16);
    this.add.circle(CENTER_X, CENTER_Y, CORE_RADIUS, 0x101114);
    this.add.circle(CENTER_X, CENTER_Y, CORE_RADIUS - 10, 0x101114).setStrokeStyle(1, 0xdfff3f, .35);
    this.levelText = this.add.text(CENTER_X, CENTER_Y - 3, "01", {
      fontFamily: "monospace", fontSize: "36px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5);
    this.add.text(CENTER_X, CENTER_Y + 29, "LEVEL", {
      fontFamily: "monospace", fontSize: "8px", color: "#dfff3f", letterSpacing: 2,
    }).setOrigin(.5);

    this.remainingText = this.add.text(CENTER_X, 585, "", {
      fontFamily: "monospace", fontSize: "11px", color: "#74726c", letterSpacing: 2,
    }).setOrigin(.5);
    this.hintText = this.add.text(CENTER_X, 624, "点击屏幕发射", {
      fontFamily: "sans-serif", fontSize: "16px", color: "#101114", fontStyle: "bold",
    }).setOrigin(.5);
    this.add.text(CENTER_X, 655, "避开已有针 · 清空待发队列", {
      fontFamily: "sans-serif", fontSize: "11px", color: "#8a8881",
    }).setOrigin(.5);
    this.queueGraphics = this.add.graphics();

    this.input.on("pointerup", () => this.handleTap());
    this.game.events.on(Phaser.Core.Events.BLUR, () => this.scene.pause());
    this.game.events.on(Phaser.Core.Events.FOCUS, () => { if (!this.ended) this.scene.resume(); });
    this.startLevel();
    this.bridge.ready();
  }

  update(_time: number, delta: number) {
    if (!this.ended && this.pinLayer) {
      this.pinLayer.rotation += this.spinSpeed * delta / 1000;
    }
  }

  private startLevel() {
    this.changingLevel = false;
    this.shooting = false;
    this.ended = false;
    this.localAngles = [];
    this.pinLayer?.destroy(true);
    this.shooter?.destroy(true);
    this.pinLayer = this.add.container(CENTER_X, CENTER_Y);
    this.levelText.setText(String(this.level).padStart(2, "0"));
    this.spinSpeed = (0.82 + Math.min(this.level * .11, 1.1)) * (this.level % 3 === 0 ? -1 : 1);
    this.remaining = Math.min(6 + this.level, 14);

    const startingPins = Math.min(3 + Math.floor(this.level / 2), 8);
    const phase = Phaser.Math.FloatBetween(0, Math.PI * 2);
    for (let index = 0; index < startingPins; index += 1) {
      const angle = phase + index * (Math.PI * 2 / startingPins);
      this.localAngles.push(Phaser.Math.Angle.Wrap(angle));
      this.addAttachedPin(angle, 0x777872);
    }

    this.hintText.setText("点击屏幕发射").setColor("#101114");
    this.updateQueue();
    this.prepareShooter();
    if (this.level === 1 && this.score === 0) this.bridge.started();
  }

  private handleTap() {
    if (this.ended) {
      this.scene.restart();
      return;
    }
    if (this.shooting || this.changingLevel || this.remaining <= 0 || !this.shooter) return;
    this.shooting = true;
    this.hintText.setText("看准空隙…");
    this.tweens.add({
      targets: this.shooter,
      y: CENTER_Y + PIN_RADIUS,
      duration: 125,
      ease: "Cubic.easeIn",
      onComplete: () => this.resolveShot(),
    });
  }

  private resolveShot() {
    const worldAngle = Math.PI / 2;
    const localAngle = Phaser.Math.Angle.Wrap(worldAngle - this.pinLayer.rotation);
    const collided = this.localAngles.some((angle) => Math.abs(Phaser.Math.Angle.Wrap(angle - localAngle)) < MIN_GAP);

    if (collided) {
      this.failLevel();
      return;
    }

    this.shooter?.destroy(true);
    this.shooter = undefined;
    this.localAngles.push(localAngle);
    this.addAttachedPin(localAngle, 0xdfff3f);
    this.remaining -= 1;
    this.score += 10 + this.level * 2;
    this.scoreText.setText(String(this.score).padStart(4, "0"));
    this.bridge.score(this.score);
    this.cameras.main.flash(70, 223, 255, 63, false);
    this.updateQueue();

    if (this.remaining === 0) {
      this.completeLevel();
    } else {
      this.shooting = false;
      this.hintText.setText("漂亮，再来一针").setColor("#101114");
      this.time.delayedCall(90, () => this.prepareShooter());
    }
  }

  private addAttachedPin(angle: number, color: number) {
    const pin = this.add.graphics();
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    pin.lineStyle(3, color, 1);
    pin.lineBetween(cos * CORE_RADIUS, sin * CORE_RADIUS, cos * PIN_RADIUS, sin * PIN_RADIUS);
    pin.fillStyle(color, 1);
    pin.fillCircle(cos * PIN_RADIUS, sin * PIN_RADIUS, 7);
    pin.lineStyle(1, 0x101114, .45);
    pin.strokeCircle(cos * PIN_RADIUS, sin * PIN_RADIUS, 9);
    this.pinLayer.add(pin);
  }

  private prepareShooter() {
    if (this.ended || this.changingLevel || this.remaining <= 0) return;
    const graphics = this.add.graphics();
    graphics.lineStyle(3, 0x101114, 1);
    graphics.lineBetween(0, 0, 0, 72);
    graphics.fillStyle(0xff6a51, 1);
    graphics.fillCircle(0, 0, 7);
    graphics.lineStyle(1, 0x101114, 1);
    graphics.strokeCircle(0, 0, 9);
    this.shooter = this.add.container(CENTER_X, 704, [graphics]);
  }

  private updateQueue() {
    this.remainingText.setText(`待发  ×  ${String(this.remaining).padStart(2, "0")}`);
    this.queueGraphics.clear();
    const visible = Math.min(this.remaining, 9);
    const startX = CENTER_X - (visible - 1) * 12;
    for (let index = 0; index < visible; index += 1) {
      this.queueGraphics.fillStyle(index === 0 ? 0xff6a51 : 0x101114, index === 0 ? 1 : .42);
      this.queueGraphics.fillCircle(startX + index * 24, 782, 4);
    }
  }

  private completeLevel() {
    this.changingLevel = true;
    this.shooting = false;
    this.hintText.setText("LEVEL CLEAR").setColor("#5c7cff");
    this.cameras.main.flash(180, 92, 124, 255, false);
    const saved = this.storage.load();
    this.storage.save({ highLevel: Math.max(saved.highLevel, this.level + 1), highScore: Math.max(saved.highScore, this.score) });
    this.time.delayedCall(820, () => {
      this.level += 1;
      this.startLevel();
    });
  }

  private failLevel() {
    this.ended = true;
    this.shooting = false;
    this.shooter?.setAlpha(.22);
    this.cameras.main.shake(220, .012);
    this.cameras.main.flash(140, 255, 47, 47, false);
    this.hintText.setText("撞针了 · 点击重新开始").setColor("#ff453a");
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highLevel: Math.max(saved.highLevel, this.level), highScore });
    const bestText = this.children.getByName("best-score") as Phaser.GameObjects.Text | null;
    bestText?.setText(`BEST  ${String(highScore).padStart(4, "0")}`);
    this.bridge.gameOver(this.score);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: "#f3f0e8",
  render: { antialias: true, roundPixels: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: WIDTH, height: HEIGHT },
  scene: PinGapScene,
});
