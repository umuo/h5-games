import Phaser from "phaser";
import initSolverModule from "./solver.wasm?init";
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
const COLS = 4;
const ROWS = 5;
const CELL = 66;
const BOARD_X = CENTER_X - (COLS * CELL) / 2;
const BOARD_Y = 190;

const BLOCK_DEFS = [
  { group: 0, w: 2, h: 2, col: 1, row: 0, label: "曹", color: 0xc23b2e },
  { group: 1, w: 2, h: 1, col: 1, row: 2, label: "关", color: 0x2f6b4f },
  { group: 2, w: 1, h: 2, col: 0, row: 0, label: "将", color: 0x35506b },
  { group: 3, w: 1, h: 2, col: 3, row: 0, label: "将", color: 0x35506b },
  { group: 4, w: 1, h: 2, col: 0, row: 3, label: "将", color: 0x35506b },
  { group: 5, w: 1, h: 2, col: 3, row: 3, label: "将", color: 0x35506b },
  { group: 6, w: 1, h: 1, col: 0, row: 2, label: "兵", color: 0x8a6d3b },
  { group: 7, w: 1, h: 1, col: 3, row: 2, label: "兵", color: 0x8a6d3b },
  { group: 8, w: 1, h: 1, col: 1, row: 3, label: "兵", color: 0x8a6d3b },
  { group: 9, w: 1, h: 1, col: 2, row: 3, label: "兵", color: 0x8a6d3b },
];

interface Block {
  group: number;
  w: number;
  h: number;
  col: number;
  row: number;
  container: Phaser.GameObjects.Container;
}

interface SolverExports {
  setCell(index: number, value: number): void;
  commitBoard(): number;
  solve(): number;
  minMoves(): number;
  hintMove(): number;
}

type Direction = { dx: number; dy: number };

class KlotskiScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private movesText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private blocks: Block[] = [];
  private selected?: Block;
  private history: Array<{ group: number; col: number; row: number }> = [];
  private moves = 0;
  private started = false;
  private ended = false;
  private solver: SolverExports | null = null;
  private wasmReady = false;
  private minMoves = 0;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "klotski", version: "1.0.0" });
  private storage = createGameStorage("klotski", { bestMoves: 0 });

  constructor() { super("klotski"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#f3f0e8");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 48, 48, 0xf3f0e8, 1, 0x101114, .04);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0x101114, .25);
    this.add.text(22, 43, "KLOT / 058", {
      fontFamily: "monospace", fontSize: "11px", color: INK, letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "华容道", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#74726c",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 70, "横刀立马", {
      fontFamily: "sans-serif", fontSize: "21px", color: INK, fontStyle: "bold",
    });
    this.movesText = this.add.text(WIDTH - 22, 78, "步数 0", {
      fontFamily: "monospace", fontSize: "12px", color: "#dfff3f", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.bestText = this.add.text(WIDTH - 22, 100, "", {
      fontFamily: "monospace", fontSize: "10px", color: "#74726c", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.hintText = this.add.text(CENTER_X, 700, "点击棋子选中 · 再点相邻空格滑动", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8a8881",
    }).setOrigin(.5);

    const frame = this.add.graphics().setDepth(1);
    frame.fillStyle(0xe9e2d2, 1);
    frame.fillRoundedRect(BOARD_X - 10, BOARD_Y - 10, COLS * CELL + 20, ROWS * CELL + 20, 12);
    frame.lineStyle(2, 0x101114, .6);
    frame.strokeRoundedRect(BOARD_X - 10, BOARD_Y - 10, COLS * CELL + 20, ROWS * CELL + 20, 12);
    // 出口标记（底边中开口）
    frame.fillStyle(0xf3f0e8, 1);
    frame.fillRect(BOARD_X + CELL - 3, BOARD_Y + ROWS * CELL + 8, CELL * 2 + 6, 6);
    frame.lineStyle(2, 0xc23b2e, .8);
    frame.lineBetween(BOARD_X + CELL, BOARD_Y + ROWS * CELL + 12, BOARD_X + CELL * 3, BOARD_Y + ROWS * CELL + 12);

    this.buildBlocks();
    this.buildButtons();
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.refreshBest();
    this.initSolver();
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.blocks = [];
    this.selected = undefined;
    this.history = [];
    this.moves = 0;
    this.started = false;
    this.ended = false;
  }

  private async initSolver() {
    try {
      this.solver = (await initSolverModule()) as unknown as SolverExports;
      this.wasmReady = true;
    } catch {
      this.wasmReady = false;
    }
    this.computeMinMoves();
  }

  private computeMinMoves() {
    if (!this.solver) return;
    this.writeBoardToSolver();
    if (this.solver.commitBoard() !== 0) return;
    this.solver.solve();
    this.minMoves = this.solver.minMoves();
    if (this.minMoves >= 0) {
      this.hintText.setText(`最少 ${this.minMoves} 步 · 点击棋子选中滑动`).setColor("#8a8881");
    }
  }

  private writeBoardToSolver() {
    if (!this.solver) return;
    const cells = new Array(20).fill(0);
    for (const block of this.blocks) {
      for (let dy = 0; dy < block.h; dy++) {
        for (let dx = 0; dx < block.w; dx++) {
          cells[(block.row + dy) * COLS + block.col + dx] = block.group + 1;
        }
      }
    }
    cells.forEach((value, index) => this.solver?.setCell(index, value));
  }

  private refreshBest() {
    const saved = this.storage.load();
    this.bestText.setText(saved.bestMoves > 0 ? `最佳 ${saved.bestMoves} 步` : "");
  }

  private buildBlocks() {
    for (const def of BLOCK_DEFS) {
      const x = BOARD_X + def.col * CELL + (def.w * CELL) / 2;
      const y = BOARD_Y + def.row * CELL + (def.h * CELL) / 2;
      const w = def.w * CELL - 6;
      const h = def.h * CELL - 6;
      const rect = this.add.rectangle(0, 0, w, h, def.color)
        .setStrokeStyle(2.5, 0x101114, .7);
      const label = this.add.text(0, 0, def.label, {
        fontFamily: "sans-serif",
        fontSize: `${Math.min(w, h) * .42}px`,
        color: def.group === 0 ? "#f3f0e8" : "#f3f0e8",
        fontStyle: "bold",
      }).setOrigin(.5);
      const container = this.add.container(x, y, [rect, label]).setDepth(4)
        .setInteractive({ useHandCursor: true });
      container.setData("group", def.group);
      container.on("pointerup", () => this.tapBlock(def.group));
      this.blocks.push({ group: def.group, w: def.w, h: def.h, col: def.col, row: def.row, container });
    }
  }

  private buildButtons() {
    const build = (x: number, label: string, onTap: () => void) => {
      const button = this.add.rectangle(x, 764, 108, 44, 0x101114)
        .setInteractive({ useHandCursor: true });
      this.add.text(x, 764, label, {
        fontFamily: "sans-serif", fontSize: "14px", color: "#f3f0e8", fontStyle: "bold",
      }).setOrigin(.5);
      button.on("pointerup", onTap);
    };
    build(CENTER_X - 76, "撤 销", () => this.undo());
    build(CENTER_X + 76, "提 示", () => this.showHint());
  }

  private blockByGroup(group: number) {
    return this.blocks.find((block) => block.group === group);
  }

  private occupancy() {
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    for (const block of this.blocks) {
      for (let dy = 0; dy < block.h; dy++) {
        for (let dx = 0; dx < block.w; dx++) {
          grid[block.row + dy][block.col + dx] = true;
        }
      }
    }
    return grid;
  }

  private canPlace(block: Block, col: number, row: number, ignore?: Block) {
    if (col < 0 || col + block.w > COLS || row < 0 || row + block.h > ROWS) return false;
    const grid = this.occupancy();
    if (ignore) {
      for (let dy = 0; dy < ignore.h; dy++) {
        for (let dx = 0; dx < ignore.w; dx++) {
          grid[ignore.row + dy][ignore.col + dx] = false;
        }
      }
    }
    for (let dy = 0; dy < block.h; dy++) {
      for (let dx = 0; dx < block.w; dx++) {
        if (grid[row + dy][col + dx]) return false;
      }
    }
    return true;
  }

  private tapBlock(group: number) {
    if (this.ended) return;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.audio.unlock();
    }
    const block = this.blockByGroup(group);
    if (!block) return;

    if (this.selected?.group === group) {
      this.clearSelection();
      return;
    }
    this.clearSelection();
    this.selected = block;
    const rect = block.container.list[0] as Phaser.GameObjects.Rectangle;
    rect.setStrokeStyle(3, 0xc23b2e, 1);
    this.audio.tone({ freq: 420, duration: .05, type: "sine", gain: .08 });
  }

  private clearSelection() {
    if (!this.selected) return;
    const rect = this.selected.container.list[0] as Phaser.GameObjects.Rectangle;
    rect.setStrokeStyle(2.5, 0x101114, .7);
    this.selected = undefined;
  }

  private tapCellAt(pointer: Phaser.Input.Pointer) {
    if (this.ended || !this.selected) return;
    const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const col = Math.floor((position.x - BOARD_X) / CELL);
    const row = Math.floor((position.y - BOARD_Y) / CELL);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
    const block = this.selected;
    const directions: Direction[] = [
      { dx: col - block.col, dy: 0 },
      { dx: 0, dy: row - block.row },
    ];
    for (const direction of directions) {
      if (direction.dx === 0 && direction.dy === 0) continue;
      if (Math.abs(direction.dx) + Math.abs(direction.dy) !== 1) continue;
      if (this.canPlace(block, block.col + direction.dx, block.row + direction.dy, block)) {
        this.slideBlock(block, direction.dx, direction.dy);
        return;
      }
    }
  }

  private slideBlock(block: Block, dx: number, dy: number) {
    this.history.push({ group: block.group, col: block.col, row: block.row });
    block.col += dx;
    block.row += dy;
    this.moves += 1;
    this.movesText.setText(`步数 ${this.moves}`);
    const { x, y } = this.cellCenterFor(block);
    this.tweens.add({ targets: block.container, x, y, duration: 140, ease: "Cubic.easeOut" });
    this.clearSelection();
    this.audio.tone({ freq: 320, duration: .06, type: "sine", gain: .1 });
    if (block.group === 0 && block.row === 3) this.winLevel();
  }

  private cellCenterFor(block: Block) {
    return {
      x: BOARD_X + block.col * CELL + (block.w * CELL) / 2,
      y: BOARD_Y + block.row * CELL + (block.h * CELL) / 2,
    };
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || !this.selected) return;
      this.tapCellAt(pointer);
    });
  }

  private undo() {
    if (this.ended || this.history.length === 0) return;
    const last = this.history.pop() as { group: number; col: number; row: number };
    const block = this.blockByGroup(last.group);
    if (!block) return;
    block.col = last.col;
    block.row = last.row;
    const { x, y } = this.cellCenterFor(block);
    this.tweens.add({ targets: block.container, x, y, duration: 120 });
    this.moves = Math.max(0, this.moves - 1);
    this.movesText.setText(`步数 ${this.moves}`);
    this.clearSelection();
    this.audio.tone({ freq: 260, duration: .05, type: "sine", gain: .08 });
  }

  private showHint() {
    if (this.ended || !this.wasmReady || !this.solver) {
      this.hintText.setText("提示需要 WebAssembly 支持").setColor("#c23b2e");
      return;
    }
    this.writeBoardToSolver();
    if (this.solver.commitBoard() !== 0) return;
    this.solver.solve();
    const encoded = this.solver.hintMove();
    if (encoded < 0) {
      this.hintText.setText("当前局面无解？试试撤销").setColor("#c23b2e");
      return;
    }
    const group = encoded >> 2;
    const block = this.blockByGroup(group);
    if (!block) return;
    this.selected = block;
    const rect = block.container.list[0] as Phaser.GameObjects.Rectangle;
    rect.setStrokeStyle(3, 0xc23b2e, 1);
    this.audio.tone({ freq: 520, duration: .08, type: "triangle", gain: .12 });
    this.hintText.setText(`提示：移动 ${BLOCK_DEFS[group].label}`).setColor("#2f6b4f");
  }

  private winLevel() {
    this.ended = true;
    this.clearSelection();
    const saved = this.storage.load();
    const bestMoves = saved.bestMoves > 0 ? Math.min(saved.bestMoves, this.moves) : this.moves;
    this.storage.save({ bestMoves });
    this.bestText.setText(`最佳 ${bestMoves} 步`);
    this.bridge.gameOver(Math.max(0, 1000 - this.moves * 10));
    this.audio.tone({ freq: 523, duration: .16, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 659, duration: .18, time: this.audio.now + .14, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 880, duration: .3, time: this.audio.now + .3, type: "triangle", gain: .22 });
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .55)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 420, 308, 190, 0xe9e2d2)
      .setStrokeStyle(2, 0xc23b2e).setDepth(101);
    this.add.text(CENTER_X, 386, "曹操遁走！", {
      fontFamily: "sans-serif", fontSize: "26px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 428, `${this.moves} 步  ·  最少 ${this.minMoves || "?"} 步  ·  最佳 ${bestMoves}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#777872", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 474, 184, 42, 0xc23b2e)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 474, "再来一局  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#f3f0e8", fontStyle: "bold",
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
  backgroundColor: "#f3f0e8",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: KlotskiScene,
});
