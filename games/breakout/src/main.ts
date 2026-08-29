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
const INK = "#f3f0e8";
const BRICK_COLS = 7;
const BRICK_WIDTH = 48;
const BRICK_HEIGHT = 18;
const BRICK_GAP = 4;
const BRICK_TOP = 208;
const BRICK_ROW_STEP = BRICK_HEIGHT + 6;
const MAX_ROWS = 7;
const PADDLE_WIDTH = 78;
const PADDLE_HEIGHT = 14;
const PADDLE_Y = 782;
const BALL_RADIUS = 7;
const BASE_SPEED = 300;
const MAX_SPEED = 560;
const WALL_MARGIN = 10;

const ROW_COLORS = [0xdfff3f, 0x5c7cff, 0x9b6bff, 0xffc24b, 0xff9f43, 0xff6a51, 0xf3f0e8];

interface Brick {
  rect: Phaser.GameObjects.Rectangle;
  alive: boolean;
  x: number;
  y: number;
}

class BreakoutScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private paddle!: Phaser.GameObjects.Rectangle;
  private ball!: Phaser.GameObjects.Arc;
  private bricks: Brick[] = [];
  private paddleX = CENTER_X;
  private ballX = CENTER_X;
  private ballY = PADDLE_Y - PADDLE_HEIGHT / 2 - BALL_RADIUS - 2;
  private velocityX = 0;
  private velocityY = 0;
  private speed = BASE_SPEED;
  private stuck = true;
  private ended = false;
  private level = 1;
  private score = 0;
  private lives = 3;
  private started = false;
  private bridge = createGameBridge({ gameId: "breakout", version: "1.0.0" });
  private storage = createGameStorage("breakout", { highScore: 0 });

  constructor() { super("breakout"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 40, 40, 0x101114, 1, 0x2b2d32, .35);
    this.add.rectangle(WIDTH / 2, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "BRICK / 014", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "打砖块", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);

    this.scoreText = this.add.text(22, 76, "0000", {
      fontFamily: "monospace", fontSize: "42px", color: INK, fontStyle: "bold",
    });
    const saved = this.storage.load();
    this.add.text(WIDTH - 22, 87, `BEST  ${String(saved.highScore).padStart(4, "0")}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.livesText = this.add.text(WIDTH - 22, 112, "● ● ●", {
      fontFamily: "monospace", fontSize: "12px", color: "#ff6a51", letterSpacing: 5,
    }).setOrigin(1, 0);
    this.levelText = this.add.text(WIDTH - 22, 76, "LV 01", {
      fontFamily: "monospace", fontSize: "13px", color: "#dfff3f", letterSpacing: 1,
    }).setOrigin(1, 0);

    this.add.rectangle(CENTER_X, 560, WIDTH - 2 * WALL_MARGIN, 1, 0xf3f0e8, .1);

    this.hintText = this.add.text(CENTER_X, 730, "左右拖动挡板 · 点击屏幕发射", {
      fontFamily: "sans-serif", fontSize: "15px", color: INK, fontStyle: "bold",
    }).setOrigin(.5);
    this.add.text(CENTER_X, 756, "球掉落底部会失去一次机会", {
      fontFamily: "sans-serif", fontSize: "11px", color: "#8f918a",
    }).setOrigin(.5);

    this.paddle = this.add.rectangle(this.paddleX, PADDLE_Y, PADDLE_WIDTH, PADDLE_HEIGHT, 0xf3f0e8)
      .setStrokeStyle(1, 0x101114, .5);
    this.ball = this.add.circle(this.ballX, this.ballY, BALL_RADIUS, 0xdfff3f)
      .setStrokeStyle(1, 0x101114, .6);

    this.bindInput();
    bindGameLifecycle(this);

    this.buildBricks();
    this.refreshHud();
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.bricks = [];
    this.paddleX = CENTER_X;
    this.speed = BASE_SPEED;
    this.stuck = true;
    this.ended = false;
    this.level = 1;
    this.score = 0;
    this.lives = 3;
    this.started = false;
    this.velocityX = 0;
    this.velocityY = 0;
  }

  private bindInput() {
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.ended) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const half = PADDLE_WIDTH / 2;
      this.paddleX = Phaser.Math.Clamp(position.x, WALL_MARGIN + half, WIDTH - WALL_MARGIN - half);
    });
    this.input.on("pointerup", () => {
      if (this.ended) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
      }
      if (this.stuck) this.launch();
    });
  }

  private buildBricks() {
    for (const brick of this.bricks) brick.rect.destroy();
    this.bricks = [];
    const rows = Math.min(3 + this.level, MAX_ROWS);
    const gridWidth = BRICK_COLS * BRICK_WIDTH + (BRICK_COLS - 1) * BRICK_GAP;
    const startX = CENTER_X - gridWidth / 2 + BRICK_WIDTH / 2;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < BRICK_COLS; col += 1) {
        const x = startX + col * (BRICK_WIDTH + BRICK_GAP);
        const y = BRICK_TOP + row * BRICK_ROW_STEP;
        const rect = this.add.rectangle(x, y, BRICK_WIDTH, BRICK_HEIGHT, ROW_COLORS[row % ROW_COLORS.length])
          .setStrokeStyle(1, 0x101114, .4);
        this.bricks.push({ rect, alive: true, x, y });
      }
    }
  }

  private refreshHud() {
    this.scoreText.setText(String(this.score).padStart(4, "0"));
    this.levelText.setText(`LV ${String(this.level).padStart(2, "0")}`);
    this.livesText.setText("● ● ●".slice(0, Math.max(this.lives, 0) * 2).trim() || "—");
  }

  private launch() {
    if (!this.stuck || this.ended) return;
    this.stuck = false;
    this.hintText.setText("接住它！").setColor("#dfff3f");
    const angle = Phaser.Math.FloatBetween(-.55, .55) - Math.PI / 2;
    this.velocityX = Math.cos(angle) * this.speed;
    this.velocityY = Math.sin(angle) * this.speed;
  }

  private resetBall() {
    this.stuck = true;
    this.velocityX = 0;
    this.velocityY = 0;
    this.ballX = this.paddleX;
    this.ballY = PADDLE_Y - PADDLE_HEIGHT / 2 - BALL_RADIUS - 2;
    this.ball.setPosition(this.ballX, this.ballY);
    this.hintText.setText("点击屏幕发射").setColor(INK);
  }

  update(_time: number, delta: number) {
    if (this.ended) return;
    this.paddle.x = this.paddleX;
    if (this.stuck) {
      this.ballX = this.paddleX;
      this.ballY = PADDLE_Y - PADDLE_HEIGHT / 2 - BALL_RADIUS - 2;
      this.ball.setPosition(this.ballX, this.ballY);
      return;
    }

    const seconds = Math.min(delta, 34) / 1000;
    const steps = 2;
    for (let step = 0; step < steps; step += 1) {
      this.ballX += (this.velocityX * seconds) / steps;
      this.ballY += (this.velocityY * seconds) / steps;
      this.resolveWalls();
      if (this.ended) return;
      this.resolvePaddle();
      this.resolveBricks();
      if (this.ended) return;
    }
    if (Math.abs(this.velocityY) < 60) {
      this.velocityY = 60 * (this.velocityY >= 0 ? 1 : -1);
    }
    this.ball.setPosition(this.ballX, this.ballY);
  }

  private resolveWalls() {
    const left = WALL_MARGIN + BALL_RADIUS;
    const right = WIDTH - WALL_MARGIN - BALL_RADIUS;
    if (this.ballX < left) {
      this.ballX = left;
      this.velocityX = Math.abs(this.velocityX);
    } else if (this.ballX > right) {
      this.ballX = right;
      this.velocityX = -Math.abs(this.velocityX);
    }
    const top = 150 + BALL_RADIUS;
    if (this.ballY < top) {
      this.ballY = top;
      this.velocityY = Math.abs(this.velocityY);
    }
    if (this.ballY - BALL_RADIUS > HEIGHT) this.loseBall();
  }

  private resolvePaddle() {
    if (this.velocityY <= 0) return;
    const paddleTop = PADDLE_Y - PADDLE_HEIGHT / 2;
    const half = PADDLE_WIDTH / 2;
    if (this.ballY + BALL_RADIUS < paddleTop || this.ballY > PADDLE_Y + PADDLE_HEIGHT) return;
    if (this.ballX < this.paddleX - half - BALL_RADIUS || this.ballX > this.paddleX + half + BALL_RADIUS) return;

    this.ballY = paddleTop - BALL_RADIUS;
    this.speed = Math.min(this.speed + 3, MAX_SPEED);
    const offset = Phaser.Math.Clamp((this.ballX - this.paddleX) / half, -1, 1);
    const angle = offset * (Math.PI / 3) - Math.PI / 2;
    this.velocityX = Math.cos(angle) * this.speed;
    this.velocityY = Math.sin(angle) * this.speed;
    if (Math.abs(this.velocityY) < this.speed * .35) {
      this.velocityY = -this.speed * .35;
      const remain = Math.sqrt(Math.max(this.speed * this.speed - this.velocityY * this.velocityY, 0));
      this.velocityX = Math.sign(this.velocityX || 1) * remain;
    }
  }

  private resolveBricks() {
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      const halfW = BRICK_WIDTH / 2 + BALL_RADIUS;
      const halfH = BRICK_HEIGHT / 2 + BALL_RADIUS;
      const dx = this.ballX - brick.x;
      const dy = this.ballY - brick.y;
      if (Math.abs(dx) >= halfW || Math.abs(dy) >= halfH) continue;

      brick.alive = false;
      brick.rect.destroy();
      this.score += 10;
      this.speed = Math.min(this.speed + 1.5, MAX_SPEED);
      this.refreshHud();
      this.bridge.score(this.score);

      const overlapX = halfW - Math.abs(dx);
      const overlapY = halfH - Math.abs(dy);
      if (overlapX < overlapY) {
        this.velocityX = Math.sign(dx) * Math.abs(this.velocityX);
        this.ballX += Math.sign(dx) * overlapX;
      } else {
        this.velocityY = Math.sign(dy) * Math.abs(this.velocityY);
        this.ballY += Math.sign(dy) * overlapY;
      }
      if (this.bricks.every((item) => !item.alive)) this.completeLevel();
      return;
    }
  }

  private loseBall() {
    this.lives -= 1;
    this.refreshHud();
    this.cameras.main.flash(140, 255, 106, 81, false);
    if (this.lives <= 0) {
      this.endRun();
      return;
    }
    this.resetBall();
  }

  private completeLevel() {
    this.score += 100;
    this.refreshHud();
    this.bridge.score(this.score);
    this.cameras.main.flash(200, 223, 255, 63, false);
    this.hintText.setText(`LV ${this.level} CLEAR +100`).setColor("#dfff3f");
    this.stuck = true;
    this.velocityX = 0;
    this.velocityY = 0;
    this.level += 1;
    this.speed = Math.min(BASE_SPEED * (1 + (this.level - 1) * .07), MAX_SPEED);
    const saved = this.storage.load();
    this.storage.save({ highScore: Math.max(saved.highScore, this.score) });
    this.time.delayedCall(820, () => {
      if (this.ended) return;
      this.buildBricks();
      this.resetBall();
    });
  }

  private endRun() {
    this.ended = true;
    this.cameras.main.shake(220, .012);
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    const bestText = this.children.getByName("best-score") as Phaser.GameObjects.Text | null;
    bestText?.setText(`BEST  ${String(highScore).padStart(4, "0")}`);
    this.bridge.gameOver(this.score);

    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .55)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(WIDTH / 2, 560, 308, 178, 0x1b1d21)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(WIDTH / 2, 528, "球用完了", {
      fontFamily: "sans-serif", fontSize: "24px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(WIDTH / 2, 568, `LV ${this.level}  ·  ${this.score} 分  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(WIDTH / 2, 610, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(WIDTH / 2, 610, "再战一局  ↻", {
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
  scene: BreakoutScene,
});
