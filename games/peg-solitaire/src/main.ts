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
const INK = "#101114";
const BOARD = [
  "..OOO..",
  "..OOO..",
  "OOOOOOO",
  "OOO#OOO",
  "OOOOOOO",
  "..OOO..",
  "..OOO..",
];
const ROWS = BOARD.length;
const COLS = BOARD[0].length;
const CELL = 46;
const BOARD_X = CENTER_X - (COLS * CELL) / 2;
const BOARD_Y = 190;

interface Cell {
  playable: boolean;
  peg: boolean;
  shape: Phaser.GameObjects.Ellipse | null;
}

class PegSolitaireScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private pegsText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private cells: Cell[][] = [];
  private selected?: { col: number; row: number };
  private moves = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "peg-solitaire", version: "1.0.0" });
  private storage = createGameStorage("peg-solitaire", { bestRemaining: 32 });

  constructor() { super("peg-solitaire"); }

  create() {
    this.cells = BOARD.map((rowString) =>
      rowString.split("").map((char) => ({
        playable: char === "O",
        peg: char === "O",
        shape: null as Phaser.GameObjects.Ellipse | null,
      })));
    this.cells[3][3].peg = false;
    this.moves = 0;
    this.started = false;
    this.ended = false;
    this.selected = undefined;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#f3f0e8");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 48, 48, 0xf3f0e8, 1, 0x101114, .04);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0x101114, .25);
    this.add.text(22, 43, "PEG / 039", {
      fontFamily: "monospace", fontSize: "11px", color: INK, letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "孔明棋", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#74726c",
    }).setOrigin(1, 0);
    this.statusText = this.add.text(22, 72, "选择一颗棋子起跳", {
      fontFamily: "sans-serif", fontSize: "17px", color: INK, fontStyle: "bold",
    });
    this.pegsText = this.add.text(WIDTH - 22, 78, "", {
      fontFamily: "monospace", fontSize: "12px", color: "#74726c", letterSpacing: 1,
    }).setOrigin(1, 0);
    const bestLabel = this.add.text(WIDTH - 22, 98, "", {
      fontFamily: "monospace", fontSize: "10px", color: "#74726c", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.hintText = this.add.text(CENTER_X, 752, "棋子跳过相邻棋子落进空位 · 被跳的移除", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8a8881",
    }).setOrigin(.5);

    const frame = this.add.graphics();
    frame.fillStyle(0xe9e2d2, 1);
    frame.fillRoundedRect(BOARD_X - 14, BOARD_Y - 14, COLS * CELL + 28, ROWS * CELL + 28, 12);
    frame.lineStyle(2, 0x101114, .6);
    frame.strokeRoundedRect(BOARD_X - 14, BOARD_Y - 14, COLS * CELL + 28, ROWS * CELL + 28, 12);

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const cell = this.cells[row][col];
        if (!cell.playable) continue;
        const x = BOARD_X + col * CELL + CELL / 2;
        const y = BOARD_Y + row * CELL + CELL / 2;
        const socket = this.add.ellipse(x, y, 30, 30, 0x101114, .08).setStrokeStyle(1.5, 0x101114, .3)
          .setInteractive({ useHandCursor: true });
        socket.setData("col", col).setData("row", row);
        socket.on("pointerup", () => this.tapCell(col, row));
        if (cell.peg) {
          cell.shape = this.add.ellipse(x, y, 27, 27, 0x8a2f2b).setStrokeStyle(2, 0x101114, .6).setDepth(2);
          cell.shape.setData("col", col).setData("row", row);
          cell.shape.on("pointerup", () => this.tapCell(col, row));
          cell.shape.setInteractive({ useHandCursor: true });
        }
      }
    }
    this.refreshPegCount();
    const saved = this.storage.load();
    bestLabel.setText(`历史最佳 剩${saved.bestRemaining}`);
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private refreshPegCount() {
    const pegs = this.cells.flat().filter((cell) => cell.peg).length;
    this.pegsText.setText(`剩余 ${pegs} 子 · ${this.moves} 步`);
    return pegs;
  }

  private cellCenter(col: number, row: number) {
    return { x: BOARD_X + col * CELL + CELL / 2, y: BOARD_Y + row * CELL + CELL / 2 };
  }

  private tapCell(col: number, row: number) {
    if (this.ended) return;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.audio.unlock();
    }
    const cell = this.cells[row][col];
    if (!cell || !cell.playable) return;

    if (this.selected) {
      const from = this.selected;
      this.clearSelection();
      if (from.col === col && from.row === row) return;
      const midCol = (from.col + col) / 2;
      const midRow = (from.row + row) / 2;
      const straight = (from.col === col) !== (from.row === row);
      const distance = Math.abs(from.col - col) + Math.abs(from.row - row);
      const jumped = this.cells[midRow]?.[midCol];
      if (straight && distance === 2 && jumped?.peg && !cell.peg) {
        this.executeJump(from, { col, row }, { col: midCol, row: midRow });
        return;
      }
      this.audio.tone({ freq: 190, duration: .08, type: "sawtooth", gain: .07 });
    }
    if (cell.peg) {
      this.selected = { col, row };
      cell.shape?.setStrokeStyle(3, 0xffb84d, 1);
      cell.shape?.setScale(1.12);
      this.audio.tone({ freq: 420, duration: .05, type: "sine", gain: .08 });
      this.statusText.setText("再选落点（隔一格的空位）");
    }
  }

  private clearSelection() {
    if (!this.selected) return;
    const cell = this.cells[this.selected.row][this.selected.col];
    cell.shape?.setStrokeStyle(2, 0x101114, .6);
    cell.shape?.setScale(1);
    this.selected = undefined;
  }

  private executeJump(from: { col: number; row: number }, to: { col: number; row: number }, mid: { col: number; row: number }) {
    const fromCell = this.cells[from.row][from.col];
    const midCell = this.cells[mid.row][mid.col];
    const toCell = this.cells[to.row][to.col];
    fromCell.peg = false;
    midCell.peg = false;
    toCell.peg = true;
    this.moves += 1;
    this.audio.tone({ freq: 300, duration: .07, type: "sine", gain: .12 });
    this.audio.tone({ freq: 210, endFreq: 150, duration: .12, time: this.audio.now + .03, type: "sine", gain: .12 });

    if (fromCell.shape) {
      this.tweens.add({
        targets: fromCell.shape,
        x: this.cellCenter(to.col, to.row).x,
        y: this.cellCenter(to.col, to.row).y,
        duration: 170,
        ease: "Cubic.easeOut",
      });
      toCell.shape = fromCell.shape;
      toCell.shape.setData("col", to.col).setData("row", to.row);
      fromCell.shape = null;
    }
    if (midCell.shape) {
      this.tweens.add({ targets: midCell.shape, scale: 0, alpha: 0, duration: 160, onComplete: () => midCell.shape?.destroy() });
      midCell.shape = null;
    }
    toCell.shape?.setScale(1.12);
    this.tweens.add({ targets: toCell.shape, scale: 1, duration: 150 });

    this.statusText.setText("好棋！继续");
    const remaining = this.refreshPegCount();
    this.bridge.score(32 - remaining);
    const anyMove = this.hasAnyMove();
    if (remaining === 1) {
      this.endRun(true);
      return;
    }
    if (!anyMove) this.endRun(false);
  }

  private hasAnyMove() {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const cell = this.cells[row][col];
        if (!cell.peg) continue;
        for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
          const target = this.cells[row + dy]?.[col + dx];
          const mid = this.cells[row + dy / 2]?.[col + dx / 2];
          if (target?.playable && !target.peg && mid?.peg) return true;
        }
      }
    }
    return false;
  }

  private endRun(perfect: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.clearSelection();
    const remaining = this.cells.flat().filter((cell) => cell.peg).length;
    const saved = this.storage.load();
    const best = Math.min(saved.bestRemaining, remaining);
    this.storage.save({ bestRemaining: best });
    this.pegsText.setText(`剩余 ${remaining} 子 · ${this.moves} 步`);
    if (perfect) {
      this.statusText.setText("完美！仅剩一子");
      this.audio.tone({ freq: 660, duration: .18, type: "triangle", gain: .2 });
      this.audio.tone({ freq: 880, duration: .3, time: this.audio.now + .15, type: "triangle", gain: .2 });
      this.cameras.main.flash(220, 223, 255, 63, false);
    } else {
      this.statusText.setText(`无路可走 · 剩 ${remaining} 子`);
      this.audio.tone({ freq: 300, endFreq: 120, duration: .5, type: "sawtooth", gain: .2 });
    }
    this.bridge.gameOver(32 - remaining);
    const bestLabel = this.children.getByName("best-score") as Phaser.GameObjects.Text | null;
    bestLabel?.setText(`历史最佳 剩${best}`);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .5)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 560, 308, 186, 0xe9e2d2)
      .setStrokeStyle(2, 0x101114).setDepth(101);
    this.add.text(CENTER_X, 524, perfect ? "孔明再世" : "终局", {
      fontFamily: "sans-serif", fontSize: "25px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 562, `${this.moves} 步  ·  剩余 ${remaining}  ·  最佳 剩${best}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#777872", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 602, 184, 42, 0x101114)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 602, "再来一局  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#e9e2d2", fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    replay.on("pointerup", () => this.scene.restart());
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: [shade, panel], alpha: { from: 0, to: 1 }, duration: 200 });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#f3f0e8",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: PegSolitaireScene,
});
