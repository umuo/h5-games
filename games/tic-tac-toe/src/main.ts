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
const GRID = 3;
const CELL = 96;
const BOARD_X = CENTER_X - (GRID * CELL) / 2;
const BOARD_Y = 260;
const LINES = [
  [[0, 0], [1, 0], [2, 0]],
  [[0, 1], [1, 1], [2, 1]],
  [[0, 2], [1, 2], [2, 2]],
  [[0, 0], [0, 1], [0, 2]],
  [[1, 0], [1, 1], [1, 2]],
  [[2, 0], [2, 1], [2, 2]],
  [[0, 0], [1, 1], [2, 2]],
  [[2, 0], [1, 1], [0, 2]],
];

const EMPTY = 0;
const PLAYER = 1;
const AI = 2;

class TicTacToeScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private recordText!: Phaser.GameObjects.Text;
  private hintLabel!: Phaser.GameObjects.Text;
  private board: number[][] = [];
  private marks: Array<Phaser.GameObjects.Container | null> = [];
  private playerTurn = true;
  private finished = false;
  private started = false;
  private wins = 0;
  private losses = 0;
  private draws = 0;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "tic-tac-toe", version: "1.0.0" });
  private storage = createGameStorage("tic-tac-toe", { wins: 0, losses: 0, draws: 0 });

  constructor() { super("tic-tac-toe"); }

  create() {
    this.board = Array.from({ length: GRID }, () => Array<number>(GRID).fill(EMPTY));
    this.marks = new Array(GRID * GRID).fill(null);
    this.playerTurn = true;
    this.finished = false;
    const saved = this.storage.load();
    this.wins = saved.wins;
    this.losses = saved.losses;
    this.draws = saved.draws;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 44, 44, 0x101114, 1, 0x232a44, .5);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "TIC / 050", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "三子棋", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.statusText = this.add.text(CENTER_X, 84, "你执 ✕ 先行", {
      fontFamily: "sans-serif", fontSize: "17px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5);
    this.recordText = this.add.text(CENTER_X, 620, "", {
      fontFamily: "monospace", fontSize: "12px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5);
    this.refreshRecord();
    this.hintLabel = this.add.text(CENTER_X, 672, "三点连线即获胜 · AI 会全力防守", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    const grid = this.add.graphics().setDepth(2);
    grid.lineStyle(3, 0x3a4470, 1);
    for (let index = 1; index < GRID; index += 1) {
      grid.lineBetween(BOARD_X, BOARD_Y + index * CELL, BOARD_X + GRID * CELL, BOARD_Y + index * CELL);
      grid.lineBetween(BOARD_X + index * CELL, BOARD_Y, BOARD_X + index * CELL, BOARD_Y + GRID * CELL);
    }
    for (let row = 0; row < GRID; row += 1) {
      for (let col = 0; col < GRID; col += 1) {
        const hit = this.add.rectangle(
          BOARD_X + col * CELL + CELL / 2,
          BOARD_Y + row * CELL + CELL / 2,
          CELL - 6, CELL - 6, 0xffffff, .001,
        ).setInteractive({ useHandCursor: true }).setDepth(3);
        hit.setData("col", col).setData("row", row);
        hit.on("pointerup", () => this.playerMove(col, row));
      }
    }

    const restart = this.add.rectangle(CENTER_X, 724, 160, 44, 0xdfff3f)
      .setInteractive({ useHandCursor: true });
    this.add.text(CENTER_X, 724, "重新开始", {
      fontFamily: "sans-serif", fontSize: "14px", color: "#101114", fontStyle: "bold",
    }).setOrigin(.5);
    restart.on("pointerup", () => this.scene.restart());

    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private refreshRecord() {
    this.recordText.setText(`战绩 ${this.wins} 胜 ${this.losses} 负 ${this.draws} 平`);
  }

  private cellCenter(col: number, row: number) {
    return { x: BOARD_X + col * CELL + CELL / 2, y: BOARD_Y + row * CELL + CELL / 2 };
  }

  private playerMove(col: number, row: number) {
    if (this.finished || !this.playerTurn || this.board[row][col] !== EMPTY) return;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.audio.unlock();
    }
    this.drawMark(col, row, PLAYER);
    this.audio.tone({ freq: 420, duration: .07, type: "square", gain: .1 });
    if (this.checkEnd(PLAYER)) return;
    this.playerTurn = false;
    this.statusText.setText("AI 思考中…");
    this.time.delayedCall(Phaser.Math.Between(300, 550), () => this.aiMove());
  }

  private aiMove() {
    if (this.finished) return;
    const move = this.bestMove();
    if (!move) {
      this.finishGame();
      return;
    }
    this.drawMark(move.col, move.row, AI);
    this.audio.tone({ freq: 300, duration: .07, type: "square", gain: .1 });
    if (this.checkEnd(AI)) return;
    this.playerTurn = true;
    this.statusText.setText("轮到你 (✕)");
  }

  /** Minimax — the AI never loses on purpose. */
  private bestMove(): { col: number; row: number } | null {
    let bestScore = -Infinity;
    let best: { col: number; row: number } | null = null;
    for (let row = 0; row < GRID; row += 1) {
      for (let col = 0; col < GRID; col += 1) {
        if (this.board[row][col] !== EMPTY) continue;
        this.board[row][col] = AI;
        const score = this.minimax(false, 0);
        this.board[row][col] = EMPTY;
        if (score > bestScore) {
          bestScore = score;
          best = { col, row };
        }
      }
    }
    return best;
  }

  private minimax(isAi: boolean, depth: number): number {
    const winner = this.findWinner();
    if (winner === AI) return 10 - depth;
    if (winner === PLAYER) return depth - 10;
    if (this.board.flat().every((cell) => cell !== EMPTY)) return 0;
    let best = isAi ? -Infinity : Infinity;
    for (let row = 0; row < GRID; row += 1) {
      for (let col = 0; col < GRID; col += 1) {
        if (this.board[row][col] !== EMPTY) continue;
        this.board[row][col] = isAi ? AI : PLAYER;
        const score = this.minimax(!isAi, depth + 1);
        this.board[row][col] = EMPTY;
        best = isAi ? Math.max(best, score) : Math.min(best, score);
      }
    }
    return best;
  }

  private findWinner(): number {
    for (const line of LINES) {
      const [[a, b], [c, d], [e, f]] = line;
      const value = this.board[b][a];
      if (value !== EMPTY && this.board[d][c] === value && this.board[f][e] === value) return value;
    }
    return EMPTY;
  }

  private drawMark(col: number, row: number, who: number) {
    this.board[row][col] = who;
    const { x, y } = this.cellCenter(col, row);
    const mark = this.add.container(x, y).setDepth(4).setScale(.4);
    const s = CELL * .3;
    if (who === PLAYER) {
      mark.add([
        this.add.line(0, 0, -s, -s, s, s, 0xff6a51).setLineWidth(6),
        this.add.line(0, 0, s, -s, -s, s, 0xff6a51).setLineWidth(6),
      ]);
    } else {
      mark.add([
        this.add.circle(0, 0, s).setStrokeStyle(6, 0x54e0ff),
      ]);
    }
    this.tweens.add({ targets: mark, scale: 1, duration: 150, ease: "Back.easeOut" });
    this.marks[row * GRID + col] = mark;
  }

  private checkEnd(who: number) {
    const winner = this.findWinner();
    if (winner !== EMPTY) {
      this.finished = true;
      if (who === PLAYER) {
        this.wins += 1;
        this.statusText.setText("你赢了！");
        this.audio.tone({ freq: 523, duration: .15, type: "triangle", gain: .2 });
        this.audio.tone({ freq: 784, duration: .28, time: this.audio.now + .14, type: "triangle", gain: .2 });
      } else {
        this.losses += 1;
        this.statusText.setText("AI 获胜");
        this.audio.tone({ freq: 300, endFreq: 110, duration: .5, type: "sawtooth", gain: .2 });
      }
      this.bridge.gameOver(who === PLAYER ? 100 : 0);
      this.storage.save({ wins: this.wins, losses: this.losses, draws: this.draws });
      this.refreshRecord();
      return true;
    }
    if (this.board.flat().every((cell) => cell !== EMPTY)) {
      this.finished = true;
      this.draws += 1;
      this.statusText.setText("平局");
      this.storage.save({ wins: this.wins, losses: this.losses, draws: this.draws });
      this.refreshRecord();
      this.audio.tone({ freq: 340, duration: .2, type: "sine", gain: .14 });
      return true;
    }
    return false;
  }

  private finishGame() {
    this.finished = true;
    this.draws += 1;
    this.statusText.setText("平局");
    this.storage.save({ wins: this.wins, losses: this.losses, draws: this.draws });
    this.refreshRecord();
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
  scene: TicTacToeScene,
});
