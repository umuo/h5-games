import Phaser from "phaser";
import {
  bindGameLifecycle,
  configureHiDpiCamera,
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
const BOARD_CELLS = 4;
const CELL_SIZE = 78;
const CELL_GAP = 10;
const BOARD_SIZE = BOARD_CELLS * CELL_SIZE + (BOARD_CELLS + 1) * CELL_GAP;
const BOARD_X = CENTER_X;
const BOARD_Y = 386;
const SWIPE_MIN = 24;
const WIN_VALUE = 2048;

type Direction = "up" | "down" | "left" | "right";

const VECTORS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const INK = "#101114";
const CREAM = "#f3f0e8";

const TILE_STYLES: Record<number, { bg: number; color: string; stroke?: number }> = {
  2: { bg: 0xf3f0e8, color: INK },
  4: { bg: 0xe8dfc8, color: INK },
  8: { bg: 0xffc24b, color: INK },
  16: { bg: 0xff9f43, color: INK },
  32: { bg: 0xff6a51, color: CREAM },
  64: { bg: 0xe8453c, color: CREAM },
  128: { bg: 0xdfff3f, color: INK },
  256: { bg: 0xb8e62e, color: INK },
  512: { bg: 0x5c7cff, color: CREAM },
  1024: { bg: 0x9b6bff, color: CREAM },
  2048: { bg: 0x101114, color: "#dfff3f", stroke: 0xdfff3f },
};

interface Tile {
  value: number;
  container: Phaser.GameObjects.Container;
  shape: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

function tileFont(value: number) {
  if (value >= 1024) return 22;
  if (value >= 128) return 26;
  return 30;
}

class Merge2048Scene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private boardGraphics!: Phaser.GameObjects.Graphics;
  private tileLayer!: Phaser.GameObjects.Container;
  private grid: Array<Array<Tile | null>> = [];
  private score = 0;
  private locked = false;
  private ended = false;
  private started = false;
  private wonShown = false;
  private swipeStart?: Phaser.Math.Vector2;
  private bridge = createGameBridge({ gameId: "merge-2048", version: "1.0.0" });
  private storage = createGameStorage("merge-2048", { highScore: 0 });

  constructor() { super("merge-2048"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#f3f0e8");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 39, 39, 0xf3f0e8, 1, 0x101114, .06);
    this.add.rectangle(WIDTH / 2, 31, WIDTH - 36, 1, 0x101114, .25);
    this.add.text(22, 43, "TILE / 012", {
      fontFamily: "monospace", fontSize: "11px", color: INK, letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "数字合并", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#74726c",
    }).setOrigin(1, 0);

    this.scoreText = this.add.text(22, 76, "0000", {
      fontFamily: "monospace", fontSize: "42px", color: INK, fontStyle: "bold",
    });
    const saved = this.storage.load();
    this.add.text(WIDTH - 22, 87, `BEST  ${String(saved.highScore).padStart(4, "0")}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#74726c", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");

    this.boardGraphics = this.add.graphics();
    this.drawBoardFrame();
    this.tileLayer = this.add.container(0, 0);

    this.hintText = this.add.text(CENTER_X, 636, "滑动棋盘 · 相同数字合并", {
      fontFamily: "sans-serif", fontSize: "16px", color: INK, fontStyle: "bold",
    }).setOrigin(.5);
    this.add.text(CENTER_X, 664, "棋盘填满且无法合并时结束", {
      fontFamily: "sans-serif", fontSize: "11px", color: "#8a8881",
    }).setOrigin(.5);
    const restart = this.add.rectangle(CENTER_X, 716, 184, 42, 0x101114)
      .setInteractive({ useHandCursor: true });
    this.add.text(CENTER_X, 716, "重新开始  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: CREAM, fontStyle: "bold",
    }).setOrigin(.5);
    restart.on("pointerup", () => this.scene.restart());

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => { this.swipeStart = undefined; } });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.swipeStart = undefined; });

    this.spawnTile(true);
    this.spawnTile(true);
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.grid = Array.from({ length: BOARD_CELLS }, () => Array<Tile | null>(BOARD_CELLS).fill(null));
    this.score = 0;
    this.locked = false;
    this.ended = false;
    this.wonShown = false;
    this.swipeStart = undefined;
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.swipeStart = new Phaser.Math.Vector2(position.x, position.y);
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      const start = this.swipeStart;
      this.swipeStart = undefined;
      if (!start || this.ended || this.locked) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const deltaX = position.x - start.x;
      const deltaY = position.y - start.y;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_MIN) return;
      const direction: Direction = Math.abs(deltaX) > Math.abs(deltaY)
        ? (deltaX > 0 ? "right" : "left")
        : (deltaY > 0 ? "down" : "up");
      if (!this.started) {
        this.started = true;
        this.bridge.started();
      }
      this.applyMove(direction);
    });
  }

  private cellCenter(col: number, row: number) {
    return {
      x: BOARD_X - BOARD_SIZE / 2 + CELL_GAP + col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2,
      y: BOARD_Y - BOARD_SIZE / 2 + CELL_GAP + row * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2,
    };
  }

  private drawBoardFrame() {
    this.boardGraphics.fillStyle(0x101114, .08);
    this.boardGraphics.fillRoundedRect(
      BOARD_X - BOARD_SIZE / 2, BOARD_Y - BOARD_SIZE / 2, BOARD_SIZE, BOARD_SIZE, 14,
    );
    for (let row = 0; row < BOARD_CELLS; row += 1) {
      for (let col = 0; col < BOARD_CELLS; col += 1) {
        const { x, y } = this.cellCenter(col, row);
        this.boardGraphics.fillStyle(0xf3f0e8, .55);
        this.boardGraphics.fillRoundedRect(x - CELL_SIZE / 2, y - CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 10);
      }
    }
    this.boardGraphics.lineStyle(2, 0x101114, .8);
    this.boardGraphics.strokeRoundedRect(
      BOARD_X - BOARD_SIZE / 2, BOARD_Y - BOARD_SIZE / 2, BOARD_SIZE, BOARD_SIZE, 14,
    );
  }

  private spawnTile(withPop: boolean) {
    const empty: Array<{ row: number; col: number }> = [];
    for (let row = 0; row < BOARD_CELLS; row += 1) {
      for (let col = 0; col < BOARD_CELLS; col += 1) {
        if (!this.grid[row][col]) empty.push({ row, col });
      }
    }
    if (empty.length === 0) return;
    const spot = Phaser.Utils.Array.GetRandom(empty);
    this.createTile(spot.col, spot.row, Math.random() < .9 ? 2 : 4, withPop);
  }

  private createTile(col: number, row: number, value: number, withPop: boolean) {
    const { x, y } = this.cellCenter(col, row);
    const shape = this.add.graphics();
    const label = this.add.text(0, 0, "", {
      fontFamily: "monospace", fontStyle: "bold", color: INK,
    }).setOrigin(.5);
    const container = this.add.container(x, y, [shape, label]);
    const tile: Tile = { value, container, shape, label };
    this.grid[row][col] = tile;
    this.tileLayer.add(container);
    this.styleTile(tile);
    if (withPop) {
      container.setScale(0);
      this.tweens.add({ targets: container, scale: 1, duration: 150, ease: "Back.easeOut" });
    }
    return tile;
  }

  private styleTile(tile: Tile) {
    const style = TILE_STYLES[tile.value] ?? { bg: 0x101114, color: CREAM, stroke: 0xdfff3f };
    const half = CELL_SIZE / 2;
    tile.shape.clear();
    tile.shape.fillStyle(style.bg, 1);
    tile.shape.fillRoundedRect(-half, -half, CELL_SIZE, CELL_SIZE, 10);
    if (style.stroke !== undefined) {
      tile.shape.lineStyle(2, style.stroke, 1);
      tile.shape.strokeRoundedRect(-half, -half, CELL_SIZE, CELL_SIZE, 10);
    } else {
      tile.shape.lineStyle(1, 0x101114, .35);
      tile.shape.strokeRoundedRect(-half, -half, CELL_SIZE, CELL_SIZE, 10);
    }
    tile.label.setText(String(tile.value));
    tile.label.setStyle({ fontFamily: "monospace", fontStyle: "bold", color: style.color, fontSize: `${tileFont(tile.value)}px` });
  }

  private applyMove(direction: Direction) {
    const vector = VECTORS[direction];
    const rows = [0, 1, 2, 3];
    const cols = [0, 1, 2, 3];
    if (vector.y === 1) rows.reverse();
    if (vector.x === 1) cols.reverse();

    let moved = false;
    const moves: Array<{ tile: Tile; x: number; y: number }> = [];
    const merges: Array<{ survivor: Tile; absorbed: Tile }> = [];
    const mergedTargets = new Set<Tile>();

    for (const row of rows) {
      for (const col of cols) {
        const tile = this.grid[row][col];
        if (!tile) continue;
        let targetRow = row;
        let targetCol = col;
        let nextRow = row + vector.y;
        let nextCol = col + vector.x;
        while (this.inside(nextRow, nextCol) && !this.grid[nextRow][nextCol]) {
          targetRow = nextRow;
          targetCol = nextCol;
          nextRow += vector.y;
          nextCol += vector.x;
        }
        const neighbor = this.inside(nextRow, nextCol) ? this.grid[nextRow][nextCol] : null;
        if (neighbor && neighbor.value === tile.value && !mergedTargets.has(neighbor)) {
          this.grid[row][col] = null;
          mergedTargets.add(neighbor);
          merges.push({ survivor: neighbor, absorbed: tile });
          moved = true;
        } else if (targetRow !== row || targetCol !== col) {
          this.grid[row][col] = null;
          this.grid[targetRow][targetCol] = tile;
          const { x, y } = this.cellCenter(targetCol, targetRow);
          moves.push({ tile, x, y });
          moved = true;
        }
      }
    }
    if (!moved) return;

    this.locked = true;
    const duration = 90;
    for (const move of moves) {
      this.tweens.add({
        targets: move.tile.container,
        x: move.x,
        y: move.y,
        duration,
        ease: "Cubic.easeOut",
      });
    }
    for (const merge of merges) {
      this.tweens.add({
        targets: merge.absorbed.container,
        x: merge.survivor.container.x,
        y: merge.survivor.container.y,
        duration,
        ease: "Cubic.easeOut",
      });
    }

    this.time.delayedCall(duration + 20, () => {
      for (const merge of merges) {
        merge.absorbed.container.destroy();
        merge.survivor.value *= 2;
        this.styleTile(merge.survivor);
        this.score += merge.survivor.value;
        merge.survivor.container.setScale(1.16);
        this.tweens.add({ targets: merge.survivor.container, scale: 1, duration: 130, ease: "Cubic.easeOut" });
        if (merge.survivor.value >= WIN_VALUE && !this.wonShown) {
          this.wonShown = true;
          this.showWin();
        }
      }
      if (merges.length > 0) {
        this.scoreText.setText(String(this.score).padStart(4, "0"));
        this.bridge.score(this.score);
        const saved = this.storage.load();
        if (this.score > saved.highScore) this.storage.save({ highScore: this.score });
      }
      this.spawnTile(true);
      sharpenSceneText(this.children, RENDER_DPR);
      this.locked = false;
      if (this.isStuck()) this.failRun();
    });
  }

  private inside(row: number, col: number) {
    return row >= 0 && row < BOARD_CELLS && col >= 0 && col < BOARD_CELLS;
  }

  private isStuck() {
    for (let row = 0; row < BOARD_CELLS; row += 1) {
      for (let col = 0; col < BOARD_CELLS; col += 1) {
        const tile = this.grid[row][col];
        if (!tile) return false;
        if (col + 1 < BOARD_CELLS && this.grid[row][col + 1]?.value === tile.value) return false;
        if (row + 1 < BOARD_CELLS && this.grid[row + 1][col]?.value === tile.value) return false;
      }
    }
    return true;
  }

  private saveBest() {
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    const bestText = this.children.getByName("best-score") as Phaser.GameObjects.Text | null;
    bestText?.setText(`BEST  ${String(highScore).padStart(4, "0")}`);
    return highScore;
  }

  private failRun() {
    this.ended = true;
    this.cameras.main.shake(200, .01);
    this.hintText.setText("棋盘已满 · 点击按钮重来").setColor("#ff453a");
    const highScore = this.saveBest();
    this.bridge.gameOver(this.score);
    this.showResult("棋盘已满", highScore);
  }

  private showWin() {
    this.cameras.main.flash(220, 223, 255, 63, false);
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .48).setDepth(100);
    const panel = this.add.rectangle(WIDTH / 2, 420, 308, 170, 0xf3f0e8)
      .setStrokeStyle(2, 0x101114).setDepth(101);
    this.add.text(WIDTH / 2, 388, "达成 2048！", {
      fontFamily: "sans-serif", fontSize: "26px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(WIDTH / 2, 428, `当前 ${this.score} 分，还能继续合并。`, {
      fontFamily: "sans-serif", fontSize: "13px", color: "#777872",
    }).setOrigin(.5).setDepth(102);
    const keep = this.add.rectangle(WIDTH / 2, 462, 184, 40, 0x101114)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(WIDTH / 2, 462, "继续挑战  →", {
      fontFamily: "sans-serif", fontSize: "13px", color: CREAM, fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    keep.on("pointerup", () => {
      shade.destroy();
      panel.destroy();
    });
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: [shade, panel], alpha: { from: 0, to: 1 }, duration: 180 });
  }

  private showResult(title: string, highScore: number) {
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .48)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(WIDTH / 2, 620, 308, 178, 0xf3f0e8)
      .setStrokeStyle(2, 0x101114).setDepth(101);
    this.add.text(WIDTH / 2, 590, title, {
      fontFamily: "sans-serif", fontSize: "24px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(WIDTH / 2, 628, `${this.score} 分  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#777872", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(WIDTH / 2, 668, 184, 42, 0x101114)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(WIDTH / 2, 668, "再来一局  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: CREAM, fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    replay.on("pointerup", () => this.scene.restart());
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: [shade, panel], alpha: { from: 0, to: 1 }, duration: 180 });
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
  scene: Merge2048Scene,
});
