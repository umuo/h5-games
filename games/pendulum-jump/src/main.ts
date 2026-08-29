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
const GRAVITY = 1400;
const ROPE_LENGTH = 130;
const ANCHOR_SCREEN_Y = 300;

interface Platform {
  container: Phaser.GameObjects.Container;
  x: number;
  y: number;
  width: number;
}

class PendulumJumpScene extends Phaser.Scene {
  private world!: Phaser.GameObjects.Container;
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private ropeGraphics!: Phaser.GameObjects.Graphics;
  private anchorDot!: Phaser.GameObjects.Arc;
  private bob!: Phaser.GameObjects.Container;
  private platforms: Platform[] = [];
  private anchor = new Phaser.Math.Vector2(CENTER_X, ANCHOR_SCREEN_Y);
  private theta = 0.9;
  private omega = 0;
  private bobX = 0;
  private bobY = 0;
  private velocity = new Phaser.Math.Vector2();
  private mode: "swing" | "fly" | "over" = "swing";
  private score = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "pendulum-jump", version: "1.0.0" });
  private storage = createGameStorage("pendulum-jump", { highScore: 0 });

  constructor() { super("pendulum-jump"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#12172b");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 44, 44, 0x12172b, 1, 0x232a44, .5);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "SWING / 038", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "钟摆跳", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(CENTER_X, 60, "0", {
      fontFamily: "monospace", fontSize: "40px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5, 0);
    const saved = this.storage.load();
    this.bestText = this.add.text(CENTER_X, 112, `BEST ${saved.highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(.5, 0).setName("best-score");
    this.hintText = this.add.text(CENTER_X, 790, "看准摆荡方向 · 点击松手飞向下一平台", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    this.ropeGraphics = this.add.graphics().setDepth(4);
    this.anchorDot = this.add.circle(this.anchor.x, this.anchor.y, 7, 0xdfff3f).setDepth(5);
    this.world.add(this.anchorDot);
    const body = this.add.circle(0, 0, 14, 0xffb84d).setStrokeStyle(2, 0x101114, .6);
    const eye = this.add.circle(-4, -3, 2, 0x101114);
    const eye2 = this.add.circle(4, -3, 2, 0x101114);
    this.bob = this.add.container(0, 0, [body, eye, eye2]).setDepth(6);
    this.world.add(this.bob);

    this.platforms.push(this.makePlatform(CENTER_X, ANCHOR_SCREEN_Y + ROPE_LENGTH + 24, 110));
    this.spawnNextPlatform();

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.platforms = [];
    this.anchor = new Phaser.Math.Vector2(CENTER_X, ANCHOR_SCREEN_Y);
    this.theta = .9;
    this.omega = 0;
    this.mode = "swing";
    this.score = 0;
    this.started = false;
    this.ended = false;
  }

  private makePlatform(x: number, y: number, width: number): Platform {
    const container = this.add.container(x, y);
    const g = this.add.graphics();
    g.fillStyle(0x3a4470, 1);
    g.fillRoundedRect(-width / 2, 0, width, 14, 7);
    g.fillStyle(0xdfff3f, .55);
    g.fillRoundedRect(-width / 2 + 4, 2, width - 8, 4, 2);
    g.lineStyle(1.5, 0x101114, .5);
    g.strokeRoundedRect(-width / 2, 0, width, 14, 7);
    container.add(g);
    this.world.add(container);
    const platform: Platform = { container, x, y, width };
    this.platforms.push(platform);
    return platform;
  }

  private lastPlatform() {
    return this.platforms[this.platforms.length - 1];
  }

  private spawnNextPlatform() {
    const last = this.lastPlatform();
    const direction = this.platforms.length % 2 === 0 ? -1 : 1;
    const distance = Phaser.Math.Between(100, 190);
    let x = last.x + direction * distance;
    if (x < 60 || x > WIDTH - 60) x = last.x - direction * distance;
    const y = last.y - Phaser.Math.Between(70, 140);
    this.makePlatform(x, y, Phaser.Math.Between(80, 130));
  }

  private bindInput() {
    this.input.on("pointerdown", () => {
      if (this.ended || this.mode !== "swing") return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      this.release();
    });
  }

  private release() {
    this.mode = "fly";
    const speed = ROPE_LENGTH * Math.abs(this.omega);
    const sign = Math.sign(this.omega) || 1;
    this.velocity.set(
      Math.cos(this.theta) * speed * sign,
      -Math.sin(this.theta) * speed * sign,
    );
    this.audio.noise({ freq: 1500, duration: .08, gain: .12 });
  }

  private attachTo(platform: Platform) {
    this.mode = "swing";
    this.score += 1;
    this.scoreText.setText(String(this.score));
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
      this.bestText.setText(`BEST ${this.score}`);
    }
    this.anchor.set(this.bobX, platform.y - ROPE_LENGTH - 4);
    this.theta = Phaser.Math.Clamp(this.velocity.x / ROPE_LENGTH * .08, -.5, .5) || .25;
    this.omega = 0;
    this.anchorDot.setPosition(this.anchor.x, this.anchor.y);
    this.audio.tone({ freq: 420, duration: .08, type: "triangle", gain: .14 });
    this.spawnNextPlatform();
    const worldTarget = ANCHOR_SCREEN_Y - this.anchor.y;
    this.tweens.add({ targets: this.world, y: worldTarget, duration: 260, ease: "Cubic.easeOut" });
  }

  update(_time: number, delta: number) {
    if (this.ended) return;
    const seconds = Math.min(delta, 40) / 1000;

    if (this.mode === "swing") {
      const angularAccel = -(GRAVITY / ROPE_LENGTH) * Math.sin(this.theta);
      this.omega += angularAccel * seconds;
      this.theta += this.omega * seconds;
      this.bobX = this.anchor.x + Math.sin(this.theta) * ROPE_LENGTH;
      this.bobY = this.anchor.y + Math.cos(this.theta) * ROPE_LENGTH;
    } else if (this.mode === "fly") {
      this.velocity.y += GRAVITY * seconds;
      const previousY = this.bobY;
      this.bobX += this.velocity.x * seconds;
      this.bobY += this.velocity.y * seconds;
      for (const platform of this.platforms) {
        if (this.bobY >= platform.y && previousY <= platform.y + 8
          && Math.abs(this.bobX - platform.x) <= platform.width / 2 + 8) {
          this.attachTo(platform);
          break;
        }
      }
      if (this.mode === "fly" && this.bobY > ANCHOR_SCREEN_Y + 700 - this.world.y) {
        this.endRun();
        return;
      }
    }

    if (this.mode === "swing" || this.mode === "fly") {
      this.bob.setPosition(this.bobX, this.bobY);
    }
    this.ropeGraphics.clear();
    if (this.mode === "swing") {
      this.ropeGraphics.lineStyle(2.2, 0xdfff3f, .8);
      this.ropeGraphics.lineBetween(this.anchor.x, this.anchor.y, this.bobX, this.bobY);
    } else if (this.mode === "fly") {
      this.ropeGraphics.lineStyle(1.4, 0xdfff3f, .25);
      this.ropeGraphics.lineBetween(this.anchor.x, this.anchor.y, this.bobX, this.bobY);
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    this.mode = "over";
    this.audio.tone({ freq: 280, endFreq: 70, duration: .6, type: "sawtooth", gain: .22 });
    this.cameras.main.shake(180, .01);
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    this.bestText.setText(`BEST ${highScore}`);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x12172b, .65)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0x1b2038)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(CENTER_X, 502, "脱手坠落", {
      fontFamily: "sans-serif", fontSize: "25px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `${this.score} 段  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "12px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "重新摆荡  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#12172b", fontStyle: "bold",
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
  backgroundColor: "#12172b",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: PendulumJumpScene,
});
