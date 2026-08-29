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
const BOARD_TOP = 150;
const BOARD_BOTTOM = 700;
const SWIPE_MIN = 24;
const WALK_SPEED = 4.6;

const DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

interface StarItem {
  tx: number;
  ty: number;
  sprite: Phaser.GameObjects.Image;
  taken: boolean;
}

function mazeSize(level: number) {
  return Math.min(10, 5 + Math.floor(level / 2));
}

class MazeRunScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private starText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private boardGraphics?: Phaser.GameObjects.Graphics;
  private walls: boolean[][] = [];
  private floorTiles: Array<{ tx: number; ty: number }> = [];
  private stars: StarItem[] = [];
  private exitTile = { tx: 1, ty: 1 };
  private player!: Phaser.GameObjects.Container;
  private playerTx = 1;
  private playerTy = 1;
  private direction = { dx: 0, dy: 0 };
  private move?: { fromX: number; fromY: number; toX: number; toY: number; t: number };
  private tile = 26;
  private boardX = 0;
  private boardY = 0;
  private level = 1;
  private collected = 0;
  private totalStars = 0;
  private started = false;
  private ended = false;
  private swipeStart?: Phaser.Math.Vector2;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "maze-run", version: "1.0.0" });
  private storage = createGameStorage("maze-run", { highLevel: 1 });

  constructor() { super("maze-run"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "MAZE / 035", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "迷宫寻宝", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 70, "第 1 层", {
      fontFamily: "sans-serif", fontSize: "21px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.starText = this.add.text(WIDTH - 22, 78, "★ 0 / 0", {
      fontFamily: "monospace", fontSize: "13px", color: "#ffd44d", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.hintText = this.add.text(CENTER_X, 726, "滑动改变方向 · 自动奔跑 · 收集星星找到出口", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#8f918a",
    }).setOrigin(.5);

    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.level = this.storage.load().highLevel;
    this.loadLevel(this.level);
    this.bindInput();
    if (!this.textures.exists("maze-star")) {
      const g = this.add.graphics();
      g.fillStyle(0xffd44d, 1);
      g.beginPath();
      for (let spike = 0; spike <= 10; spike += 1) {
        const angle = -Math.PI / 2 + (spike * Math.PI) / 5;
        const radius = spike % 2 === 0 ? 9 : 4;
        const px = 12 + Math.cos(angle) * radius;
        const py = 12 + Math.sin(angle) * radius;
        if (spike === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillPath();
      g.lineStyle(1, 0x101114, .5);
      g.strokePath();
      g.generateTexture("maze-star", 24, 24);
      g.destroy();
    }
    this.level = this.storage.load().highLevel;
    this.loadLevel(this.level);
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private loadLevel(level: number) {
    this.level = level;
    this.collected = 0;
    this.direction = { dx: 0, dy: 0 };
    this.move = undefined;
    this.boardGraphics?.destroy();
    for (const star of this.stars) star.sprite.destroy();
    this.stars = [];
    this.levelText.setText(`第 ${level} 层`);

    const cells = mazeSize(level);
    const tileCount = cells * 2 + 1;
    this.tile = Math.floor(Math.min(WIDTH - 24, BOARD_BOTTOM - BOARD_TOP) / tileCount);
    this.boardX = CENTER_X - (tileCount * this.tile) / 2;
    this.boardY = BOARD_TOP + ((BOARD_BOTTOM - BOARD_TOP) - tileCount * this.tile) / 2;

    const walls = Array.from({ length: tileCount }, () => Array<boolean>(tileCount).fill(true));
    const cellVisited = Array.from({ length: cells }, () => Array<boolean>(cells).fill(false));
    const stack: Array<{ cx: number; cy: number }> = [{ cx: 0, cy: cells - 1 }];
    cellVisited[cells - 1][0] = true;
    walls[1][1] = false;
    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const options = Phaser.Utils.Array.Shuffle(DIRECTIONS.slice()).filter(({ dx, dy }) => {
        const nc = current.cx + dx;
        const nr = current.cy + dy;
        return nc >= 0 && nc < cells && nr >= 0 && nr < cells && !cellVisited[nr][nc];
      });
      if (options.length === 0) {
        stack.pop();
        continue;
      }
      const step = options[0];
      const next = { cx: current.cx + step.dx, cy: current.cy + step.dy };
      walls[current.cy * 2 + 1 + step.dy][current.cx * 2 + 1 + step.dx] = false;
      walls[next.cy * 2 + 1][next.cx * 2 + 1] = false;
      cellVisited[next.cy][next.cx] = true;
      stack.push(next);
    }
    this.walls = walls;

    this.floorTiles = [];
    for (let ty = 0; ty < tileCount; ty += 1) {
      for (let tx = 0; tx < tileCount; tx += 1) {
        if (!walls[ty][tx]) this.floorTiles.push({ tx, ty });
      }
    }

    const bfsDistance = new Map<string, number>();
    const queue = [{ tx: 1, ty: tileCount - 2, distance: 0 }];
    bfsDistance.set(`1,${tileCount - 2}`, 0);
    while (queue.length > 0) {
      const current = queue.shift() as { tx: number; ty: number; distance: number };
      for (const { dx, dy } of DIRECTIONS) {
        const nx = current.tx + dx;
        const ny = current.ty + dy;
        const cellKey = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= tileCount || ny >= tileCount) continue;
        if (walls[ny][nx] || bfsDistance.has(cellKey)) continue;
        bfsDistance.set(cellKey, current.distance + 1);
        queue.push({ tx: nx, ty: ny, distance: current.distance + 1 });
      }
    }
    let exitKey = `1,${tileCount - 2}`;
    let exitDistance = -1;
    for (const [cellKey, distance] of bfsDistance) {
      if (distance > exitDistance) {
        exitDistance = distance;
        exitKey = cellKey;
      }
    }
    const [exitX, exitY] = exitKey.split(",").map(Number);
    this.exitTile = { tx: exitX, ty: exitY };

    this.floorTiles = this.floorTiles.filter((tilePos) =>
      !(tilePos.tx === 1 && tilePos.ty === tileCount - 2) && !(tilePos.tx === exitX && tilePos.ty === exitY));
    const deadEnds = this.floorTiles.filter((tilePos) => {
      let open = 0;
      for (const { dx, dy } of DIRECTIONS) {
        if (!walls[tilePos.ty + dy][tilePos.tx + dx]) open += 1;
      }
      return open === 1;
    });
    Phaser.Utils.Array.Shuffle(deadEnds);
    const starCount = Math.min(6, Math.max(3, deadEnds.length));
    this.stars = [];
    for (let index = 0; index < starCount && index < deadEnds.length; index += 1) {
      const spot = deadEnds[index];
      const sprite = this.add.image(
        this.boardX + spot.tx * this.tile + this.tile / 2,
        this.boardY + spot.ty * this.tile + this.tile / 2,
        "maze-star",
      ).setDepth(4);
      this.tweens.add({ targets: sprite, angle: 360, duration: 2600, repeat: -1 });
      this.stars.push({ tx: spot.tx, ty: spot.ty, sprite, taken: false });
    }
    this.totalStars = this.stars.length;
    this.starText.setText(`★ 0 / ${this.totalStars}`);

    const g = this.add.graphics();
    this.boardGraphics = g;
    g.fillStyle(0x1b1d21, 1);
    for (let ty = 0; ty < tileCount; ty += 1) {
      for (let tx = 0; tx < tileCount; tx += 1) {
        if (walls[ty][tx]) {
          g.fillRect(this.boardX + tx * this.tile, this.boardY + ty * this.tile, this.tile, this.tile);
        }
      }
    }
    g.fillStyle(0x2f5d33, 1);
    g.fillRect(this.boardX + exitX * this.tile + 4, this.boardY + exitY * this.tile + 4, this.tile - 8, this.tile - 8);
    g.lineStyle(2, 0xdfff3f, .9);
    g.strokeRect(this.boardX + exitX * this.tile + 4, this.boardY + exitY * this.tile + 4, this.tile - 8, this.tile - 8);

    this.playerTx = 1;
    this.playerTy = tileCount - 2;
    this.player?.destroy();
    this.player = this.add.container(
      this.boardX + this.playerTx * this.tile + this.tile / 2,
      this.boardY + this.playerTy * this.tile + this.tile / 2,
      [
        this.add.circle(0, 0, this.tile * .3, 0x54e0ff).setStrokeStyle(2, 0x101114, .7),
        this.add.circle(-2.5, -2, 1.6, 0x101114),
        this.add.circle(2.5, -2, 1.6, 0x101114),
      ],
    ).setDepth(6);
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.swipeStart = new Phaser.Math.Vector2(position.x, position.y);
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (this.ended) return;
      const start = this.swipeStart;
      this.swipeStart = undefined;
      if (!start) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const deltaX = position.x - start.x;
      const deltaY = position.y - start.y;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_MIN) return;
      const direction = Math.abs(deltaX) > Math.abs(deltaY)
        ? { dx: Math.sign(deltaX), dy: 0 }
        : { dx: 0, dy: Math.sign(deltaY) };
      this.setDirection(direction);
    });
  }

  private isFloor(tx: number, ty: number) {
    return ty >= 0 && ty < this.walls.length && tx >= 0 && tx < this.walls.length && !this.walls[ty][tx];
  }

  private setDirection(direction: { dx: number; dy: number }) {
    this.direction = direction;
    if (!this.move) this.tryContinue();
  }

  private tryContinue() {
    if (this.move || this.ended) return;
    const nextX = this.playerTx + this.direction.dx;
    const nextY = this.playerTy + this.direction.dy;
    if (!this.isFloor(nextX, nextY)) return;
    this.move = {
      fromX: this.boardX + this.playerTx * this.tile + this.tile / 2,
      fromY: this.boardY + this.playerTy * this.tile + this.tile / 2,
      toX: this.boardX + nextX * this.tile + this.tile / 2,
      toY: this.boardY + nextY * this.tile + this.tile / 2,
      t: 0,
    };
  }

  update(_time: number, delta: number) {
    if (this.ended) return;
    const move = this.move;
    if (!move) return;
    move.t += WALK_SPEED * Math.min(delta, 40) / 1000;
    const p = Math.min(1, move.t);
    this.player.setPosition(
      Phaser.Math.Linear(move.fromX, move.toX, p),
      Phaser.Math.Linear(move.fromY, move.toY, p),
    );
    if (p < 1) return;
    this.move = undefined;
    this.playerTx += this.direction.dx;
    this.playerTy += this.direction.dy;

    for (const star of this.stars) {
      if (!star.taken && star.tx === this.playerTx && star.ty === this.playerTy) {
        star.taken = true;
        star.sprite.destroy();
        this.collected += 1;
        this.starText.setText(`★ ${this.collected} / ${this.totalStars}`);
        this.audio.tone({ freq: 700, duration: .09, type: "triangle", gain: .16 });
      }
    }

    if (this.playerTx === this.exitTile.tx && this.playerTy === this.exitTile.ty) {
      this.completeLevel();
      return;
    }
    this.tryContinue();
  }

  private completeLevel() {
    const perfect = this.collected === this.totalStars && this.totalStars > 0;
    if (perfect) {
      this.audio.tone({ freq: 660, duration: .16, type: "triangle", gain: .2 });
    } else {
      this.audio.tone({ freq: 440, duration: .14, type: "triangle", gain: .16 });
    }
    this.bridge.gameOver(this.collected);
    this.storage.save({ highLevel: this.level + 1 });
    this.levelText.setText(`第 ${this.level + 1} 层`);
    const banner = this.add.text(CENTER_X, HEIGHT / 2 - 30,
      perfect ? "完美通关 +★" : "找到出口！", {
        fontFamily: "sans-serif", fontSize: "30px",
        color: perfect ? "#ffd44d" : "#dfff3f",
        fontStyle: "bold", letterSpacing: 6,
      }).setOrigin(.5).setDepth(20).setAlpha(0);
    this.tweens.add({
      targets: banner,
      alpha: 1,
      scale: { from: .75, to: 1 },
      duration: 240,
      ease: "Back.easeOut",
      onComplete: () => {
        this.tweens.add({
          targets: banner,
          alpha: 0,
          delay: 700,
          duration: 280,
          onComplete: () => this.loadLevel(this.level + 1),
        });
      },
    });
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
  scene: MazeRunScene,
});
