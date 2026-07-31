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
const COLS = 9;
const ROWS = 9;
const CELL_RADIUS = 14;
const CELL_GAP_X = 38;
const CELL_GAP_Y = 33;
const BOARD_ORIGIN_X = 42.5;
const BOARD_ORIGIN_Y = 238;
const INITIAL_WALLS = 8;

const COLORS = {
  paper: 0xf3f0e8,
  ink: 0x101114,
  acid: 0xdfff3f,
  coral: 0xff6a51,
  blue: 0x5c7cff,
  muted: 0x777872,
  open: 0xfffdf7,
};

type Cell = {
  col: number;
  row: number;
};

const cellKey = ({ col, row }: Cell) => `${col}:${row}`;

class CatchTheCatScene extends Phaser.Scene {
  private circles: Phaser.GameObjects.Arc[][] = [];
  private cat!: Phaser.GameObjects.Container;
  private moveText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private walls = new Set<string>();
  private catCell: Cell = { col: 4, row: 4 };
  private moves = 0;
  private locked = false;
  private ended = false;
  private started = false;
  private endLayer?: Phaser.GameObjects.Container;
  private storage = createGameStorage("catch-the-cat", { bestMoves: 0, wins: 0 });
  private bridge = createGameBridge({
    gameId: "catch-the-cat",
    version: "1.2.0",
    onCommand: (event) => {
      if (event.type === "PAUSE") this.scene.pause();
      if (event.type === "RESUME" && !this.ended) this.scene.resume();
      if (event.type === "RESTART") this.scene.restart();
    },
  });

  constructor() {
    super("catch-the-cat");
  }

  preload() {
    this.load.image("cat-mascot", "assets/cat-mascot.png");
  }

  create() {
    this.moves = 0;
    this.locked = false;
    this.ended = false;
    this.started = false;
    this.catCell = { col: 4, row: 4 };
    this.circles = [];
    this.endLayer = undefined;
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor(COLORS.paper);

    this.drawInterface();
    this.createBoard();
    this.createInitialWalls();
    this.cat = this.createCat();
    const start = this.getCellPosition(this.catCell);
    this.cat.setPosition(start.x, start.y);
    this.refreshStats();
    sharpenSceneText(this.children, RENDER_DPR);

    bindGameLifecycle(this);

    this.bridge.ready();
  }

  private drawInterface() {
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 39, 39, COLORS.paper, 1, COLORS.ink, .055);
    this.add.rectangle(WIDTH / 2, 30, WIDTH - 36, 1, COLORS.ink, .28);
    this.add.text(22, 42, "CATCH / CAT  ·  003", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#101114",
      letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 42, "围住小猫", {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#74726c",
    }).setOrigin(1, 0);

    this.add.text(22, 78, "别让它跑掉", {
      fontFamily: "sans-serif",
      fontSize: "28px",
      fontStyle: "bold",
      color: "#101114",
    });
    this.add.text(22, 117, "每设置一个路障，小猫会移动一步", {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#777872",
    });

    this.moveText = this.add.text(22, 158, "步数  00", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#101114",
      letterSpacing: 1,
    });
    this.bestText = this.add.text(WIDTH - 22, 158, "最佳  --", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#777872",
      letterSpacing: 1,
    }).setOrigin(1, 0);
    this.add.rectangle(WIDTH / 2, 190, WIDTH - 44, 1, COLORS.ink, .14);

    this.hintText = this.add.text(WIDTH / 2, 563, "点击空白圆点 · 设置路障", {
      fontFamily: "sans-serif",
      fontSize: "16px",
      fontStyle: "bold",
      color: "#101114",
    }).setOrigin(.5);
    this.add.text(WIDTH / 2, 596, "围住小猫即获胜 · 抵达边缘则逃脱", {
      fontFamily: "sans-serif",
      fontSize: "11px",
      color: "#777872",
    }).setOrigin(.5);

    const resetButton = this.add.rectangle(WIDTH / 2, 654, 164, 44, COLORS.ink)
      .setStrokeStyle(1, COLORS.ink)
      .setInteractive({ useHandCursor: true });
    this.add.text(WIDTH / 2, 654, "重新布置  ↻", {
      fontFamily: "sans-serif",
      fontSize: "14px",
      fontStyle: "bold",
      color: "#f3f0e8",
    }).setOrigin(.5);
    resetButton.on("pointerup", () => this.scene.restart());

    this.add.text(WIDTH / 2, HEIGHT - 61, "ADAPTED FROM · GANLVTECH / MIT", {
      fontFamily: "monospace",
      fontSize: "9px",
      color: "#9a978f",
      letterSpacing: 1,
    }).setOrigin(.5);
    this.add.text(WIDTH / 2, HEIGHT - 39, "游点意思  ·  MOBILE GAME LAB", {
      fontFamily: "monospace",
      fontSize: "9px",
      color: "#777872",
      letterSpacing: 1,
    }).setOrigin(.5);
  }

  private createBoard() {
    this.circles = Array.from({ length: ROWS }, () => []);
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const cell = { col, row };
        const position = this.getCellPosition(cell);
        const circle = this.add.circle(position.x, position.y, CELL_RADIUS, COLORS.open)
          .setStrokeStyle(1.5, COLORS.ink, .7)
          .setInteractive({ useHandCursor: true });
        circle.on("pointerover", () => {
          if (!this.locked && !this.ended && !this.walls.has(cellKey(cell)) && cellKey(cell) !== cellKey(this.catCell)) {
            circle.setFillStyle(COLORS.acid, .72);
          }
        });
        circle.on("pointerout", () => this.refreshCell(cell));
        circle.on("pointerup", () => this.placeWall(cell));
        this.circles[row][col] = circle;
      }
    }
  }

  private createInitialWalls() {
    const candidates: Cell[] = [];
    for (let row = 1; row < ROWS - 1; row += 1) {
      for (let col = 1; col < COLS - 1; col += 1) {
        const cell = { col, row };
        if (cellKey(cell) !== cellKey(this.catCell)) candidates.push(cell);
      }
    }

    let foundPlayableLayout = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      this.walls.clear();
      const shuffled = Phaser.Utils.Array.Shuffle([...candidates]);
      shuffled.slice(0, INITIAL_WALLS).forEach((cell) => this.walls.add(cellKey(cell)));
      const reachable = this.createDistanceMap().has(cellKey(this.catCell));
      const openNeighbors = this.getNeighbors(this.catCell).filter((cell) => !this.walls.has(cellKey(cell))).length;
      if (reachable && openNeighbors >= 3) {
        foundPlayableLayout = true;
        break;
      }
    }

    if (!foundPlayableLayout) {
      this.walls = new Set([
        "1:1", "7:1",
        "2:3", "6:3",
        "2:5", "6:5",
        "1:7", "7:7",
      ]);
    }

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) this.refreshCell({ col, row });
    }
  }

  private placeWall(cell: Cell) {
    const key = cellKey(cell);
    if (this.locked || this.ended || this.walls.has(key) || key === cellKey(this.catCell)) return;

    this.locked = true;
    this.walls.add(key);
    this.moves += 1;
    this.refreshCell(cell);
    this.tweens.add({
      targets: this.circles[cell.row][cell.col],
      scale: { from: .72, to: 1 },
      duration: 150,
      ease: "Back.easeOut",
    });
    this.refreshStats();
    this.hintText.setText("小猫正在找出口…").setColor("#5c7cff");
    this.bridge.score(this.moves * 10);
    if (!this.started) {
      this.started = true;
      this.bridge.started();
    }
    this.time.delayedCall(110, () => this.moveCat());
  }

  private moveCat() {
    const next = this.chooseCatStep();
    if (!next) {
      this.finish(true);
      return;
    }

    const position = this.getCellPosition(next);
    const movingLeft = position.x < this.cat.x;
    const mascot = this.cat.getByName("mascot") as Phaser.GameObjects.Image | null;
    mascot?.setFlipX(!movingLeft);
    this.tweens.add({
      targets: this.cat,
      x: position.x,
      y: position.y,
      duration: 220,
      ease: "Cubic.easeOut",
      onStart: () => this.cat.setScale(1.08, .9),
      onComplete: () => {
        this.cat.setScale(1);
        this.catCell = next;
        if (this.isEdge(next)) {
          this.finish(false);
        } else {
          this.locked = false;
          this.hintText.setText("继续封路，别留出口").setColor("#101114");
        }
      },
    });
  }

  private chooseCatStep(): Cell | null {
    const distanceMap = this.createDistanceMap();
    const openNeighbors = this.getNeighbors(this.catCell).filter((cell) => !this.walls.has(cellKey(cell)));
    const reachable = openNeighbors
      .map((cell) => ({ cell, distance: distanceMap.get(cellKey(cell)) }))
      .filter((choice): choice is { cell: Cell; distance: number } => choice.distance !== undefined);

    if (reachable.length === 0) return null;
    const shortest = Math.min(...reachable.map((choice) => choice.distance));
    const shortestChoices = reachable.filter((choice) => choice.distance === shortest);
    const routeScores = shortestChoices.map((choice) => ({
      ...choice,
      exits: this.getNeighbors(choice.cell).filter((neighbor) => {
        const neighborDistance = distanceMap.get(cellKey(neighbor));
        return !this.walls.has(cellKey(neighbor)) && neighborDistance !== undefined && neighborDistance < choice.distance;
      }).length,
    }));
    const mostExits = Math.max(...routeScores.map((choice) => choice.exits));
    const best = routeScores.filter((choice) => choice.exits === mostExits);
    return best[Phaser.Math.Between(0, best.length - 1)].cell;
  }

  private createDistanceMap() {
    const distances = new Map<string, number>();
    const queue: Cell[] = [];

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const cell = { col, row };
        const key = cellKey(cell);
        if (this.isEdge(cell) && !this.walls.has(key) && !distances.has(key)) {
          distances.set(key, 0);
          queue.push(cell);
        }
      }
    }

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      const nextDistance = (distances.get(cellKey(current)) ?? 0) + 1;
      for (const neighbor of this.getNeighbors(current)) {
        const key = cellKey(neighbor);
        if (this.walls.has(key) || distances.has(key)) continue;
        distances.set(key, nextDistance);
        queue.push(neighbor);
      }
    }
    return distances;
  }

  private getNeighbors({ col, row }: Cell): Cell[] {
    const evenRowOffsets = [[-1, 0], [-1, -1], [0, -1], [1, 0], [0, 1], [-1, 1]];
    const oddRowOffsets = [[-1, 0], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1]];
    const offsets = row % 2 === 0 ? evenRowOffsets : oddRowOffsets;
    return offsets
      .map(([colOffset, rowOffset]) => ({ col: col + colOffset, row: row + rowOffset }))
      .filter((cell) => cell.col >= 0 && cell.col < COLS && cell.row >= 0 && cell.row < ROWS);
  }

  private isEdge({ col, row }: Cell) {
    return col === 0 || col === COLS - 1 || row === 0 || row === ROWS - 1;
  }

  private getCellPosition({ col, row }: Cell) {
    return {
      x: BOARD_ORIGIN_X + col * CELL_GAP_X + (row % 2 === 1 ? CELL_GAP_X / 2 : 0),
      y: BOARD_ORIGIN_Y + row * CELL_GAP_Y,
    };
  }

  private refreshCell(cell: Cell) {
    const circle = this.circles[cell.row]?.[cell.col];
    if (!circle) return;
    if (this.walls.has(cellKey(cell))) {
      circle.setFillStyle(COLORS.ink, 1).setStrokeStyle(2, COLORS.ink, 1);
    } else {
      circle.setFillStyle(COLORS.open, 1).setStrokeStyle(1.5, COLORS.ink, .7);
    }
  }

  private refreshStats() {
    const saved = this.storage.load();
    this.moveText.setText(`步数  ${String(this.moves).padStart(2, "0")}`);
    this.bestText.setText(`最佳  ${saved.bestMoves > 0 ? String(saved.bestMoves).padStart(2, "0") : "--"}`);
  }

  private finish(won: boolean) {
    this.locked = true;
    this.ended = true;
    const score = won ? Math.max(200, 1200 - this.moves * 35) : this.moves * 10;
    const saved = this.storage.load();
    const bestMoves = won && (saved.bestMoves === 0 || this.moves < saved.bestMoves) ? this.moves : saved.bestMoves;
    this.storage.save({ bestMoves, wins: saved.wins + (won ? 1 : 0) });
    this.refreshStats();
    this.bridge.score(score);
    this.bridge.gameOver(score);

    if (won) {
      this.hintText.setText("围住了！").setColor("#101114");
      this.cameras.main.flash(180, 223, 255, 63, false);
      this.tweens.add({ targets: this.cat, angle: { from: -7, to: 7 }, yoyo: true, repeat: 3, duration: 80 });
    } else {
      this.hintText.setText("小猫逃掉了").setColor("#ff6a51");
      this.cameras.main.shake(180, .008);
    }
    this.showResult(won, score);
  }

  private showResult(won: boolean, score: number) {
    const panel = this.add.rectangle(0, 0, 304, 132, COLORS.open, .97).setStrokeStyle(2, COLORS.ink, 1);
    const title = this.add.text(0, -36, won ? "成功围住小猫" : "还是让它溜了", {
      fontFamily: "sans-serif",
      fontSize: "20px",
      fontStyle: "bold",
      color: won ? "#101114" : "#ff6a51",
    }).setOrigin(.5);
    const detail = this.add.text(0, -5, `${this.moves} 步  ·  ${score} 分`, {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#777872",
      letterSpacing: 1,
    }).setOrigin(.5);
    const replayButton = this.add.rectangle(0, 36, 142, 38, won ? COLORS.acid : COLORS.ink)
      .setStrokeStyle(1, COLORS.ink, 1)
      .setInteractive({ useHandCursor: true });
    const replayText = this.add.text(0, 36, "再玩一局  ↻", {
      fontFamily: "sans-serif",
      fontSize: "13px",
      fontStyle: "bold",
      color: won ? "#101114" : "#f3f0e8",
    }).setOrigin(.5);
    replayButton.on("pointerup", () => this.scene.restart());
    this.endLayer = this.add.container(WIDTH / 2, 686, [panel, title, detail, replayButton, replayText])
      .setDepth(20)
      .setAlpha(0)
      .setScale(.94);
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: this.endLayer, alpha: 1, scale: 1, duration: 180, ease: "Back.easeOut" });
  }

  private createCat() {
    const halo = this.add.circle(0, 2, 25, COLORS.acid, .72)
      .setStrokeStyle(1.5, COLORS.ink, .55);
    const mascot = this.add.image(0, -2, "cat-mascot")
      .setName("mascot")
      .setDisplaySize(54, 54);
    return this.add.container(0, 0, [halo, mascot]).setDepth(10);
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
  scene: CatchTheCatScene,
});
