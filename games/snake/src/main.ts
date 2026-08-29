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
const CELL = 24;
const COLS = 15;
const ROWS = 24;
const GRID_WIDTH = COLS * CELL;
const GRID_HEIGHT = ROWS * CELL;
const GRID_X = CENTER_X - GRID_WIDTH / 2;
const GRID_Y = 172;
const SWIPE_MIN = 24;
const INK = "#f3f0e8";

type Direction = "up" | "down" | "left" | "right";

const DIRECTION_DELTAS: Record<Direction, { col: number; row: number }> = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};

const OPPOSITES: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

class SnakeScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private snakeGraphics!: Phaser.GameObjects.Graphics;
  private food!: Phaser.GameObjects.Arc;
  private body: Array<{ col: number; row: number }> = [];
  private direction: Direction = "up";
  private pendingDirections: Direction[] = [];
  private foodCell = { col: 0, row: 0 };
  private stepMs = 170;
  private moveTimer?: Phaser.Time.TimerEvent;
  private score = 0;
  private started = false;
  private ended = false;
  private swipeStart?: Phaser.Math.Vector2;
  private bridge = createGameBridge({ gameId: "snake", version: "1.0.0" });
  private storage = createGameStorage("snake", { highScore: 0 });

  constructor() { super("snake"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 40, 40, 0x101114, 1, 0x2b2d32, .35);
    this.add.rectangle(WIDTH / 2, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "SNAKE / 013", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "贪吃蛇", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);

    this.scoreText = this.add.text(22, 76, "0000", {
      fontFamily: "monospace", fontSize: "42px", color: INK, fontStyle: "bold",
    });
    const saved = this.storage.load();
    this.add.text(WIDTH - 22, 87, `BEST  ${String(saved.highScore).padStart(4, "0")}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");

    this.add.rectangle(CENTER_X, GRID_Y + GRID_HEIGHT / 2, GRID_WIDTH + 10, GRID_HEIGHT + 10)
      .setStrokeStyle(2, 0xdfff3f, .55);
    this.snakeGraphics = this.add.graphics();

    this.hintText = this.add.text(CENTER_X, 778, "滑动屏幕控制方向 · 吃光点变长", {
      fontFamily: "sans-serif", fontSize: "15px", color: INK, fontStyle: "bold",
    }).setOrigin(.5);
    this.add.text(CENTER_X, 804, "撞墙或咬到自己就结束了", {
      fontFamily: "sans-serif", fontSize: "11px", color: "#8f918a",
    }).setOrigin(.5);

    this.food = this.add.circle(0, 0, 8, 0xff6a51).setStrokeStyle(2, 0x101114, .6);
    this.tweens.add({
      targets: this.food,
      scale: { from: .82, to: 1.12 },
      duration: 460,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => { this.pendingDirections = []; this.swipeStart = undefined; } });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.moveTimer?.destroy();
      this.swipeStart = undefined;
    });

    this.placeFood();
    this.renderSnake();
    this.moveTimer = this.time.addEvent({ delay: this.stepMs, loop: true, callback: () => this.step() });
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    const startCol = Math.floor(COLS / 2);
    const startRow = Math.floor(ROWS * .7);
    this.body = [
      { col: startCol, row: startRow },
      { col: startCol, row: startRow + 1 },
      { col: startCol, row: startRow + 2 },
    ];
    this.direction = "up";
    this.pendingDirections = [];
    this.stepMs = 170;
    this.score = 0;
    this.started = false;
    this.ended = false;
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
      if (!start || this.ended) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const deltaX = position.x - start.x;
      const deltaY = position.y - start.y;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_MIN) return;
      const direction: Direction = Math.abs(deltaX) > Math.abs(deltaY)
        ? (deltaX > 0 ? "right" : "left")
        : (deltaY > 0 ? "down" : "up");
      this.enqueueDirection(direction);
    });
  }

  private enqueueDirection(direction: Direction) {
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.hintText.setText("冲！别咬到自己").setColor("#dfff3f");
    }
    const last = this.pendingDirections[this.pendingDirections.length - 1] ?? this.direction;
    if (direction === last || direction === OPPOSITES[last]) return;
    if (this.pendingDirections.length >= 2) return;
    this.pendingDirections.push(direction);
  }

  private step() {
    if (!this.started || this.ended) return;
    const next = this.pendingDirections.shift();
    if (next && next !== OPPOSITES[this.direction]) this.direction = next;
    const delta = DIRECTION_DELTAS[this.direction];
    const head = this.body[0];
    const target = { col: head.col + delta.col, row: head.row + delta.row };
    if (target.col < 0 || target.col >= COLS || target.row < 0 || target.row >= ROWS) {
      this.die();
      return;
    }
    const eating = target.col === this.foodCell.col && target.row === this.foodCell.row;
    const ignoreTail = eating ? 0 : 1;
    for (let index = 0; index < this.body.length - ignoreTail; index += 1) {
      if (this.body[index].col === target.col && this.body[index].row === target.row) {
        this.die();
        return;
      }
    }
    this.body.unshift(target);
    if (eating) {
      this.score += 10;
      this.scoreText.setText(String(this.score).padStart(4, "0"));
      this.bridge.score(this.score);
      this.speedUp();
      this.placeFood();
      this.cameras.main.flash(60, 223, 255, 63, false);
    } else {
      this.body.pop();
    }
    this.renderSnake();
  }

  private speedUp() {
    const next = Math.max(92, 170 - Math.floor(this.score / 60) * 9);
    if (next === this.stepMs) return;
    this.stepMs = next;
    this.moveTimer?.destroy();
    this.moveTimer = this.time.addEvent({ delay: this.stepMs, loop: true, callback: () => this.step() });
  }

  private placeFood() {
    const occupied = new Set(this.body.map((cell) => `${cell.col},${cell.row}`));
    const empty: Array<{ col: number; row: number }> = [];
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        if (!occupied.has(`${col},${row}`)) empty.push({ col, row });
      }
    }
    if (empty.length === 0) {
      this.win();
      return;
    }
    this.foodCell = Phaser.Utils.Array.GetRandom(empty);
    this.food.setPosition(
      GRID_X + this.foodCell.col * CELL + CELL / 2,
      GRID_Y + this.foodCell.row * CELL + CELL / 2,
    );
  }

  private cellRect(col: number, row: number) {
    return {
      x: GRID_X + col * CELL + 3,
      y: GRID_Y + row * CELL + 3,
      width: CELL - 6,
      height: CELL - 6,
    };
  }

  private renderSnake() {
    this.snakeGraphics.clear();
    for (let index = this.body.length - 1; index >= 1; index -= 1) {
      const segment = this.body[index];
      const rect = this.cellRect(segment.col, segment.row);
      const fade = Math.max(.32, 1 - index * .045);
      this.snakeGraphics.fillStyle(0xf3f0e8, fade);
      this.snakeGraphics.fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 5);
    }
    const head = this.body[0];
    const headRect = this.cellRect(head.col, head.row);
    this.snakeGraphics.fillStyle(0xdfff3f, 1);
    this.snakeGraphics.fillRoundedRect(headRect.x - 1, headRect.y - 1, headRect.width + 2, headRect.height + 2, 6);
    this.snakeGraphics.lineStyle(1, 0x101114, .55);
    this.snakeGraphics.strokeRoundedRect(headRect.x - 1, headRect.y - 1, headRect.width + 2, headRect.height + 2, 6);
  }

  private saveBest() {
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    const bestText = this.children.getByName("best-score") as Phaser.GameObjects.Text | null;
    bestText?.setText(`BEST  ${String(highScore).padStart(4, "0")}`);
    return highScore;
  }

  private die() {
    this.ended = true;
    this.moveTimer?.destroy();
    this.cameras.main.shake(220, .012);
    this.cameras.main.flash(140, 255, 106, 81, false);
    const highScore = this.saveBest();
    this.bridge.gameOver(this.score);
    this.showResult("撞到了", highScore);
  }

  private win() {
    this.ended = true;
    this.moveTimer?.destroy();
    const highScore = this.saveBest();
    this.bridge.gameOver(this.score);
    this.showResult("铺满全场，太强了", highScore);
  }

  private showResult(title: string, highScore: number) {
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .55)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(WIDTH / 2, 560, 308, 178, 0x1b1d21)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(WIDTH / 2, 528, title, {
      fontFamily: "sans-serif", fontSize: "24px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(WIDTH / 2, 568, `长度 ${this.body.length}  ·  ${this.score} 分  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(WIDTH / 2, 610, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(WIDTH / 2, 610, "再来一条  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#101114", fontStyle: "bold",
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
  backgroundColor: "#101114",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: SnakeScene,
});
