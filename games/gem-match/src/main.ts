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
const ROWS = 9;
const CELL = 42;
const BOARD_X = 27;
const BOARD_Y = 170;
const TYPE_COUNT = 6;
const RUN_TIME = 60000;
const SWAP_DURATION = 150;
const POP_DURATION = 190;
const FALL_DURATION = 200;
const DRAG_THRESHOLD = 12;

const GEM_COLORS = [0xff5f6d, 0x54e0ff, 0x9b6bff, 0x9fe08a, 0xffb84d, 0x5c7cff];

interface Gem {
  type: number;
  sprite: Phaser.GameObjects.Image;
}

function gemKey(type: number) {
  return `gem-${type}`;
}

class GemMatchScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private timeText!: Phaser.GameObjects.Text;
  private selectFrame!: Phaser.GameObjects.Rectangle;
  private grid: Array<Array<Gem | null>> = [];
  private selected?: { col: number; row: number };
  private busy = false;
  private started = false;
  private ended = false;
  private timeLeft = RUN_TIME;
  private score = 0;
  private dragSource?: { col: number; row: number; x: number; y: number };
  private audio = createAudioKit({ masterGain: 0.42 });
  private bridge = createGameBridge({ gameId: "gem-match", version: "1.0.0" });
  private storage = createGameStorage("gem-match", { highScore: 0 });

  constructor() { super("gem-match"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 40, 40, 0x101114, 1, 0x2b2d32, .35);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "GEMS / 023", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "宝石消消", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);

    this.add.rectangle(CENTER_X, 70, WIDTH - 54, 10, 0x1b1d21).setStrokeStyle(1, 0x3a3d45);
    this.timerBar = this.add.rectangle(27, 70, WIDTH - 54, 10, 0x9fe08a).setOrigin(0, .5);
    this.timeText = this.add.text(CENTER_X, 92, "60.0s", {
      fontFamily: "monospace", fontSize: "11px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5, 0);
    this.scoreText = this.add.text(22, 104, "0", {
      fontFamily: "monospace", fontSize: "34px", color: "#f3f0e8", fontStyle: "bold",
    });
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 22, 112, `BEST ${saved.highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.comboText = this.add.text(CENTER_X, 574, "", {
      fontFamily: "monospace", fontSize: "17px", color: "#dfff3f", fontStyle: "bold", letterSpacing: 2,
    }).setOrigin(.5).setAlpha(0);
    this.hintText = this.add.text(CENTER_X, 762, "点两颗相邻宝石交换 · 或直接滑动", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    this.selectFrame = this.add.rectangle(0, 0, CELL + 6, CELL + 6)
      .setStrokeStyle(2.5, 0xffffff, .9).setVisible(false).setDepth(3);

    this.buildTextures();
    this.fillBoard();
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.grid = Array.from({ length: ROWS }, () => Array<Gem | null>(COLS).fill(null));
    this.selected = undefined;
    this.busy = false;
    this.started = false;
    this.ended = false;
    this.timeLeft = RUN_TIME;
    this.score = 0;
    this.dragSource = undefined;
  }

  private buildTextures() {
    for (let type = 0; type < TYPE_COUNT; type += 1) {
      const key = gemKey(type);
      if (this.textures.exists(key)) continue;
      const color = GEM_COLORS[type];
      const g = this.add.graphics();
      const c = 22;
      const polygon = (sides: number, radius: number, offset = -Math.PI / 2) => {
        g.beginPath();
        for (let index = 0; index <= sides; index += 1) {
          const angle = offset + (index / sides) * Math.PI * 2;
          const px = c + Math.cos(angle) * radius;
          const py = c + Math.sin(angle) * radius;
          if (index === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
      };
      g.fillStyle(color, 1);
      if (type === 0) g.fillCircle(c, c, 17);
      else if (type === 1) polygon(4, 19);
      else if (type === 2) polygon(6, 18);
      else if (type === 3) g.fillRoundedRect(c - 15, c - 15, 30, 30, 7);
      else if (type === 4) polygon(3, 20);
      else polygon(4, 19, Math.PI / 4);
      g.fillPath();
      g.lineStyle(2, 0x101114, .5);
      if (type === 0) g.strokeCircle(c, c, 17);
      else {
        g.strokePath();
      }
      g.fillStyle(0xffffff, .38);
      g.fillEllipse(c - 5, c - 6, 11, 6);
      g.generateTexture(key, 44, 44);
      g.destroy();
    }
  }

  private fillBoard() {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        let type = Phaser.Math.Between(0, TYPE_COUNT - 1);
        let guard = 0;
        while (guard < 20 && this.createsRunWhenPlaced(col, row, type)) {
          type = Phaser.Math.Between(0, TYPE_COUNT - 1);
          guard += 1;
        }
        this.placeGem(col, row, type);
      }
    }
    if (!this.findPossibleMove()) this.shuffleBoard(true);
  }

  private createsRunWhenPlaced(col: number, row: number, type: number) {
    const match = (c: number, r: number) => {
      const gem = this.grid[r]?.[c];
      return gem && gem.type === type;
    };
    if (match(col - 1, row) && match(col - 2, row)) return true;
    if (match(col, row - 1) && match(col, row - 2)) return true;
    return false;
  }

  private placeGem(col: number, row: number, type: number) {
    const sprite = this.add.image(
      BOARD_X + col * CELL + CELL / 2,
      BOARD_Y + row * CELL + CELL / 2,
      gemKey(type),
    ).setDepth(2);
    const gem: Gem = { type, sprite };
    this.grid[row][col] = gem;
    return gem;
  }

  private gemAt(col: number, row: number): Gem | null {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return this.grid[row][col];
  }

  private findRuns(): Array<Array<{ col: number; row: number }>> {
    const runs: Array<Array<{ col: number; row: number }>> = [];
    const scan = (getCell: (index: number) => Gem | null, toPoint: (index: number) => { col: number; row: number }, length: number) => {
      let index = 0;
      while (index < length) {
        const gem = getCell(index);
        if (!gem) {
          index += 1;
          continue;
        }
        let runEnd = index + 1;
        while (runEnd < length) {
          const nextGem = getCell(runEnd);
          if (nextGem && nextGem.type === gem.type) runEnd += 1;
          else break;
        }
        if (runEnd - index >= 3) {
          const run: Array<{ col: number; row: number }> = [];
          for (let step = index; step < runEnd; step += 1) run.push(toPoint(step));
          runs.push(run);
        }
        index = runEnd;
      }
    };
    for (let row = 0; row < ROWS; row += 1) {
      scan((col) => this.gemAt(col, row), (col) => ({ col, row }), COLS);
    }
    for (let col = 0; col < COLS; col += 1) {
      scan((row) => this.gemAt(col, row), (index) => ({ col, row: index }), ROWS);
    }
    return runs;
  }

  private findPossibleMove() {
    const hasRunAt = (col: number, row: number) => this.findRuns().some((run) => run.some((cell) => cell.col === col && cell.row === row));
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          const a = this.gemAt(col, row);
          const b = this.gemAt(col + dx, row + dy);
          if (!a || !b || a.type === b.type) continue;
          this.grid[row][col] = b;
          this.grid[row + dy][col + dx] = a;
          const matched = hasRunAt(col, row) || hasRunAt(col + dx, row + dy);
          this.grid[row][col] = a;
          this.grid[row + dy][col + dx] = b;
          if (matched) return true;
        }
      }
    }
    return false;
  }

  private shuffleBoard(silent = false) {
    const cells: Gem[] = [];
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const gem = this.grid[row][col];
        if (gem) cells.push(gem);
      }
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      Phaser.Utils.Array.Shuffle(cells);
      let cursor = 0;
      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          if (this.grid[row][col]) this.grid[row][col] = cells[cursor++];
        }
      }
      const hasMatch = this.findRuns().length > 0;
      if (!hasMatch && this.findPossibleMove()) break;
    }
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const gem = this.grid[row][col];
        if (!gem) continue;
        gem.sprite.setPosition(BOARD_X + col * CELL + CELL / 2, BOARD_Y + row * CELL + CELL / 2);
      }
    }
    if (!silent) {
      this.hintText.setText("无可消除 · 重新洗牌").setColor("#dfff3f");
      this.time.delayedCall(1400, () => {
        this.hintText.setText("点两颗相邻宝石交换 · 或直接滑动").setColor("#8f918a");
      });
      this.audio.noise({ freq: 900, duration: .25, gain: .14 });
    }
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.busy || this.ended) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const col = Math.floor((position.x - BOARD_X) / CELL);
      const row = Math.floor((position.y - BOARD_Y) / CELL);
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
      this.dragSource = { col, row, x: position.x, y: position.y };
      this.selected = { col, row };
      this.selectFrame.setPosition(BOARD_X + col * CELL + CELL / 2, BOARD_Y + row * CELL + CELL / 2).setVisible(true);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const source = this.dragSource;
      if (!source || this.busy || this.ended || !pointer.isDown) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const deltaX = position.x - source.x;
      const deltaY = position.y - source.y;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < DRAG_THRESHOLD) return;
      const direction = Math.abs(deltaX) > Math.abs(deltaY)
        ? { col: Math.sign(deltaX), row: 0 }
        : { col: 0, row: Math.sign(deltaY) };
      const target = { col: source.col + direction.col, row: source.row + direction.row };
      this.dragSource = undefined;
      this.clearSelection();
      this.trySwap({ col: source.col, row: source.row }, target);
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      const source = this.dragSource;
      if (!source) return;
      this.dragSource = undefined;
      if (this.busy || this.ended) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const col = Math.floor((position.x - BOARD_X) / CELL);
      const row = Math.floor((position.y - BOARD_Y) / CELL);
      if (this.selected && col === this.selected.col && row === this.selected.row) return;
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) {
        this.clearSelection();
        return;
      }
      if (this.selected && Math.abs(this.selected.col - col) + Math.abs(this.selected.row - row) === 1) {
        const from = { ...this.selected };
        this.clearSelection();
        this.trySwap(from, { col, row });
      } else {
        this.selected = { col, row };
        this.selectFrame.setPosition(BOARD_X + col * CELL + CELL / 2, BOARD_Y + row * CELL + CELL / 2).setVisible(true);
      }
    });
    this.input.on("pointerupoutside", () => { this.dragSource = undefined; });
  }

  private clearSelection() {
    this.selected = undefined;
    this.selectFrame.setVisible(false);
  }

  private trySwap(from: { col: number; row: number }, to: { col: number; row: number }) {
    const a = this.gemAt(from.col, from.row);
    const b = this.gemAt(to.col, to.row);
    if (!a || !b) return;
    this.busy = true;
    this.grid[from.row][from.col] = b;
    this.grid[to.row][to.col] = a;
    this.tweens.add({
      targets: a.sprite,
      x: BOARD_X + to.col * CELL + CELL / 2,
      y: BOARD_Y + to.row * CELL + CELL / 2,
      duration: SWAP_DURATION,
      ease: "Cubic.easeOut",
    });
    this.tweens.add({
      targets: b.sprite,
      x: BOARD_X + from.col * CELL + CELL / 2,
      y: BOARD_Y + from.row * CELL + CELL / 2,
      duration: SWAP_DURATION,
      ease: "Cubic.easeOut",
      onComplete: () => {
        if (this.findRuns().length > 0) {
          this.cascade = 0;
          this.resolveWave();
          return;
        }
        this.grid[from.row][from.col] = a;
        this.grid[to.row][to.col] = b;
        this.tweens.add({
          targets: a.sprite,
          x: BOARD_X + from.col * CELL + CELL / 2,
          y: BOARD_Y + from.row * CELL + CELL / 2,
          duration: SWAP_DURATION,
        });
        this.tweens.add({
          targets: b.sprite,
          x: BOARD_X + to.col * CELL + CELL / 2,
          y: BOARD_Y + to.row * CELL + CELL / 2,
          duration: SWAP_DURATION,
          onComplete: () => {
            this.audio.tone({ freq: 180, duration: .1, type: "sawtooth", gain: .08 });
            this.busy = false;
          },
        });
      },
    });
  }
  private cascade = 0;

  private resolveWave() {
    const runs = this.findRuns();
    if (runs.length === 0) {
      this.afterCascadeSettle();
      return;
    }
    this.cascade += 1;
    const toRemove = new Map<string, { col: number; row: number }>();
    let longest = 3;
    const centroid = { x: CENTER_X, y: BOARD_Y + (ROWS * CELL) / 2 };
    let centroidCount = 0;
    for (const run of runs) {
      longest = Math.max(longest, run.length);
      for (const cell of run) {
        toRemove.set(`${cell.col},${cell.row}`, cell);
        const gem = this.gemAt(cell.col, cell.row);
        if (gem) {
          centroid.x += gem.sprite.x;
          centroid.y += gem.sprite.y;
          centroidCount += 1;
        }
      }
    }
    if (centroidCount > 0) {
      centroid.x /= centroidCount;
      centroid.y /= centroidCount;
    }
    const gained = toRemove.size * 30 * this.cascade + (longest > 3 ? (longest - 3) * 60 : 0);
    this.score += gained;
    this.refreshScore();
    if (this.cascade >= 2) {
      this.comboText.setText(`连锁 ×${this.cascade}`);
      this.comboText.setAlpha(1).setScale(1.2);
      this.tweens.killTweensOf(this.comboText);
      this.tweens.add({ targets: this.comboText, scale: 1, duration: 140 });
      this.tweens.add({ targets: this.comboText, alpha: 0, delay: 600, duration: 240 });
    }
    const label = this.add.text(centroid.x, centroid.y, `+${gained}`, {
      fontFamily: "monospace", fontSize: "15px", color: "#dfff3f", fontStyle: "bold",
    }).setOrigin(.5).setDepth(6);
    this.tweens.add({ targets: label, y: centroid.y - 34, alpha: 0, duration: 640, onComplete: () => label.destroy() });

    const pitch = 380 + this.cascade * 90;
    this.audio.tone({ freq: pitch, duration: .12, type: "triangle", gain: .16 });
    this.audio.noise({ freq: 1800, duration: .1, gain: .1 });

    for (const cell of toRemove.values()) {
      const gem = this.gemAt(cell.row, cell.col);
      if (!gem) continue;
      this.grid[cell.row][cell.col] = null;
      this.tweens.add({
        targets: gem.sprite,
        scale: 0,
        angle: 90,
        duration: POP_DURATION,
        ease: "Cubic.easeIn",
        onComplete: () => gem.sprite.destroy(),
      });
      for (let index = 0; index < 4; index += 1) {
        const speck = this.add.circle(gem.sprite.x, gem.sprite.y, Phaser.Math.FloatBetween(1.5, 3), GEM_COLORS[gem.type]);
        this.tweens.add({
          targets: speck,
          x: gem.sprite.x + Phaser.Math.FloatBetween(-40, 40),
          y: gem.sprite.y + Phaser.Math.FloatBetween(-30, 50),
          alpha: 0,
          duration: 360,
          onComplete: () => speck.destroy(),
        });
      }
    }
    this.clearSelection();
    this.time.delayedCall(POP_DURATION + 30, () => this.dropColumns());
  }

  private dropColumns() {
    let dropped = false;
    for (let col = 0; col < COLS; col += 1) {
      let writeRow = ROWS - 1;
      for (let row = ROWS - 1; row >= 0; row -= 1) {
        const gem = this.grid[row][col];
        if (gem) {
          if (writeRow !== row) {
            this.grid[writeRow][col] = gem;
            this.grid[row][col] = null;
            dropped = true;
          }
          const targetY = BOARD_Y + writeRow * CELL + CELL / 2;
          if (gem.sprite.y !== targetY) {
            this.tweens.add({
              targets: gem.sprite,
              y: targetY,
              duration: FALL_DURATION,
              ease: "Cubic.easeIn",
            });
          }
          writeRow -= 1;
        }
      }
      let spawnAbove = 1;
      for (let row = writeRow; row >= 0; row -= 1) {
        const type = Phaser.Math.Between(0, TYPE_COUNT - 1);
        const gem = this.placeGem(col, row, type);
        gem.sprite.y = BOARD_Y - spawnAbove * CELL + CELL / 2;
        this.tweens.add({
          targets: gem.sprite,
          y: BOARD_Y + row * CELL + CELL / 2,
          duration: FALL_DURATION + spawnAbove * 30,
          ease: "Cubic.easeIn",
        });
        spawnAbove += 1;
        dropped = true;
      }
    }
    this.time.delayedCall(dropped ? FALL_DURATION + 160 : 30, () => {
      if (this.findRuns().length > 0) {
        this.resolveWave();
      } else {
        this.afterCascadeSettle();
      }
    });
  }

  private afterCascadeSettle() {
    this.cascade = 0;
    if (!this.findPossibleMove()) {
      this.shuffleBoard();
      if (!this.findPossibleMove()) this.shuffleBoard();
    }
    this.busy = false;
  }

  private refreshScore() {
    this.scoreText.setText(String(this.score));
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
      this.bestText.setText(`BEST ${this.score}`);
    }
  }

  update(_time: number, delta: number) {
    if (this.ended || !this.started) return;
    this.timeLeft -= delta;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.endRun();
    }
    const ratio = this.timeLeft / RUN_TIME;
    this.timerBar.width = (WIDTH - 54) * ratio;
    this.timerBar.fillColor = ratio > .5 ? 0x9fe08a : ratio > .25 ? 0xffd44d : 0xff6a51;
    this.timeText.setText(`${(this.timeLeft / 1000).toFixed(1)}s`);
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    this.busy = true;
    this.clearSelection();
    this.audio.tone({ freq: 392, duration: .25, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 311, duration: .3, time: this.audio.now + .2, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 262, duration: .45, time: this.audio.now + .42, type: "triangle", gain: .2 });
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .6)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 186, 0x1b1d21)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(CENTER_X, 502, "时间到", {
      fontFamily: "sans-serif", fontSize: "25px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `${this.score} 分  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "12px", color: "#8f918a", letterSpacing: 1,
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
  scene: GemMatchScene,
});
