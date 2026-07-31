import Phaser from "phaser";
import {
  configureHiDpiCamera,
  createGameBridge,
  createGameStorage,
  getGameRenderDpr,
  sharpenSceneText,
} from "@web-games/game-sdk";
import levelsData from "./levels.json";
import "./style.css";

const WIDTH = 390;
const HEIGHT = 844;
const RENDER_DPR = getGameRenderDpr();
const BOARD_LEFT = 27;
const BOARD_TOP = 244;
const BOARD_SIZE = 336;

type Point = { x: number; y: number };
type Pair = { color: number; start: Point; end: Point };
type LineLevel = {
  id: number;
  name: string;
  difficulty: string;
  size: number;
  pairs: Pair[];
  solution: Point[][];
};
type Snapshot = { paths: Point[][]; actions: number };
type SaveData = { bestActions: Record<string, number>; lastLevel: number };

const LEVELS = levelsData as LineLevel[];
const PALETTE = [
  { value: 0xff6d5a, css: "#ff6d5a", name: "珊瑚红" },
  { value: 0x55ddeb, css: "#55ddeb", name: "湖水蓝" },
  { value: 0xffca55, css: "#ffca55", name: "明亮黄" },
  { value: 0x9c7cff, css: "#9c7cff", name: "星云紫" },
  { value: 0x69dd8a, css: "#69dd8a", name: "薄荷绿" },
  { value: 0x5d8cff, css: "#5d8cff", name: "电光蓝" },
  { value: 0xff7fbd, css: "#ff7fbd", name: "莓果粉" },
] as const;
const pointKey = (point: Point) => `${point.x},${point.y}`;
const samePoint = (left: Point, right: Point) => left.x === right.x && left.y === right.y;
const clonePaths = (paths: Point[][]) => paths.map((path) => path.map((point) => ({ ...point })));

class LineConnectScene extends Phaser.Scene {
  private levelIndex = 0;
  private level!: LineLevel;
  private paths: Point[][] = [];
  private history: Snapshot[] = [];
  private actions = 0;
  private activeColor: number | null = null;
  private activePointerId: number | null = null;
  private started = false;
  private ended = false;
  private picker: Phaser.GameObjects.Container | null = null;
  private tileSize = 64;
  private boardActualSize = BOARD_SIZE;
  private boardX = BOARD_LEFT;
  private boardY = BOARD_TOP;
  private endpointLookup = new Map<string, number>();
  private pathGraphics!: Phaser.GameObjects.Graphics;
  private actionsText!: Phaser.GameObjects.Text;
  private connectedText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private progressText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private lastBlockedAt = 0;
  private storage = createGameStorage<SaveData>("line-connect", {
    bestActions: {},
    lastLevel: 0,
  });
  private bridge = createGameBridge({
    gameId: "line-connect",
    version: "1.0.0",
    onCommand: (event) => {
      if (event.type === "PAUSE") this.scene.pause();
      if (event.type === "RESUME" && !this.ended) this.scene.resume();
      if (event.type === "RESTART") this.scene.restart({ levelIndex: this.levelIndex });
    },
  });

  constructor() {
    super("line-connect");
  }

  init(data: { levelIndex?: number }) {
    const saved = this.storage.load();
    const requested = data?.levelIndex ?? saved.lastLevel ?? 0;
    this.levelIndex = Phaser.Math.Clamp(requested, 0, LEVELS.length - 1);
    this.level = LEVELS[this.levelIndex];
  }

  create() {
    this.resetState();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#080c15");
    this.drawBackground();
    this.drawHeader();
    this.drawBoard();
    this.drawControls();
    this.bindInput();
    this.updateBoard();
    sharpenSceneText(this.children, RENDER_DPR);
    this.storage.save({ ...this.storage.load(), lastLevel: this.levelIndex });
    this.bridge.ready();
  }

  private resetState() {
    this.paths = this.level.pairs.map(() => []);
    this.history = [];
    this.actions = 0;
    this.activeColor = null;
    this.activePointerId = null;
    this.started = false;
    this.ended = false;
    this.picker = null;
    this.endpointLookup = new Map();
    this.lastBlockedAt = 0;
  }

  private drawBackground() {
    this.add.grid(
      WIDTH / 2,
      HEIGHT / 2,
      WIDTH,
      HEIGHT,
      32,
      32,
      0x080c15,
      1,
      0x7792ba,
      0.04,
    );
    this.add.circle(349, 104, 78, 0x5d8cff, 0.065);
    this.add.circle(32, 622, 92, 0xff6d5a, 0.035);
    this.add.rectangle(WIDTH / 2, 20, WIDTH - 40, 1, 0xbfd3f5, 0.16);
  }

  private drawHeader() {
    const saved = this.storage.load();
    const completed = Object.values(saved.bestActions).filter((value) => value > 0).length;
    this.add.text(22, 31, "FLOW / 011", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#55ddeb",
      letterSpacing: 2,
      fontStyle: "bold",
    });
    this.add.text(WIDTH - 22, 31, "益智", {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#778399",
    }).setOrigin(1, 0);
    this.add.text(22, 57, "连线不交叉", {
      fontFamily: "sans-serif",
      fontSize: "36px",
      color: "#f4f7ff",
      fontStyle: "bold",
    });
    this.progressText = this.add.text(WIDTH - 22, 70, `${completed}/${LEVELS.length}`, {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#ffca55",
      fontStyle: "bold",
    }).setOrigin(1, 0);
    this.add.text(24, 105, "连接同色端点，路线不能相交", {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#778399",
    });

    this.makeSmallButton(42, 145, "‹", () => this.changeLevel(-1));
    const levelButton = this.add.rectangle(WIDTH / 2, 145, 250, 38, 0x121a2a)
      .setStrokeStyle(1, 0x394963)
      .setInteractive({ cursor: "pointer" });
    this.add.text(
      WIDTH / 2,
      145,
      `第 ${String(this.level.id).padStart(2, "0")} 关 · ${this.level.name}  ▾`,
      {
        fontFamily: "sans-serif",
        fontSize: "13px",
        color: "#f4f7ff",
        fontStyle: "bold",
      },
    ).setOrigin(0.5);
    levelButton.on("pointerup", () => this.showLevelPicker());
    this.makeSmallButton(WIDTH - 42, 145, "›", () => this.changeLevel(1));

    this.add.rectangle(WIDTH / 2, 198, WIDTH - 44, 62, 0x121a2a)
      .setStrokeStyle(1, 0x394963, 0.76);
    this.actionsText = this.add.text(42, 182, "00", this.statValueStyle());
    this.connectedText = this.add.text(
      WIDTH / 2,
      182,
      `0/${this.level.pairs.length}`,
      this.statValueStyle(),
    ).setOrigin(0.5, 0);
    const best = saved.bestActions[String(this.level.id)] ?? 0;
    this.bestText = this.add.text(
      WIDTH - 42,
      182,
      best ? String(best).padStart(2, "0") : "--",
      this.statValueStyle(),
    ).setOrigin(1, 0);
    this.add.text(42, 209, "操作", this.statLabelStyle());
    this.add.text(WIDTH / 2, 209, "连通", this.statLabelStyle()).setOrigin(0.5, 0);
    this.add.text(WIDTH - 42, 209, "最佳", this.statLabelStyle()).setOrigin(1, 0);
  }

  private drawBoard() {
    this.tileSize = Math.floor(BOARD_SIZE / this.level.size);
    this.boardActualSize = this.tileSize * this.level.size;
    this.boardX = BOARD_LEFT + (BOARD_SIZE - this.boardActualSize) / 2;
    this.boardY = BOARD_TOP + (BOARD_SIZE - this.boardActualSize) / 2;
    this.add.rectangle(
      this.boardX + this.boardActualSize / 2,
      this.boardY + this.boardActualSize / 2,
      this.boardActualSize + 14,
      this.boardActualSize + 14,
      0x050810,
      0.8,
    ).setStrokeStyle(1.5, 0x35445e, 0.9);

    const cells = this.add.graphics();
    for (let y = 0; y < this.level.size; y += 1) {
      for (let x = 0; x < this.level.size; x += 1) {
        const center = this.cellCenter({ x, y });
        cells.fillStyle((x + y) % 2 === 0 ? 0x151e30 : 0x121b2b, 1);
        cells.fillRoundedRect(
          center.x - this.tileSize / 2 + 2,
          center.y - this.tileSize / 2 + 2,
          this.tileSize - 4,
          this.tileSize - 4,
          Math.max(5, this.tileSize * 0.12),
        );
        cells.lineStyle(1, 0x2b3952, 0.72);
        cells.strokeRoundedRect(
          center.x - this.tileSize / 2 + 2,
          center.y - this.tileSize / 2 + 2,
          this.tileSize - 4,
          this.tileSize - 4,
          Math.max(5, this.tileSize * 0.12),
        );
      }
    }
    this.pathGraphics = this.add.graphics().setDepth(4);

    this.level.pairs.forEach((pair) => {
      [pair.start, pair.end].forEach((point) => {
        this.endpointLookup.set(pointKey(point), pair.color);
        const center = this.cellCenter(point);
        const color = PALETTE[pair.color];
        const glow = this.add.circle(0, 0, this.tileSize * 0.25, color.value, 0.2);
        const outer = this.add.circle(0, 0, this.tileSize * 0.2, 0x080c15)
          .setStrokeStyle(Math.max(3, this.tileSize * 0.055), color.value, 1);
        const core = this.add.circle(0, 0, this.tileSize * 0.105, color.value, 1);
        const shine = this.add.circle(
          -this.tileSize * 0.035,
          -this.tileSize * 0.04,
          Math.max(2, this.tileSize * 0.025),
          0xffffff,
          0.82,
        );
        this.add.container(center.x, center.y, [glow, outer, core, shine]).setDepth(9);
        this.tweens.add({
          targets: glow,
          scale: 1.18,
          alpha: 0.08,
          duration: 880 + pair.color * 65,
          ease: "Sine.InOut",
          yoyo: true,
          repeat: -1,
        });
      });
    });
  }

  private drawControls() {
    this.statusText = this.add.text(WIDTH / 2, 606, "从彩色端点按住拖动开始连线", {
      fontFamily: "sans-serif",
      fontSize: "13px",
      color: "#bac5d8",
      fontStyle: "bold",
    }).setOrigin(0.5);
    this.add.text(WIDTH / 2, 627, "同色相连 · 路线不交叉 · 铺满全部格子", {
      fontFamily: "sans-serif",
      fontSize: "9px",
      color: "#65728a",
      letterSpacing: 0.7,
    }).setOrigin(0.5);

    this.makeTextButton(79, 672, 104, "↶  撤销", () => this.undo());
    this.makeTextButton(195, 672, 104, "↻  重开", () => {
      if (!this.ended) this.scene.restart({ levelIndex: this.levelIndex });
    });
    this.makeTextButton(311, 672, 104, "◎  提示", () => this.showHint());
    this.add.text(WIDTH / 2, 724, "拖回上一格可原路撤回，点击已画线路可从中间改线", {
      fontFamily: "sans-serif",
      fontSize: "10px",
      color: "#65728a",
    }).setOrigin(0.5);
    this.add.text(WIDTH / 2, 790, `${this.level.size} × ${this.level.size}  ·  ${this.level.difficulty}`, {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#46536b",
      letterSpacing: 1.4,
    }).setOrigin(0.5);
  }

  private bindInput() {
    const pointerDown = (pointer: Phaser.Input.Pointer) => this.handlePointerDown(pointer);
    const pointerMove = (pointer: Phaser.Input.Pointer) => this.handlePointerMove(pointer);
    const pointerUp = (pointer: Phaser.Input.Pointer) => this.handlePointerUp(pointer);
    const pauseGame = () => this.scene.pause();
    const resumeGame = () => {
      if (!this.ended) this.scene.resume();
    };
    this.input.on("pointerdown", pointerDown);
    this.input.on("pointermove", pointerMove);
    this.input.on("pointerup", pointerUp);
    this.game.events.on(Phaser.Core.Events.BLUR, pauseGame);
    this.game.events.on(Phaser.Core.Events.FOCUS, resumeGame);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off("pointerdown", pointerDown);
      this.input.off("pointermove", pointerMove);
      this.input.off("pointerup", pointerUp);
      this.game.events.off(Phaser.Core.Events.BLUR, pauseGame);
      this.game.events.off(Phaser.Core.Events.FOCUS, resumeGame);
    });
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    if (this.ended || this.picker || this.activeColor !== null) return;
    const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const cell = this.positionToCell(position);
    if (!cell) return;

    const endpointColor = this.endpointLookup.get(pointKey(cell));
    let color = endpointColor;
    let prefix: Point[] | null = null;
    if (color === undefined) {
      for (let index = 0; index < this.paths.length; index += 1) {
        const pathIndex = this.paths[index].findIndex((point) => samePoint(point, cell));
        if (pathIndex >= 0) {
          color = index;
          prefix = this.paths[index].slice(0, pathIndex + 1);
          break;
        }
      }
    }
    if (color === undefined) {
      this.showBlocked(cell, "请从彩色端点或已有线路开始");
      return;
    }

    this.history.push({ paths: clonePaths(this.paths), actions: this.actions });
    this.actions += 1;
    this.activeColor = color;
    this.activePointerId = pointer.id;
    if (endpointColor !== undefined) this.paths[color] = [{ ...cell }];
    else if (prefix) this.paths[color] = prefix;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
    }
    this.statusText
      .setText(`正在连接${PALETTE[color].name}`)
      .setColor(PALETTE[color].css);
    this.updateBoard();
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    if (
      this.activeColor === null ||
      this.activePointerId !== pointer.id ||
      !pointer.isDown ||
      this.ended
    ) {
      return;
    }
    const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const cell = this.positionToCell(position);
    if (cell) this.extendToward(cell);
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer) {
    if (this.activeColor === null || this.activePointerId !== pointer.id) return;
    const color = this.activeColor;
    this.activeColor = null;
    this.activePointerId = null;
    const connected = this.isPathConnected(color);
    this.statusText
      .setText(connected ? `${PALETTE[color].name}已连通` : "线路已保留，可继续调整")
      .setColor(connected ? PALETTE[color].css : "#bac5d8");
    this.updateBoard();
    this.checkCompletion();
  }

  private extendToward(target: Point) {
    if (this.activeColor === null) return;
    const path = this.paths[this.activeColor];
    if (path.length === 0) return;
    let guard = 0;
    while (guard < this.level.size * 2) {
      guard += 1;
      const current = path[path.length - 1];
      if (samePoint(current, target)) break;
      const dx = target.x - current.x;
      const dy = target.y - current.y;
      const next = Math.abs(dx) >= Math.abs(dy)
        ? { x: current.x + Math.sign(dx), y: current.y }
        : { x: current.x, y: current.y + Math.sign(dy) };
      if (!this.extendOne(next)) break;
    }
  }

  private extendOne(next: Point) {
    if (this.activeColor === null) return false;
    const color = this.activeColor;
    const path = this.paths[color];
    const current = path[path.length - 1];
    if (
      next.x < 0 ||
      next.x >= this.level.size ||
      next.y < 0 ||
      next.y >= this.level.size ||
      Math.abs(next.x - current.x) + Math.abs(next.y - current.y) !== 1
    ) {
      return false;
    }

    const pair = this.level.pairs[color];
    if (
      path.length > 1 &&
      (samePoint(current, pair.start) || samePoint(current, pair.end)) &&
      !samePoint(current, path[0])
    ) {
      return false;
    }

    const ownIndex = path.findIndex((point) => samePoint(point, next));
    if (ownIndex >= 0) {
      if (ownIndex === path.length - 2) path.pop();
      else path.splice(ownIndex + 1);
      this.updateBoard();
      return true;
    }

    const endpointColor = this.endpointLookup.get(pointKey(next));
    if (endpointColor !== undefined && endpointColor !== color) {
      this.showBlocked(next, "不同颜色的端点不能连接");
      return false;
    }
    for (let otherColor = 0; otherColor < this.paths.length; otherColor += 1) {
      if (
        otherColor !== color &&
        this.paths[otherColor].some((point) => samePoint(point, next))
      ) {
        this.showBlocked(next, "路线不能交叉或重叠");
        return false;
      }
    }
    if (
      (samePoint(next, pair.start) || samePoint(next, pair.end)) &&
      samePoint(next, path[0])
    ) {
      return false;
    }

    path.push({ ...next });
    this.updateBoard();
    return true;
  }

  private updateBoard() {
    this.drawPaths();
    const connected = this.paths.filter((_path, color) => this.isPathConnected(color)).length;
    this.actionsText.setText(String(this.actions).padStart(2, "0"));
    this.connectedText.setText(`${connected}/${this.level.pairs.length}`);
  }

  private drawPaths() {
    this.pathGraphics.clear();
    const routeWidth = Math.max(12, this.tileSize * 0.28);
    this.paths.forEach((path, color) => {
      if (path.length < 2) return;
      const centers = path.map((point) => this.cellCenter(point));
      this.pathGraphics.lineStyle(routeWidth + 6, 0x03050a, 0.58);
      this.pathGraphics.beginPath();
      this.pathGraphics.moveTo(centers[0].x, centers[0].y);
      centers.slice(1).forEach((center) => this.pathGraphics.lineTo(center.x, center.y));
      this.pathGraphics.strokePath();
      centers.forEach((center) => {
        this.pathGraphics.fillStyle(0x03050a, 0.58);
        this.pathGraphics.fillCircle(center.x, center.y, (routeWidth + 6) / 2);
      });

      const alpha = this.isPathConnected(color) ? 1 : 0.82;
      this.pathGraphics.lineStyle(routeWidth, PALETTE[color].value, alpha);
      this.pathGraphics.beginPath();
      this.pathGraphics.moveTo(centers[0].x, centers[0].y);
      centers.slice(1).forEach((center) => this.pathGraphics.lineTo(center.x, center.y));
      this.pathGraphics.strokePath();
      centers.forEach((center) => {
        this.pathGraphics.fillStyle(PALETTE[color].value, alpha);
        this.pathGraphics.fillCircle(center.x, center.y, routeWidth / 2);
      });
    });
  }

  private isPathConnected(color: number) {
    const path = this.paths[color];
    if (path.length < 2) return false;
    const pair = this.level.pairs[color];
    const first = path[0];
    const last = path[path.length - 1];
    return (
      (samePoint(first, pair.start) && samePoint(last, pair.end)) ||
      (samePoint(first, pair.end) && samePoint(last, pair.start))
    );
  }

  private coverageCount() {
    const occupied = new Set<string>();
    this.level.pairs.forEach((pair) => {
      occupied.add(pointKey(pair.start));
      occupied.add(pointKey(pair.end));
    });
    this.paths.forEach((path) => path.forEach((point) => occupied.add(pointKey(point))));
    return occupied.size;
  }

  private checkCompletion() {
    if (!this.paths.every((_path, color) => this.isPathConnected(color))) return;
    if (this.coverageCount() < this.level.size * this.level.size) {
      this.statusText.setText("颜色已经连通，还需要铺满空白格").setColor("#ffca55");
      return;
    }
    this.completeLevel();
  }

  private undo() {
    if (this.ended || this.picker || this.activeColor !== null) return;
    const snapshot = this.history.pop();
    if (!snapshot) {
      this.statusText.setText("还没有可以撤销的连线").setColor("#ffca55");
      return;
    }
    this.paths = clonePaths(snapshot.paths);
    this.actions = snapshot.actions;
    this.statusText.setText("已撤销上一次连线").setColor("#bac5d8");
    this.updateBoard();
  }

  private showHint() {
    if (this.ended || this.picker || this.activeColor !== null) return;
    let color = this.paths.findIndex((_path, index) => !this.isPathConnected(index));
    if (color < 0) color = 0;
    const solution = this.level.solution[color];
    if (!solution || solution.length < 2) return;
    const hint = this.add.graphics().setDepth(20);
    const first = this.cellCenter(solution[0]);
    const second = this.cellCenter(solution[1]);
    hint.lineStyle(Math.max(6, this.tileSize * 0.11), PALETTE[color].value, 0.95);
    hint.beginPath();
    hint.moveTo(first.x, first.y);
    hint.lineTo(second.x, second.y);
    hint.strokePath();
    hint.fillStyle(PALETTE[color].value, 1);
    hint.fillCircle(second.x, second.y, Math.max(6, this.tileSize * 0.11));
    this.statusText
      .setText(`提示：从${PALETTE[color].name}端点向高亮方向出发`)
      .setColor(PALETTE[color].css);
    this.tweens.add({
      targets: hint,
      alpha: 0.15,
      duration: 280,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: 2,
      onComplete: () => hint.destroy(),
    });
  }

  private showBlocked(cell: Point, message: string) {
    if (this.time.now - this.lastBlockedAt < 180) return;
    this.lastBlockedAt = this.time.now;
    const center = this.cellCenter(cell);
    const mark = this.add.rectangle(
      center.x,
      center.y,
      this.tileSize - 8,
      this.tileSize - 8,
      0xff6d5a,
      0.08,
    ).setStrokeStyle(2, 0xff6d5a, 0.8).setDepth(18);
    this.statusText.setText(message).setColor("#ff8d7e");
    this.tweens.add({
      targets: mark,
      alpha: 0,
      scale: 0.84,
      duration: 260,
      onComplete: () => mark.destroy(),
    });
  }

  private completeLevel() {
    this.ended = true;
    const saved = this.storage.load();
    const key = String(this.level.id);
    const previousBest = saved.bestActions[key] ?? 0;
    const isRecord = previousBest === 0 || this.actions < previousBest;
    if (isRecord) saved.bestActions[key] = this.actions;
    saved.lastLevel = Math.min(this.levelIndex + 1, LEVELS.length - 1);
    this.storage.save(saved);
    this.bestText.setText(String(saved.bestActions[key]).padStart(2, "0"));
    this.progressText.setText(
      `${Object.values(saved.bestActions).filter((value) => value > 0).length}/${LEVELS.length}`,
    );
    const score = Math.max(100, 1500 + this.levelIndex * 90 - this.actions * 18);
    this.bridge.score(score);
    this.bridge.gameOver(score);
    this.statusText.setText("全部连通，棋盘已铺满！").setColor("#69dd8a");
    this.createCelebration();
    this.time.delayedCall(320, () => this.showCompleteOverlay(isRecord));
  }

  private createCelebration() {
    for (let index = 0; index < 28; index += 1) {
      const color = PALETTE[index % this.level.pairs.length].value;
      const particle = this.add.circle(
        WIDTH / 2 + Phaser.Math.Between(-45, 45),
        470,
        Phaser.Math.Between(2, 5),
        color,
        1,
      ).setDepth(90);
      this.tweens.add({
        targets: particle,
        x: particle.x + Phaser.Math.Between(-165, 165),
        y: particle.y + Phaser.Math.Between(-210, -40),
        scale: Phaser.Math.FloatBetween(0.4, 1.4),
        alpha: 0,
        duration: Phaser.Math.Between(650, 1050),
        ease: "Quad.Out",
        onComplete: () => particle.destroy(),
      });
    }
  }

  private showCompleteOverlay(isRecord: boolean) {
    const nextIndex = Math.min(this.levelIndex + 1, LEVELS.length - 1);
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x040710, 0.88)
      .setDepth(100)
      .setInteractive();
    const panel = this.add.rectangle(WIDTH / 2, 430, 324, 304, 0x121a2a)
      .setStrokeStyle(2, 0x55ddeb)
      .setDepth(101);
    const badge = this.add.circle(WIDTH / 2, 331, 32, 0x69dd8a)
      .setStrokeStyle(2, 0xb8ffcc)
      .setDepth(102);
    this.add.text(WIDTH / 2, 331, "✓", {
      fontFamily: "sans-serif",
      fontSize: "31px",
      color: "#08140d",
      fontStyle: "bold",
    }).setOrigin(0.5).setDepth(103);
    this.add.text(WIDTH / 2, 382, "完美连通", {
      fontFamily: "sans-serif",
      fontSize: "28px",
      color: "#f4f7ff",
      fontStyle: "bold",
    }).setOrigin(0.5).setDepth(102);
    this.add.text(WIDTH / 2, 424, `${this.actions} 次操作 · 覆盖 100%`, {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#9ba8bd",
    }).setOrigin(0.5).setDepth(102);
    this.add.text(WIDTH / 2, 454, isRecord ? "NEW BEST  新纪录" : "关卡完成", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#ffca55",
      letterSpacing: 1,
      fontStyle: "bold",
    }).setOrigin(0.5).setDepth(102);
    const label = this.levelIndex === LEVELS.length - 1 ? "再玩一次  ↗" : "下一关  →";
    const button = this.add.rectangle(WIDTH / 2, 521, 226, 52, 0x55ddeb)
      .setDepth(102)
      .setInteractive({ cursor: "pointer" });
    this.add.text(WIDTH / 2, 521, label, {
      fontFamily: "sans-serif",
      fontSize: "15px",
      color: "#071018",
      fontStyle: "bold",
    }).setOrigin(0.5).setDepth(103);
    button.on("pointerup", () => this.scene.restart({ levelIndex: nextIndex }));
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({
      targets: [shade, panel, badge, button],
      alpha: { from: 0, to: 1 },
      duration: 220,
      ease: "Sine.Out",
    });
  }

  private showLevelPicker() {
    if (this.picker || this.activeColor !== null) return;
    const saved = this.storage.load();
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x040710, 0.92)
      .setInteractive();
    const panel = this.add.rectangle(WIDTH / 2, 421, 350, 620, 0x121a2a)
      .setStrokeStyle(1.5, 0x465a78);
    const title = this.add.text(40, 132, "选择关卡", {
      fontFamily: "sans-serif",
      fontSize: "27px",
      color: "#f4f7ff",
      fontStyle: "bold",
    });
    const count = Object.values(saved.bestActions).filter((value) => value > 0).length;
    const summary = this.add.text(WIDTH - 40, 142, `已完成 ${count}/${LEVELS.length}`, {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#55ddeb",
    }).setOrigin(1, 0);
    const objects: Phaser.GameObjects.GameObject[] = [shade, panel, title, summary];

    LEVELS.forEach((level, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const x = 66 + column * 86;
      const y = 211 + row * 66;
      const completed = Boolean(saved.bestActions[String(level.id)]);
      const active = index === this.levelIndex;
      const tile = this.add.rectangle(
        x,
        y,
        70,
        52,
        active ? 0x55ddeb : completed ? 0x1c4350 : 0x172136,
      ).setStrokeStyle(1.5, active ? 0xb9f8ff : completed ? 0x69dd8a : 0x3c4c69)
        .setInteractive({ cursor: "pointer" });
      const number = this.add.text(x, y - 7, String(level.id).padStart(2, "0"), {
        fontFamily: "monospace",
        fontSize: "15px",
        color: active ? "#071018" : "#f4f7ff",
        fontStyle: "bold",
      }).setOrigin(0.5);
      const mark = this.add.text(
        x,
        y + 13,
        completed ? `✓ ${saved.bestActions[String(level.id)]}次` : `${level.size}×${level.size}`,
        {
          fontFamily: "sans-serif",
          fontSize: "8px",
          color: active ? "#20353d" : completed ? "#8ff2ac" : "#778399",
        },
      ).setOrigin(0.5);
      tile.on("pointerup", () => this.scene.restart({ levelIndex: index }));
      objects.push(tile, number, mark);
    });

    const close = this.add.rectangle(WIDTH / 2, 657, 220, 45, 0x172136)
      .setStrokeStyle(1, 0x465a78)
      .setInteractive({ cursor: "pointer" });
    const closeText = this.add.text(WIDTH / 2, 657, "返回游戏", {
      fontFamily: "sans-serif",
      fontSize: "13px",
      color: "#f4f7ff",
      fontStyle: "bold",
    }).setOrigin(0.5);
    objects.push(close, closeText);
    this.picker = this.add.container(0, 0, objects).setDepth(110).setAlpha(0).setScale(0.975);
    close.on("pointerup", () => this.closeLevelPicker());
    shade.on("pointerup", () => this.closeLevelPicker());
    this.tweens.add({
      targets: this.picker,
      alpha: 1,
      scale: 1,
      duration: 180,
      ease: "Sine.Out",
    });
    sharpenSceneText(this.children, RENDER_DPR);
  }

  private closeLevelPicker() {
    const picker = this.picker;
    if (!picker) return;
    this.picker = null;
    this.tweens.add({
      targets: picker,
      alpha: 0,
      scale: 0.985,
      duration: 120,
      onComplete: () => picker.destroy(),
    });
  }

  private changeLevel(offset: number) {
    if (this.activeColor !== null) return;
    const next = Phaser.Math.Clamp(this.levelIndex + offset, 0, LEVELS.length - 1);
    if (next !== this.levelIndex) this.scene.restart({ levelIndex: next });
  }

  private cellCenter(point: Point) {
    return new Phaser.Math.Vector2(
      this.boardX + (point.x + 0.5) * this.tileSize,
      this.boardY + (point.y + 0.5) * this.tileSize,
    );
  }

  private positionToCell(position: Phaser.Math.Vector2): Point | null {
    const x = Math.floor((position.x - this.boardX) / this.tileSize);
    const y = Math.floor((position.y - this.boardY) / this.tileSize);
    if (x < 0 || x >= this.level.size || y < 0 || y >= this.level.size) return null;
    return { x, y };
  }

  private makeTextButton(
    x: number,
    y: number,
    width: number,
    label: string,
    onPress: () => void,
  ) {
    const button = this.add.rectangle(x, y, width, 46, 0x172136)
      .setStrokeStyle(1.5, 0x465a78)
      .setInteractive({ cursor: "pointer" });
    this.add.text(x, y, label, {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#dce5f5",
      fontStyle: "bold",
    }).setOrigin(0.5);
    button.on("pointerdown", () => button.setFillStyle(0x253554));
    button.on("pointerout", () => button.setFillStyle(0x172136));
    button.on("pointerup", () => {
      button.setFillStyle(0x172136);
      onPress();
    });
  }

  private makeSmallButton(x: number, y: number, label: string, onPress: () => void) {
    const button = this.add.rectangle(x, y, 38, 38, 0x172136)
      .setStrokeStyle(1, 0x465a78)
      .setInteractive({ cursor: "pointer" });
    this.add.text(x, y - 1, label, {
      fontFamily: "sans-serif",
      fontSize: "25px",
      color: "#dce5f5",
    }).setOrigin(0.5);
    button.on("pointerup", onPress);
  }

  private statValueStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: "monospace",
      fontSize: "20px",
      color: "#f4f7ff",
      fontStyle: "bold",
    };
  }

  private statLabelStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: "sans-serif",
      fontSize: "9px",
      color: "#778399",
    };
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#080c15",
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: false,
    powerPreference: "high-performance",
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: LineConnectScene,
});
