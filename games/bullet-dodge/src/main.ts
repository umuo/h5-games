import Phaser from "phaser";
import {
  bindGameLifecycle,
  configureHiDpiCamera,
  createAudioKit,
  createGameBridge,
  createGameStorage,
  getGameRenderDpr,
  sharpenSceneText,
} from "@web-games/game-sdk";
import "./style.css";

const WIDTH = 390;
const HEIGHT = 844;
const RENDER_DPR = getGameRenderDpr();
const CENTER_X = WIDTH / 2;

interface Bullet {
  circle: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
}

interface Shooter {
  container: Phaser.GameObjects.Container;
  vx: number;
  fireAt: number;
  isTurret: boolean;
}

class BulletDodgeScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private player!: Phaser.GameObjects.Container;
  private bullets: Bullet[] = [];
  private shooters: Shooter[] = [];
  private targetX = CENTER_X;
  private targetY = 700;
  private timeSurvived = 0;
  private score = 0;
  private started = false;
  private ended = false;
  private nextShooterAt = 900;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "bullet-dodge", version: "1.0.0" });
  private storage = createGameStorage("bullet-dodge", { highScore: 0 });

  constructor() { super("bullet-dodge"); }

  create() {
    this.timeSurvived = 0;
    this.bullets = [];
    this.shooters = [];
    this.targetX = CENTER_X;
    this.score = 0;
    this.started = false;
    this.ended = false;
    this.nextShooterAt = 900;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#0a0a12");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 44, 44, 0x0a0a12, 1, 0x232a44, .5);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "DODGE / 041", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "弹幕躲避", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(CENTER_X, 64, "0.0s", {
      fontFamily: "monospace", fontSize: "34px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5, 0);
    const saved = this.storage.load();
    this.bestText = this.add.text(CENTER_X, 110, `BEST ${saved.highScore.toFixed(1)}s`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(.5, 0).setName("best-score");
    this.hintText = this.add.text(CENTER_X, 792, "拖动小机甲移动 · 弹雨会越来越密", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    this.player = this.add.container(CENTER_X, 700, [
      this.add.triangle(0, -2, -13, 12, 13, 12, 0, -14, 0x54e0ff).setStrokeStyle(2, 0x101114, .7),
      this.add.circle(0, 0, 3.5, 0xffffff),
    ]).setDepth(6);

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.targetX = position.x;
      this.targetY = position.y;
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || !pointer.isDown || !this.started) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.targetX = position.x;
      this.targetY = position.y;
    });
  }

  private spawnShooter(time: number) {
    const fromTop = Math.random() < .5;
    const x = Phaser.Math.Between(50, WIDTH - 50);
    const y = fromTop ? 130 : Phaser.Math.Between(300, 620);
    const container = this.add.container(x, y, [
      this.add.rectangle(0, 0, 30, 30, 0x9b6bff, .9).setStrokeStyle(2, 0x101114, .7),
      this.add.rectangle(0, 0, 10, 10, 0x0a0a12),
    ]).setDepth(5);
    container.angle = Math.random() * 360;
    this.shooters.push({
      container,
      vx: Phaser.Math.FloatBetween(-70, 70),
      fireAt: time + Phaser.Math.Between(300, 800),
      isTurret: false,
    });
    void time;
  }

  private firePattern(shooter: Shooter) {
    const kinds = ["aimed", "ring", "fan"];
    const kind = Phaser.Utils.Array.GetRandom(kinds);
    const speed = 150 + Math.min(this.timeSurvived * 2.4, 190);
    if (kind === "aimed") {
      const angle = Phaser.Math.Angle.Between(shooter.container.x, shooter.container.y, this.player.x, this.player.y);
      this.addBullet(shooter, angle, speed);
    } else if (kind === "ring") {
      const count = 9;
      for (let index = 0; index < count; index += 1) {
        this.addBullet(shooter, (index / count) * Math.PI * 2, speed * .8);
      }
    } else {
      const base = Phaser.Math.Angle.Between(shooter.container.x, shooter.container.y, this.player.x, this.player.y);
      for (const spread of [-.32, 0, .32]) {
        this.addBullet(shooter, base + spread, speed);
      }
    }
    this.audio.tone({ freq: 260, duration: .05, type: "square", gain: .05 });
  }

  private addBullet(shooter: Shooter, angle: number, speed: number) {
    const circle = this.add.circle(shooter.container.x, shooter.container.y, 4.4, 0xff6a51)
      .setStrokeStyle(1.4, 0xffffff, .55).setDepth(5);
    this.bullets.push({ circle, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }

  update(time: number, delta: number) {
    if (this.ended) return;
    const seconds = Math.min(delta, 40) / 1000;

    this.player.x = Phaser.Math.Linear(this.player.x, Phaser.Math.Clamp(this.targetX, 18, WIDTH - 18), Math.min(1, seconds * 7));
    this.player.y = Phaser.Math.Linear(this.player.y, Phaser.Math.Clamp(this.targetY, 160, 760), Math.min(1, seconds * 7));

    if (this.started) {
      this.timeSurvived += seconds;
      this.scoreText.setText(`${this.timeSurvived.toFixed(1)}s`);
      this.bridge.score(Math.round(this.timeSurvived * 10));
      const saved = this.storage.load();
      if (this.timeSurvived > saved.highScore) {
        this.storage.save({ highScore: this.timeSurvived });
        this.bestText.setText(`BEST ${this.timeSurvived.toFixed(1)}s`);
      }
      if (time >= this.nextShooterAt) {
        this.nextShooterAt = time + Math.max(500, 1400 - this.timeSurvived * 26);
        this.spawnShooter(time);
      }
    }

    for (let index = this.shooters.length - 1; index >= 0; index -= 1) {
      const shooter = this.shooters[index];
      shooter.container.x += shooter.vx * seconds;
      if (shooter.container.x < 40 || shooter.container.x > WIDTH - 40) shooter.vx *= -1;
      shooter.container.angle += 40 * seconds;
      if (this.started && time >= shooter.fireAt) {
        shooter.fireAt = time + Phaser.Math.Between(900, 1500);
        this.firePattern(shooter);
      }
      if (this.shooters.length > 7) {
        shooter.container.destroy();
        this.shooters.splice(index, 1);
      }
    }

    for (let index = this.bullets.length - 1; index >= 0; index -= 1) {
      const bullet = this.bullets[index];
      bullet.circle.x += bullet.vx * seconds;
      bullet.circle.y += bullet.vy * seconds;
      if (bullet.circle.x < -20 || bullet.circle.x > WIDTH + 20
        || bullet.circle.y < -20 || bullet.circle.y > HEIGHT + 20) {
        bullet.circle.destroy();
        this.bullets.splice(index, 1);
        continue;
      }
      if (Phaser.Math.Distance.Between(bullet.circle.x, bullet.circle.y, this.player.x, this.player.y) < 12) {
        bullet.circle.destroy();
        this.bullets.splice(index, 1);
        this.endRun();
        return;
      }
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    this.cameras.main.shake(240, .014);
    this.cameras.main.flash(150, 84, 224, 255, false);
    this.audio.noise({ freq: 900, duration: .35, gain: .26 });
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.timeSurvived);
    this.storage.save({ highScore });
    this.bridge.gameOver(Math.round(this.timeSurvived * 10));
    this.bestText.setText(`BEST ${highScore.toFixed(1)}s`);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x0a0a12, .66)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0x1b2038)
      .setStrokeStyle(2, 0x54e0ff).setDepth(101);
    this.add.text(CENTER_X, 502, "机甲被击中", {
      fontFamily: "sans-serif", fontSize: "25px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `存活 ${this.timeSurvived.toFixed(1)}s  ·  BEST ${highScore.toFixed(1)}s`, {
      fontFamily: "monospace", fontSize: "12px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0x54e0ff)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "重新出击  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#0a0a12", fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    replay.on("pointerup", () => this.scene.restart());
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: [shade, panel], alpha: { from: 0, to: 1 }, duration: 220 });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#0a0a12",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: BulletDodgeScene,
});
