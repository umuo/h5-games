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
const GROUND_Y = 700;
const GRAVITY = 900;
const SLING_X = 90;
const SLING_Y = 620;

interface Target {
  container: Phaser.GameObjects.Container;
  alive: boolean;
}

class SlingshotScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private shotsText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private targetGraphics!: Phaser.GameObjects.Graphics;
  private projectile!: Phaser.GameObjects.Arc;
  private targets: Target[] = [];
  private walls: Wall[] = [];
  private projectileX = SLING_X;
  private projectileY = SLING_Y;
  private vx = 0;
  private vy = 0;
  private inFlight = false;
  private aiming = false;
  private shots = 0;
  private level = 1;
  private score = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "slingshot", version: "1.0.0" });
  private storage = createGameStorage("slingshot", { highScore: 0 });

  constructor() { super("slingshot"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#d8ecf5");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0x101114, .25);
    this.add.text(22, 43, "SLING / 052", {
      fontFamily: "monospace", fontSize: "11px", color: INK, letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "弹弓打靶", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#5d7d95",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 68, "第 1 关", {
      fontFamily: "sans-serif", fontSize: "21px", color: INK, fontStyle: "bold",
    });
    this.shotsText = this.add.text(WIDTH - 22, 76, "剩余 5 发", {
      fontFamily: "monospace", fontSize: "12px", color: "#5d7d95", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.hintText = this.add.text(CENTER_X, 790, "从弹弓往后拖动瞄准 · 松手发射", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#5d7d95",
    }).setOrigin(.5);

    this.add.rectangle(CENTER_X, GROUND_Y + 24, WIDTH, 48, 0x8fbc74);
    this.add.rectangle(CENTER_X, GROUND_Y + 2, WIDTH, 4, 0x2f5d33, .6);

    this.targetGraphics = this.add.graphics().setDepth(3);
    this.projectile = this.add.circle(this.projectileX, this.projectileY, 9, 0x101114).setDepth(6);

    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.level = 1;
    this.score = 0;
    this.loadLevel(this.level);
    this.bindInput();
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }
  private INK = "#101114";

  private resetRun() {
    this.targets = [];
    this.walls = [];
    this.projectileX = SLING_X;
    this.projectileY = SLING_Y;
    this.vx = 0;
    this.vy = 0;
    this.inFlight = false;
    this.aiming = false;
    this.shots = 0;
    this.started = false;
    this.ended = false;
  }

  private loadLevel(level: number) {
    this.resetRun();
    this.level = level;
    this.levelText.setText(`第 ${level} 关`);
    this.shotsText.setText(`剩余 ${5 + level} 发`);
    this.targetGraphics.clear();

    const rows = Math.min(2 + Math.floor(level / 2), 4);
    for (let row = 0; row < rows; row += 1) {
      const y = GROUND_Y - 70 - row * 74;
      const columns = 2 + Math.min(level, 3);
      for (let col = 0; col < columns; col += 1) {
        const x = 220 + col * 44 + (row % 2) * 12;
        const container = this.add.container(x, y, [
          this.add.rectangle(0, 0, 30, 30, row % 2 === 0 ? 0xff6a51 : 0xffd44d).setStrokeStyle(2, 0x101114, .6),
          this.add.text(0, 0, `${(rows - row) * 10}`, {
            fontFamily: "monospace", fontSize: "13px", color: "#101114", fontStyle: "bold",
          }).setOrigin(.5),
        ]).setDepth(4);
        this.targets.push({ container, alive: true });
      }
    }
    const wallCount = Math.min(1 + Math.floor(level / 3), 2);
    this.walls = [];
    for (let index = 0; index < wallCount; index += 1) {
      const height = Phaser.Math.Between(60, 120);
      const wall = {
        x: Phaser.Math.Between(160, 200),
        y: GROUND_Y - height,
        w: 16,
        h: height,
      };
      this.walls.push(wall);
      this.targetGraphics.fillStyle(0x8a5a34, 1);
      this.targetGraphics.fillRoundedRect(wall.x, wall.y, wall.w, wall.h, 4);
      this.targetGraphics.lineStyle(1.5, 0x101114, .5);
      this.targetGraphics.strokeRoundedRect(wall.x, wall.y, wall.w, wall.h, 4);
    }
    this.projectile.setPosition(this.projectileX, this.projectileY);
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || this.inFlight) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      if (Phaser.Math.Distance.Between(position.x, position.y, SLING_X, SLING_Y) < 110) {
        this.aiming = true;
      }
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.aiming || this.inFlight) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const dx = SLING_X - position.x;
      const dy = SLING_Y - position.y;
      const power = Math.min(Math.hypot(dx, dy) * 3.4, 780);
      const angle = Math.atan2(dy, dx);
      this.projectileX = SLING_X - Math.cos(angle) * Math.min(Math.hypot(dx, dy), 60);
      this.projectileY = SLING_Y - Math.sin(angle) * Math.min(Math.hypot(dx, dy), 60);
      this.projectile.setPosition(this.projectileX, this.projectileY);
      void power;
      void angle;
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (!this.aiming || this.inFlight) return;
      this.aiming = false;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const dx = SLING_X - position.x;
      const dy = SLING_Y - position.y;
      const power = Math.min(Math.hypot(dx, dy) * 3.4, 780);
      if (power < 40 || dx < 0) {
        this.projectileX = SLING_X;
        this.projectileY = SLING_Y;
        this.projectile.setPosition(this.projectileX, this.projectileY);
        return;
      }
      const angle = Math.atan2(dy, dx);
      this.vx = Math.cos(angle) * power;
      this.vy = Math.sin(angle) * power;
      this.inFlight = true;
      this.shots += 1;
      this.audio.noise({ freq: 1300, duration: .08, gain: .12 });
    });
  }

  update(_time: number, delta: number) {
    if (this.ended) return;
    if (!this.inFlight) return;
    const seconds = Math.min(delta, 40) / 1000;
    this.vy += GRAVITY * seconds;
    const nextX = this.projectileX + this.vx * seconds;
    const nextY = this.projectileY + this.vy * seconds;

    for (const wall of this.walls) {
      if (nextX + 8 > wall.x && nextX - 8 < wall.x + wall.w && nextY + 8 > wall.y) {
        this.vx = -Math.abs(this.vx) * .5;
        this.audio.tone({ freq: 200, duration: .05, type: "square", gain: .08 });
      }
    }

    this.projectileX = nextX;
    this.projectileY = nextY;

    for (const target of this.targets) {
      if (!target.alive) continue;
      if (Phaser.Math.Distance.Between(this.projectileX, this.projectileY, target.container.x, target.container.y) < 22) {
        target.alive = false;
        const points = Number((target.container.list[1] as Phaser.GameObjects.Text).text);
        this.score += points;
        this.bridge.score(points);
        const saved = this.storage.load();
        if (this.score > saved.highScore) {
          this.storage.save({ highScore: this.score });
        }
        this.audio.tone({ freq: 640, duration: .12, type: "triangle", gain: .16 });
        for (let index = 0; index < 8; index += 1) {
          const shard = this.add.circle(target.container.x, target.container.y, 3,
            index % 2 === 0 ? 0xff6a51 : 0xffd44d);
          this.tweens.add({
            targets: shard,
            x: shard.x + Phaser.Math.Between(-70, 70),
            y: shard.y - Phaser.Math.Between(10, 80),
            alpha: 0,
            duration: 400,
            onComplete: () => shard.destroy(),
          });
        }
        this.tweens.add({
          targets: target.container,
          y: target.container.y + 120,
          angle: 40,
          alpha: 0,
          duration: 400,
          onComplete: () => target.container.destroy(),
        });
      }
    }

    this.projectile.setPosition(this.projectileX, this.projectileY);

    if (this.projectileY > GROUND_Y || this.projectileX > WIDTH + 20) {
      this.inFlight = false;
      const remaining = this.targets.filter((target) => target.alive).length;
      const shotsLeft = 5 + this.level - this.shots;
      if (remaining === 0) {
        this.score += 100 + shotsLeft * 20;
        this.bridge.score(100 + shotsLeft * 20);
        const saved = this.storage.load();
        this.storage.save({ highScore: Math.max(saved.highScore, this.score) });
        this.audio.tone({ freq: 660, duration: .18, type: "triangle", gain: .2 });
        this.audio.tone({ freq: 990, duration: .3, time: this.audio.now + .15, type: "triangle", gain: .2 });
        this.showBanner(`过关！+${100 + shotsLeft * 20}`, () => this.loadLevel(this.level + 1));
      } else if (shotsLeft <= 0) {
        this.audio.tone({ freq: 260, endFreq: 90, duration: .5, type: "sawtooth", gain: .2 });
        this.showBanner(`弹药用完 · 得分 ${this.score}`, () => this.loadLevel(this.level));
      } else {
        this.audio.tone({ freq: 200, duration: .05, type: "sine", gain: .08 });
        this.projectileX = SLING_X;
        this.projectileY = SLING_Y;
        this.shotsText.setText(`剩余 ${shotsLeft} 发`);
      }
    }
  }

  private showBanner(message: string, onComplete: () => void) {
    const banner = this.add.text(CENTER_X, 400, message, {
      fontFamily: "sans-serif", fontSize: "26px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(20).setAlpha(0);
    this.tweens.add({
      targets: banner,
      alpha: 1,
      duration: 220,
      onComplete: () => {
        this.tweens.add({
          targets: banner,
          alpha: 0,
          delay: 900,
          duration: 260,
          onComplete,
        });
      },
    });
  }
}

interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
}

const INK = "#101114";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#d8ecf5",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: SlingshotScene,
});
