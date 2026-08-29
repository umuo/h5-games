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
const INK_COLOR = "#101114";
const BOARD_TOP = 208;

function levelSize(level: number) {
  if (level === 1) return 3;
  if (level <= 3) return 4;
  return 5;
}

interface Tile {
  value: number;
  container: Phaser.GameObjects.Container;
}

class SlidePuzzleScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private movesText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private tiles: Tile[] = [];
  /** positions[valueIndex] = grid cell of the tile numbered valueIndex + 1. */
  private positions: Array<{ col: number; row: number }> = [];
  private blank = { col: 0, row: 0 };
  private size = 3;
  private cell = 100;
  private boardX = 0;
  private boardY = 0;
  private level = 1;
  private moves = 0;
  private started = false;
  private celebrating = false;
  private audio = createAudioKit({ masterGain: 0.42 });
  private bridge = createGameBridge({ gameId: "slide-puzzle", version: "1.0.0" });
  private storage = createGameStorage("slide-puzzle", { level: 1 });

  constructor() { super("slide-puzzle"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#f3f0e8");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 48, 48, 0xf3f0e8, 1, 0x101114, .04);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0x101114, .25);
    this.add.text(22, 43, "SLIDE / 026", {
      fontFamily: "monospace", fontSize: "11px", color: INK_COLOR, letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "数字华容道", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#74726c",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 70, "第 1 关 · 三阶", {
      fontFamily: "sans-serif", fontSize: "21px", color: INK_COLOR, fontStyle: "bold",
    });
    this.movesText = this.add.text(22, 104, "步数 0", {
      fontFamily: "monospace", fontSize: "11px", color: "#74726c", letterSpacing: 1,
    });
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 22, 104, `进度 第${saved.level}关`, {
      fontFamily: "monospace", fontSize: "10px", color: "#74726c", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.hintText = this.add.text(CENTER_X, 742, "点击空格旁的数字滑动它", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8a8881",
    }).setOrigin(.5);

    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.level = this.storage.load().level;
    this.loadLevel(this.level);
    this.bindInput();
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private loadLevel(level: number) {
    this.level = level;
    this.size = levelSize(level);
    this.tiles.forEach((tile) => tile.container.destroy());
    this.tiles = [];
    this.moves = 0;
    this.started = false;
    this.celebrating = false;

    const boardPixels = Math.min(WIDTH - 60, 470);
    this.cell = Math.floor(boardPixels / this.size);
    const boardPx = this.cell * this.size;
    this.boardX = CENTER_X - boardPx / 2;
    this.boardY = BOARD_TOP + (470 - boardPx) / 2;

    this.levelText.setText(`第 ${level} 关 · ${["三", "四", "五"][this.size - 3]}阶`);
    this.movesText.setText("步数 0");
    this.add.rectangle(
      this.boardX + boardPx / 2, this.boardY + boardPx / 2,
      boardPx + 10, boardPx + 10,
    ).setStrokeStyle(2.5, 0x101114, .8);

    const total = this.size * this.size;
    this.positions = [];
    for (let value = 1; value < total; value += 1) {
      const col = (value - 1) % this.size;
      const row = Math.floor((value - 1) / this.size);
      this.positions.push({ col, row });
      const hue = (value * 26) % 360;
      const color = Phaser.Display.Color.HSLToColor(hue / 360, .5, .72).color;
      const { x, y } = this.cellCenter(col, row);
      const container = this.add.container(x, y).setDepth(2);
      const rect = this.add.rectangle(0, 0, this.cell - 8, this.cell - 8, color)
        .setStrokeStyle(2, 0x101114, .55);
      const label = this.add.text(0, 0, String(value), {
        fontFamily: "monospace", fontSize: `${Math.floor(this.cell * .38)}px`,
        color: "#101114", fontStyle: "bold",
      }).setOrigin(.5);
      container.add([rect, label]);
      this.tiles.push({ value, container });
    }
    this.blank = { col: this.size - 1, row: this.size - 1 };
    this.scramble();
  }

  private cellCenter(col: number, row: number) {
    return {
      x: this.boardX + col * this.cell + this.cell / 2,
      y: this.boardY + row * this.cell + this.cell / 2,
    };
  }

  private tileAtPosition(col: number, row: number): Tile | null {
    const valueIndex = this.positions.findIndex((p) => p.col === col && p.row === row);
    return valueIndex >= 0 && valueIndex < this.tiles.length ? this.tiles[valueIndex] : null;
  }

  private scramble() {
    const directions = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    ];
    let lastDirection = { dx: 0, dy: 0 };
    const steps = this.size === 3 ? 70 : this.size === 4 ? 150 : 260;
    for (let step = 0; step < steps; step += 1) {
      const options = directions.filter(({ dx, dy }) => {
        const col = this.blank.col + dx;
        const row = this.blank.row + dy;
        return col >= 0 && col < this.size && row >= 0 && row < this.size;
      }).filter(({ dx, dy }) => !(dx === -lastDirection.dx && dy === -lastDirection.dy));
      const chosen = Phaser.Utils.Array.GetRandom(options);
      this.moveBlank(chosen.dx, chosen.dy, true);
      lastDirection = chosen;
    }
  }

  /** Move the blank by (dx, dy); the displaced tile slides into the blank cell. */
  private moveBlank(dx: number, dy: number, instant = false) {
    const fromCol = this.blank.col + dx;
    const fromRow = this.blank.row + dy;
    if (fromCol < 0 || fromCol >= this.size || fromRow < 0 || fromRow >= this.size) return false;
    const tile = this.tileAtPosition(fromCol, fromRow);
    if (!tile) return false;
    const valueIndex = this.tiles.indexOf(tile);

    this.positions[valueIndex] = { ...this.blank };
    this.blank = { col: fromCol, row: fromRow };

    const { x, y } = this.cellCenter(this.positions[valueIndex].col, this.positions[valueIndex].row);
    if (instant) {
      tile.container.setPosition(x, y);
    } else {
      this.tweens.add({ targets: tile.container, x, y, duration: 120, ease: "Cubic.easeOut" });
    }
    return true;
  }

  private isSolved() {
    return this.positions.every((position, index) => {
      const solvedCol = index % this.size;
      const solvedRow = Math.floor(index / this.size);
      return position.col === solvedCol && position.row === solvedRow;
    });
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.celebrating) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const col = Math.floor((position.x - this.boardX) / this.cell);
      const row = Math.floor((position.y - this.boardY) / this.cell);
      if (col < 0 || col >= this.size || row < 0 || row >= this.size) return;
      const dx = this.blank.col - col;
      const dy = this.blank.row - row;
      if (Math.abs(dx) + Math.abs(dy) !== 1) return;
      if (this.moveBlank(-dx, -dy)) {
        this.moves += 1;
        this.movesText.setText(`步数 ${this.moves}`);
        this.audio.tone({ freq: 320, duration: .04, type: "square", gain: .06 });
        if (this.isSolved()) this.completeLevel();
      }
    });
  }

  private completeLevel() {
    this.celebrating = true;
    this.storage.save({ level: this.level + 1 });
    this.bridge.score(this.level);
    this.audio.tone({ freq: 523, duration: .15, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 659, duration: .18, time: this.audio.now + .13, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .28, type: "triangle", gain: .22 });

    const boardPx = this.cell * this.size;
    const banner = this.add.text(CENTER_X, this.boardY + boardPx / 2, "复原！", {
      fontFamily: "sans-serif", fontSize: "44px", color: "#f3f0e8", fontStyle: "bold", letterSpacing: 8,
    }).setOrigin(.5).setDepth(20).setAlpha(0);
    const bannerBack = this.add.rectangle(CENTER_X, this.boardY + boardPx / 2, 240, 86, 0x101114, .85)
      .setDepth(19).setAlpha(0);
    this.tweens.add({ targets: [banner, bannerBack], alpha: 1, duration: 200 });
    for (let index = 0; index < 22; index += 1) {
      const speck = this.add.circle(
        CENTER_X + Phaser.Math.Between(-boardPx / 2, boardPx / 2),
        this.boardY + boardPx / 2,
        Phaser.Math.FloatBetween(2, 4),
        Phaser.Utils.Array.GetRandom([0xff5f6d, 0x54e0ff, 0x9fe08a, 0xffd44d]),
      );
      this.tweens.add({
        targets: speck,
        y: speck.y - Phaser.Math.Between(60, 180),
        x: speck.x + Phaser.Math.Between(-60, 60),
        alpha: 0,
        duration: Phaser.Math.FloatBetween(600, 1000),
        onComplete: () => speck.destroy(),
      });
    }
    this.time.delayedCall(1150, () => this.loadLevel(this.level + 1));
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
  scene: SlidePuzzleScene,
});
