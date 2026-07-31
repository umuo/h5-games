import Phaser from "phaser";
import {
  bindGameLifecycle,
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
const BOARD_AREA_TOP = 238;
const BOARD_AREA_HEIGHT = 356;
const WORKER_ASSET = new URL("./assets/sokoban-worker.png", import.meta.url).href;
const CRATE_ASSET = new URL("./assets/sokoban-crate.png", import.meta.url).href;
const WALL_ASSET = new URL("./assets/sokoban-wall.png", import.meta.url).href;
const TARGET_ASSET = new URL("./assets/sokoban-target.png", import.meta.url).href;

type Point = { x: number; y: number };
type Direction = { dx: number; dy: number; code: "U" | "R" | "D" | "L" };
type Snapshot = { player: Point; boxes: Point[]; moves: number; pushes: number };
type SaveData = { bestMoves: Record<string, number>; lastLevel: number };
type SokobanLevel = {
  id: number;
  name: string;
  difficulty: string;
  map: string[];
};

const LEVELS = levelsData as SokobanLevel[];
const DIRECTIONS: Record<string, Direction> = {
  ArrowUp: { dx: 0, dy: -1, code: "U" },
  KeyW: { dx: 0, dy: -1, code: "U" },
  ArrowRight: { dx: 1, dy: 0, code: "R" },
  KeyD: { dx: 1, dy: 0, code: "R" },
  ArrowDown: { dx: 0, dy: 1, code: "D" },
  KeyS: { dx: 0, dy: 1, code: "D" },
  ArrowLeft: { dx: -1, dy: 0, code: "L" },
  KeyA: { dx: -1, dy: 0, code: "L" },
};
const SWIPE_DIRECTIONS = {
  up: DIRECTIONS.ArrowUp,
  right: DIRECTIONS.ArrowRight,
  down: DIRECTIONS.ArrowDown,
  left: DIRECTIONS.ArrowLeft,
};

const pointKey = (point: Point) => `${point.x},${point.y}`;
const clonePoint = (point: Point): Point => ({ ...point });
const clonePoints = (points: Point[]) => points.map(clonePoint);

class SokobanScene extends Phaser.Scene {
  private levelIndex = 0;
  private level!: SokobanLevel;
  private walls = new Set<string>();
  private floors = new Set<string>();
  private targets = new Set<string>();
  private boxes: Point[] = [];
  private player: Point = { x: 0, y: 0 };
  private boxSprites: Phaser.GameObjects.Image[] = [];
  private boxBaseScale = { x: 1, y: 1 };
  private targetSprites = new Map<string, Phaser.GameObjects.Image>();
  private playerSprite!: Phaser.GameObjects.Image;
  private history: Snapshot[] = [];
  private moves = 0;
  private pushes = 0;
  private started = false;
  private busy = false;
  private ended = false;
  private queuedDirection: Direction | null = null;
  private swipeStart: Phaser.Math.Vector2 | null = null;
  private picker: Phaser.GameObjects.Container | null = null;
  private tileSize = 36;
  private boardLeft = 0;
  private boardTop = 0;
  private movesText!: Phaser.GameObjects.Text;
  private pushesText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private progressText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private storage = createGameStorage<SaveData>("sokoban", {
    bestMoves: {},
    lastLevel: 0,
  });
  private bridge = createGameBridge({
    gameId: "sokoban",
    version: "1.0.2",
    onCommand: (event) => {
      if (event.type === "PAUSE") this.scene.pause();
      if (event.type === "RESUME" && !this.ended) this.scene.resume();
      if (event.type === "RESTART") this.scene.restart({ levelIndex: this.levelIndex });
    },
  });

  constructor() {
    super("sokoban");
  }

  init(data: { levelIndex?: number }) {
    const saved = this.storage.load();
    const requested = data?.levelIndex ?? saved.lastLevel ?? 0;
    this.levelIndex = Phaser.Math.Clamp(requested, 0, LEVELS.length - 1);
    this.level = LEVELS[this.levelIndex];
  }

  preload() {
    this.load.image("sokoban-worker", WORKER_ASSET);
    this.load.image("sokoban-crate", CRATE_ASSET);
    this.load.image("sokoban-wall", WALL_ASSET);
    this.load.image("sokoban-target", TARGET_ASSET);
  }

  create() {
    this.resetState();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#0b1720");
    this.drawBackground();
    this.parseLevel();
    this.drawHeader();
    this.drawBoard();
    this.drawControls();
    this.bindInput();
    sharpenSceneText(this.children, RENDER_DPR);
    this.storage.save({ ...this.storage.load(), lastLevel: this.levelIndex });
    this.bridge.ready();
  }

  private resetState() {
    this.walls = new Set();
    this.floors = new Set();
    this.targets = new Set();
    this.boxes = [];
    this.boxSprites = [];
    this.targetSprites = new Map();
    this.history = [];
    this.moves = 0;
    this.pushes = 0;
    this.started = false;
    this.busy = false;
    this.ended = false;
    this.queuedDirection = null;
    this.swipeStart = null;
    this.picker = null;
  }

  private drawBackground() {
    this.add.grid(
      WIDTH / 2,
      HEIGHT / 2,
      WIDTH,
      HEIGHT,
      32,
      32,
      0x0b1720,
      1,
      0x8fc5d9,
      0.045,
    );
    this.add.circle(350, 104, 74, 0x4aa2b8, 0.06);
    this.add.circle(35, 575, 96, 0xe9a83b, 0.035);
    this.add.rectangle(WIDTH / 2, 20, WIDTH - 40, 1, 0xbfe8ef, 0.18);
  }

  private parseLevel() {
    const columns = Math.max(...this.level.map.map((row) => row.length));
    const rows = this.level.map.length;
    this.level.map.forEach((row, y) => {
      [...row].forEach((tile, x) => {
        const position = { x, y };
        if (tile === "#") this.walls.add(pointKey(position));
        if (".+*".includes(tile)) this.targets.add(pointKey(position));
        if ("$*".includes(tile)) this.boxes.push(position);
        if ("@+".includes(tile)) this.player = position;
      });
    });

    const queue = [clonePoint(this.player)];
    this.floors.add(pointKey(this.player));
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const direction of Object.values(SWIPE_DIRECTIONS)) {
        const next = {
          x: current.x + direction.dx,
          y: current.y + direction.dy,
        };
        const nextKey = pointKey(next);
        if (
          next.x < 0 ||
          next.x >= columns ||
          next.y < 0 ||
          next.y >= rows ||
          this.walls.has(nextKey) ||
          this.floors.has(nextKey)
        ) {
          continue;
        }
        this.floors.add(nextKey);
        queue.push(next);
      }
    }
  }

  private drawHeader() {
    const save = this.storage.load();
    const completed = Object.keys(save.bestMoves).filter(
      (key) => save.bestMoves[key] > 0,
    ).length;
    this.add.text(22, 31, "WAREHOUSE / 010", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#70d2df",
      letterSpacing: 2,
      fontStyle: "bold",
    });
    this.add.text(WIDTH - 22, 31, "益智", {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#78909a",
    }).setOrigin(1, 0);
    this.add.text(22, 57, "推箱子", {
      fontFamily: "sans-serif",
      fontSize: "38px",
      color: "#f4fbfa",
      fontStyle: "bold",
    });
    this.progressText = this.add.text(WIDTH - 22, 70, `${completed}/${LEVELS.length}`, {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#e9b957",
      fontStyle: "bold",
    }).setOrigin(1, 0);
    this.add.text(24, 105, "推动全部木箱进入金色目标点", {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#78909a",
    });

    this.makeSmallButton(42, 145, 38, 38, "‹", () => this.changeLevel(-1));
    const levelButton = this.add.rectangle(WIDTH / 2, 145, 250, 38, 0x112630)
      .setStrokeStyle(1, 0x36515c)
      .setInteractive({ cursor: "pointer" });
    this.levelText = this.add.text(
      WIDTH / 2,
      145,
      `第 ${String(this.level.id).padStart(2, "0")} 关 · ${this.level.name}  ▾`,
      {
        fontFamily: "sans-serif",
        fontSize: "13px",
        color: "#eef9f8",
        fontStyle: "bold",
      },
    ).setOrigin(0.5);
    levelButton.on("pointerup", () => this.showLevelPicker());
    this.makeSmallButton(WIDTH - 42, 145, 38, 38, "›", () => this.changeLevel(1));

    this.add.rectangle(WIDTH / 2, 198, WIDTH - 44, 62, 0x112630)
      .setStrokeStyle(1, 0x36515c, 0.75);
    this.movesText = this.add.text(42, 182, "00", this.statValueStyle());
    this.pushesText = this.add.text(WIDTH / 2, 182, "00", this.statValueStyle())
      .setOrigin(0.5, 0);
    const best = save.bestMoves[String(this.level.id)] ?? 0;
    this.bestText = this.add.text(
      WIDTH - 42,
      182,
      best ? String(best).padStart(2, "0") : "--",
      this.statValueStyle(),
    ).setOrigin(1, 0);
    this.add.text(42, 209, "步数", this.statLabelStyle());
    this.add.text(WIDTH / 2, 209, "推动", this.statLabelStyle()).setOrigin(0.5, 0);
    this.add.text(WIDTH - 42, 209, "最佳", this.statLabelStyle()).setOrigin(1, 0);
  }

  private drawBoard() {
    const columns = Math.max(...this.level.map.map((row) => row.length));
    const rows = this.level.map.length;
    this.tileSize = Math.floor(Math.min(342 / columns, 342 / rows));
    const boardWidth = columns * this.tileSize;
    const boardHeight = rows * this.tileSize;
    this.boardLeft = (WIDTH - boardWidth) / 2;
    this.boardTop = BOARD_AREA_TOP + (BOARD_AREA_HEIGHT - boardHeight) / 2;

    const panel = this.add.rectangle(
      WIDTH / 2,
      this.boardTop + boardHeight / 2,
      boardWidth + 16,
      boardHeight + 16,
      0x071015,
      0.72,
    ).setStrokeStyle(1, 0x43616b, 0.7);

    const floorGraphics = this.add.graphics();
    this.level.map.forEach((row, y) => {
      [...row].forEach((_tile, x) => {
        if (!this.floors.has(`${x},${y}`)) return;
        const center = this.cellCenter({ x, y });
        floorGraphics.fillStyle((x + y) % 2 === 0 ? 0x18333c : 0x152e37, 1);
        floorGraphics.fillRoundedRect(
          center.x - this.tileSize / 2 + 1,
          center.y - this.tileSize / 2 + 1,
          this.tileSize - 2,
          this.tileSize - 2,
          Math.max(3, this.tileSize * 0.1),
        );
      });
    });

    const introTargets: Phaser.GameObjects.GameObject[] = [panel, floorGraphics];
    this.targets.forEach((targetKey) => {
      const [x, y] = targetKey.split(",").map(Number);
      const center = this.cellCenter({ x, y });
      const sprite = this.add.image(center.x, center.y, "sokoban-target")
        .setDisplaySize(this.tileSize * 0.76, this.tileSize * 0.76)
        .setDepth(2);
      this.targetSprites.set(targetKey, sprite);
      introTargets.push(sprite);
      this.tweens.add({
        targets: sprite,
        scaleX: sprite.scaleX * 1.06,
        scaleY: sprite.scaleY * 1.06,
        alpha: 0.82,
        duration: 900 + (x + y) * 23,
        ease: "Sine.InOut",
        yoyo: true,
        repeat: -1,
      });
    });

    this.walls.forEach((wallKey) => {
      const [x, y] = wallKey.split(",").map(Number);
      const center = this.cellCenter({ x, y });
      const wall = this.add.image(center.x, center.y, "sokoban-wall")
        .setDisplaySize(this.tileSize * 1.03, this.tileSize * 1.03)
        .setDepth(4);
      introTargets.push(wall);
    });

    this.boxSprites = this.boxes.map((box, index) => {
      const center = this.cellCenter(box);
      const sprite = this.add.image(center.x, center.y, "sokoban-crate")
        .setDisplaySize(this.tileSize * 0.9, this.tileSize * 0.9)
        .setDepth(7 + index * 0.001);
      introTargets.push(sprite);
      return sprite;
    });
    if (this.boxSprites[0]) {
      this.boxBaseScale = {
        x: this.boxSprites[0].scaleX,
        y: this.boxSprites[0].scaleY,
      };
    }
    const playerCenter = this.cellCenter(this.player);
    this.playerSprite = this.add.image(
      playerCenter.x,
      playerCenter.y,
      "sokoban-worker",
    ).setDisplaySize(this.tileSize * 0.92, this.tileSize * 0.92).setDepth(10);
    introTargets.push(this.playerSprite);
    this.refreshCrateTargets(false);

    introTargets.forEach((target) => {
      (target as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Alpha).setAlpha(0);
    });
    this.tweens.add({
      targets: introTargets,
      alpha: 1,
      duration: 260,
      ease: "Sine.Out",
      delay: this.tweens.stagger(10, { start: 0 }),
    });
  }

  private drawControls() {
    this.statusText = this.add.text(WIDTH / 2, 612, "滑动棋盘，或使用方向键移动", {
      fontFamily: "sans-serif",
      fontSize: "13px",
      color: "#b6cad0",
      fontStyle: "bold",
    }).setOrigin(0.5);
    this.add.text(WIDTH / 2, 632, "箱子只能推动，不能拉动", {
      fontFamily: "sans-serif",
      fontSize: "9px",
      color: "#617a84",
      letterSpacing: 1,
    }).setOrigin(0.5);

    this.makeTextButton(86, 669, 118, 46, "↶  撤销", () => this.undo());
    this.makeTextButton(216, 669, 118, 46, "↻  重开", () => {
      if (!this.busy) this.scene.restart({ levelIndex: this.levelIndex });
    });
    this.makeTextButton(330, 669, 86, 46, "关卡", () => this.showLevelPicker());

    this.add.rectangle(WIDTH / 2, 762, 224, 138, 0x071015, 0.48)
      .setStrokeStyle(1, 0x36515c, 0.65);
    this.makeDirectionButton(195, 728, "▲", SWIPE_DIRECTIONS.up);
    this.makeDirectionButton(126, 796, "◀", SWIPE_DIRECTIONS.left);
    this.makeDirectionButton(195, 796, "▼", SWIPE_DIRECTIONS.down);
    this.makeDirectionButton(264, 796, "▶", SWIPE_DIRECTIONS.right);
  }

  private bindInput() {
    const pointerDown = (pointer: Phaser.Input.Pointer) => {
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      if (
        position.y >= BOARD_AREA_TOP - 10 &&
        position.y <= BOARD_AREA_TOP + BOARD_AREA_HEIGHT + 10
      ) {
        this.swipeStart = position.clone();
      } else {
        this.swipeStart = null;
      }
    };
    const pointerUp = (pointer: Phaser.Input.Pointer) => {
      if (!this.swipeStart || this.picker) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const dx = position.x - this.swipeStart.x;
      const dy = position.y - this.swipeStart.y;
      this.swipeStart = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        this.tryMove(dx > 0 ? SWIPE_DIRECTIONS.right : SWIPE_DIRECTIONS.left);
      } else {
        this.tryMove(dy > 0 ? SWIPE_DIRECTIONS.down : SWIPE_DIRECTIONS.up);
      }
    };
    const keyDown = (event: KeyboardEvent) => {
      const direction = DIRECTIONS[event.code];
      if (direction) {
        event.preventDefault();
        this.tryMove(direction);
      } else if (event.code === "KeyZ") {
        this.undo();
      } else if (event.code === "KeyR") {
        this.scene.restart({ levelIndex: this.levelIndex });
      }
    };
    this.input.on("pointerdown", pointerDown);
    this.input.on("pointerup", pointerUp);
    this.input.keyboard?.on("keydown", keyDown);
    bindGameLifecycle(this, {
      onInterrupt: () => {
        this.swipeStart = null;
      },
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off("pointerdown", pointerDown);
      this.input.off("pointerup", pointerUp);
      this.input.keyboard?.off("keydown", keyDown);
    });
  }

  private tryMove(direction: Direction) {
    if (this.picker || this.ended) return;
    if (this.busy) {
      this.queuedDirection = direction;
      return;
    }

    const next = {
      x: this.player.x + direction.dx,
      y: this.player.y + direction.dy,
    };
    if (!this.floors.has(pointKey(next)) || this.walls.has(pointKey(next))) {
      this.showBlocked("前面是墙，换条路线试试");
      return;
    }

    const boxIndex = this.boxes.findIndex((box) => pointKey(box) === pointKey(next));
    let pushedBoxIndex = -1;
    let pushedDestination: Point | null = null;
    if (boxIndex >= 0) {
      const beyond = {
        x: next.x + direction.dx,
        y: next.y + direction.dy,
      };
      if (
        !this.floors.has(pointKey(beyond)) ||
        this.walls.has(pointKey(beyond)) ||
        this.boxes.some((box, index) => index !== boxIndex && pointKey(box) === pointKey(beyond))
      ) {
        this.showBlocked("箱子被挡住了，无法继续推动");
        return;
      }
      pushedBoxIndex = boxIndex;
      pushedDestination = beyond;
    }

    this.history.push({
      player: clonePoint(this.player),
      boxes: clonePoints(this.boxes),
      moves: this.moves,
      pushes: this.pushes,
    });
    if (!this.started) {
      this.started = true;
      this.bridge.started();
    }
    this.moves += 1;
    this.player = next;
    if (pushedBoxIndex >= 0 && pushedDestination) {
      this.pushes += 1;
      this.boxes[pushedBoxIndex] = pushedDestination;
    }
    this.updateStats();
    this.animateMove(direction, pushedBoxIndex);
  }

  private animateMove(direction: Direction, pushedBoxIndex: number) {
    this.busy = true;
    this.queuedDirection = null;
    this.tweens.killTweensOf(this.playerSprite);
    this.playerSprite.setFlipX(direction.dx < 0);
    const playerDestination = this.cellCenter(this.player);
    const tweens: Phaser.Tweens.Tween[] = [];
    tweens.push(this.tweens.add({
      targets: this.playerSprite,
      x: playerDestination.x,
      y: playerDestination.y,
      angle: direction.dx * 4,
      duration: 118,
      ease: "Cubic.Out",
    }));

    if (pushedBoxIndex >= 0) {
      const boxSprite = this.boxSprites[pushedBoxIndex];
      const boxDestination = this.cellCenter(this.boxes[pushedBoxIndex]);
      this.tweens.killTweensOf(boxSprite);
      boxSprite
        .setScale(this.boxBaseScale.x, this.boxBaseScale.y)
        .setAngle(0)
        .setDepth(12);
      tweens.push(this.tweens.add({
        targets: boxSprite,
        x: boxDestination.x,
        y: boxDestination.y,
        angle: direction.dx * 3,
        scaleX: this.boxBaseScale.x * 1.035,
        scaleY: this.boxBaseScale.y * 0.965,
        duration: 138,
        ease: "Cubic.Out",
        onComplete: () => {
          boxSprite
            .setScale(this.boxBaseScale.x, this.boxBaseScale.y)
            .setAngle(0)
            .setDepth(7);
          this.createLandingRipple(boxDestination);
        },
      }));
    }

    let remaining = tweens.length;
    tweens.forEach((tween) => {
      tween.once("complete", () => {
        remaining -= 1;
        if (remaining === 0) this.finishMove();
      });
    });
  }

  private finishMove() {
    this.playerSprite.setAngle(0);
    this.refreshCrateTargets(true);
    this.busy = false;
    if (this.boxes.every((box) => this.targets.has(pointKey(box)))) {
      this.completeLevel();
      return;
    }
    this.statusText.setText("继续规划路线");
    const queued = this.queuedDirection;
    this.queuedDirection = null;
    if (queued) this.tryMove(queued);
  }

  private undo() {
    if (this.busy || this.ended || this.picker || this.history.length === 0) {
      if (!this.busy && this.history.length === 0) this.showBlocked("还没有可以撤销的移动");
      return;
    }
    const snapshot = this.history.pop();
    if (!snapshot) return;
    this.busy = true;
    this.player = clonePoint(snapshot.player);
    this.boxes = clonePoints(snapshot.boxes);
    this.moves = snapshot.moves;
    this.pushes = snapshot.pushes;
    this.updateStats();
    const targets: Phaser.GameObjects.Image[] = [this.playerSprite, ...this.boxSprites];
    const destinations = [this.player, ...this.boxes].map((point) => this.cellCenter(point));
    targets.forEach((target, index) => {
      this.tweens.killTweensOf(target);
      if (target !== this.playerSprite) {
        target.setScale(this.boxBaseScale.x, this.boxBaseScale.y);
      }
      this.tweens.add({
        targets: target,
        x: destinations[index].x,
        y: destinations[index].y,
        angle: 0,
        duration: 140,
        ease: "Cubic.Out",
      });
    });
    this.time.delayedCall(150, () => {
      this.busy = false;
      this.refreshCrateTargets(false);
      this.statusText.setText("已撤销上一步");
    });
  }

  private refreshCrateTargets(animate: boolean) {
    this.boxSprites.forEach((sprite, index) => {
      this.tweens.killTweensOf(sprite);
      sprite
        .setScale(this.boxBaseScale.x, this.boxBaseScale.y)
        .setAngle(0);
      const onTarget = this.targets.has(pointKey(this.boxes[index]));
      if (onTarget) {
        sprite.setTint(0xffe5a3);
        if (animate) {
          this.tweens.add({
            targets: sprite,
            scaleX: this.boxBaseScale.x * 1.08,
            scaleY: this.boxBaseScale.y * 1.08,
            duration: 110,
            yoyo: true,
            ease: "Back.Out",
            onComplete: () => {
              sprite.setScale(this.boxBaseScale.x, this.boxBaseScale.y);
            },
          });
        }
      } else {
        sprite.clearTint();
      }
    });
  }

  private createLandingRipple(position: Phaser.Math.Vector2) {
    const ring = this.add.circle(position.x, position.y, this.tileSize * 0.18)
      .setStrokeStyle(2, 0xe9b957, 0.7)
      .setDepth(6);
    this.tweens.add({
      targets: ring,
      scale: 2.2,
      alpha: 0,
      duration: 250,
      ease: "Sine.Out",
      onComplete: () => ring.destroy(),
    });
  }

  private showBlocked(message: string) {
    this.statusText.setText(message).setColor("#e9b957");
    const originX = this.playerSprite.x;
    this.tweens.add({
      targets: this.playerSprite,
      x: { from: originX - 3, to: originX + 3 },
      duration: 42,
      yoyo: true,
      repeat: 2,
      onComplete: () => this.playerSprite.setX(originX),
    });
    this.time.delayedCall(850, () => {
      if (!this.ended) this.statusText.setText("滑动棋盘，或使用方向键移动").setColor("#b6cad0");
    });
  }

  private completeLevel() {
    this.ended = true;
    const save = this.storage.load();
    const key = String(this.level.id);
    const previousBest = save.bestMoves[key] ?? 0;
    const isRecord = previousBest === 0 || this.moves < previousBest;
    if (isRecord) save.bestMoves[key] = this.moves;
    save.lastLevel = Math.min(this.levelIndex + 1, LEVELS.length - 1);
    this.storage.save(save);
    this.bestText.setText(String(save.bestMoves[key]).padStart(2, "0"));
    this.progressText.setText(
      `${Object.values(save.bestMoves).filter((value) => value > 0).length}/${LEVELS.length}`,
    );
    const score = Math.max(100, 1200 + this.levelIndex * 80 - this.moves * 8);
    this.bridge.score(score);
    this.bridge.gameOver(score);
    this.statusText.setText("全部入库，任务完成！").setColor("#e9b957");
    this.createCelebration();
    this.time.delayedCall(320, () => this.showCompleteOverlay(isRecord));
  }

  private createCelebration() {
    for (let index = 0; index < 22; index += 1) {
      const color = index % 3 === 0 ? 0xe9b957 : index % 3 === 1 ? 0x70d2df : 0xf4fbfa;
      const particle = this.add.rectangle(
        WIDTH / 2 + Phaser.Math.Between(-45, 45),
        510,
        4,
        9,
        color,
      ).setDepth(90).setAngle(Phaser.Math.Between(-45, 45));
      this.tweens.add({
        targets: particle,
        x: particle.x + Phaser.Math.Between(-145, 145),
        y: particle.y + Phaser.Math.Between(-180, -40),
        angle: particle.angle + Phaser.Math.Between(120, 420),
        alpha: 0,
        duration: Phaser.Math.Between(650, 1050),
        ease: "Quad.Out",
        onComplete: () => particle.destroy(),
      });
    }
  }

  private showCompleteOverlay(isRecord: boolean) {
    const nextIndex = Math.min(this.levelIndex + 1, LEVELS.length - 1);
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x061015, 0.84)
      .setDepth(100)
      .setInteractive();
    const panel = this.add.rectangle(WIDTH / 2, 430, 324, 300, 0x112630)
      .setStrokeStyle(2, 0xe9b957)
      .setDepth(101);
    const badge = this.add.circle(WIDTH / 2, 333, 31, 0xe9b957)
      .setStrokeStyle(2, 0xffe4a9)
      .setDepth(102);
    this.add.text(WIDTH / 2, 333, "✓", {
      fontFamily: "sans-serif",
      fontSize: "31px",
      color: "#10212a",
      fontStyle: "bold",
    }).setOrigin(0.5).setDepth(103);
    this.add.text(WIDTH / 2, 382, "货物全部入库", {
      fontFamily: "sans-serif",
      fontSize: "26px",
      color: "#f4fbfa",
      fontStyle: "bold",
    }).setOrigin(0.5).setDepth(102);
    this.add.text(WIDTH / 2, 420, `${this.moves} 步 · 推动 ${this.pushes} 次`, {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#9cb3ba",
    }).setOrigin(0.5).setDepth(102);
    this.add.text(WIDTH / 2, 450, isRecord ? "NEW BEST  新纪录" : "任务完成", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#e9b957",
      letterSpacing: 1,
      fontStyle: "bold",
    }).setOrigin(0.5).setDepth(102);
    const buttonLabel = this.levelIndex === LEVELS.length - 1 ? "再玩一次  ↗" : "下一关  →";
    const button = this.add.rectangle(WIDTH / 2, 518, 226, 52, 0xe9b957)
      .setDepth(102)
      .setInteractive({ cursor: "pointer" });
    this.add.text(WIDTH / 2, 518, buttonLabel, {
      fontFamily: "sans-serif",
      fontSize: "15px",
      color: "#10212a",
      fontStyle: "bold",
    }).setOrigin(0.5).setDepth(103);
    button.on("pointerup", () => this.scene.restart({ levelIndex: nextIndex }));
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({
      targets: [shade, panel, badge, button],
      alpha: { from: 0, to: 1 },
      duration: 230,
      ease: "Sine.Out",
    });
  }

  private showLevelPicker() {
    if (this.busy || this.picker) return;
    const save = this.storage.load();
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x061015, 0.9)
      .setInteractive();
    const panel = this.add.rectangle(WIDTH / 2, 421, 350, 620, 0x112630)
      .setStrokeStyle(1.5, 0x52717b);
    const title = this.add.text(40, 132, "选择关卡", {
      fontFamily: "sans-serif",
      fontSize: "27px",
      color: "#f4fbfa",
      fontStyle: "bold",
    });
    const count = Object.values(save.bestMoves).filter((value) => value > 0).length;
    const summary = this.add.text(WIDTH - 40, 142, `已完成 ${count}/${LEVELS.length}`, {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#e9b957",
    }).setOrigin(1, 0);
    const objects: Phaser.GameObjects.GameObject[] = [shade, panel, title, summary];

    LEVELS.forEach((level, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const x = 66 + column * 86;
      const y = 211 + row * 66;
      const completed = Boolean(save.bestMoves[String(level.id)]);
      const active = index === this.levelIndex;
      const tile = this.add.rectangle(
        x,
        y,
        70,
        52,
        active ? 0xe9b957 : completed ? 0x20434a : 0x17323b,
      ).setStrokeStyle(1.5, active ? 0xffe4a9 : completed ? 0x70d2df : 0x3f5c66)
        .setInteractive({ cursor: "pointer" });
      const number = this.add.text(x, y - 7, String(level.id).padStart(2, "0"), {
        fontFamily: "monospace",
        fontSize: "15px",
        color: active ? "#10212a" : "#f4fbfa",
        fontStyle: "bold",
      }).setOrigin(0.5);
      const mark = this.add.text(x, y + 13, completed ? `✓ ${save.bestMoves[String(level.id)]}步` : level.difficulty, {
        fontFamily: "sans-serif",
        fontSize: "8px",
        color: active ? "#31454c" : completed ? "#8ae0e8" : "#78909a",
      }).setOrigin(0.5);
      tile.on("pointerup", () => this.scene.restart({ levelIndex: index }));
      objects.push(tile, number, mark);
    });

    const close = this.add.rectangle(WIDTH / 2, 657, 220, 45, 0x17323b)
      .setStrokeStyle(1, 0x52717b)
      .setInteractive({ cursor: "pointer" });
    const closeText = this.add.text(WIDTH / 2, 657, "返回游戏", {
      fontFamily: "sans-serif",
      fontSize: "13px",
      color: "#f4fbfa",
      fontStyle: "bold",
    }).setOrigin(0.5);
    objects.push(close, closeText);
    this.picker = this.add.container(0, 0, objects).setDepth(110);
    close.on("pointerup", () => this.closeLevelPicker());
    shade.on("pointerup", () => this.closeLevelPicker());
    this.picker.setAlpha(0).setScale(0.975);
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
    if (this.busy) return;
    const next = Phaser.Math.Clamp(this.levelIndex + offset, 0, LEVELS.length - 1);
    if (next !== this.levelIndex) this.scene.restart({ levelIndex: next });
  }

  private updateStats() {
    this.movesText.setText(String(this.moves).padStart(2, "0"));
    this.pushesText.setText(String(this.pushes).padStart(2, "0"));
  }

  private cellCenter(point: Point) {
    return new Phaser.Math.Vector2(
      this.boardLeft + (point.x + 0.5) * this.tileSize,
      this.boardTop + (point.y + 0.5) * this.tileSize,
    );
  }

  private makeDirectionButton(x: number, y: number, label: string, direction: Direction) {
    const button = this.add.rectangle(x, y, 64, 58, 0x17323b)
      .setStrokeStyle(2, 0x6b909b)
      .setInteractive({ cursor: "pointer" });
    this.add.text(x, y, label, {
      fontFamily: "sans-serif",
      fontSize: "19px",
      color: "#d7e9eb",
      fontStyle: "bold",
    }).setOrigin(0.5);
    button.on("pointerdown", () => {
      button.setFillStyle(0xe9b957).setStrokeStyle(2, 0xffe4a9);
    });
    button.on("pointerout", () => {
      button.setFillStyle(0x17323b).setStrokeStyle(2, 0x6b909b);
    });
    button.on("pointerup", () => {
      button.setFillStyle(0x17323b).setStrokeStyle(2, 0x6b909b);
      this.tryMove(direction);
    });
  }

  private makeTextButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onPress: () => void,
  ) {
    const button = this.add.rectangle(x, y, width, height, 0x17323b)
      .setStrokeStyle(1, 0x52717b)
      .setInteractive({ cursor: "pointer" });
    this.add.text(x, y, label, {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#d7e9eb",
      fontStyle: "bold",
    }).setOrigin(0.5);
    button.on("pointerup", onPress);
  }

  private makeSmallButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onPress: () => void,
  ) {
    const button = this.add.rectangle(x, y, width, height, 0x17323b)
      .setStrokeStyle(1, 0x52717b)
      .setInteractive({ cursor: "pointer" });
    this.add.text(x, y - 1, label, {
      fontFamily: "sans-serif",
      fontSize: "25px",
      color: "#d7e9eb",
    }).setOrigin(0.5);
    button.on("pointerup", onPress);
  }

  private statValueStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: "monospace",
      fontSize: "20px",
      color: "#f4fbfa",
      fontStyle: "bold",
    };
  }

  private statLabelStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: "sans-serif",
      fontSize: "9px",
      color: "#78909a",
    };
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#0b1720",
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
  scene: SokobanScene,
});
