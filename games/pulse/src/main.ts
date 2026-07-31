import Phaser from "phaser";
import {
  bindGameLifecycle,
  configureHiDpiCamera,
  createGameBridge,
  createGameStorage,
  getGameRenderDpr,
  sharpenSceneText,
} from "@web-games/game-sdk";
import "./style.css";

const WIDTH = 390;
const HEIGHT = 844;
const RENDER_DPR = getGameRenderDpr();
const TARGET_RADIUS = 92;

class PulseScene extends Phaser.Scene {
  private ring!: Phaser.GameObjects.Graphics;
  private feedback!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private radius = 190;
  private speed = 72;
  private score = 0;
  private combo = 0;
  private lives = 3;
  private activeRound = false;
  private ended = false;
  private resolving = false;
  private round = 0;
  private bridge = createGameBridge({ gameId: "pulse", version: "1.2.0" });
  private storage = createGameStorage("pulse", { highScore: 0 });

  constructor() { super("pulse"); }

  create() {
    this.resetState();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 42, 42, 0x101114, 1, 0x2b2d32, .35);
    this.add.text(24, 31, "PULSE / 001", { fontFamily: "monospace", fontSize: "12px", color: "#dfff3f", letterSpacing: 2 });
    this.add.text(WIDTH - 24, 31, "反应力", { fontFamily: "sans-serif", fontSize: "12px", color: "#73757d" }).setOrigin(1, 0);

    this.scoreText = this.add.text(24, 69, "0000", { fontFamily: "monospace", fontSize: "48px", color: "#f3f0e8", fontStyle: "bold" });
    this.comboText = this.add.text(27, 121, "COMBO  ×  0", { fontFamily: "monospace", fontSize: "11px", color: "#73757d", letterSpacing: 2 });
    this.livesText = this.add.text(WIDTH - 24, 79, "● ● ●", { fontFamily: "monospace", fontSize: "12px", color: "#ff6a51", letterSpacing: 5 }).setOrigin(1, 0);
    this.roundText = this.add.text(WIDTH - 24, 116, "ROUND 00", {
      fontFamily: "monospace", fontSize: "9px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0);

    const centerX = WIDTH / 2;
    const centerY = 420;
    this.add.circle(centerX, centerY, TARGET_RADIUS, 0x101114).setStrokeStyle(2, 0xdfff3f, .9);
    this.add.circle(centerX, centerY, TARGET_RADIUS - 12, 0x101114).setStrokeStyle(1, 0xdfff3f, .22);
    this.add.circle(centerX, centerY, 20, 0xdfff3f);
    this.add.circle(centerX, centerY, 6, 0x101114);
    this.ring = this.add.graphics();

    this.feedback = this.add.text(centerX, centerY - 8, "", { fontFamily: "monospace", fontSize: "15px", color: "#f3f0e8", fontStyle: "bold" }).setOrigin(.5);
    this.hintText = this.add.text(centerX, 660, "点击屏幕 · 开始校准", { fontFamily: "sans-serif", fontSize: "16px", color: "#f3f0e8" }).setOrigin(.5);
    this.add.text(centerX, 700, "在光环与目标环重合时点击", { fontFamily: "sans-serif", fontSize: "12px", color: "#73757d" }).setOrigin(.5);
    this.add.text(centerX, HEIGHT - 42, "TAP TO SYNC  ·  BEST 0000", { fontFamily: "monospace", fontSize: "10px", color: "#55575d", letterSpacing: 1 }).setOrigin(.5).setName("footer");

    const highScore = this.storage.load().highScore;
    this.children.getByName("footer")?.setData("highScore", highScore);
    this.refreshFooter(highScore);

    const handlePointer = () => this.handleTap();
    this.input.on("pointerup", handlePointer);
    bindGameLifecycle(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off("pointerup", handlePointer);
    });
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  update(_time: number, delta: number) {
    if (!this.activeRound || this.ended) return;
    this.radius -= this.speed * (delta / 1000);
    this.drawRing();
    if (this.radius < 45) this.resolveTap(false, 999);
  }

  private resetState() {
    this.radius = 190;
    this.speed = 72;
    this.score = 0;
    this.combo = 0;
    this.lives = 3;
    this.round = 0;
    this.activeRound = false;
    this.ended = false;
    this.resolving = false;
  }

  private handleTap() {
    if (this.ended || this.resolving) return;
    if (!this.activeRound) {
      this.activeRound = true;
      this.hintText.setText("看准光环");
      this.bridge.started();
      this.startRound();
      return;
    }
    this.resolveTap(true, Math.abs(this.radius - TARGET_RADIUS));
  }

  private resolveTap(wasTap: boolean, distance: number) {
    if (this.resolving || this.ended) return;
    this.resolving = true;
    this.activeRound = false;
    if (wasTap && distance <= 9) {
      this.combo += 1;
      this.score += 100 + this.combo * 12;
      this.showFeedback("PERFECT", "#dfff3f");
    } else if (wasTap && distance <= 20) {
      this.combo += 1;
      this.score += 55 + this.combo * 6;
      this.showFeedback("GOOD", "#5c7cff");
    } else {
      this.combo = 0;
      this.lives -= 1;
      this.showFeedback(wasTap ? "太早 / 太晚" : "MISS", "#ff6a51");
      this.cameras.main.shake(100, .006);
    }

    this.scoreText.setText(String(this.score).padStart(4, "0"));
    this.comboText.setText(`COMBO  ×  ${this.combo}`);
    this.livesText.setText(Array.from({ length: 3 }, (_, index) => index < this.lives ? "●" : "○").join(" "));
    this.bridge.score(this.score);

    if (this.lives <= 0) {
      this.finishGame();
    } else {
      this.time.delayedCall(560, () => this.startRound());
    }
  }

  private startRound() {
    this.resolving = false;
    this.round += 1;
    this.radius = Phaser.Math.Between(176, 206);
    this.speed = Phaser.Math.Between(72, 98) + Math.min(this.score / 85, 34);
    this.activeRound = true;
    this.feedback.setText("");
    this.roundText.setText(`ROUND ${String(this.round).padStart(2, "0")}`);
    this.drawRing();
  }

  private drawRing() {
    this.ring.clear();
    this.ring.lineStyle(7, 0xff6a51, 1);
    this.ring.strokeCircle(WIDTH / 2, 420, this.radius);
    this.ring.lineStyle(1, 0xf3f0e8, .22);
    this.ring.strokeCircle(WIDTH / 2, 420, this.radius + 13);
  }

  private showFeedback(label: string, color: string) {
    this.feedback.setText(label).setColor(color).setAlpha(1).setScale(.8);
    this.tweens.add({ targets: this.feedback, scale: 1.12, alpha: 0, duration: 520, ease: "Quad.easeOut" });
  }

  private finishGame() {
    this.ended = true;
    this.ring.clear();
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.refreshFooter(highScore);
    this.hintText.setText(`本局 ${this.score} 分 · 校准结束`).setColor("#dfff3f");
    this.bridge.gameOver(this.score);
    this.showResult(highScore);
  }

  private refreshFooter(highScore: number) {
    const footer = this.children.getByName("footer") as Phaser.GameObjects.Text | null;
    footer?.setText(`TAP TO SYNC  ·  BEST ${String(highScore).padStart(4, "0")}`);
  }

  private showResult(highScore: number) {
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .72)
      .setDepth(100);
    const panel = this.add.rectangle(WIDTH / 2, 430, 310, 250, 0x1d1e22)
      .setStrokeStyle(2, 0xdfff3f, .85)
      .setDepth(101);
    const pulse = this.add.circle(WIDTH / 2, 355, 27, 0xdfff3f)
      .setStrokeStyle(2, 0xf3f0e8, .45)
      .setDepth(102);
    this.add.circle(WIDTH / 2, 355, 8, 0x101114).setDepth(103);
    this.add.text(WIDTH / 2, 401, "校准结束", {
      fontFamily: "sans-serif", fontSize: "26px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(WIDTH / 2, 441, `${this.score} 分  ·  连击 ${this.combo}  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(WIDTH / 2, 501, 196, 48, 0xdfff3f)
      .setStrokeStyle(1, 0xf3f0e8, .5)
      .setInteractive({ useHandCursor: true })
      .setDepth(102);
    this.add.text(WIDTH / 2, 501, "再校准一次  ↻", {
      fontFamily: "sans-serif", fontSize: "14px", color: "#101114", fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    replay.on("pointerup", () => this.scene.restart());
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({
      targets: [shade, panel, pulse, replay],
      alpha: { from: 0, to: 1 },
      duration: 190,
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#101114",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: PulseScene,
});
