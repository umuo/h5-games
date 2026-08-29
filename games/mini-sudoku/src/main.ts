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
const SIZE = 6;
const BOX_ROWS = 2;
const BOX_COLS = 3;
const BOARD_TOP = 168;

function basePattern(row: number, col: number) {
  return ((row % BOX_ROWS) * BOX_COLS + Math.floor(row / BOX_ROWS) + col) % SIZE + 1;
}

function cellRegion(col: number, row: number) {
  return `${Math.floor(row / BOX_ROWS)},${Math.floor(col / BOX_COLS)}`;
}

class MiniSudokuScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private cells: Array<{ value: number; given: boolean; text: Phaser.GameObjects.Text; rect: Phaser.GameObjects.Rectangle }> = [];
  private solution: number[] = [];
  private palette: Array<{ value: number; rect: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }> = [];
  private selectedDigit = 1;
  private level = 1;
  private mistakes = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "mini-sudoku", version: "1.0.0" });
  private storage = createGameStorage("mini-sudoku", { level: 1 });

  constructor() { super("mini-sudoku"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#f3f0e8");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 48, 48, 0xf3f0e8, 1, 0x101114, .04);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0x101114, .25);
    this.add.text(22, 43, "SUDOKU / 037", {
      fontFamily: "monospace", fontSize: "11px", color: INK, letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "数独小解", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#74726c",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 70, "第 1 题", {
      fontFamily: "sans-serif", fontSize: "21px", color: INK, fontStyle: "bold",
    });
    this.statusText = this.add.text(WIDTH - 22, 78, "失误 0", {
      fontFamily: "monospace", fontSize: "11px", color: "#74726c", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.hintText = this.add.text(CENTER_X, 742, "选下方数字 · 点击空格填入", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8a8881",
    }).setOrigin(.5);

    this.buildPalette();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.level = this.storage.load().level;
    this.loadLevel(this.level);
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.cells = [];
    this.mistakes = 0;
    this.started = false;
    this.ended = false;
    this.selectedDigit = 1;
  }

  private cellCenter(col: number, row: number) {
    return {
      x: CENTER_X - (SIZE * 52) / 2 + col * 52 + 26,
      y: BOARD_TOP + row * 52 + 26,
    };
  }

  private loadLevel(level: number) {
    this.resetRun();
    this.level = level;
    this.levelText.setText(`第 ${level} 题`);
    const solution = this.generateSolution();
    this.solution = solution;
    const removals = Math.min(18, 8 + level * 2);
    const puzzle = this.carvePuzzle(solution, removals);

    const grid = this.add.graphics();
    grid.lineStyle(1.2, 0x101114, .35);
    for (let index = 0; index <= SIZE; index += 1) {
      const bold = index % BOX_COLS === 0;
      const boldRow = index % BOX_ROWS === 0;
      const weight = bold || boldRow ? 2.4 : 1;
      grid.lineStyle(weight, 0x101114, .8);
      grid.lineBetween(
        CENTER_X - (SIZE * 52) / 2, BOARD_TOP + index * 52,
        CENTER_X + (SIZE * 52) / 2, BOARD_TOP + index * 52,
      );
      grid.lineBetween(
        CENTER_X - (SIZE * 52) / 2 + index * 52, BOARD_TOP,
        CENTER_X - (SIZE * 52) / 2 + index * 52, BOARD_TOP + SIZE * 52,
      );
    }
    grid.strokeRect(CENTER_X - (SIZE * 52) / 2, BOARD_TOP, SIZE * 52, SIZE * 52);

    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        const value = puzzle[row * SIZE + col];
        const given = value !== 0;
        const { x, y } = this.cellCenter(col, row);
        const rect = this.add.rectangle(x, y, 50, 50, given ? 0xe9e2d2 : 0xfdfaf2)
          .setStrokeStyle(1, 0x101114, .18)
          .setInteractive({ useHandCursor: true });
        const text = this.add.text(x, y, given ? String(value) : "", {
          fontFamily: "monospace", fontSize: "24px",
          color: given ? INK : "#74726c", fontStyle: given ? "bold" : "normal",
        }).setOrigin(.5);
        rect.setData("col", col).setData("row", row);
        rect.on("pointerup", () => this.tryFill(col, row));
        this.cells.push({ value, given, text, rect });
      }
    }
  }

  private generateSolution() {
    let solution = Array.from({ length: SIZE * SIZE }, (_, index) =>
      basePattern(Math.floor(index / SIZE), index % SIZE));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const digitMap = Phaser.Utils.Array.Shuffle([1, 2, 3, 4, 5, 6]);
      solution = solution.map((value) => digitMap[value - 1]);
      const rowBands = Phaser.Utils.Array.Shuffle([0, 1]);
      const reordered: number[] = [];
      for (const band of rowBands) {
        const rowBlock = Phaser.Utils.Array.Shuffle([0, 1]);
        for (const inner of rowBlock) {
          for (let col = 0; col < SIZE; col += 1) {
            reordered.push(solution[(band * BOX_ROWS + inner) * SIZE + col]);
          }
        }
      }
      solution = reordered;
      const colStacks = Phaser.Utils.Array.Shuffle([0, 1]);
      const columnOrder: number[] = [];
      for (const stack of colStacks) {
        const innerCols = Phaser.Utils.Array.Shuffle([0, 1, 2]);
        for (const inner of innerCols) columnOrder.push(stack * BOX_COLS + inner);
      }
      solution = solution.map((_, index) => {
        const row = Math.floor(index / SIZE);
        const col = index % SIZE;
        return solution[row * SIZE + columnOrder[col]];
      });
      if (this.isValidGrid(solution)) break;
    }
    return solution;
  }

  private isValidGrid(grid: number[]) {
    for (let row = 0; row < SIZE; row += 1) {
      if (new Set(grid.slice(row * SIZE, row * SIZE + SIZE)).size !== SIZE) return false;
    }
    for (let col = 0; col < SIZE; col += 1) {
      const column = Array.from({ length: SIZE }, (_, row) => grid[row * SIZE + col]);
      if (new Set(column).size !== SIZE) return false;
    }
    const regions = new Map<string, Set<number>>();
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        const region = cellRegion(col, row);
        if (!regions.has(region)) regions.set(region, new Set());
        regions.get(region)?.add(grid[row * SIZE + col]);
      }
    }
    return [...regions.values()].every((set) => set.size === SIZE);
  }

  private carvePuzzle(solution: number[], removals: number) {
    const puzzle = [...solution];
    const order = Phaser.Utils.Array.Shuffle(Array.from({ length: SIZE * SIZE }, (_, index) => index));
    let removed = 0;
    for (const index of order) {
      if (removed >= removals) break;
      const backup = puzzle[index];
      puzzle[index] = 0;
      if (this.countSolutions([...puzzle], 0, 2) !== 1) puzzle[index] = backup;
      else removed += 1;
    }
    return puzzle;
  }

  private countSolutions(grid: number[], startIndex: number, limit: number): number {
    let index = startIndex;
    while (index < SIZE * SIZE && grid[index] !== 0) index += 1;
    if (index >= SIZE * SIZE) return 1;
    let count = 0;
    const row = Math.floor(index / SIZE);
    const col = index % SIZE;
    for (let value = 1; value <= SIZE; value += 1) {
      if (!this.canPlace(grid, col, row, value)) continue;
      grid[index] = value;
      count += this.countSolutions(grid, index + 1, limit - count);
      grid[index] = 0;
      if (count >= limit) return count;
    }
    return count;
  }

  private canPlace(grid: number[], col: number, row: number, value: number) {
    for (let index = 0; index < SIZE; index += 1) {
      if (grid[row * SIZE + index] === value) return false;
      if (grid[index * SIZE + col] === value) return false;
    }
    const region = cellRegion(col, row);
    for (let otherRow = 0; otherRow < SIZE; otherRow += 1) {
      for (let otherCol = 0; otherCol < SIZE; otherCol += 1) {
        if (cellRegion(otherCol, otherRow) === region
          && grid[otherRow * SIZE + otherCol] === value) return false;
      }
    }
    return true;
  }

  private buildPalette() {
    for (let index = 0; index < SIZE; index += 1) {
      const x = CENTER_X - (SIZE * 52) / 2 + index * 52 + 26;
      const rect = this.add.rectangle(x, 636, 48, 48, index + 1 === 1 ? 0x101114 : 0xe9e2d2)
        .setStrokeStyle(2, index + 1 === 1 ? 0x101114 : 0x101114, .5)
        .setInteractive({ useHandCursor: true });
      const label = this.add.text(x, 636, String(index + 1), {
        fontFamily: "monospace", fontSize: "22px",
        color: index + 1 === 1 ? "#f3f0e8" : INK, fontStyle: "bold",
      }).setOrigin(.5);
      this.palette.push({ value: index + 1, rect, label });
      rect.on("pointerup", () => this.selectDigit(index + 1));
    }
    this.highlightPalette();
  }

  private selectDigit(value: number) {
    this.selectedDigit = value;
    this.highlightPalette();
    this.audio.tone({ freq: 340 + value * 30, duration: .05, type: "sine", gain: .08 });
  }

  private highlightPalette() {
    for (const item of this.palette) {
      const active = item.value === this.selectedDigit;
      item.rect.setFillStyle(active ? 0x101114 : 0xe9e2d2);
      item.label.setColor(active ? "#f3f0e8" : INK);
      item.rect.setStrokeStyle(2, active ? 0xff6a51 : 0x101114, .6);
    }
  }

  private tryFill(col: number, row: number) {
    if (this.ended) return;
    const cell = this.cells[row * SIZE + col];
    if (!cell || cell.given || cell.value !== 0) return;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.audio.unlock();
    }
    if (this.solution[row * SIZE + col] === this.selectedDigit) {
      cell.value = this.selectedDigit;
      cell.text.setText(String(this.selectedDigit));
      cell.text.setColor("#2f5d33");
      cell.rect.setFillStyle(0xdff0df);
      cell.rect.disableInteractive();
      this.audio.tone({ freq: 480 + this.selectedDigit * 40, duration: .08, type: "sine", gain: .12 });
      if (this.cells.every((entry) => entry.value !== 0)) this.completeLevel();
    } else {
      this.mistakes += 1;
      this.statusText.setText(`失误 ${this.mistakes}`);
      this.audio.tone({ freq: 190, duration: .12, type: "sawtooth", gain: .1 });
      this.tweens.add({ targets: cell.rect, x: "+=4", duration: 50, yoyo: true, repeat: 2 });
    }
  }

  private completeLevel() {
    this.ended = true;
    this.storage.save({ level: this.level + 1 });
    this.bridge.gameOver(100 - this.mistakes * 10);
    this.audio.tone({ freq: 523, duration: .15, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 659, duration: .18, time: this.audio.now + .13, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .28, type: "triangle", gain: .22 });
    const banner = this.add.text(CENTER_X, 480, `完成！失误 ${this.mistakes}`, {
      fontFamily: "sans-serif", fontSize: "26px", color: "#2f5d33", fontStyle: "bold",
    }).setOrigin(.5).setDepth(20).setAlpha(0);
    this.tweens.add({ targets: banner, alpha: 1, duration: 220 });
    this.time.delayedCall(1100, () => this.loadLevel(this.level + 1));
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
  scene: MiniSudokuScene,
});
