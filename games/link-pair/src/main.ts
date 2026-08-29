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
const COLS = 8;
const ROWS = 8;
const CELL = 42;
const BOARD_X = CENTER_X - (COLS * CELL) / 2;
const BOARD_Y = 170;
const TYPE_COUNT = 8;

interface Tile {
  type: number;
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

const TILE_GLYPHS = ["▲", "●", "■", "◆", "★", "✚", "⬟", "☯"];

class LinkPairScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private pairsText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private pathGraphics!: Phaser.GameObjects.Graphics;
  private grid: Array<Array<Tile | null>> = [];
  private selected?: { col: number; row: number };
  private totalPairs = 0;
  private clearedPairs = 0;
  private level = 1;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "link-pair", version: "1.0.0" });
  private storage = createGameStorage("link-pair", { level: 1 });

  constructor() { super("link-pair"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 40, 40, 0x101114, 1, 0x2b2d32, .35);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "LINK / 053", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "连连看", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 70, "第 1 关", {
      fontFamily: "sans-serif", fontSize: "21px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.pairsText = this.add.text(WIDTH - 22, 78, "", {
      fontFamily: "monospace", fontSize: "12px", color: "#dfff3f", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.hintText = this.add.text(CENTER_X, 730, "连接两颗相同图案 · 路径最多两个拐角", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    this.pathGraphics = this.add.graphics().setDepth(5);

    this.level = this.storage.load().level;
    this.loadLevel(this.level);
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  /** outer ring (row/col -1) counts as free walkway for pathfinding. */
  private tileAt(col: number, row: number): Tile | null {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return this.grid[row][col];
  }

  private loadLevel(level: number) {
    this.level = level;
    this.clearedPairs = 0;
    this.selected = undefined;
    this.pathGraphics.clear();

    const pairs = Math.min(14, 6 + level * 2);
    const typeCount = Math.min(TYPE_COUNT, 4 + Math.floor(level / 3));
    const total = COLS * ROWS;
    this.totalPairs = pairs;
    const cells: Array<{ col: number; row: number }> = [];
    const types: number[] = [];
    for (let index = 0; index < pairs; index += 1) {
      const type = Phaser.Math.Between(0, typeCount - 1);
      types.push(type, type);
    }
    for (let spare = 0; spare < total - pairs * 2; spare += 1) {
      types.push(-1);
    }
    Phaser.Utils.Array.Shuffle(types);
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        cells.push({ col, row });
      }
    }

    this.grid = Array.from({ length: ROWS }, () => Array<Tile | null>(COLS).fill(null));
    let cursor = 0;
    for (const cell of cells) {
      const type = types[cursor++];
      if (type < 0) continue;
      const x = BOARD_X + cell.col * CELL + CELL / 2;
      const y = BOARD_Y + cell.row * CELL + CELL / 2;
      const rect = this.add.rectangle(x, y, CELL - 6, CELL - 6, 0x1b2038)
        .setStrokeStyle(1.5, 0x3a4470).setInteractive({ useHandCursor: true }).setDepth(3);
      const label = this.add.text(x, y, TILE_GLYPHS[type], {
        fontFamily: "sans-serif", fontSize: "20px", color: "#f3f0e8",
      }).setOrigin(.5).setDepth(4);
      rect.on("pointerup", () => this.tapTile(cell.col, cell.row));
      this.grid[cell.row][cell.col] = { type, rect, label };
    }

    // If the generated board has no possible move at all, reshuffle once.
    if (!this.findPossiblePair()) this.reshuffle();
    this.levelText.setText(`第 ${level} 关`);
    this.pairsText.setText(`剩余 ${this.totalPairs - this.clearedPairs} 对`);
  }

  private findPossiblePair() {
    for (let row1 = 0; row1 < ROWS; row1 += 1) {
      for (let col1 = 0; col1 < COLS; col1 += 1) {
        const a = this.tileAt(col1, row1);
        if (!a) continue;
        for (let row2 = row1; row2 < ROWS; row2 += 1) {
          for (let col2 = row2 === row1 ? col1 + 1 : 0; col2 < COLS; col2 += 1) {
            const b = this.tileAt(col2, row2);
            if (!b || b.type !== a.type) continue;
            if (this.findPath(col1, row1, col2, row2)) return true;
          }
        }
      }
    }
    return false;
  }

  private reshuffle() {
    const tiles = this.grid.flat().filter((tile): tile is Tile => Boolean(tile));
    const positions: Array<{ col: number; row: number }> = tiles.map((_, index) => ({
      col: index % COLS,
      row: Math.floor(index / COLS),
    }));
    Phaser.Utils.Array.Shuffle(positions);
    tiles.forEach((tile, index) => {
      this.grid[positions[index].row][positions[index].col] = tile;
      const { x, y } = {
        x: BOARD_X + positions[index].col * CELL + CELL / 2,
        y: BOARD_Y + positions[index].row * CELL + CELL / 2,
      };
      tile.rect.setPosition(x, y);
      tile.label.setPosition(x, y);
    });
  }

  /** BFS over 4-directions where cost = turns; max 2 turns. */
  private findPath(col1: number, row1: number, col2: number, row2: number) {
    const walkable = (col: number, row: number) => {
      if (col === col2 && row === row2) return true;
      return col < 0 || col >= COLS || row < 0 || row >= ROWS || !this.grid[row][col];
    };
    const start = { col: col1, row: row1, dir: -1, turns: 0 };
    const queue: Array<typeof start> = [start];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift() as typeof start;
      const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let dirIndex = 0; dirIndex < 4; dirIndex += 1) {
        const [dx, dy] = directions[dirIndex];
        const turns = current.dir === -1 || current.dir === dirIndex ? current.turns : current.turns + 1;
        if (turns > 2) continue;
        const col = current.col;
        const row = current.row;
        // step along direction one cell at a time
        let step = 1;
        while (true) {
          const nextCol = col + dx * step;
          const nextRow = row + dy * step;
          if (!walkable(nextCol, nextRow)) break;
          if (nextCol === col2 && nextRow === row2) return true;
          const cellKey = `${nextCol},${nextRow},${dirIndex},${turns}`;
          if (!seen.has(cellKey)) {
            seen.add(cellKey);
            queue.push({ col: nextCol, row: nextRow, dir: dirIndex, turns });
          }
          step += 1;
        }
      }
    }
    return false;
  }

  private tracePath(col1: number, row1: number, col2: number, row2: number): Array<{ x: number; y: number }> | null {
    const center = (col: number, row: number) => ({
      x: BOARD_X + col * CELL + CELL / 2,
      y: BOARD_Y + row * CELL + CELL / 2,
    });
    const walkable = (col: number, row: number) => {
      if (col === col2 && row === row2) return true;
      return col < 0 || col >= COLS || row < 0 || row >= ROWS || !this.grid[row][col];
    };
    const start = { col: col1, row: row1, dir: -1, turns: 0, path: [center(col1, row1)] };
    const queue: Array<typeof start> = [start];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift() as typeof start;
      const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let dirIndex = 0; dirIndex < 4; dirIndex += 1) {
        const [dx, dy] = directions[dirIndex];
        const turns = current.dir === -1 || current.dir === dirIndex ? current.turns : current.turns + 1;
        if (turns > 2) continue;
        let step = 1;
        while (true) {
          const nextCol = current.col + dx * step;
          const nextRow = current.row + dy * step;
          if (!walkable(nextCol, nextRow)) break;
          const position = center(nextCol, nextRow);
          const path = current.dir === dirIndex
            ? [...current.path]
            : [...current.path, position];
          if (nextCol === col2 && nextRow === row2) {
            path.push(center(col2, row2));
            return path;
          }
          const cellKey = `${nextCol},${nextRow},${dirIndex},${turns}`;
          if (!seen.has(cellKey)) {
            seen.add(cellKey);
            queue.push({ col: nextCol, row: nextRow, dir: dirIndex, turns, path });
          }
          step += 1;
        }
      }
    }
    return null;
  }

  private tapTile(col: number, row: number) {
    if (this.ended) return;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.audio.unlock();
    }
    const tile = this.tileAt(col, row);
    if (!tile) return;
    if (this.selected) {
      const previous = this.selected;
      const previousTile = this.tileAt(previous.col, previous.row);
      if (previous.col === col && previous.row === row) {
        this.clearSelection();
        return;
      }
      if (previousTile && previousTile.type === tile.type) {
        const path = this.tracePath(previous.col, previous.row, col, row);
        if (path) {
          this.removePair(previous, { col, row }, path);
          return;
        }
      }
      this.clearSelection();
    }
    this.selected = { col, row };
    tile.rect.setStrokeStyle(3, 0xdfff3f, 1);
    this.audio.tone({ freq: 420, duration: .05, type: "sine", gain: .08 });
  }

  private clearSelection() {
    if (this.selected) {
      const tile = this.tileAt(this.selected.col, this.selected.row);
      tile?.rect.setStrokeStyle(1.5, 0x3a4470, 1);
    }
    this.selected = undefined;
  }

  private removePair(from: { col: number; row: number }, to: { col: number; row: number }, path: Array<{ x: number; y: number }>) {
    const a = this.tileAt(from.col, from.row);
    const b = this.tileAt(to.col, to.row);
    if (a) {
      a.rect.destroy();
      a.label.destroy();
      this.grid[from.row][from.col] = null;
    }
    if (b) {
      b.rect.destroy();
      b.label.destroy();
      this.grid[to.row][to.col] = null;
    }
    this.clearSelection();
    this.clearedPairs += 1;
    this.pairsText.setText(`剩余 ${this.totalPairs - this.clearedPairs} 对`);
    this.bridge.score(10);
    this.audio.tone({ freq: 620, duration: .1, type: "triangle", gain: .14 });

    this.pathGraphics.lineStyle(4, 0xdfff3f, .9);
    this.pathGraphics.beginPath();
    this.pathGraphics.moveTo(path[0].x, path[0].y);
    for (const point of path.slice(1)) this.pathGraphics.lineTo(point.x, point.y);
    this.pathGraphics.strokePath();
    this.time.delayedCall(180, () => this.pathGraphics.clear());

    const remainingPairs = this.totalPairs - this.clearedPairs;
    if (remainingPairs === 0) {
      this.ended = true;
      this.storage.save({ level: this.level + 1 });
      this.bridge.gameOver(100 + this.level * 20);
      this.audio.tone({ freq: 523, duration: .15, type: "triangle", gain: .2 });
      this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .14, type: "triangle", gain: .2 });
      const banner = this.add.text(CENTER_X, 430, "全部消除！", {
        fontFamily: "sans-serif", fontSize: "30px", color: "#dfff3f", fontStyle: "bold", letterSpacing: 6,
      }).setOrigin(.5).setDepth(20).setAlpha(0);
      this.tweens.add({ targets: banner, alpha: 1, duration: 220 });
      this.time.delayedCall(1100, () => this.scene.restart());
      return;
    }
    if (!this.findPossiblePair()) {
      this.reshuffle();
      this.hintText.setText("无可连接 · 已重新洗牌").setColor("#dfff3f");
      this.time.delayedCall(1300, () => this.hintText.setText("连接两颗相同图案 · 路径最多两个拐角").setColor("#8f918a"));
      if (!this.findPossiblePair()) this.reshuffle();
    }
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
  scene: LinkPairScene,
});
