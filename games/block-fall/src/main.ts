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
const ROWS = 17;
const CELL = 30;
const BOARD_X = 45;
const BOARD_Y = 178;
const BUTTON_Y = 768;
const LOCK_DELAY = 420;
const MAX_LOCK_RESETS = 12;
const CLEAR_ANIMATION = 280;

const PIECE_TYPES = ["I", "O", "T", "S", "Z", "J", "L"] as const;
type PieceType = typeof PIECE_TYPES[number];

const BASE_MATRICES: Record<PieceType, number[][]> = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};

const PIECE_COLORS: Record<PieceType, number> = {
  I: 0x54e0ff, O: 0xffd44d, T: 0x9b6bff, S: 0x9fe08a, Z: 0xff6a51, J: 0x5c7cff, L: 0xffa63d,
};

const KICK_OFFSETS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [0, -2], [-1, -1], [1, -1]];

interface ActivePiece {
  type: PieceType;
  matrix: number[][];
  x: number;
  y: number;
}

function rotateMatrix(matrix: number[][]): number[][] {
  const size = matrix.length;
  const rotated: number[][] = matrix.map((row) => [...row]);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      rotated[col][size - 1 - row] = matrix[row][col];
    }
  }
  return rotated;
}

class BlockFallScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private linesText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private boardGraphics!: Phaser.GameObjects.Graphics;
  private pieceGraphics!: Phaser.GameObjects.Graphics;
  private panelGraphics!: Phaser.GameObjects.Graphics;
  private board: number[][] = [];
  private active?: ActivePiece;
  private hold?: PieceType;
  private holdUsed = false;
  private queue: PieceType[] = [];
  private bag: PieceType[] = [];
  private score = 0;
  private lines = 0;
  private level = 1;
  private started = false;
  private ended = false;
  private state: "playing" | "clearing" | "over" = "playing";
  private fallAcc = 0;
  private lockElapsed = 0;
  private lockResets = 0;
  private grounded = false;
  private clearingRows: number[] = [];
  private clearStart = 0;
  private combo = 0;
  private panelDirty = true;
  private gesture?: { id: number; x: number; y: number; startX: number; startY: number; time: number; travel: number };
  private heldButtons = new Set<string>();
  private repeatAt = 0;
  private audio = createAudioKit({ masterGain: 0.4 });
  private bridge = createGameBridge({ gameId: "block-fall", version: "1.0.0" });
  private storage = createGameStorage("block-fall", { highScore: 0 });

  constructor() { super("block-fall"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 40, 40, 0x101114, 1, 0x2b2d32, .35);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "FALL / 020", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "方块倾落", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);

    this.panelGraphics = this.add.graphics();
    this.boardGraphics = this.add.graphics();
    this.pieceGraphics = this.add.graphics();

    this.scoreText = this.add.text(CENTER_X, 58, "0", {
      fontFamily: "monospace", fontSize: "30px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5, 0);
    this.linesText = this.add.text(CENTER_X, 98, "0 行", {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(.5, 0);
    this.levelText = this.add.text(CENTER_X, 116, "LV 1", {
      fontFamily: "monospace", fontSize: "10px", color: "#dfff3f", letterSpacing: 2,
    }).setOrigin(.5, 0);
    this.bestText = this.add.text(CENTER_X, 134, `BEST ${this.storage.load().highScore}`, {
      fontFamily: "monospace", fontSize: "9px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(.5, 0).setName("best-score");
    this.add.text(66, 62, "暂存", {
      fontFamily: "sans-serif", fontSize: "9px", color: "#73757d",
    }).setOrigin(.5, 0);
    this.add.text(WIDTH - 66, 62, "接下来", {
      fontFamily: "sans-serif", fontSize: "9px", color: "#73757d",
    }).setOrigin(.5, 0);

    this.hintText = this.add.text(CENTER_X, 722, "拖动移位 · 轻点旋转 · 下滑软降", {
      fontFamily: "sans-serif", fontSize: "11px", color: "#8f918a",
    }).setOrigin(.5);

    this.buildButtons();
    this.refillQueue();
    this.spawnPiece();
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    this.panelDirty = true;
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.board = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
    this.active = undefined;
    this.hold = undefined;
    this.holdUsed = false;
    this.queue = [];
    this.bag = [];
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.started = false;
    this.ended = false;
    this.state = "playing";
    this.fallAcc = 0;
    this.lockElapsed = 0;
    this.lockResets = 0;
    this.grounded = false;
    this.clearingRows = [];
    this.combo = 0;
    this.heldButtons = new Set();
    this.gesture = undefined;
  }

  private refillQueue() {
    while (this.queue.length < 5) {
      if (this.bag.length === 0) {
        this.bag = [...PIECE_TYPES];
        for (let index = this.bag.length - 1; index > 0; index -= 1) {
          const swap = Phaser.Math.Between(0, index);
          [this.bag[index], this.bag[swap]] = [this.bag[swap], this.bag[index]];
        }
      }
      this.queue.push(this.bag.pop() as PieceType);
    }
    this.panelDirty = true;
  }

  private makePiece(type: PieceType): ActivePiece {
    return {
      type,
      matrix: BASE_MATRICES[type].map((row) => [...row]),
      x: Math.floor((COLS - BASE_MATRICES[type][0].length) / 2),
      y: 0,
    };
  }

  private collides(matrix: number[][], px: number, py: number) {
    for (let row = 0; row < matrix.length; row += 1) {
      for (let col = 0; col < matrix[row].length; col += 1) {
        if (!matrix[row][col]) continue;
        const bx = px + col;
        const by = py + row;
        if (bx < 0 || bx >= COLS || by >= ROWS) return true;
        if (by >= 0 && this.board[by][bx]) return true;
      }
    }
    return false;
  }

  private spawnPiece() {
    const type = this.queue.shift() as PieceType;
    this.refillQueue();
    const piece = this.makePiece(type);
    if (this.collides(piece.matrix, piece.x, piece.y)) {
      this.endRun();
      return;
    }
    this.active = piece;
    this.holdUsed = false;
    this.lockElapsed = 0;
    this.lockResets = 0;
    this.grounded = false;
    this.fallAcc = 0;
    this.panelDirty = true;
  }

  private ghostY() {
    const piece = this.active;
    if (!piece) return 0;
    let y = piece.y;
    while (!this.collides(piece.matrix, piece.x, y + 1)) y += 1;
    return y;
  }

  private tryMove(dx: number, dy: number): boolean {
    const piece = this.active;
    if (!piece || this.state !== "playing") return false;
    if (this.collides(piece.matrix, piece.x + dx, piece.y + dy)) return false;
    piece.x += dx;
    piece.y += dy;
    if (this.grounded && this.lockResets < MAX_LOCK_RESETS) {
      this.lockElapsed = 0;
      this.lockResets += 1;
    }
    return true;
  }

  private tryRotate() {
    const piece = this.active;
    if (!piece || this.state !== "playing" || piece.type === "O") return false;
    const rotated = rotateMatrix(piece.matrix);
    for (const [ox, oy] of KICK_OFFSETS) {
      if (!this.collides(rotated, piece.x + ox, piece.y + oy)) {
        piece.matrix = rotated;
        piece.x += ox;
        piece.y += oy;
        if (this.grounded && this.lockResets < MAX_LOCK_RESETS) {
          this.lockElapsed = 0;
          this.lockResets += 1;
        }
        this.audio.tone({ freq: 520, duration: .05, type: "square", gain: .07 });
        return true;
      }
    }
    return false;
  }

  private hardDrop() {
    const piece = this.active;
    if (!piece || this.state !== "playing") return;
    const target = this.ghostY();
    this.score += (target - piece.y) * 2;
    piece.y = target;
    this.refreshScore();
    this.cameras.main.shake(70, .004);
    this.audio.tone({ freq: 150, endFreq: 80, duration: .12, type: "square", gain: .14 });
    this.lockPiece();
  }

  private holdPiece() {
    const piece = this.active;
    if (!piece || this.holdUsed || this.state !== "playing") return;
    const current = piece.type;
    const replacement = this.hold ?? (this.queue.shift() as PieceType);
    this.hold = current;
    this.refillQueue();
    this.active = this.makePiece(replacement);
    this.holdUsed = true;
    this.lockElapsed = 0;
    this.lockResets = 0;
    this.grounded = false;
    this.fallAcc = 0;
    this.panelDirty = true;
    this.audio.tone({ freq: 440, duration: .07, type: "triangle", gain: .1 });
  }

  private gravityInterval() {
    const base = Math.max(80, Math.round(720 * Math.pow(.82, this.level - 1)));
    return this.heldButtons.has("▼") ? Math.min(45, base) : base;
  }

  private lockPiece() {
    const piece = this.active;
    if (!piece) return;
    this.active = undefined;
    let aboveTop = false;
    for (let row = 0; row < piece.matrix.length; row += 1) {
      for (let col = 0; col < piece.matrix[row].length; col += 1) {
        if (!piece.matrix[row][col]) continue;
        const by = piece.y + row;
        if (by < 0) {
          aboveTop = true;
          continue;
        }
        this.board[by][piece.x + col] = PIECE_TYPES.indexOf(piece.type) + 1;
      }
    }
    this.audio.tone({ freq: 190, endFreq: 140, duration: .09, type: "square", gain: .1 });
    if (aboveTop) {
      this.endRun();
      return;
    }
    const fullRows: number[] = [];
    for (let row = 0; row < ROWS; row += 1) {
      if (this.board[row].every((cell) => cell !== 0)) fullRows.push(row);
    }
    if (fullRows.length > 0) {
      this.state = "clearing";
      this.clearingRows = fullRows;
      this.clearStart = this.time.now;
      const count = fullRows.length;
      this.audio.noise({ freq: 1400, duration: .18, gain: .2 });
      this.audio.tone({ freq: 380 + count * 120, duration: .2, type: "triangle", gain: .18 });
      if (count === 4) {
        this.audio.tone({ freq: 660, duration: .25, time: this.audio.now + .12, type: "triangle", gain: .2 });
        this.audio.tone({ freq: 880, duration: .3, time: this.audio.now + .22, type: "triangle", gain: .2 });
      }
    } else {
      this.combo = 0;
      this.spawnPiece();
    }
  }

  private finishClear() {
    for (const row of this.clearingRows) {
      this.board.splice(row, 1);
      this.board.unshift(Array<number>(COLS).fill(0));
    }
    const count = this.clearingRows.length;
    this.combo += 1;
    const base = [0, 100, 300, 500, 800][count];
    const gained = base * this.level + (this.combo > 1 ? 50 * (this.combo - 1) * this.level : 0);
    this.score += gained;
    this.lines += count;
    const newLevel = Math.floor(this.lines / 10) + 1;
    if (newLevel > this.level) {
      this.level = newLevel;
      this.audio.tone({ freq: 520, duration: .12, type: "triangle", gain: .14 });
      this.audio.tone({ freq: 780, duration: .16, time: this.audio.now + .1, type: "triangle", gain: .14 });
    }
    this.refreshScore();
    this.clearingRows = [];
    this.state = "playing";
    this.spawnPiece();
  }

  private refreshScore() {
    this.scoreText.setText(String(this.score));
    this.linesText.setText(`${this.lines} 行`);
    this.levelText.setText(`LV ${this.level}`);
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
      this.bestText.setText(`BEST ${this.score}`);
    }
  }

  private buildButtons() {
    const labels = ["◀", "▶", "▼", "⟳", "⤓", "存"];
    const actions: Array<() => void> = [
      () => { if (this.tryMove(-1, 0)) this.audio.tone({ freq: 240, duration: .03, type: "square", gain: .05 }); },
      () => { if (this.tryMove(1, 0)) this.audio.tone({ freq: 240, duration: .03, type: "square", gain: .05 }); },
      () => { if (this.tryMove(0, 1)) this.refreshScore(); },
      () => this.tryRotate(),
      () => this.hardDrop(),
      () => this.holdPiece(),
    ];
    labels.forEach((label, index) => {
      const x = 45 + index * 56 + 25;
      const button = this.add.rectangle(x, BUTTON_Y, 50, 56, 0x1b1d21)
        .setStrokeStyle(1.5, 0x3a3d45)
        .setInteractive({ useHandCursor: true });
      this.add.text(x, BUTTON_Y, label, {
        fontFamily: "monospace", fontSize: "17px", color: "#f3f0e8", fontStyle: "bold",
      }).setOrigin(.5);
      const action = actions[index];
      button.on("pointerdown", () => {
        this.heldButtons.add(label);
        this.repeatAt = this.time.now + 240;
        action();
      });
      const release = () => this.heldButtons.delete(label);
      button.on("pointerup", release);
      button.on("pointerupoutside", release);
      button.on("pointerout", release);
    });
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.state !== "playing") return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      if (position.y < BOARD_Y || position.y > BOARD_Y + ROWS * CELL) return;
      this.gesture = {
        id: pointer.id, x: position.x, y: position.y,
        startX: position.x, startY: position.y, time: this.time.now, travel: 0,
      };
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const gesture = this.gesture;
      if (!gesture || pointer.id !== gesture.id || !pointer.isDown || this.state !== "playing") return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      gesture.travel += Math.abs(position.x - gesture.startX) + Math.abs(position.y - gesture.startY);

      let deltaX = position.x - gesture.x;
      while (Math.abs(deltaX) >= CELL) {
        const direction = Math.sign(deltaX);
        if (this.tryMove(direction, 0)) {
          gesture.x += direction * CELL;
        } else {
          gesture.x = position.x;
          break;
        }
        deltaX = position.x - gesture.x;
      }

      const deltaY = position.y - gesture.y;
      const rows = Math.floor(deltaY / CELL);
      if (rows > 0) {
        for (let index = 0; index < rows; index += 1) {
          if (this.tryMove(0, 1)) this.score += 1;
        }
        gesture.y += rows * CELL;
        this.refreshScore();
      }
    });
    const release = (pointer: Phaser.Input.Pointer) => {
      const gesture = this.gesture;
      if (!gesture || pointer.id !== gesture.id) return;
      if (this.time.now - gesture.time < 240 && gesture.travel < 14) {
        this.tryRotate();
      }
      this.gesture = undefined;
    };
    this.input.on("pointerup", release);
    this.input.on("pointerupoutside", release);
  }

  private redrawBoard(time: number) {
    const g = this.boardGraphics;
    g.clear();
    g.lineStyle(2, 0x3a3d45, 1);
    g.strokeRect(BOARD_X - 2, BOARD_Y - 2, COLS * CELL + 4, ROWS * CELL + 4);
    g.lineStyle(1, 0xffffff, .045);
    for (let col = 1; col < COLS; col += 1) {
      g.lineBetween(BOARD_X + col * CELL, BOARD_Y, BOARD_X + col * CELL, BOARD_Y + ROWS * CELL);
    }
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const cellValue = this.board[row][col];
        if (!cellValue) continue;
        this.drawBlock(g, BOARD_X + col * CELL, BOARD_Y + row * CELL, PIECE_COLORS[PIECE_TYPES[cellValue - 1]], 1);
      }
    }
    if (this.state === "clearing") {
      const flash = .55 + Math.sin(time / 40) * .4;
      for (const row of this.clearingRows) {
        g.fillStyle(0xffffff, flash);
        g.fillRect(BOARD_X, BOARD_Y + row * CELL, COLS * CELL, CELL);
      }
    }
  }

  private drawBlock(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, alpha: number) {
    g.fillStyle(color, alpha);
    g.fillRoundedRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3, 4);
    g.fillStyle(0xffffff, .22 * alpha);
    g.fillRoundedRect(x + 4, y + 4, CELL - 12, (CELL - 12) * .38, 3);
    g.lineStyle(1, 0x101114, .5 * alpha);
    g.strokeRoundedRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3, 4);
  }

  private redrawPieces() {
    const g = this.pieceGraphics;
    g.clear();
    const piece = this.active;
    if (!piece || this.state === "over") return;
    const color = PIECE_COLORS[piece.type];
    const ghost = this.ghostY();
    for (let row = 0; row < piece.matrix.length; row += 1) {
      for (let col = 0; col < piece.matrix[row].length; col += 1) {
        if (!piece.matrix[row][col]) continue;
        const gy = ghost + row;
        if (gy !== piece.y + row && gy < ROWS) {
          g.lineStyle(1.6, color, .38);
          g.strokeRoundedRect(BOARD_X + (piece.x + col) * CELL + 3, BOARD_Y + gy * CELL + 3, CELL - 6, CELL - 6, 4);
        }
        const py = piece.y + row;
        if (py >= 0) {
          this.drawBlock(g, BOARD_X + (piece.x + col) * CELL, BOARD_Y + py * CELL, color, 1);
        }
      }
    }
  }

  private redrawPanels() {
    const g = this.panelGraphics;
    g.clear();
    const drawMini = (type: PieceType | undefined, x: number, y: number, cell: number) => {
      if (!type) return;
      const matrix = BASE_MATRICES[type];
      for (let row = 0; row < matrix.length; row += 1) {
        for (let col = 0; col < matrix[row].length; col += 1) {
          if (!matrix[row][col]) continue;
          g.fillStyle(PIECE_COLORS[type], 1);
          g.fillRoundedRect(x + col * cell, y + row * cell, cell - 2, cell - 2, 3);
          g.lineStyle(1, 0x101114, .4);
          g.strokeRoundedRect(x + col * cell, y + row * cell, cell - 2, cell - 2, 3);
        }
      }
    };
    g.lineStyle(1.5, 0x3a3d45, 1);
    g.strokeRoundedRect(24, 76, 84, 76, 8);
    g.strokeRoundedRect(WIDTH - 108, 76, 84, 100, 8);
    drawMini(this.hold, 46, 92, 15);
    this.queue.slice(0, 3).forEach((type, index) => {
      drawMini(type, WIDTH - 99, 88 + index * 28, 12);
    });
  }

  update(time: number, delta: number) {
    if (this.ended) return;

    if (this.state === "clearing") {
      this.redrawBoard(time);
      this.redrawPieces();
      if (time - this.clearStart >= CLEAR_ANIMATION) this.finishClear();
      return;
    }
    if (this.state !== "playing") return;

    for (const label of this.heldButtons) {
      if (label !== "◀" && label !== "▶" && label !== "▼") continue;
      if (time >= this.repeatAt) {
        this.repeatAt = time + 55;
        if (label === "◀") this.tryMove(-1, 0);
        else if (label === "▶") this.tryMove(1, 0);
        else if (this.tryMove(0, 1)) this.refreshScore();
      }
    }

    const piece = this.active;
    if (!piece) return;
    this.fallAcc += delta;
    const interval = this.gravityInterval();
    while (this.fallAcc >= interval) {
      this.fallAcc -= interval;
      if (!this.tryMove(0, 1)) {
        this.fallAcc = 0;
        break;
      }
    }

    this.grounded = this.collides(piece.matrix, piece.x, piece.y + 1);
    if (this.grounded) {
      this.lockElapsed += delta;
      if (this.lockElapsed >= LOCK_DELAY) {
        this.lockPiece();
        this.redrawBoard(time);
        this.redrawPieces();
        if (this.panelDirty) {
          this.panelDirty = false;
          this.redrawPanels();
        }
        return;
      }
    } else {
      this.lockElapsed = 0;
    }

    this.redrawBoard(time);
    this.redrawPieces();
    if (this.panelDirty) {
      this.panelDirty = false;
      this.redrawPanels();
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    this.state = "over";
    this.redrawBoard(this.time.now);
    this.redrawPieces();
    this.audio.tone({ freq: 300, endFreq: 70, duration: .8, type: "sawtooth", gain: .22 });
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .62)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 196, 0x1b1d21)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(CENTER_X, 502, "堆到顶了", {
      fontFamily: "sans-serif", fontSize: "25px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `${this.score} 分  ·  ${this.lines} 行  ·  LV ${this.level}  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#8f918a", letterSpacing: 1,
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
  scene: BlockFallScene,
});
