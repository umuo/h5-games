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
const SIZE = 15;
const CELL = 24;
const BOARD_X = CENTER_X - (CELL * (SIZE - 1)) / 2;
const BOARD_Y = 190;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

function patternScore(consecutive: number, openEnds: number) {
  if (consecutive >= 5) return 1000000;
  if (openEnds === 0) return 0;
  if (consecutive === 4) return openEnds === 2 ? 100000 : 12000;
  if (consecutive === 3) return openEnds === 2 ? 6000 : 700;
  if (consecutive === 2) return openEnds === 2 ? 400 : 60;
  return openEnds === 2 ? 40 : 10;
}

class GomokuScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private recordText!: Phaser.GameObjects.Text;
  private hintGomoku!: Phaser.GameObjects.Text;
  private board: number[][] = [];
  private stones: Array<Phaser.GameObjects.Arc> = [];
  private playerTurn = true;
  private finished = false;
  private wins = 0;
  private losses = 0;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "gomoku", version: "1.0.0" });
  private storage = createGameStorage("gomoku", { wins: 0, losses: 0 });

  constructor() { super("gomoku"); }

  create() {
    this.board = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(EMPTY));
    this.stones = [];
    this.playerTurn = true;
    this.finished = false;
    const saved = this.storage.load();
    this.wins = saved.wins;
    this.losses = saved.losses;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "GOMOKU / 031", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "五子棋", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);

    const boardPx = CELL * (SIZE - 1);
    const g = this.add.graphics();
    g.fillStyle(0xd9b06a, 1);
    g.fillRoundedRect(BOARD_X - 22, BOARD_Y - 22, boardPx + 44, boardPx + 44, 10);
    g.lineStyle(1.2, 0x4a3820, .8);
    for (let index = 0; index < SIZE; index += 1) {
      g.lineBetween(BOARD_X, BOARD_Y + index * CELL, BOARD_X + boardPx, BOARD_Y + index * CELL);
      g.lineBetween(BOARD_X + index * CELL, BOARD_Y, BOARD_X + index * CELL, BOARD_Y + boardPx);
    }
    g.fillStyle(0x4a3820, 1);
    for (const [sc, sr] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) {
      g.fillCircle(BOARD_X + sc * CELL, BOARD_Y + sr * CELL, 3);
    }

    this.statusText = this.add.text(CENTER_X, 84, "你执黑先行", {
      fontFamily: "sans-serif", fontSize: "16px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5);
    this.recordText = this.add.text(CENTER_X, 560, `战绩 ${this.wins} 胜 ${this.losses} 负`, {
      fontFamily: "monospace", fontSize: "11px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5);
    this.hintGomoku = this.add.text(CENTER_X, 600, "点击交叉点落子 · 连成五子获胜", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    const restart = this.add.rectangle(CENTER_X, 656, 160, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true });
    this.add.text(CENTER_X, 656, "重新开始", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#101114", fontStyle: "bold",
    }).setOrigin(.5);
    restart.on("pointerup", () => this.scene.restart());

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private intersectionAt(x: number, y: number) {
    const col = Math.round((x - BOARD_X) / CELL);
    const row = Math.round((y - BOARD_Y) / CELL);
    if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return null;
    const px = BOARD_X + col * CELL;
    const py = BOARD_Y + row * CELL;
    if (Math.abs(px - x) > 14 || Math.abs(py - y) > 14) return null;
    return { col, row };
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.finished || !this.playerTurn) return;
      this.audio.unlock();
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const cell = this.intersectionAt(position.x, position.y);
      if (!cell || this.board[cell.row][cell.col] !== EMPTY) return;
      this.placeStone(cell.col, cell.row, BLACK);
      if (this.checkEnd(cell.col, cell.row, BLACK)) return;
      this.playerTurn = false;
      this.statusText.setText("AI 思考中…");
      this.time.delayedCall(Phaser.Math.Between(260, 520), () => this.aiMove());
    });
  }

  private placeStone(col: number, row: number, color: number) {
    this.board[row][col] = color;
    const x = BOARD_X + col * CELL;
    const y = BOARD_Y + row * CELL;
    const stone = this.add.circle(x, y, 10, color === BLACK ? 0x101114 : 0xf3f0e8)
      .setStrokeStyle(1.5, 0x101114, color === BLACK ? 1 : .8).setDepth(5);
    if (color === BLACK) {
      this.add.circle(x - 3, y - 3.5, 2.6, 0x5a5a66).setDepth(6);
    }
    this.stones.push(stone);
    this.audio.tone({ freq: color === BLACK ? 300 : 360, duration: .06, type: "sine", gain: .12 });
  }

  private lineStats(col: number, row: number, color: number, [dc, dr]: number[]) {
    let consecutive = 1;
    let openEnds = 0;
    for (const sign of [1, -1]) {
      let step = 1;
      while (true) {
        const c = col + dc * step * sign;
        const r = row + dr * step * sign;
        if (c < 0 || c >= SIZE || r < 0 || r >= SIZE || this.board[r][c] !== color) {
          const edge = c < 0 || c >= SIZE || r < 0 || r >= SIZE || this.board[r][c] !== EMPTY;
          if (!edge) openEnds += 1;
          break;
        }
        consecutive += 1;
        step += 1;
      }
    }
    return patternScore(consecutive, openEnds);
  }

  private cellScore(col: number, row: number, color: number) {
    let total = 0;
    for (const direction of DIRECTIONS) {
      total += this.lineStats(col, row, color, direction);
    }
    return total;
  }

  private aiMove() {
    if (this.finished) return;
    let best: { col: number; row: number; score: number } | null = null;
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (this.board[row][col] !== EMPTY) continue;
        const attack = this.cellScore(col, row, WHITE);
        const defend = this.cellScore(col, row, BLACK);
        const score = attack + defend * .92;
        if (!best || score > best.score) best = { col, row, score };
      }
    }
    if (!best) {
      this.statusText.setText("和棋");
      this.finished = true;
      return;
    }
    this.placeStone(best.col, best.row, WHITE);
    if (this.checkEnd(best.col, best.row, WHITE)) return;
    this.playerTurn = true;
    this.statusText.setText("轮到你 (黑)");
  }

  private checkEnd(col: number, row: number, color: number) {
    for (const [dc, dr] of DIRECTIONS) {
      const line: Array<{ col: number; row: number }> = [{ col, row }];
      for (const sign of [1, -1]) {
        let step = 1;
        while (true) {
          const c = col + dc * step * sign;
          const r = row + dr * step * sign;
          if (c < 0 || c >= SIZE || r < 0 || r >= SIZE || this.board[r][c] !== color) break;
          line.push({ col: c, row: r });
          step += 1;
        }
      }
      if (line.length >= 5) {
        this.finished = true;
        for (const cell of line) {
          this.add.circle(BOARD_X + cell.col * CELL, BOARD_Y + cell.row * CELL, 12.5)
            .setStrokeStyle(3, 0xff6a51, 1).setDepth(8);
        }
        if (color === BLACK) {
          this.wins += 1;
          this.statusText.setText("你赢了！");
          this.audio.tone({ freq: 523, duration: .16, type: "triangle", gain: .2 });
          this.audio.tone({ freq: 784, duration: .28, time: this.audio.now + .14, type: "triangle", gain: .2 });
        } else {
          this.losses += 1;
          this.statusText.setText("AI 获胜");
          this.audio.tone({ freq: 300, endFreq: 120, duration: .5, type: "sawtooth", gain: .2 });
        }
        this.storage.save({ wins: this.wins, losses: this.losses });
        this.recordText.setText(`战绩 ${this.wins} 胜 ${this.losses} 负`);
        this.bridge.gameOver(color === BLACK ? 100 : 0);
        return true;
      }
    }
    const full = this.board.every((rowCells) => rowCells.every((cell) => cell !== EMPTY));
    if (full) {
      this.finished = true;
      this.statusText.setText("和棋");
      return true;
    }
    return false;
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
  scene: GomokuScene,
});
