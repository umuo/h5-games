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
const PAD_TONES = [329.6, 392, 493.9, 587.3];
const PAD_COLORS = [0x9fe08a, 0xff6a51, 0xffd44d, 0x54e0ff];
const PAD_POSITIONS = [
  { x: CENTER_X - 74, y: 360 },
  { x: CENTER_X + 74, y: 360 },
  { x: CENTER_X - 74, y: 508 },
  { x: CENTER_X + 74, y: 508 },
];

type Phase = "idle" | "showing" | "input" | "over";

class MemorySequenceScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private pads: Array<{ index: number; base: Phaser.GameObjects.Rectangle; glow: Phaser.GameObjects.Rectangle }> = [];
  private sequence: number[] = [];
  private inputIndex = 0;
  private phase: Phase = "idle";
  private level = 0;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "memory-sequence", version: "1.0.0" });
  private storage = createGameStorage("memory-sequence", { highScore: 0 });

  constructor() { super("memory-sequence"); }

  create() {
    this.sequence = [];
    this.level = 0;
    this.inputIndex = 0;
    this.phase = "idle";
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 40, 40, 0x101114, 1, 0x2b2d32, .35);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "ECHO / 027", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "记忆序列", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(CENTER_X, 66, "第 0 轮", {
      fontFamily: "monospace", fontSize: "30px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5, 0);
    const saved = this.storage.load();
    this.bestText = this.add.text(CENTER_X, 112, `BEST ${saved.highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(.5, 0).setName("best-score");
    this.statusText = this.add.text(CENTER_X, 240, "点击任意处开始", {
      fontFamily: "sans-serif", fontSize: "17px", color: "#dfff3f", fontStyle: "bold",
    }).setOrigin(.5);

    for (let index = 0; index < 4; index += 1) {
      const { x, y } = PAD_POSITIONS[index];
      const base = this.add.rectangle(x, y, 128, 128, PAD_COLORS[index], .32)
        .setStrokeStyle(2.5, PAD_COLORS[index], .75);
      const glow = this.add.rectangle(x, y, 128, 128, PAD_COLORS[index], 0);
      this.pads.push({ index, base, glow });
    }
    const hint = this.add.text(CENTER_X, 640, "看序列亮灯 · 按同样顺序按亮", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
    void hint;
  }

  private flashPad(index: number, duration = 300) {
    const pad = this.pads[index];
    pad.glow.setAlpha(.85);
    this.audio.tone({ freq: PAD_TONES[index], duration: duration / 1000 + .05, type: "triangle", gain: .22 });
    this.tweens.add({ targets: pad.glow, alpha: 0, duration: duration });
    this.tweens.add({ targets: pad.base, scale: { from: 1.06, to: 1 }, duration: duration });
  }

  private startRound() {
    this.level += 1;
    this.scoreText.setText(`第 ${this.level - 1} 轮`);
    const saved = this.storage.load();
    if (this.level - 1 > saved.highScore) {
      this.storage.save({ highScore: this.level - 1 });
      this.bestText.setText(`BEST ${this.level - 1}`);
    }
    this.sequence.push(Phaser.Math.Between(0, 3));
    this.inputIndex = 0;
    this.phase = "showing";
    this.statusText.setText("看好了…");
    const stepMs = Math.max(260, 480 - this.level * 14);
    this.sequence.forEach((padIndex, order) => {
      this.time.delayedCall(500 + order * stepMs, () => {
        if (this.phase !== "showing") return;
        this.flashPad(padIndex, stepMs * .62);
      });
    });
    this.time.delayedCall(500 + this.sequence.length * stepMs + 120, () => {
      if (this.phase !== "showing") return;
      this.phase = "input";
      this.statusText.setText("轮到你了");
    });
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.phase === "over") return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      if (this.phase === "idle") {
        this.audio.unlock();
        this.startRound();
        return;
      }
      if (this.phase !== "input") return;
      const pad = this.pads.find(({ base }) =>
        Math.abs(base.x - position.x) <= 70 && Math.abs(base.y - position.y) <= 70);
      if (!pad) return;
      this.flashPad(pad.index, 170);
      const expected = this.sequence[this.inputIndex];
      if (pad.index !== expected) {
        this.failRound();
        return;
      }
      this.inputIndex += 1;
      if (this.inputIndex >= this.sequence.length) {
        this.phase = "idle";
        this.statusText.setText("正确！下一轮…");
        this.audio.tone({ freq: 784, duration: .18, type: "triangle", gain: .16 });
        this.time.delayedCall(750, () => this.startRound());
      }
    });
  }

  private failRound() {
    this.phase = "over";
    this.audio.tone({ freq: 200, endFreq: 90, duration: .6, type: "sawtooth", gain: .24 });
    this.cameras.main.shake(260, .012);
    const score = this.level - 1;
    this.bridge.gameOver(score);
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, score);
    this.storage.save({ highScore });
    this.bestText.setText(`BEST ${highScore}`);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .62)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0x1b1d21)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(CENTER_X, 500, "记岔了", {
      fontFamily: "sans-serif", fontSize: "25px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 542, `撑过 ${score} 轮  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "12px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "重头再来  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#101114", fontStyle: "bold",
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
  backgroundColor: "#101114",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: MemorySequenceScene,
});
