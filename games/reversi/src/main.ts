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
const SIZE = 8;
const CELL = 41;
const BOARD_X = CENTER_X - (CELL * SIZE) / 2;
const BOARD_Y = 172;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

class ReversiScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private scoreBlackText!: Phaser.GameObjects.Text;
  private scoreWhiteText!: Phaser.GameObjects.Text;
  private hintLabel!: Phaser.GameObjects.Text;
  private discLayer: Phaser.GameObjects.Arc[] = [];
  private board: number[][] = [];
  private playerTurn = true;
  private finished = false;
  private wins = 0;
  private losses = 0;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "reversi", version: "1.0.0" });
  private storage = createGameStorage("reversi", { wins: 0, losses: 0 });

  constructor() { super("reversi"); }

  create() {
    this.board = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(EMPTY));
    this.discLayer = [];
    this.playerTurn = true;
    this.finished = false;
    const saved = this.storage.load();
    this.wins = saved.wins;
    this.losses = saved.losses;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#0d3b2e");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "FLIP / 033", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "黑白棋", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#9dbb9f",
    }).setOrigin(1, 0);

    const g = this.add.graphics();
    g.fillStyle(0x1a6b4a, 1);
    g.fillRoundedRect(BOARD_X - 10, BOARD_Y - 10, CELL * SIZE + 20, CELL * SIZE + 20, 10);
    g.lineStyle(1, 0x0d3b2e, .8);
    for (let index = 0; index <= SIZE; index += 1) {
      g.lineBetween(BOARD_X, BOARD_Y + index * CELL, BOARD_X + CELL * SIZE, BOARD_Y + index * CELL);
      g.lineBetween(BOARD_X + index * CELL, BOARD_Y, BOARD_X + index * CELL, BOARD_Y + CELL * SIZE);
    }
    g.lineStyle(2, 0x0d3b2e, .9);
    for (const [a, b] of [[2, 2], [6, 2], [2, 6], [6, 6]]) {
      g.strokeCircle(BOARD_X + a * CELL + CELL / 2, BOARD_Y + b * CELL + CELL / 2, 4);
    }

    this.scoreBlackText = this.add.text(22, 74, "● 2", {
      fontFamily: "monospace", fontSize: "20px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.scoreWhiteText = this.add.text(WIDTH - 22, 74, "2 ○", {
      fontFamily: "monospace", fontSize: "20px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(1, 0);
    this.statusText = this.add.text(CENTER_X, 80, "你执黑先行", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#9fe08a", fontStyle: "bold",
    }).setOrigin(.5);
    this.hintLabel = this.add.text(CENTER_X, 560, "落子必须夹住对方棋子 · 无处可下自动跳过", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#9dbb9f",
    }).setOrigin(.5);

    this.setInitialDiscs();
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    this.refreshCounts();
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private setInitialDiscs() {
    const mid = SIZE / 2;
    this.board[mid - 1][mid - 1] = WHITE;
    this.board[mid][mid] = WHITE;
    this.board[mid - 1][mid] = BLACK;
    this.board[mid][mid - 1] = BLACK;
    for (const [col, row] of [[mid - 1, mid - 1], [mid, mid], [mid - 1, mid], [mid, mid - 1]] as const) {
      this.drawDisc(col, row, this.board[row][col]);
    }
  }

  private cellCenter(col: number, row: number) {
    return { x: BOARD_X + col * CELL + CELL / 2, y: BOARD_Y + row * CELL + CELL / 2 };
  }

  private drawDisc(col: number, row: number, color: number) {
    const { x, y } = this.cellCenter(col, row);
    const disc = this.add.circle(x, y, 15.5, color === BLACK ? 0x101114 : 0xf3f0e8)
      .setStrokeStyle(1.5, 0x0d3b2e, .9).setDepth(4);
    this.discLayer.push(disc);
  }

  private discsAt(col: number, row: number) {
    const { x, y } = this.cellCenter(col, row);
    return this.discLayer.find((disc) => Math.abs(disc.x - x) < 2 && Math.abs(disc.y - y) < 2);
  }

  private flipsFor(col: number, row: number, color: number) {
    if (this.board[row][col] !== EMPTY) return [];
    const opponent = color === BLACK ? WHITE : BLACK;
    const all: Array<{ col: number; row: number }> = [];
    for (const [dc, dr] of DIRECTIONS) {
      const line: Array<{ col: number; row: number }> = [];
      let step = 1;
      while (true) {
        const c = col + dc * step;
        const r = row + dr * step;
        if (c < 0 || c >= SIZE || r < 0 || r >= SIZE || this.board[r][c] !== opponent) {
          if (line.length > 0 && c >= 0 && c < SIZE && r >= 0 && r < SIZE && this.board[r][c] === color) {
            all.push(...line);
          }
          break;
        }
        line.push({ col: c, row: r });
        step += 1;
      }
    }
    return all;
  }

  private hasAnyMove(color: number) {
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (this.board[row][col] === EMPTY && this.flipsFor(col, row, color).length > 0) return true;
      }
    }
    return false;
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.finished || !this.playerTurn) return;
      this.audio.unlock();
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const col = Math.floor((position.x - BOARD_X) / CELL);
      const row = Math.floor((position.y - BOARD_Y) / CELL);
      if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return;
      const flips = this.flipsFor(col, row, BLACK);
      if (flips.length === 0) {
        this.audio.tone({ freq: 190, duration: .08, type: "sawtooth", gain: .07 });
        return;
      }
      this.playMove(col, row, BLACK, flips);
      this.playerTurn = false;
      this.statusText.setText("AI 思考中…");
      this.time.delayedCall(Phaser.Math.Between(420, 700), () => {
        this.afterPlayerMove();
      });
    });
  }

  private afterPlayerMove() {
    if (this.finished) return;
    if (!this.hasAnyMove(WHITE)) {
      this.playerTurn = true;
      if (!this.hasAnyMove(BLACK)) {
        this.finishGame();
        return;
      }
      this.statusText.setText("AI 无处可下 · 轮到你");
      return;
    }
    this.aiMove();
  }

  private aiMove() {
    if (this.finished) return;
    let best: { col: number; row: number; score: number } | null = null;
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (this.board[row][col] !== EMPTY) continue;
        const flips = this.flipsFor(col, row, WHITE);
        if (flips.length === 0) continue;
        const corner = (col === 0 || col === SIZE - 1) && (row === 0 || row === SIZE - 1);
        const danger = (col === 1 || col === SIZE - 2) && (row === 1 || row === SIZE - 2) ? 12 : 0;
        const edge = col === 0 || col === SIZE - 1 || row === 0 || row === SIZE - 1 ? 6 : 0;
        const score = flips.length * 3 + (corner ? 60 : 0) + edge - danger;
        if (!best || score > best.score) best = { col, row, score };
      }
    }
    if (!best) {
      this.playerTurn = true;
      if (!this.hasAnyMove(BLACK)) {
        this.finishGame();
        return;
      }
      this.statusText.setText("AI 无处可下 · 轮到你");
      return;
    }
    const flips = this.flipsFor(best.col, best.row, WHITE);
    this.playMove(best.col, best.row, WHITE, flips);
    this.playerTurn = true;
    if (!this.hasAnyMove(BLACK)) {
      if (!this.hasAnyMove(WHITE)) {
        this.finishGame();
        return;
      }
      this.statusText.setText("你无处可下 · AI 继续行棋");
      this.playerTurn = false;
      this.time.delayedCall(650, () => this.aiMove());
      return;
    }
    this.statusText.setText("轮到你 (黑)");
  }

  private playMove(col: number, row: number, color: number, flips: Array<{ col: number; row: number }>) {
    this.board[row][col] = color;
    this.drawDisc(col, row, color);
    for (const flip of flips) {
      this.board[flip.row][flip.col] = color;
      const disc = this.discsAt(flip.col, flip.row);
      if (disc) {
        disc.setFillStyle(color === BLACK ? 0x101114 : 0xf3f0e8);
        this.tweens.add({ targets: disc, scale: { from: 1.25, to: 1 }, duration: 180 });
      }
    }
    this.audio.tone({ freq: 300 + flips.length * 26, duration: .07, type: "sine", gain: .12 });
    this.refreshCounts();
  }

  private refreshCounts() {
    let blackCount = 0;
    let whiteCount = 0;
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (this.board[row][col] === BLACK) blackCount += 1;
        if (this.board[row][col] === WHITE) whiteCount += 1;
      }
    }
    this.scoreBlackText.setText(`● ${blackCount}`);
    this.scoreWhiteText.setText(`${whiteCount} ○`);
    return { blackCount, whiteCount };
  }

  private finishGame() {
    this.finished = true;
    const { blackCount, whiteCount } = this.refreshCounts();
    if (blackCount > whiteCount) {
      this.wins += 1;
      this.statusText.setText(`你赢了！${blackCount} : ${whiteCount}`);
      this.audio.tone({ freq: 523, duration: .16, type: "triangle", gain: .2 });
      this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .14, type: "triangle", gain: .2 });
    } else if (whiteCount > blackCount) {
      this.losses += 1;
      this.statusText.setText(`AI 获胜 ${whiteCount} : ${blackCount}`);
      this.audio.tone({ freq: 300, endFreq: 120, duration: .5, type: "sawtooth", gain: .2 });
    } else {
      this.statusText.setText(`平局 ${blackCount} : ${whiteCount}`);
    }
    this.storage.save({ wins: this.wins, losses: this.losses });
    this.bridge.gameOver(blackCount);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#0d3b2e",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: ReversiScene,
});
