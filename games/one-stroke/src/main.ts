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
const INK = 0x2b2724;
const PAPER = "#f7f3ea";
const SEAL_RED = 0xc23b2e;
const BOARD_TOP = 176;
const BOARD_BOTTOM = 706;
const BOARD_MARGIN_X = 30;

interface Point {
  x: number;
  y: number;
}

interface LevelSpec {
  cols: number;
  rows: number;
  holes: number;
}

function levelSpec(level: number): LevelSpec {
  const size = level <= 2 ? 4 : level <= 5 ? 5 : 6;
  const holes = level <= 2 ? 0 : Math.min(3, Math.floor(level / 2) - 1);
  return { cols: size, rows: size, holes };
}

function key(point: Point) {
  return `${point.x},${point.y}`;
}

/** Randomized Warnsdorff walk: covers every open cell or gives up quickly. */
function generatePath(spec: LevelSpec, blocked: Set<string>): Point[] | null {
  const open: Point[] = [];
  for (let y = 0; y < spec.rows; y += 1) {
    for (let x = 0; x < spec.cols; x += 1) {
      if (!blocked.has(key({ x, y }))) open.push({ x, y });
    }
  }
  const total = open.length;
  const neighbors = (point: Point) => [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 },
  ].filter((n) => n.x >= 0 && n.x < spec.cols && n.y >= 0 && n.y < spec.rows && !blocked.has(key(n)));

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const start = open[Phaser.Math.Between(0, open.length - 1)];
    const visited = new Set<string>([key(start)]);
    const path: Point[] = [{ ...start }];
    let failed = false;
    while (path.length < total) {
      const head = path[path.length - 1];
      const candidates = neighbors(head).filter((n) => !visited.has(key(n)));
      if (candidates.length === 0) {
        failed = true;
        break;
      }
      candidates.sort((a, b) => {
        const degreeA = neighbors(a).filter((n) => !visited.has(key(n))).length;
        const degreeB = neighbors(b).filter((n) => !visited.has(key(n))).length;
        if (degreeA !== degreeB) return degreeA - degreeB;
        return Math.random() - .5;
      });
      const chosen = candidates[0];
      visited.add(key(chosen));
      path.push({ ...chosen });
    }
    if (!failed) return path;
  }
  return null;
}

function generateLevel(level: number): { spec: LevelSpec; blocked: Set<string>; path: Point[] } {
  const spec = levelSpec(level);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const holes = attempt < 16 ? spec.holes : 0;
    const blocked = new Set<string>();
    for (let index = 0; index < holes; index += 1) {
      const hole = { x: Phaser.Math.Between(0, spec.cols - 1), y: Phaser.Math.Between(0, spec.rows - 1) };
      if (!(hole.x === 0 && hole.y === 0)) blocked.add(key(hole));
    }
    const path = generatePath(spec, blocked);
    if (path) return { spec, blocked, path };
  }
  const spec0 = { cols: spec.cols, rows: spec.rows, holes: 0 };
  const path: Point[] = [];
  for (let row = 0; row < spec0.rows; row += 1) {
    for (let col = 0; col < spec0.cols; col += 1) {
      path.push({ x: row % 2 === 0 ? col : spec0.cols - 1 - col, y: row });
    }
  }
  return { spec: spec0, blocked: new Set(), path };
}

class OneStrokeScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private progressText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private boardGraphics!: Phaser.GameObjects.Graphics;
  private pathGraphics!: Phaser.GameObjects.Graphics;
  private headDot!: Phaser.GameObjects.Arc;
  private boardX = 0;
  private boardY = 0;
  private cell = 60;
  private spec: LevelSpec = { cols: 4, rows: 4, holes: 0 };
  private blocked = new Set<string>();
  private solution: Point[] = [];
  private visited: Point[] = [];
  private total = 0;
  private level = 1;
  private started = false;
  private tracing = false;
  private celebrating = false;
  private audio = createAudioKit({ masterGain: 0.42 });
  private bridge = createGameBridge({ gameId: "one-stroke", version: "1.0.0" });
  private storage = createGameStorage("one-stroke", { level: 1 });

  constructor() { super("one-stroke"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor(PAPER);
    this.add.rectangle(WIDTH / 2, 31, WIDTH - 36, 1, 0x2b2724, .3);
    this.add.text(22, 43, "STROKE / 019", {
      fontFamily: "monospace", fontSize: "11px", color: "#2b2724", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "一笔画", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#8d8674",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 72, "第 1 关", {
      fontFamily: "sans-serif", fontSize: "22px", color: "#2b2724", fontStyle: "bold",
    });
    this.progressText = this.add.text(WIDTH - 22, 78, "1 / 16", {
      fontFamily: "monospace", fontSize: "13px", color: "#8d8674", letterSpacing: 1,
    }).setOrigin(1, 0);

    this.boardGraphics = this.add.graphics();
    this.pathGraphics = this.add.graphics();
    this.headDot = this.add.circle(0, 0, 9, SEAL_RED).setDepth(3);
    this.hintText = this.add.text(CENTER_X, 726, "从红点起笔 · 拖过每一格 · 不能重复", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8d8674",
    }).setOrigin(.5);
    this.buildButtons();
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.level = this.storage.load().level;
    this.loadLevel(this.level);
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.visited = [];
    this.tracing = false;
    this.celebrating = false;
  }

  private loadLevel(level: number) {
    this.resetRun();
    this.level = level;
    const generated = generateLevel(level);
    this.spec = generated.spec;
    this.blocked = generated.blocked;
    this.solution = generated.path;
    this.total = this.solution.length;
    const width = WIDTH - BOARD_MARGIN_X * 2;
    this.cell = Math.min(width / this.spec.cols, (BOARD_BOTTOM - BOARD_TOP) / this.spec.rows);
    this.boardX = CENTER_X - (this.cell * this.spec.cols) / 2;
    this.boardY = BOARD_TOP + ((BOARD_BOTTOM - BOARD_TOP) - this.cell * this.spec.rows) / 2;
    this.levelText.setText(`第 ${level} 关`);
    this.startFromSolutionHead();
  }

  /** The player may begin at either end of the guaranteed solution. */
  private startFromSolutionHead() {
    const tail = this.solution[this.solution.length - 1];
    this.visited = [{ ...tail }];
    this.redrawBoard();
  }

  private cellCenter(point: Point) {
    return {
      x: this.boardX + point.x * this.cell + this.cell / 2,
      y: this.boardY + point.y * this.cell + this.cell / 2,
    };
  }

  private cellAt(x: number, y: number): Point | null {
    const col = Math.floor((x - this.boardX) / this.cell);
    const row = Math.floor((y - this.boardY) / this.cell);
    if (col < 0 || col >= this.spec.cols || row < 0 || row >= this.spec.rows) return null;
    return { x: col, y: row };
  }

  private redrawBoard() {
    const g = this.boardGraphics;
    g.clear();
    for (let row = 0; row < this.spec.rows; row += 1) {
      for (let col = 0; col < this.spec.cols; col += 1) {
        const point = { x: col, y: row };
        if (this.blocked.has(key(point))) continue;
        const { x, y } = this.cellCenter(point);
        const visited = this.visited.some((cell) => cell.x === col && cell.y === row);
        if (visited) {
          g.fillStyle(INK, .1);
          g.fillRoundedRect(x - this.cell * .42, y - this.cell * .42, this.cell * .84, this.cell * .84, 8);
        }
        g.fillStyle(INK, visited ? .5 : .22);
        g.fillCircle(x, y, visited ? 4.5 : 3);
      }
    }
    const p = this.pathGraphics;
    p.clear();
    p.lineStyle(9, INK, .88);
    for (let index = 1; index < this.visited.length; index += 1) {
      const a = this.cellCenter(this.visited[index - 1]);
      const b = this.cellCenter(this.visited[index]);
      p.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (const cell of this.visited) {
      const { x, y } = this.cellCenter(cell);
      p.fillStyle(INK, .88);
      p.fillCircle(x, y, 4.5);
    }
    const head = this.cellCenter(this.visited[this.visited.length - 1]);
    this.headDot.setPosition(head.x, head.y);
    this.headDot.setVisible(!this.celebrating);
    this.progressText.setText(`${this.visited.length} / ${this.total}`);
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.celebrating) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const cell = this.cellAt(position.x, position.y);
      const head = this.visited[this.visited.length - 1];
      if (!cell || !head || key(cell) !== key(head)) return;
      if (!this.started && this.visited.length >= 0) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      this.tracing = true;
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.tracing || this.celebrating || !pointer.isDown) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const cell = this.cellAt(position.x, position.y);
      if (!cell) return;
      this.extendToward(cell);
    });
    const release = () => { this.tracing = false; };
    this.input.on("pointerup", release);
    this.input.on("pointerupoutside", release);
  }

  private extendToward(cell: Point) {
    const head = this.visited[this.visited.length - 1];
    if (!head || key(cell) === key(head)) return;
    if (cell.x < 0 || cell.x >= this.spec.cols || cell.y < 0 || cell.y >= this.spec.rows) return;
    if (this.blocked.has(key(cell))) return;
    const distance = Math.abs(cell.x - head.x) + Math.abs(cell.y - head.y);
    if (distance !== 1) return;
    if (this.visited.some((visitedCell) => key(visitedCell) === key(cell))) return;

    this.visited.push({ ...cell });
    this.redrawBoard();
    const progress = this.visited.length / this.total;
    this.audio.tone({ freq: 300 + progress * 420, duration: .07, type: "sine", gain: .1 });
    this.tweens.add({ targets: this.headDot, scale: { from: 1.5, to: 1 }, duration: 140 });

    if (this.visited.length === this.total) {
      this.completeLevel();
      return;
    }
    const neighbors = [
      { x: cell.x + 1, y: cell.y }, { x: cell.x - 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 }, { x: cell.x, y: cell.y - 1 },
    ];
    const stuck = !neighbors.some((n) => {
      return n.x >= 0 && n.x < this.spec.cols && n.y >= 0 && n.y < this.spec.rows
        && !this.blocked.has(key(n))
        && !this.visited.some((visitedCell) => key(visitedCell) === key(n));
    });
    if (stuck) {
      this.hintText.setText("此路不通 · 点撤销退一步").setColor("#c23b2e");
      this.audio.tone({ freq: 180, endFreq: 120, duration: .2, type: "sawtooth", gain: .12 });
      this.tweens.add({ targets: this.headDot, x: "+=4", duration: 55, yoyo: true, repeat: 3 });
    }
  }

  private undo() {
    if (this.celebrating || this.visited.length <= 1) return;
    this.visited.pop();
    this.hintText.setText("从红点起笔 · 拖过每一格 · 不能重复").setColor("#8d8674");
    this.redrawBoard();
    this.audio.tone({ freq: 260, duration: .06, type: "sine", gain: .09 });
  }

  private restartLevel() {
    if (this.celebrating) return;
    this.audio.tone({ freq: 220, duration: .08, type: "sine", gain: .09 });
    this.startFromSolutionHead();
    this.hintText.setText("从红点起笔 · 拖过每一格 · 不能重复").setColor("#8d8674");
    this.redrawBoard();
  }

  private completeLevel() {
    this.celebrating = true;
    this.headDot.setVisible(false);
    this.storage.save({ level: this.level + 1 });
    this.bridge.score(this.level);
    this.audio.tone({ freq: 520, duration: .16, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .12, type: "triangle", gain: .2 });

    const last = this.solution[this.solution.length - 1];
    const seal = this.add.container(0, 0).setDepth(10).setAlpha(0);
    const rect = this.add.rectangle(0, 0, 74, 74, SEAL_RED).setStrokeStyle(2, 0x8f2519);
    const mark = this.add.text(0, 0, "完", {
      fontFamily: "sans-serif", fontSize: "40px", color: "#f7f3ea", fontStyle: "bold",
    }).setOrigin(.5);
    seal.add([rect, mark]);
    const center = this.cellCenter({
      x: (last.x + this.visited[0].x) / 2,
      y: (last.y + this.visited[0].y) / 2,
    });
    seal.setPosition(center.x, center.y);
    seal.setAngle(-8);
    this.tweens.add({ targets: seal, alpha: 1, scale: { from: 1.6, to: 1 }, duration: 260, ease: "Cubic.easeIn" });
    this.cameras.main.shake(90, .004);

    for (let index = 0; index < 18; index += 1) {
      const speck = this.add.circle(center.x, center.y, Phaser.Math.FloatBetween(1.5, 3.4),
        Phaser.Utils.Array.GetRandom([SEAL_RED, INK, 0xc9a34d]));
      const angle = Math.random() * Math.PI * 2;
      const speed = Phaser.Math.FloatBetween(50, 150);
      this.tweens.add({
        targets: speck,
        x: center.x + Math.cos(angle) * speed,
        y: center.y + Math.sin(angle) * speed + 30,
        alpha: 0,
        duration: Phaser.Math.FloatBetween(500, 800),
        onComplete: () => speck.destroy(),
      });
    }

    this.time.delayedCall(950, () => this.loadLevel(this.level + 1));
  }

  private buildButtons() {
    const build = (x: number, label: string, onTap: () => void) => {
      const button = this.add.rectangle(x, 776, 118, 46, 0x2b2724)
        .setInteractive({ useHandCursor: true });
      this.add.text(x, 776, label, {
        fontFamily: "sans-serif", fontSize: "14px", color: "#f7f3ea", fontStyle: "bold",
      }).setOrigin(.5);
      button.on("pointerup", onTap);
    };
    build(CENTER_X - 72, "撤 销", () => this.undo());
    build(CENTER_X + 72, "重 来", () => this.restartLevel());
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#f7f3ea",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: OneStrokeScene,
});
