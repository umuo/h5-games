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
const COLS = 10;
const ROWS = 13;
const CELL = 30;
const BOARD_X = CENTER_X - (COLS * CELL) / 2;
const BOARD_Y = 168;
const TYPE_COUNT = 5;
const MIN_GROUP = 2;

const COLORS = [0xff5f6d, 0x54e0ff, 0x9fe08a, 0xffd44d, 0x9b6bff];

class SamePopScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private blocks: Array<Array<{ rect: Phaser.GameObjects.Rectangle; type: number } | null>> = [];
  private selected: Array<{ col: number; row: number }> = [];
  private score = 0;
  private started = false;
  private ended = false;
  private busy = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "same-pop", version: "1.0.0" });
  private storage = createGameStorage("same-pop", { highScore: 0 });

  constructor() { super("same-pop"); }

  create() {
    this.blocks = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.selected = [];
    this.score = 0;
    this.started = false;
    this.ended = false;
    this.busy = false;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 40, 40, 0x101114, 1, 0x2b2d32, .35);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "POP / 034", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "点点消除", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(22, 66, "0", {
      fontFamily: "monospace", fontSize: "38px", color: "#f3f0e8", fontStyle: "bold",
    });
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 22, 76, `BEST ${saved.highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.hintText = this.add.text(CENTER_X, 730, "点击相邻同色方块组成的片 · 片越大分越高", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        this.createBlock(col, row);
      }
    }

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private blockAt(col: number, row: number) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return this.blocks[row][col];
  }

  private createBlock(col: number, row: number) {
    const type = Phaser.Math.Between(0, TYPE_COUNT - 1);
    const rect = this.add.rectangle(
      BOARD_X + col * CELL + CELL / 2,
      BOARD_Y + row * CELL + CELL / 2,
      CELL - 4, CELL - 4, COLORS[type],
    ).setStrokeStyle(1.5, 0x101114, .4).setInteractive({ useHandCursor: true });
    rect.setData("col", col);
    rect.setData("row", row);
    this.blocks[row][col] = { rect, type };
  }

  private groupAt(col: number, row: number) {
    const start = this.blockAt(col, row);
    if (!start) return [];
    const type = start.type;
    const seen = new Set<string>();
    const stack = [{ col, row }];
    const group: Array<{ col: number; row: number }> = [];
    while (stack.length > 0) {
      const current = stack.pop() as { col: number; row: number };
      const cellKey = `${current.col},${current.row}`;
      if (seen.has(cellKey)) continue;
      seen.add(cellKey);
      const block = this.blockAt(current.col, current.row);
      if (!block || block.type !== type) continue;
      group.push(current);
      stack.push(
        { col: current.col + 1, row: current.row },
        { col: current.col - 1, row: current.row },
        { col: current.col, row: current.row + 1 },
        { col: current.col, row: current.row - 1 },
      );
    }
    return group;
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.busy || this.ended) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const col = Math.floor((position.x - BOARD_X) / CELL);
      const row = Math.floor((position.y - BOARD_Y) / CELL);
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
      this.popGroup(col, row);
    });
  }

  private popGroup(col: number, row: number) {
    const group = this.groupAt(col, row);
    if (group.length < MIN_GROUP) {
      this.audio.tone({ freq: 190, duration: .07, type: "sawtooth", gain: .07 });
      return;
    }
    this.busy = true;
    const gained = group.length * group.length * 5;
    this.score += gained;
    this.scoreText.setText(String(this.score));
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
      this.bestText.setText(`BEST ${this.score}`);
    }
    const centroidCol = group.reduce((sum, cell) => sum + cell.col, 0) / group.length;
    const centroidRow = group.reduce((sum, cell) => sum + cell.row, 0) / group.length;
    const label = this.add.text(
      BOARD_X + centroidCol * CELL + CELL / 2,
      BOARD_Y + centroidRow * CELL + CELL / 2,
      `+${gained}`,
      { fontFamily: "monospace", fontSize: `${Math.min(15 + group.length, 26)}px`, color: "#dfff3f", fontStyle: "bold" },
    ).setOrigin(.5).setDepth(6);
    this.tweens.add({ targets: label, y: label.y - 36, alpha: 0, duration: 620, onComplete: () => label.destroy() });
    this.audio.tone({ freq: 320 + Math.min(group.length, 12) * 34, duration: .14, type: "triangle", gain: .18 });

    for (const cell of group) {
      const block = this.blocks[cell.row][cell.col];
      if (!block) continue;
      this.blocks[cell.row][cell.col] = null;
      this.tweens.add({
        targets: block.rect,
        scale: 0,
        angle: Phaser.Math.Between(-90, 90),
        duration: 170,
        ease: "Cubic.easeIn",
        onComplete: () => block.rect.destroy(),
      });
    }
    this.time.delayedCall(190, () => this.collapse());
  }

  private collapse() {
    for (let col = 0; col < COLS; col += 1) {
      let writeRow = ROWS - 1;
      for (let row = ROWS - 1; row >= 0; row -= 1) {
        const block = this.blocks[row][col];
        if (block) {
          if (writeRow !== row) {
            this.blocks[writeRow][col] = block;
            this.blocks[row][col] = null;
            block.rect.setData("row", writeRow);
          }
          const targetY = BOARD_Y + writeRow * CELL + CELL / 2;
          if (block.rect.y !== targetY) {
            this.tweens.add({ targets: block.rect, y: targetY, duration: 180, ease: "Cubic.easeIn" });
          }
          writeRow -= 1;
        }
      }
    }
    this.time.delayedCall(200, () => this.checkEnd());
  }

  private checkEnd() {
    const remaining = this.blocks.flat().filter(Boolean).length;
    if (remaining === 0) {
      this.score += 1500;
      this.scoreText.setText(String(this.score));
      this.refreshHigh();
      this.audio.tone({ freq: 660, duration: .2, type: "triangle", gain: .22 });
      this.audio.tone({ freq: 880, duration: .3, time: this.audio.now + .16, type: "triangle", gain: .22 });
    }
    let hasMove = false;
    for (let row = 0; row < ROWS && !hasMove; row += 1) {
      for (let col = 0; col < COLS && !hasMove; col += 1) {
        if (this.groupAt(col, row).length >= MIN_GROUP) hasMove = true;
      }
    }
    this.busy = false;
    if (!hasMove) this.endRun();
  }

  private refreshHigh() {
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
      this.bestText.setText(`BEST ${this.score}`);
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    const leftover = this.blocks.flat().filter(Boolean).length;
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .62)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 196, 0x1b1d21)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(CENTER_X, 500, leftover === 0 ? "完美清空！" : "没有可消的了", {
      fontFamily: "sans-serif", fontSize: "24px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `${this.score} 分  ·  残留 ${leftover}  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "再来一局  ↻", {
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
  scene: SamePopScene,
});
