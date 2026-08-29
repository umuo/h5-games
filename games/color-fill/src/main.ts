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
const SIZE = 14;
const TILE = 24;
const BOARD_X = CENTER_X - (SIZE * TILE) / 2;
const BOARD_Y = 170;
const COLOR_SET = [0xff5f6d, 0x54e0ff, 0x9fe08a, 0xffd44d, 0x9b6bff, 0xffa63d];

class ColorFillScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private movesText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private board: number[][] = [];
  private tiles: Phaser.GameObjects.Rectangle[][] = [];
  private palette: Array<{ color: number; rect: Phaser.GameObjects.Rectangle }> = [];
  private movesLeft = 0;
  private level = 1;
  private started = false;
  private ended = false;
  private busy = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "color-fill", version: "1.0.0" });
  private storage = createGameStorage("color-fill", { level: 1 });

  constructor() { super("color-fill"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "FILL / 047", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "色彩蔓延", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 70, "第 1 关", {
      fontFamily: "sans-serif", fontSize: "21px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.movesText = this.add.text(WIDTH - 22, 78, "", {
      fontFamily: "monospace", fontSize: "12px", color: "#dfff3f", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.hintText = this.add.text(CENTER_X, 700, "从左上角的色块开始向外蔓延", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        this.add.rectangle(
          BOARD_X + col * TILE + TILE / 2,
          BOARD_Y + row * TILE + TILE / 2,
          TILE - 2, TILE - 2, 0x1b1d21,
        );
      }
    }

    this.buildPalette();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.level = this.storage.load().level;
    this.loadLevel(this.level);
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private loadLevel(level: number) {
    this.level = level;
    this.movesLeft = 25 + Math.min(level, 10);
    this.ended = false;
    this.busy = false;
    this.levelText.setText(`第 ${level} 关`);
    this.movesText.setText(`剩余 ${this.movesLeft} 步`);
    this.board = Array.from({ length: SIZE }, () =>
      Array.from({ length: SIZE }, () => Phaser.Math.Between(0, COLOR_SET.length - 1)));
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (!this.tiles[row]) this.tiles[row] = [];
        const existing = this.tiles[row][col];
        const color = COLOR_SET[this.board[row][col]];
        if (existing) {
          existing.setFillStyle(color);
        } else {
          this.tiles[row][col] = this.add.rectangle(
            BOARD_X + col * TILE + TILE / 2,
            BOARD_Y + row * TILE + TILE / 2,
            TILE - 2, TILE - 2, color,
          );
        }
      }
    }
  }

  private buildPalette() {
    COLOR_SET.forEach((color, index) => {
      const x = CENTER_X - (COLOR_SET.length * 52) / 2 + index * 52 + 26;
      const rect = this.add.rectangle(x, 632, 46, 46, color)
        .setStrokeStyle(2.5, 0x101114, .55)
        .setInteractive({ useHandCursor: true });
      this.palette.push({ color, rect });
      rect.on("pointerup", () => this.pickColor(index));
    });
  }

  private pickColor(index: number) {
    if (this.busy || this.ended) return;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.audio.unlock();
    }
    const root = this.board[0][0];
    if (index === root) return;
    this.movesLeft -= 1;
    this.movesText.setText(`剩余 ${this.movesLeft} 步`);
    this.audio.tone({ freq: 300 + index * 50, duration: .07, type: "sine", gain: .1 });

    this.board = this.board.map((rowCells) =>
      rowCells.map((value) => (value === root ? index : value)));
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        this.tiles[row][col].setFillStyle(COLOR_SET[this.board[row][col]]);
      }
    }

    if (this.board.every((rowCells) => rowCells.every((value) => value === index))) {
      this.winLevel();
      return;
    }
    if (this.movesLeft <= 0) {
      this.endRun();
    }
  }

  private winLevel() {
    this.ended = true;
    const bonus = this.movesLeft * 30;
    this.bridge.score(100 + bonus);
    this.storage.save({ level: this.level + 1 });
    this.audio.tone({ freq: 523, duration: .15, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .14, type: "triangle", gain: .2 });
    const banner = this.add.text(CENTER_X, BOARD_Y + (SIZE * TILE) / 2, `通关！+${100 + bonus}`, {
      fontFamily: "sans-serif", fontSize: "28px", color: "#dfff3f", fontStyle: "bold", letterSpacing: 4,
    }).setOrigin(.5).setDepth(20).setAlpha(0);
    this.tweens.add({ targets: banner, alpha: 1, duration: 200 });
    this.time.delayedCall(1100, () => this.loadLevel(this.level + 1));
  }

  private endRun() {
    this.ended = true;
    this.audio.tone({ freq: 280, endFreq: 90, duration: .55, type: "sawtooth", gain: .2 });
    this.bridge.gameOver(this.level * 50);
    const banner = this.add.text(CENTER_X, BOARD_Y + (SIZE * TILE) / 2, "步数用完", {
      fontFamily: "sans-serif", fontSize: "26px", color: "#ff6a51", fontStyle: "bold",
    }).setOrigin(.5).setDepth(20);
    const replay = this.add.rectangle(CENTER_X, HEIGHT / 2 + 80, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(21);
    this.add.text(CENTER_X, HEIGHT / 2 + 80, `重试第 ${this.level} 关`, {
      fontFamily: "sans-serif", fontSize: "13px", color: "#101114", fontStyle: "bold",
    }).setOrigin(.5).setDepth(22);
    replay.on("pointerup", () => this.loadLevel(this.level));
    this.tweens.add({ targets: [banner, replay], alpha: { from: 0, to: 1 }, duration: 220 });
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
  scene: ColorFillScene,
});
