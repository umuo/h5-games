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
const BOARD_TOP = 176;
const BOARD_BOTTOM = 716;
const BOARD_MARGIN = 30;
const DIRS: Array<{ dx: number; dy: number; bit: number; opposite: number }> = [
  { dx: 0, dy: -1, bit: 1, opposite: 4 },
  { dx: 1, dy: 0, bit: 2, opposite: 8 },
  { dx: 0, dy: 1, bit: 4, opposite: 1 },
  { dx: -1, dy: 0, bit: 8, opposite: 2 },
];

interface PipeCell {
  col: number;
  row: number;
  /** Solved connection bits. */
  solvedDirs: number;
  /** 0..3 quarter turns applied to the solved orientation. */
  rotation: number;
  isSource: boolean;
  container: Phaser.GameObjects.Container;
  graphics: Phaser.GameObjects.Graphics;
  filled: boolean;
}

function currentDirs(cell: PipeCell) {
  let dirs = cell.solvedDirs;
  for (let turn = 0; turn < cell.rotation; turn += 1) {
    dirs = ((dirs << 1) | (dirs >>> 3)) & 15;
  }
  return dirs;
}

function levelSpec(level: number) {
  if (level <= 2) return { cols: 4, rows: 5 };
  if (level <= 5) return { cols: 5, rows: 5 };
  if (level <= 9) return { cols: 5, rows: 6 };
  return { cols: 6, rows: 6 };
}

class PipeConnectScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private movesText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private cells: PipeCell[] = [];
  private cols = 4;
  private rows = 5;
  private cell = 66;
  private boardX = 0;
  private boardY = 0;
  private level = 1;
  private started = false;
  private moves = 0;
  private won = false;
  private audio = createAudioKit({ masterGain: 0.42 });
  private bridge = createGameBridge({ gameId: "pipe-connect", version: "1.0.0" });
  private storage = createGameStorage("pipe-connect", { level: 1 });

  constructor() { super("pipe-connect"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 40, 40, 0x101114, 1, 0x2b2d32, .35);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "PIPE / 021", {
      fontFamily: "monospace", fontSize: "11px", color: "#54e0ff", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "管道连接", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 70, "第 1 关", {
      fontFamily: "sans-serif", fontSize: "22px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.movesText = this.add.text(WIDTH - 22, 78, "旋转 0 次", {
      fontFamily: "monospace", fontSize: "11px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.hintText = this.add.text(CENTER_X, 742, "点击管道旋转 · 全部接通即过关", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.level = this.storage.load().level;
    this.loadLevel(this.level);
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private levelIndex(col: number, row: number) {
    return row * this.cols + col;
  }

  private inside(col: number, row: number) {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  private cellAt(col: number, row: number): PipeCell | undefined {
    return this.inside(col, row) ? this.cells[this.levelIndex(col, row)] : undefined;
  }

  /** Spanning tree from a random source, then scramble orientations. */
  private buildLevel(level: number) {
    const spec = levelSpec(level);
    this.cols = spec.cols;
    this.rows = spec.rows;
    const total = this.cols * this.rows;
    const solved = new Array<number>(total).fill(0);
    const visited = new Array<boolean>(total).fill(false);
    const sourceIndex = Phaser.Math.RND.pick([
      Phaser.Math.Between(0, this.cols - 1),
      total - Phaser.Math.Between(1, this.cols),
      0,
      total - 1,
    ]);
    const stack = [sourceIndex];
    visited[sourceIndex] = true;
    let grown = 1;
    while (grown < total) {
      const index = stack[stack.length - 1];
      const col = index % this.cols;
      const row = Math.floor(index / this.cols);
      const options = Phaser.Utils.Array.Shuffle(DIRS.slice())
        .filter(({ dx, dy }) => {
          const nc = col + dx;
          const nr = row + dy;
          return this.inside(nc, nr) && !visited[this.levelIndex(nc, nr)];
        });
      if (options.length === 0) {
        stack.pop();
        continue;
      }
      const step = options[0];
      solved[index] |= step.bit;
      const neighbor = this.levelIndex(col + step.dx, row + step.dy);
      solved[neighbor] |= step.opposite;
      visited[neighbor] = true;
      stack.push(neighbor);
      grown += 1;
    }
    if (Math.random() < .4) {
      const index = Phaser.Math.Between(0, total - 1);
      const col = index % this.cols;
      const row = Math.floor(index / this.cols);
      const extra = Phaser.Utils.Array.GetRandom(
        DIRS.filter(({ dx, dy }) => this.inside(col + dx, row + dy)),
      );
      if ((solved[index] & extra.bit) === 0) {
        solved[index] |= extra.bit;
        solved[this.levelIndex(col + extra.dx, row + extra.dy)] |= extra.opposite;
      }
    }

    const width = WIDTH - BOARD_MARGIN * 2;
    this.cell = Math.min(width / this.cols, (BOARD_BOTTOM - BOARD_TOP) / this.rows);
    this.boardX = CENTER_X - (this.cell * this.cols) / 2;
    this.boardY = BOARD_TOP + ((BOARD_BOTTOM - BOARD_TOP) - this.cell * this.rows) / 2;

    for (let index = 0; index < total; index += 1) {
      const col = index % this.cols;
      const row = Math.floor(index / this.cols);
      const x = this.boardX + col * this.cell + this.cell / 2;
      const y = this.boardY + row * this.cell + this.cell / 2;
      const container = this.add.container(x, y);
      const graphics = this.add.graphics();
      container.add(graphics);
      const hit = this.add.rectangle(0, 0, this.cell - 4, this.cell - 4, 0xffffff, .001)
        .setInteractive({ useHandCursor: true });
      container.add(hit);
      const cell: PipeCell = {
        col, row,
        solvedDirs: solved[index],
        rotation: Phaser.Math.Between(0, 3),
        isSource: index === sourceIndex,
        container, graphics,
        filled: false,
      };
      hit.on("pointerup", () => this.rotateCell(cell));
      this.cells.push(cell);
    }
    let unsolved = this.cells.filter((cell) => cell.rotation !== 0).length;
    while (unsolved < this.cells.length * .6) {
      const cell = Phaser.Utils.Array.GetRandom(this.cells);
      cell.rotation = (cell.rotation + 1) % 4;
      unsolved = this.cells.filter((entry) => entry.rotation !== 0).length;
    }
  }

  private loadLevel(level: number) {
    this.level = level;
    this.moves = 0;
    this.won = false;
    this.cells = [];
    this.buildLevel(level);
    this.levelText.setText(`第 ${level} 关`);
    this.movesText.setText("旋转 0 次");
    this.updateFlow();
  }

  private rotateCell(cell: PipeCell) {
    if (this.won) return;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.audio.unlock();
    }
    cell.rotation = (cell.rotation + 1) % 4;
    this.moves += 1;
    this.movesText.setText(`旋转 ${this.moves} 次`);
    this.audio.tone({ freq: 300 + cell.rotation * 40, duration: .05, type: "square", gain: .08 });
    cell.container.setAngle(-90);
    this.tweens.add({ targets: cell.container, angle: 0, duration: 110, ease: "Cubic.easeOut" });
    this.updateFlow();
  }

  private computeFlow() {
    const source = this.cells.find((cell) => cell.isSource);
    if (!source) return new Set<PipeCell>();
    const filled = new Set<PipeCell>([source]);
    const stack = [source];
    while (stack.length > 0) {
      const cell = stack.pop() as PipeCell;
      const dirs = currentDirs(cell);
      for (const { dx, dy, bit } of DIRS) {
        if (!(dirs & bit)) continue;
        const neighbor = this.cellAt(cell.col + dx, cell.row + dy);
        if (!neighbor || filled.has(neighbor)) continue;
        if (currentDirs(neighbor) & bit) {
          filled.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    return filled;
  }

  private updateFlow() {
    const filled = this.computeFlow();
    for (const cell of this.cells) {
      cell.filled = filled.has(cell);
      this.drawCell(cell);
    }
    if (filled.size === this.cells.length) this.winLevel();
  }

  private drawCell(cell: PipeCell) {
    const g = cell.graphics;
    g.clear();
    const half = this.cell / 2;
    g.fillStyle(cell.filled ? 0x123744 : 0x1b1d21, 1);
    g.fillRoundedRect(-half + 3, -half + 3, this.cell - 6, this.cell - 6, 8);
    g.lineStyle(1.2, 0x3a3d45, .9);
    g.strokeRoundedRect(-half + 3, -half + 3, this.cell - 6, this.cell - 6, 8);
    const dirs = currentDirs(cell);
    const pipeColor = cell.filled ? 0x54e0ff : 0x4a5468;
    g.lineStyle(this.cell * .22, pipeColor, 1);
    for (const { bit } of DIRS) {
      if (!(dirs & bit)) continue;
      if (bit === 1) g.lineBetween(0, 0, 0, -half);
      else if (bit === 2) g.lineBetween(0, 0, half, 0);
      else if (bit === 4) g.lineBetween(0, 0, 0, half);
      else g.lineBetween(0, 0, -half, 0);
    }
    if (cell.isSource) {
      g.fillStyle(cell.filled ? 0xdfff3f : 0x54e0ff, 1);
      g.fillCircle(0, 0, this.cell * .17);
      g.lineStyle(2, 0x101114, .6);
      g.strokeCircle(0, 0, this.cell * .17);
    } else {
      g.fillStyle(cell.filled ? 0x9becff : 0x5a6478, 1);
      g.fillCircle(0, 0, this.cell * .1);
    }
  }

  private winLevel() {
    this.won = true;
    this.storage.save({ level: this.level + 1 });
    this.bridge.score(this.level);
    this.audio.tone({ freq: 440, duration: .14, type: "triangle", gain: .18 });
    this.audio.tone({ freq: 660, duration: .18, time: this.audio.now + .12, type: "triangle", gain: .18 });
    this.audio.tone({ freq: 880, duration: .26, time: this.audio.now + .26, type: "triangle", gain: .2 });
    for (const cell of this.cells) {
      const distance = Phaser.Math.Distance.Between(
        cell.container.x, cell.container.y,
        this.boardX + this.cell / 2, this.boardY + this.cell / 2,
      );
      this.tweens.add({
        targets: cell.graphics,
        alpha: { from: .4, to: 1 },
        delay: distance * .9,
        duration: 240,
      });
    }
    const banner = this.add.text(CENTER_X, HEIGHT / 2 - 40, "全线贯通！", {
      fontFamily: "sans-serif", fontSize: "32px", color: "#54e0ff", fontStyle: "bold", letterSpacing: 6,
    }).setOrigin(.5).setDepth(20).setAlpha(0);
    this.tweens.add({
      targets: banner,
      alpha: 1,
      scale: { from: .7, to: 1 },
      duration: 260,
      ease: "Back.easeOut",
      onComplete: () => {
        this.tweens.add({
          targets: banner,
          alpha: 0,
          delay: 720,
          duration: 300,
          onComplete: () => this.loadLevel(this.level + 1),
        });
      },
    });
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
  scene: PipeConnectScene,
});
