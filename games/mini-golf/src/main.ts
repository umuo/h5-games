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
const FIELD_TOP = 150;
const FIELD_BOTTOM = 700;
const FRICTION = 0.985;
const HOLE_RADIUS = 17;
const MAX_POWER = 720;

interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
}

class MiniGolfScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private strokesText!: Phaser.GameObjects.Text;
  private parText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private fieldGraphics!: Phaser.GameObjects.Graphics;
  private ball!: Phaser.GameObjects.Container;
  private walls: Wall[] = [];
  private hole = { x: 0, y: 0 };
  private ballX = 0;
  private ballY = 0;
  private vx = 0;
  private vy = 0;
  private level = 1;
  private strokes = 0;
  private totalStrokes = 0;
  private started = false;
  private ended = false;
  private aiming = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "mini-golf", version: "1.0.0" });
  private storage = createGameStorage("mini-golf", { highScore: 0 });

  constructor() { super("mini-golf"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#2f5d33");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "GOLF / 045", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "迷你高尔夫", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#9dbb9f",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 68, "第 1 洞", {
      fontFamily: "sans-serif", fontSize: "20px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.strokesText = this.add.text(CENTER_X, 74, "本洞 0 杆", {
      fontFamily: "monospace", fontSize: "12px", color: "#dfff3f", letterSpacing: 1,
    }).setOrigin(.5, 0);
    this.parText = this.add.text(WIDTH - 22, 74, "PAR 3", {
      fontFamily: "monospace", fontSize: "11px", color: "#9dbb9f", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.hintText = this.add.text(CENTER_X, 760, "从球往后拖动瞄准 · 松手击球", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#cfe3cf",
    }).setOrigin(.5);

    this.fieldGraphics = this.add.graphics().setDepth(1);
    this.ball = this.add.container(0, 0, [
      this.add.circle(1.5, 1.5, 8, 0x101114, .35),
      this.add.circle(0, 0, 8, 0xf7f4ec).setStrokeStyle(1.2, 0x101114, .5),
    ]).setDepth(5);

    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.level = 1;
    this.totalStrokes = 0;
    this.loadLevel(this.level);
    this.bindInput();
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.walls = [];
    this.vx = 0;
    this.vy = 0;
    this.strokes = 0;
    this.started = false;
    this.ended = false;
    this.aiming = false;
  }

  private loadLevel(level: number) {
    this.resetRun();
    this.level = level;
    this.levelText.setText(`第 ${level} 洞`);
    const par = 3;
    this.parText.setText(`PAR ${par}`);

    this.walls = [];
    const wallCount = Math.min(2 + Math.floor(level / 2), 5);
    const safeZones = [
      { x: 40, y: FIELD_TOP + 30 },
      { x: WIDTH - 40, y: FIELD_BOTTOM - 30 },
    ];
    for (let index = 0; index < wallCount; index += 1) {
      const horizontal = Math.random() < .5;
      const w = horizontal ? Phaser.Math.Between(70, 150) : 18;
      const h = horizontal ? 18 : Phaser.Math.Between(70, 150);
      const x = Phaser.Math.Between(60, WIDTH - 60 - w);
      const y = Phaser.Math.Between(FIELD_TOP + 60, FIELD_BOTTOM - 80 - h);
      const nearStart = Phaser.Math.Distance.Between(x, y, safeZones[0].x, safeZones[0].y) < 110;
      const nearHole = x + w < WIDTH - 140 && y < FIELD_TOP + 160 ? false : false;
      if (nearStart || nearHole) continue;
      this.walls.push({ x, y, w, h });
    }
    this.ballX = Phaser.Math.Between(50, 130);
    this.ballY = Phaser.Math.Between(FIELD_BOTTOM - 90, FIELD_BOTTOM - 40);
    this.hole.x = Phaser.Math.Between(WIDTH - 130, WIDTH - 50);
    this.hole.y = Phaser.Math.Between(FIELD_TOP + 50, FIELD_TOP + 140);
    this.strokes = 0;
    this.strokesText.setText(`本洞 0 杆`);
    this.vx = 0;
    this.vy = 0;

    const g = this.fieldGraphics;
    g.clear();
    g.fillStyle(0x3a7d44, 1);
    g.fillRect(0, FIELD_TOP, WIDTH, FIELD_BOTTOM - FIELD_TOP);
    g.lineStyle(2, 0xf3f0e8, .25);
    g.strokeRect(6, FIELD_TOP + 6, WIDTH - 12, FIELD_BOTTOM - FIELD_TOP - 12);
    g.fillStyle(0x2f5d33, 1);
    for (const wall of this.walls) {
      g.fillRoundedRect(wall.x, wall.y, wall.w, wall.h, 6);
      g.lineStyle(1.5, 0x101114, .5);
      g.strokeRoundedRect(wall.x, wall.y, wall.w, wall.h, 6);
    }
    g.fillStyle(0x101114, 1);
    g.fillCircle(this.hole.x, this.hole.y, HOLE_RADIUS);
    g.lineStyle(3, 0x101114, .8);
    g.strokeCircle(this.hole.x, this.hole.y, HOLE_RADIUS);
    g.fillStyle(0xff6a51, 1);
    g.fillTriangle(this.hole.x + 2, this.hole.y - HOLE_RADIUS, this.hole.x + 2, this.hole.y - HOLE_RADIUS - 26, this.hole.x + 30, this.hole.y - HOLE_RADIUS - 13);
    g.lineStyle(2.5, 0xf3f0e8, .9);
    g.lineBetween(this.hole.x + 2, this.hole.y - HOLE_RADIUS, this.hole.x + 2, this.hole.y - HOLE_RADIUS - 28);
    this.ball.setPosition(this.ballX, this.ballY);
    this.strokesText.setText(`本洞 0 杆`);
    void par;
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
      if (Phaser.Math.Distance.Between(position.x, position.y, this.ballX, this.ballY) < 70 && Math.abs(this.vx) + Math.abs(this.vy) < 8) {
        this.aiming = true;
      }
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.aiming || this.ended) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const dx = this.ballX - position.x;
      const dy = this.ballY - position.y;
      const power = Math.min(Math.hypot(dx, dy) * 2.6, MAX_POWER);
      const angle = Math.atan2(dy, dx);
      this.fieldGraphics.clear();
      this.drawField();
      this.fieldGraphics.lineStyle(3, 0xffffff, .75);
      this.fieldGraphics.lineBetween(this.ballX, this.ballY, this.ballX + Math.cos(angle) * Math.min(Math.hypot(dx, dy), 130), this.ballY + Math.sin(angle) * Math.min(Math.hypot(dx, dy), 130));
      this.fieldGraphics.fillStyle(0xdfff3f, .9);
      this.fieldGraphics.fillCircle(this.ballX + Math.cos(angle) * Math.min(Math.hypot(dx, dy), 130), this.ballY + Math.sin(angle) * Math.min(Math.hypot(dx, dy), 130), 5);
      void power;
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (!this.aiming || this.ended) return;
      this.aiming = false;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const dx = this.ballX - position.x;
      const dy = this.ballY - position.y;
      const power = Math.min(Math.hypot(dx, dy) * 2.6, MAX_POWER);
      if (power < 26) {
        this.drawField();
        return;
      }
      const angle = Math.atan2(dy, dx);
      this.vx = Math.cos(angle) * power;
      this.vy = Math.sin(angle) * power;
      this.strokes += 1;
      this.totalStrokes += 1;
      this.strokesText.setText(`本洞 ${this.strokes} 杆`);
      this.audio.tone({ freq: 260, endFreq: 170, duration: .1, type: "square", gain: .1 });
      this.drawField();
    });
  }

  private drawField() {
    const g = this.fieldGraphics;
    g.clear();
    g.fillStyle(0x3a7d44, 1);
    g.fillRect(0, FIELD_TOP, WIDTH, FIELD_BOTTOM - FIELD_TOP);
    g.lineStyle(2, 0xf3f0e8, .25);
    g.strokeRect(6, FIELD_TOP + 6, WIDTH - 12, FIELD_BOTTOM - FIELD_TOP - 12);
    g.fillStyle(0x2f5d33, 1);
    for (const wall of this.walls) {
      g.fillRoundedRect(wall.x, wall.y, wall.w, wall.h, 6);
      g.lineStyle(1.5, 0x101114, .5);
      g.strokeRoundedRect(wall.x, wall.y, wall.w, wall.h, 6);
    }
    g.fillStyle(0x101114, 1);
    g.fillCircle(this.hole.x, this.hole.y, HOLE_RADIUS);
    g.lineStyle(3, 0x101114, .8);
    g.strokeCircle(this.hole.x, this.hole.y, HOLE_RADIUS);
    g.fillStyle(0xff6a51, 1);
    g.fillTriangle(this.hole.x + 2, this.hole.y - HOLE_RADIUS, this.hole.x + 2, this.hole.y - HOLE_RADIUS - 26, this.hole.x + 30, this.hole.y - HOLE_RADIUS - 13);
    g.lineStyle(2.5, 0xf3f0e8, .9);
    g.lineBetween(this.hole.x + 2, this.hole.y - HOLE_RADIUS, this.hole.x + 2, this.hole.y - HOLE_RADIUS - 28);
  }

  update(_time: number, delta: number) {
    if (this.ended) return;
    const seconds = Math.min(delta, 40) / 1000;
    if (this.aiming) return;
    if (Math.abs(this.vx) + Math.abs(this.vy) < 4) {
      if (this.vx !== 0 || this.vy !== 0) {
        this.vx = 0;
        this.vy = 0;
        this.drawField();
      }
      return;
    }
    this.vx *= Math.pow(FRICTION, delta / 16.6);
    this.vy *= Math.pow(FRICTION, delta / 16.6);

    const nextX = this.ballX + this.vx * seconds;
    const nextY = this.ballY + this.vy * seconds;

    for (const wall of this.walls) {
      if (nextX + 8 > wall.x && nextX - 8 < wall.x + wall.w
        && nextY + 8 > wall.y && nextY - 8 < wall.y + wall.h) {
        if (this.ballX < wall.x || this.ballX > wall.x + wall.w) this.vx = -this.vx;
        else this.vy = -this.vy;
        this.audio.tone({ freq: 220, duration: .04, type: "square", gain: .07 });
        return;
      }
    }
    if (nextX < 14 || nextX > WIDTH - 14) {
      this.vx = -this.vx;
      this.ballX = Phaser.Math.Clamp(nextX, 14, WIDTH - 14);
      this.audio.tone({ freq: 220, duration: .04, type: "square", gain: .07 });
    } else {
      this.ballX = nextX;
    }
    if (nextY < FIELD_TOP + 14 || nextY > FIELD_BOTTOM - 14) {
      this.vy = -this.vy;
      this.ballY = Phaser.Math.Clamp(nextY, FIELD_TOP + 14, FIELD_BOTTOM - 14);
      this.audio.tone({ freq: 220, duration: .04, type: "square", gain: .07 });
    } else {
      this.ballY = nextY;
    }

    this.ball.setPosition(this.ballX, this.ballY);

    if (Phaser.Math.Distance.Between(this.ballX, this.ballY, this.hole.x, this.hole.y) < HOLE_RADIUS - 2
      && Math.hypot(this.vx, this.vy) < 420) {
      this.completeHole();
    }
  }

  private completeHole() {
    this.ended = true;
    this.vx = 0;
    this.vy = 0;
    this.ball.setPosition(this.hole.x, this.hole.y);
    this.tweens.add({ targets: this.ball, scale: 0, duration: 240, ease: "Cubic.easeIn" });
    const par = 3;
    const term = this.strokes <= par - 1 ? "小鸟球！" : this.strokes === par ? "标准杆" : "完成";
    this.audio.tone({ freq: 523, duration: .15, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .14, type: "triangle", gain: .2 });
    this.bridge.score(Math.max(0, 100 - this.strokes * 15));
    const saved = this.storage.load();
    this.storage.save({ highScore: saved.highScore + Math.max(0, 100 - this.strokes * 15) });
    const banner = this.add.text(CENTER_X, 420, `${term} · ${this.strokes} 杆`, {
      fontFamily: "sans-serif", fontSize: "28px", color: "#dfff3f", fontStyle: "bold", letterSpacing: 4,
    }).setOrigin(.5).setDepth(20).setAlpha(0);
    this.tweens.add({ targets: banner, alpha: 1, duration: 200 });
    this.time.delayedCall(1000, () => {
      this.ball.setScale(1);
      this.loadLevel(this.level + 1);
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#2f5d33",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: MiniGolfScene,
});
