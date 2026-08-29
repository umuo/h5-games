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
const GRAVITY = 1500;
const FLAP_VELOCITY = -430;
const PIPE_SPEED = 170;
const PIPE_GAP = 190;
const PIPE_INTERVAL = 1500;

interface PipePair {
  top: Phaser.GameObjects.Rectangle;
  bottom: Phaser.GameObjects.Rectangle;
  gapCenter: number;
  scored: boolean;
}

class FlapBirdScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private bird!: Phaser.GameObjects.Container;
  private pipes: PipePair[] = [];
  private birdY = 400;
  private vy = 0;
  private nextPipeAt = 0;
  private score = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "flap-bird", version: "1.0.0" });
  private storage = createGameStorage("flap-bird", { highScore: 0 });

  constructor() { super("flap-bird"); }

  create() {
    this.birdY = 400;
    this.vy = 0;
    this.pipes = [];
    this.nextPipeAt = 0;
    this.score = 0;
    this.started = false;
    this.ended = false;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#8fd3f4");
    for (let index = 0; index < 10; index += 1) {
      const cloud = this.add.ellipse(
        Phaser.Math.Between(20, WIDTH - 20),
        Phaser.Math.Between(60, 760),
        Phaser.Math.Between(70, 130),
        Phaser.Math.Between(18, 30),
        0xffffff,
      ).setAlpha(.5).setDepth(0);
      this.tweens.add({
        targets: cloud,
        x: "-=40",
        duration: Phaser.Math.FloatBetween(6000, 12000),
        repeat: -1,
        yoyo: true,
      });
    }
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0x101114, .25);
    this.scoreText = this.add.text(CENTER_X, 66, "0", {
      fontFamily: "monospace", fontSize: "42px", color: "#ffffff", fontStyle: "bold",
    }).setOrigin(.5, 0).setStroke("#101114", 2);
    const saved = this.storage.load();
    this.bestText = this.add.text(CENTER_X, 126, `BEST ${saved.highScore}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#ffffff", letterSpacing: 1,
    }).setOrigin(.5, 0).setStroke("#101114", 2).setName("best-score");
    this.hintText = this.add.text(CENTER_X, 760, "轻点振翅 · 穿过管道缝隙", {
      fontFamily: "sans-serif", fontSize: "14px", color: "#ffffff",
    }).setOrigin(.5).setStroke("#101114", 2);

    this.bird = this.add.container(CENTER_X, this.birdY, [
      this.add.circle(0, 0, 15, 0xffd44d).setStrokeStyle(2, 0x101114, .7),
      this.add.circle(-5, -4, 2.4, 0x101114),
      this.add.triangle(12, 2, -4, -4, -4, 4, 8, 0, 0xff9d3d),
      this.add.ellipse(-6, 4, 12, 7, 0xfff3b0),
    ]).setDepth(8);

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private bindInput() {
    this.input.on("pointerdown", () => {
      if (this.ended) return;
      if (!this.started) {
        this.started = true;
        this.nextPipeAt = this.time.now + 900;
        this.bridge.started();
        this.audio.unlock();
        this.tweens.add({ targets: this.hintText, alpha: 0, duration: 300 });
      }
      this.vy = FLAP_VELOCITY;
      this.audio.tone({ freq: 500, endFreq: 700, duration: .08, type: "square", gain: .09 });
    });
  }

  private spawnPipe() {
    const gapCenter = Phaser.Math.Between(210, 630);
    const pipeWidth = 62;
    const topHeight = gapCenter - PIPE_GAP / 2;
    const top = this.add.rectangle(CENTER_X + 60, topHeight / 2, pipeWidth, topHeight, 0x67c784)
      .setStrokeStyle(2, 0x101114, .5).setDepth(5);
    const bottomY = gapCenter + PIPE_GAP / 2;
    const bottomHeight = HEIGHT - bottomY;
    const bottom = this.add.rectangle(CENTER_X + 60, bottomY + bottomHeight / 2, pipeWidth, bottomHeight, 0x67c784)
      .setStrokeStyle(2, 0x101114, .5).setDepth(5);
    this.pipes.push({ top, bottom, gapCenter, scored: false });
  }

  update(_time: number, delta: number) {
    if (this.ended) return;
    const seconds = Math.min(delta, 40) / 1000;

    if (this.started) {
      this.vy += GRAVITY * seconds;
      this.birdY += this.vy * seconds;
      this.bird.setPosition(CENTER_X, this.birdY);
      this.bird.angle = Phaser.Math.Clamp(this.vy / 12, -18, 60);

      for (const pipe of this.pipes) {
        pipe.top.x -= PIPE_SPEED * seconds;
        pipe.bottom.x -= PIPE_SPEED * seconds;
      }
      this.pipes = this.pipes.filter((pipe) => {
        if (pipe.top.x < -60) {
          pipe.top.destroy();
          pipe.bottom.destroy();
          return false;
        }
        return true;
      });
      if (_time >= this.nextPipeAt) {
        this.nextPipeAt = _time + PIPE_INTERVAL;
        this.spawnPipe();
      }

      for (const pipe of this.pipes) {
        const pipeCenterX = pipe.top.x;
        if (!pipe.scored && pipeCenterX < CENTER_X - 20) {
          pipe.scored = true;
          this.score += 1;
          this.scoreText.setText(String(this.score));
          this.bridge.score(this.score);
          const saved = this.storage.load();
          if (this.score > saved.highScore) {
            this.storage.save({ highScore: this.score });
            this.bestText.setText(`BEST ${this.score}`);
          }
          this.audio.tone({ freq: 700, duration: .07, type: "triangle", gain: .12 });
        }
        const withinPipeX = Math.abs(pipeCenterX - CENTER_X) < 31 + 12;
        if (withinPipeX) {
          const gapTop = pipe.gapCenter - PIPE_GAP / 2;
          const gapBottom = pipe.gapCenter + PIPE_GAP / 2;
          if (this.birdY - 13 < gapTop || this.birdY + 13 > gapBottom) {
            this.endRun();
            return;
          }
        }
      }
    } else {
      this.birdY = 400 + Math.sin(_time / 260) * 16;
      this.bird.setPosition(CENTER_X, this.birdY);
    }

    if (this.birdY > HEIGHT - 30 || this.birdY < -40) {
      this.endRun();
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    this.cameras.main.shake(240, .014);
    this.audio.noise({ freq: 800, duration: .3, gain: .22 });
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    this.bestText.setText(`BEST ${highScore}`);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .55)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0xf3f0e8)
      .setStrokeStyle(2, 0x101114).setDepth(101);
    this.add.text(CENTER_X, 502, "小鸟坠地", {
      fontFamily: "sans-serif", fontSize: "25px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `${this.score} 分  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "12px", color: "#777872", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0x101114)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "再飞一次  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    replay.on("pointerup", () => this.scene.restart());
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: [shade, panel], alpha: { from: 0, to: 1 }, duration: 200 });
  }
}

const INK = "#101114";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#8fd3f4",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: FlapBirdScene,
});
