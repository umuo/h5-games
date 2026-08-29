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
const TABLE_X = 35;
const TABLE_Y = 150;
const TABLE_W = 320;
const TABLE_H = 545;
const FRICTION = 0.9885;
const STOP_SPEED = 5;
const POCKET_RADIUS = 15;

const POCKETS: Array<{ x: number; y: number }> = [
  { x: TABLE_X + 8, y: TABLE_Y + 8 },
  { x: TABLE_X + TABLE_W - 8, y: TABLE_Y + 8 },
  { x: TABLE_X + 8, y: TABLE_Y + TABLE_H - 8 },
  { x: TABLE_X + TABLE_W - 8, y: TABLE_Y + TABLE_H - 8 },
  { x: TABLE_X + 2, y: TABLE_Y + TABLE_H / 2 },
  { x: TABLE_X + TABLE_W - 2, y: TABLE_Y + TABLE_H / 2 },
];

const BALL_COLORS = [0xff5f6d, 0x54e0ff, 0x9fe08a, 0xffd44d, 0x9b6bff, 0xffa63d];

interface Ball {
  circle: Phaser.GameObjects.Arc;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isCue: boolean;
}

class MiniBilliardsScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private shotsText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private tableGraphics!: Phaser.GameObjects.Graphics;
  private aimGraphics!: Phaser.GameObjects.Graphics;
  private balls: Ball[] = [];
  private aiming = false;
  private aimX = 0;
  private aimY = 0;
  private level = 1;
  private shots = 0;
  private score = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "mini-billiards", version: "1.0.0" });
  private storage = createGameStorage("mini-billiards", { bestScore: 0 });

  constructor() { super("mini-billiards"); }

  create() {
    this.level = 1;
    this.score = 0;
    this.started = false;
    this.ended = false;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "BILLIARD / 060", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "桌上台球", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(22, 68, "0", {
      fontFamily: "monospace", fontSize: "26px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.levelText = this.add.text(CENTER_X, 72, "第 1 关", {
      fontFamily: "sans-serif", fontSize: "21px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.shotsText = this.add.text(CENTER_X, 76, "已击 0 杆", {
      fontFamily: "monospace", fontSize: "12px", color: "#dfff3f", letterSpacing: 1,
    }).setOrigin(.5, 0);
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 22, 82, `BEST ${saved.bestScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.hintText = this.add.text(CENTER_X, 730, "从白球往后拖动瞄准 · 松手出杆", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    const table = this.add.graphics().setDepth(1);
    table.fillStyle(0x0f5132, 1);
    table.fillRoundedRect(TABLE_X - 8, TABLE_Y - 8, TABLE_W + 16, TABLE_H + 16, 12);
    table.fillStyle(0x15803d, 1);
    table.fillRect(TABLE_X, TABLE_Y, TABLE_W, TABLE_H);
    table.lineStyle(2, 0x101114, .6);
    table.strokeRect(TABLE_X, TABLE_Y, TABLE_W, TABLE_H);
    for (const pocket of POCKETS) {
      table.fillStyle(0x101114, 1);
      table.fillCircle(pocket.x, pocket.y, POCKET_RADIUS);
      table.lineStyle(2.5, 0xc9a34d, 1);
      table.strokeCircle(pocket.x, pocket.y, POCKET_RADIUS);
    }

    this.tableGraphics = this.add.graphics().setDepth(4);
    this.aimGraphics = this.add.graphics().setDepth(5);

    this.rackBalls();
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.balls = [];
    this.aiming = false;
    this.shots = 0;
    this.ended = false;
  }

  private rackBalls() {
    this.resetRun();
    this.levelText.setText(`第 ${this.level} 关`);
    this.shotsText.setText(`已击 ${this.shots} 杆`);
    const cueX = CENTER_X;
    const cueY = TABLE_Y + TABLE_H - 70;
    this.addBall(cueX, cueY, 0xffffff, true);
    const count = Math.min(4 + this.level, 9);
    const gap = 21;
    let index = 0;
    for (let row = 0; row < 4 && index < count; row += 1) {
      for (let col = 0; col <= row && index < count; col += 1) {
        const x = CENTER_X + (col - row / 2) * gap;
        const y = TABLE_Y + 70 + row * (gap - 3);
        this.addBall(x, y, BALL_COLORS[index % BALL_COLORS.length], false);
        index += 1;
      }
    }
  }

  private addBall(x: number, y: number, color: number, isCue: boolean) {
    const circle = this.add.circle(x, y, isCue ? 10 : 11, color)
      .setStrokeStyle(1.6, 0x101114, .55).setDepth(4);
    if (!isCue) {
      circle.setStrokeStyle(1.6, 0x101114, .55);
    }
    this.balls.push({ circle, x, y, vx: 0, vy: 0, isCue });
  }

  private cueBall(): Ball | undefined {
    return this.balls.find((ball) => ball.isCue);
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
      this.aiming = true;
      this.aimX = position.x;
      this.aimY = position.y;
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.aiming || this.ended || !pointer.isDown) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.aimX = position.x;
      this.aimY = position.y;
    });
    this.input.on("pointerup", () => {
      if (!this.aiming || this.ended) return;
      this.aiming = false;
      this.aimGraphics.clear();
      const cue = this.cueBall();
      if (!cue) return;
      const dx = cue.x - this.aimX;
      const dy = cue.y - this.aimY;
      const power = Math.min(Math.hypot(dx, dy) * 4.2, 900);
      if (power < 30) return;
      const angle = Math.atan2(dy, dx);
      cue.vx = Math.cos(angle) * power;
      cue.vy = Math.sin(angle) * power;
      this.shots += 1;
      this.shotsText.setText(`已击 ${this.shots} 杆`);
      this.audio.tone({ freq: 240, endFreq: 150, duration: .09, type: "square", gain: .11 });
    });
  }

  update(_time: number, delta: number) {
    if (this.ended) return;
    const steps = 2;
    const seconds = Math.min(delta, 40) / 1000 / steps;
    for (let step = 0; step < steps; step += 1) {
      for (const ball of this.balls) {
        ball.x += ball.vx * seconds;
        ball.y += ball.vy * seconds;
        ball.vx *= Math.pow(FRICTION, Math.min(delta, 40) / 16.6 / steps);
        ball.vy *= Math.pow(FRICTION, Math.min(delta, 40) / 16.6 / steps);
        if (Math.abs(ball.vx) < STOP_SPEED) ball.vx = 0;
        if (Math.abs(ball.vy) < STOP_SPEED) ball.vy = 0;

        if (ball.x < TABLE_X + 10) { ball.x = TABLE_X + 10; ball.vx = Math.abs(ball.vx) * .8; }
        if (ball.x > TABLE_X + TABLE_W - 10) { ball.x = TABLE_X + TABLE_W - 10; ball.vx = -Math.abs(ball.vx) * .8; }
        if (ball.y < TABLE_Y + 10) { ball.y = TABLE_Y + 10; ball.vy = Math.abs(ball.vy) * .8; }
        if (ball.y > TABLE_Y + TABLE_H - 10) { ball.y = TABLE_Y + TABLE_H - 10; ball.vy = -Math.abs(ball.vy) * .8; }
      }
      for (let a = 0; a < this.balls.length; a += 1) {
        for (let b = a + 1; b < this.balls.length; b += 1) {
          const first = this.balls[a];
          const second = this.balls[b];
          const dx = second.x - first.x;
          const dy = second.y - first.y;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < 20) {
            const nx = dx / distance;
            const ny = dy / distance;
            const overlap = 20 - distance;
            first.x -= nx * overlap / 2;
            first.y -= ny * overlap / 2;
            second.x += nx * overlap / 2;
            second.y += ny * overlap / 2;
            const p = (first.vx - second.vx) * nx + (first.vy - second.vy) * ny;
            if (p > 0) {
              first.vx -= p * nx;
              first.vy -= p * ny;
              second.vx += p * nx;
              second.vy += p * ny;
              if (p > 60) this.audio.tone({ freq: 300 + Math.min(p, 400), duration: .04, type: "sine", gain: .07 });
            }
          }
        }
      }
      for (let index = this.balls.length - 1; index >= 0; index -= 1) {
        const ball = this.balls[index];
        for (const pocket of POCKETS) {
          if (Phaser.Math.Distance.Between(ball.x, ball.y, pocket.x, pocket.y) < POCKET_RADIUS - 2) {
            this.balls.splice(index, 1);
            ball.circle.destroy();
            this.audio.tone({ freq: ball.isCue ? 200 : 560, duration: .12, type: ball.isCue ? "sawtooth" : "triangle", gain: .14 });
            if (ball.isCue) {
              this.respotCue();
            } else {
              this.score += 100;
              this.refreshScore();
            }
            break;
          }
        }
      }
    }

    for (const ball of this.balls) ball.circle.setPosition(ball.x, ball.y);

    this.aimGraphics.clear();
    if (this.aiming) {
      const cue = this.cueBall();
      if (cue) {
        const dx = cue.x - this.aimX;
        const dy = cue.y - this.aimY;
        const length = Math.min(Math.hypot(dx, dy), 150);
        const angle = Math.atan2(dy, dx);
        this.aimGraphics.lineStyle(2.5, 0xffffff, .8);
        this.aimGraphics.lineBetween(cue.x, cue.y, cue.x + Math.cos(angle) * length, cue.y + Math.sin(angle) * length);
        this.aimGraphics.fillStyle(0xdfff3f, .9);
        this.aimGraphics.fillCircle(cue.x + Math.cos(angle) * length, cue.y + Math.sin(angle) * length, 5);
      }
    }

    const colored = this.balls.filter((ball) => !ball.isCue).length;
    const moving = this.balls.some((ball) => Math.abs(ball.vx) > 0 || Math.abs(ball.vy) > 0);
    if (!moving && colored === 0 && this.started) {
      this.score += 300;
      this.refreshScore();
      this.level += 1;
      this.audio.tone({ freq: 523, duration: .16, type: "triangle", gain: .2 });
      this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .14, type: "triangle", gain: .2 });
      this.time.delayedCall(500, () => this.rackBalls());
    }
  }

  private respotCue() {
    this.addBall(CENTER_X, TABLE_Y + TABLE_H - 70, 0xffffff, true);
  }

  private refreshScore() {
    this.scoreText.setText(String(this.score));
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.bestScore) {
      this.storage.save({ bestScore: this.score });
      this.bestText.setText(`BEST ${this.score}`);
    }
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
  scene: MiniBilliardsScene,
});
