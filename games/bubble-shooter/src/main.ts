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
const BUBBLE_RADIUS = 21;
const BUBBLE_DIAMETER = BUBBLE_RADIUS * 2;
const BOARD_X = CENTER_X - (COLS * BUBBLE_DIAMETER) / 2;
const BOARD_TOP = 130;
const DEATH_ROW = 11;
const TYPE_COUNT_START = 4;
const SHOOTER_Y = 742;

interface Bubble {
  type: number;
  sprite: Phaser.GameObjects.Image;
}

class BubbleShooterScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private grid: Array<Array<Bubble | null>> = [];
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private bubbleGraphics!: Phaser.GameObjects.Graphics;
  private aimGraphics!: Phaser.GameObjects.Graphics;
  private currentBubble!: Phaser.GameObjects.Image;
  private nextType = 0;
  private currentType = 0;
  private typeCount = TYPE_COUNT_START;
  private aimAngle = -Math.PI / 2;
  private shotsSinceRow = 0;
  private level = 1;
  private score = 0;
  private started = false;
  private ended = false;
  private flying?: { x: number; y: number; vx: number; vy: number; type: number };
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "bubble-shooter", version: "1.0.0" });
  private storage = createGameStorage("bubble-shooter", { highScore: 0 });

  constructor() { super("bubble-shooter"); }

  create() {
    this.grid = Array.from({ length: DEATH_ROW + 2 }, () => Array<Bubble | null>(COLS).fill(null));
    this.score = 0;
    this.shotsSinceRow = 0;
    this.started = false;
    this.ended = false;
    this.flying = undefined;
    this.typeCount = TYPE_COUNT_START;
    const saved = this.storage.load();
    this.level = Math.max(1, Math.floor(saved.highScore / 800) + 1);

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "BUBBLE / 042", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "泡泡龙", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(CENTER_X, 62, "0", {
      fontFamily: "monospace", fontSize: "32px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5, 0);
    this.bestText = this.add.text(CENTER_X, 104, `BEST ${saved.highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(.5, 0).setName("best-score");
    this.hintText = this.add.text(CENTER_X, 800, "拖动瞄准 · 松手发射 · 同色三连引爆", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    const frame = this.add.graphics();
    frame.lineStyle(2, 0x3a3d45, 1);
    frame.strokeRect(BOARD_X - 2, BOARD_TOP - 2, COLS * BUBBLE_DIAMETER + 4, 8);

    this.gridGraphics = this.add.graphics();
    this.bubbleGraphics = this.add.graphics();
    this.aimGraphics = this.add.graphics();
    this.buildTextures();
    this.currentBubble = this.add.image(CENTER_X, SHOOTER_Y, "bubble-0").setDepth(6);

    this.fillInitialRows();
    this.nextType = Phaser.Math.Between(0, this.typeCount - 1);
    this.loadNextBubble();
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.grid = Array.from({ length: DEATH_ROW + 2 }, () => Array<Bubble | null>(COLS).fill(null));
    this.score = 0;
    this.shotsSinceRow = 0;
    this.started = false;
    this.ended = false;
    this.flying = undefined;
  }

  private rowWidth(row: number) {
    return row % 2 === 0 ? COLS : COLS - 1;
  }

  private bubblePosition(col: number, row: number) {
    const offset = row % 2 === 0 ? 0 : BUBBLE_RADIUS;
    return {
      x: BOARD_X + BUBBLE_RADIUS + col * BUBBLE_DIAMETER + offset,
      y: BOARD_TOP + BUBBLE_RADIUS + row * Math.round(BUBBLE_RADIUS * 1.74),
    };
  }

  private fillInitialRows() {
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < this.rowWidth(row); col += 1) {
        this.placeBubble(col, row, Phaser.Math.Between(0, this.typeCount - 1));
      }
    }
    this.bubbleDirty = true;
  }

  private bubbleDirty = true;

  private buildTextures() {
    const colors = [0xff5f6d, 0x54e0ff, 0x9fe08a, 0xffd44d, 0x9b6bff, 0xffa63d];
    for (let type = 0; type < colors.length; type += 1) {
      const key = `bubble-${type}`;
      if (this.textures.exists(key)) continue;
      const g = this.add.graphics();
      g.fillStyle(colors[type], 1);
      g.fillCircle(21, 21, 19);
      g.fillStyle(0xffffff, .38);
      g.fillEllipse(15, 13, 13, 7);
      g.lineStyle(1.6, 0x101114, .45);
      g.strokeCircle(21, 21, 19);
      g.generateTexture(key, 42, 42);
      g.destroy();
    }
  }

  private placeBubble(col: number, row: number, type: number) {
    const sprite = this.add.image(0, 0, `bubble-${type}`).setDepth(3);
    const { x, y } = this.bubblePosition(col, row);
    sprite.setPosition(x, y);
    this.grid[row][col] = { type, sprite };
  }

  private neighbors(col: number, row: number): Array<{ col: number; row: number }> {
    const even = row % 2 === 0;
    const offsets = even
      ? [[-1, -1], [0, -1], [-1, 0], [1, 0], [-1, 1], [0, 1]]
      : [[0, -1], [1, -1], [-1, 0], [1, 0], [0, 1], [1, 1]];
    const result: Array<{ col: number; row: number }> = [];
    for (const [dc, dr] of offsets) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc >= 0 && nc < this.rowWidth(nr) && nr >= 0 && nr < this.grid.length) result.push({ col: nc, row: nr });
    }
    return result;
  }

  private loadNextBubble() {
    this.currentType = this.nextType;
    this.nextType = Phaser.Math.Between(0, this.typeCount - 1);
    this.currentBubble.setTexture(`bubble-${this.currentType}`);
    this.currentBubble.setPosition(CENTER_X, SHOOTER_Y);
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || this.flying) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      this.updateAim(pointer);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || this.flying || !pointer.isDown) return;
      this.updateAim(pointer);
    });
    this.input.on("pointerup", () => {
      if (this.ended || this.flying) return;
      this.aimGraphics.clear();
      this.fire();
    });
  }

  private updateAim(pointer: Phaser.Input.Pointer) {
    const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const dx = position.x - CENTER_X;
    const dy = position.y - SHOOTER_Y;
    if (dy > -14) return;
    this.aimAngle = Math.atan2(dy, dx);
    this.drawAimLine();
  }

  private drawAimLine() {
    this.aimGraphics.clear();
    let x = CENTER_X;
    let y = SHOOTER_Y;
    let vx = Math.cos(this.aimAngle) * 8;
    const vy = Math.sin(this.aimAngle) * 8;
    this.aimGraphics.fillStyle(0xdfff3f, .65);
    for (let step = 0; step < 90; step += 1) {
      x += vx;
      y += vy;
      if (x < BOARD_X + BUBBLE_RADIUS || x > BOARD_X + COLS * BUBBLE_DIAMETER - BUBBLE_RADIUS) {
        vx = -vx;
        x = Phaser.Math.Clamp(x, BOARD_X + BUBBLE_RADIUS, BOARD_X + COLS * BUBBLE_DIAMETER - BUBBLE_RADIUS);
      }
      if (this.hitGrid(x, y)) break;
      if (step % 2 === 0) this.aimGraphics.fillCircle(x, y, 2.6);
    }
  }

  private hitGrid(x: number, y: number) {
    const row = Math.round((y - BOARD_TOP - BUBBLE_RADIUS) / Math.round(BUBBLE_RADIUS * 1.74));
    if (row < 0 || row >= this.grid.length) return false;
    for (let r = Math.max(0, row - 1); r <= Math.min(this.grid.length - 1, row + 1); r += 1) {
      for (let c = 0; c < this.rowWidth(r); c += 1) {
        const bubble = this.grid[r][c];
        if (!bubble) continue;
        const position = this.bubblePosition(c, r);
        if (Phaser.Math.Distance.Between(x, y, position.x, position.y) <= BUBBLE_DIAMETER - 6) return true;
      }
    }
    return false;
  }

  private fire() {
    const flying = {
      x: CENTER_X,
      y: SHOOTER_Y,
      vx: Math.cos(this.aimAngle) * 900,
      vy: Math.sin(this.aimAngle) * 900,
      type: this.currentType,
    };
    this.flying = flying;
    this.loadNextBubble();
    this.audio.tone({ freq: 500, endFreq: 300, duration: .08, type: "square", gain: .1 });
  }

  private snapFlying(flying: NonNullable<BubbleShooterScene["flying"]>) {
    const row = Phaser.Math.Clamp(Math.round((flying.y - BOARD_TOP - BUBBLE_RADIUS) / Math.round(BUBBLE_RADIUS * 1.74)), 0, DEATH_ROW);
    let best: { col: number; row: number; distance: number } | null = null;
    for (const neighbor of this.emptyNeighborsOf(flying, row)) {
      const position = this.bubblePosition(neighbor.col, neighbor.row);
      const distance = Phaser.Math.Distance.Between(flying.x, flying.y, position.x, position.y);
      if (!best || distance < best.distance) best = { ...neighbor, distance };
    }
    if (!best) return;
    this.placeBubble(best.col, best.row, flying.type);
    this.flying = undefined;
    this.shotsSinceRow += 1;
    const { matched, floating } = this.resolveMatches(best.col, best.row);
    this.currentBubble.setPosition(CENTER_X, SHOOTER_Y);
    if (matched > 0) {
      const gained = matched * 20 + floating * 10 + (matched >= 5 ? 100 : 0);
      this.score += gained;
      this.scoreText.setText(String(this.score));
      this.bridge.score(this.score);
      const saved = this.storage.load();
      if (this.score > saved.highScore) {
        this.storage.save({ highScore: this.score });
        this.bestText.setText(`BEST ${this.score}`);
      }
      this.audio.tone({ freq: 420 + Math.min(matched, 8) * 55, duration: .14, type: "triangle", gain: .18 });
    } else {
      this.audio.tone({ freq: 260, duration: .06, type: "sine", gain: .09 });
    }
    if (this.shotsSinceRow >= 6) {
      this.shotsSinceRow = 0;
      this.addRow();
    }
    if (this.rowsReachDeath()) {
      this.endRun();
      return;
    }
    if (this.grid.flat().every((bubble) => !bubble)) {
      this.score += 500;
      this.scoreText.setText(String(this.score));
      this.refreshHigh();
      this.audio.tone({ freq: 660, duration: .2, type: "triangle", gain: .2 });
      this.audio.tone({ freq: 990, duration: .3, time: this.audio.now + .15, type: "triangle", gain: .2 });
    }
  }

  private refreshHigh() {
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
      this.bestText.setText(`BEST ${this.score}`);
    }
  }

  private emptyNeighborsOf(flying: { x: number; y: number }, hintRow: number) {
    const slots: Array<{ col: number; row: number }> = [];
    for (let row = Math.max(0, hintRow - 2); row <= Math.min(DEATH_ROW, hintRow + 2); row += 1) {
      for (let col = 0; col < this.rowWidth(row); col += 1) {
        if (this.grid[row][col]) continue;
        const position = this.bubblePosition(col, row);
        if (Phaser.Math.Distance.Between(flying.x, flying.y, position.x, position.y) <= BUBBLE_DIAMETER + 2) {
          slots.push({ col, row });
        }
      }
    }
    return slots;
  }

  private resolveMatches(col: number, row: number) {
    const bubble = this.grid[row][col];
    if (!bubble) return { matched: 0, floating: 0 };
    const cluster = new Set<string>();
    const stack = [{ col, row }];
    while (stack.length > 0) {
      const current = stack.pop() as { col: number; row: number };
      const cellKey = `${current.col},${current.row}`;
      if (cluster.has(cellKey)) continue;
      const candidate = this.grid[current.row]?.[current.col];
      if (!candidate || candidate.type !== bubble.type) continue;
      cluster.add(cellKey);
      for (const neighbor of this.neighbors(current.col, current.row)) stack.push(neighbor);
    }
    let floating = 0;
    if (cluster.size >= 3) {
      for (const cellKey of cluster) {
        const [c, r] = cellKey.split(",").map(Number);
        const removed = this.grid[r][c];
        if (removed) {
          removed.sprite.destroy();
          this.grid[r][c] = null;
        }
      }
      floating = this.dropFloating();
    }
    this.bubbleDirty = true;
    return { matched: cluster.size >= 3 ? cluster.size : 0, floating };
  }

  private dropFloating() {
    const connected = new Set<string>();
    const stack: Array<{ col: number; row: number }> = [];
    for (let col = 0; col < this.rowWidth(0); col += 1) {
      if (this.grid[0][col]) {
        connected.add(`0,${col}`);
        stack.push({ col, row: 0 });
      }
    }
    while (stack.length > 0) {
      const current = stack.pop() as { col: number; row: number };
      for (const neighbor of this.neighbors(current.col, current.row)) {
        const cellKey = `${neighbor.col},${neighbor.row}`;
        if (connected.has(cellKey)) continue;
        if (this.grid[neighbor.row]?.[neighbor.col]) {
          connected.add(cellKey);
          stack.push(neighbor);
        }
      }
    }
    let dropped = 0;
    for (let row = 0; row < this.grid.length; row += 1) {
      for (let col = 0; col < this.rowWidth(row); col += 1) {
        const bubble = this.grid[row][col];
        if (!bubble) continue;
        if (connected.has(`${col},${row}`)) continue;
        this.grid[row][col] = null;
        dropped += 1;
        this.tweens.add({
          targets: bubble.sprite,
          y: HEIGHT + 40,
          alpha: 0,
          duration: 420,
          ease: "Cubic.easeIn",
          onComplete: () => bubble.sprite.destroy(),
        });
      }
    }
    return dropped;
  }

  private addRow() {
    for (let row = this.grid.length - 1; row > 0; row -= 1) {
      this.grid[row] = this.grid[row - 1];
    }
    this.grid[0] = Array<Bubble | null>(COLS).fill(null);
    for (let row = 0; row < this.grid.length; row += 1) {
      for (let col = 0; col < this.rowWidth(row); col += 1) {
        const bubble = this.grid[row][col];
        if (!bubble) continue;
        const position = this.bubblePosition(col, row);
        bubble.sprite.setPosition(position.x, position.y);
      }
    }
    for (let col = 0; col < this.rowWidth(0); col += 1) {
      this.placeBubble(col, 0, Phaser.Math.Between(0, this.typeCount - 1));
    }
    this.bubbleDirty = true;
  }

  private rowsReachDeath() {
    for (let row = DEATH_ROW; row < this.grid.length; row += 1) {
      for (let col = 0; col < this.rowWidth(row); col += 1) {
        if (this.grid[row][col]) return true;
      }
    }
    return false;
  }

  update(_time: number, delta: number) {
    const seconds = Math.min(delta, 40) / 1000;
    const flying = this.flying;
    if (flying) {
      flying.x += flying.vx * seconds;
      flying.y += flying.vy * seconds;
      this.currentBubble.setPosition(flying.x, flying.y);
      if (flying.x < BOARD_X + BUBBLE_RADIUS) {
        flying.x = BOARD_X + BUBBLE_RADIUS;
        flying.vx = Math.abs(flying.vx);
      }
      if (flying.x > BOARD_X + COLS * BUBBLE_DIAMETER - BUBBLE_RADIUS) {
        flying.x = BOARD_X + COLS * BUBBLE_DIAMETER - BUBBLE_RADIUS;
        flying.vx = -Math.abs(flying.vx);
      }
      if (flying.y <= BOARD_TOP + BUBBLE_RADIUS || this.hitGrid(flying.x, flying.y)) {
        flying.y = Math.max(flying.y, BOARD_TOP + BUBBLE_RADIUS);
        this.snapFlying(flying);
      }
    }
    if (this.bubbleDirty) {
      this.bubbleDirty = false;
      this.gridGraphics.clear();
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    this.audio.tone({ freq: 300, endFreq: 80, duration: .6, type: "sawtooth", gain: .22 });
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    this.bestText.setText(`BEST ${highScore}`);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .62)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0x1b1d21)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(CENTER_X, 502, "泡泡压境", {
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
  scene: BubbleShooterScene,
});
