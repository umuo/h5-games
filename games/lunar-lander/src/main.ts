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
const GRAVITY = 190;
const THRUST = 420;
const SIDE_THRUST = 260;
const SAFE_VY = 105;
const SAFE_VX = 55;
const LANDER_Y_START = 130;

interface TerrainPoint {
  x: number;
  y: number;
}

interface Pad {
  x1: number;
  x2: number;
}

class LanderScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private altText!: Phaser.GameObjects.Text;
  private velText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private terrainGraphics!: Phaser.GameObjects.Graphics;
  private points: TerrainPoint[] = [];
  private pad: Pad = { x1: 0, x2: 0 };
  private lander!: Phaser.GameObjects.Container;
  private flame!: Phaser.GameObjects.Triangle;
  private landerX = CENTER_X;
  private landerY = LANDER_Y_START;
  private vx = 0;
  private vy = 40;
  private thrusting = false;
  private sideInput = 0;
  private wind = 0;
  private level = 1;
  private lives = 3;
  private score = 0;
  private started = false;
  private ended = false;
  private landed = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "lunar-lander", version: "1.0.0" });
  private storage = createGameStorage("lunar-lander", { highScore: 0 });

  constructor() { super("lunar-lander"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#05060a");
    for (let index = 0; index < 30; index += 1) {
      this.add.circle(
        Phaser.Math.Between(6, WIDTH - 6),
        Phaser.Math.Between(6, 700),
        Phaser.Math.FloatBetween(.7, 1.6),
        0xf3f0e8,
      ).setAlpha(Phaser.Math.FloatBetween(.2, .6));
    }
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "LANDER / 040", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "着陆器", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(22, 66, "0", {
      fontFamily: "monospace", fontSize: "34px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.levelText = this.add.text(22, 108, "LV 1", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 22, 76, `BEST ${saved.highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.altText = this.add.text(WIDTH - 22, 96, "ALT ---", {
      fontFamily: "monospace", fontSize: "10px", color: "#54e0ff", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.velText = this.add.text(WIDTH - 22, 112, "VY -- VX --", {
      fontFamily: "monospace", fontSize: "10px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.hintText = this.add.text(CENTER_X, 806, "按住喷射 · 左右键平移 · 平稳落在闪光平台", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#8f918a",
    }).setOrigin(.5);

    this.terrainGraphics = this.add.graphics().setDepth(3);
    const thrustFlame = this.add.triangle(0, 22, -8, 0, 8, 0, 0, 20, 0xffb84d);
    this.flame = thrustFlame;
    const body = this.add.triangle(0, -6, -16, 10, 16, 10, 0, -18, 0xdfe3ee).setStrokeStyle(2, 0x101114, .7);
    const legL = this.add.rectangle(-10, 12, 3, 10, 0x8f918a);
    const legR = this.add.rectangle(10, 12, 3, 10, 0x8f918a);
    this.lander = this.add.container(this.landerX, this.landerY, [thrustFlame, body, legL, legR]).setDepth(6);
    thrustFlame.setVisible(false);

    this.buildTerrain();
    this.buildControls();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.points = [];
    this.landerX = CENTER_X;
    this.landerY = LANDER_Y_START;
    this.vx = 0;
    this.vy = 40;
    this.thrusting = false;
    this.sideInput = 0;
    this.level = 1;
    this.lives = 3;
    this.score = 0;
    this.started = false;
    this.ended = false;
    this.landed = false;
  }

  private buildTerrain() {
    this.points = [];
    const segments = 12;
    const padSegment = Phaser.Math.Between(3, segments - 4);
    for (let index = 0; index <= segments; index += 1) {
      const x = (index / segments) * WIDTH;
      let y: number;
      if (index === padSegment) {
        y = 720;
        this.pad = { x1: x, x2: x + WIDTH / segments };
        this.points.push({ x, y });
        continue;
      }
      if (index === padSegment + 1) {
        y = 720;
        this.points.push({ x, y });
        continue;
      }
      y = Phaser.Math.Between(620, 790);
      this.points.push({ x, y });
    }
    const g = this.terrainGraphics;
    g.clear();
    g.fillStyle(0x2b2d32, 1);
    g.beginPath();
    g.moveTo(0, HEIGHT);
    for (const point of this.points) g.lineTo(point.x, point.y);
    g.lineTo(WIDTH, HEIGHT);
    g.closePath();
    g.fillPath();
    g.lineStyle(2, 0xdfff3f, .9);
    g.lineBetween(this.pad.x1, 720, this.pad.x2, 720);
    for (let blink = 0; blink < 2; blink += 1) {
      g.fillStyle(0xff6a51, 1);
      g.fillCircle(this.pad.x1 + 6, 716, 3);
      g.fillCircle(this.pad.x2 - 6, 716, 3);
    }
    this.wind = Phaser.Math.FloatBetween(-14, 14) * Math.min(this.level, 4);
  }

  private buildControls() {
    const build = (x: number, label: string, onDown: () => void) => {
      const button = this.add.rectangle(x, 748, 56, 48, 0x1b1d21)
        .setStrokeStyle(1.5, 0x3a3d45)
        .setInteractive({ useHandCursor: true });
      this.add.text(x, 748, label, {
        fontFamily: "monospace", fontSize: "16px", color: "#f3f0e8", fontStyle: "bold",
      }).setOrigin(.5);
      button.on("pointerdown", () => onDown());
      return button;
    };
    build(60, "◀", () => { this.sideInput = -1; });
    const thrustButton = build(CENTER_X, "▲", () => { this.thrusting = true; if (!this.started) this.begin(); });
    build(WIDTH - 60, "▶", () => { this.sideInput = 1; });
    thrustButton.on("pointerup", () => { this.thrusting = false; });
    thrustButton.on("pointerupoutside", () => { this.thrusting = false; });
    this.input.on("pointerup", () => {
      this.thrusting = false;
      this.sideInput = 0;
    });
  }

  private begin() {
    if (this.started || this.ended || this.landed) return;
    this.started = true;
    this.bridge.started();
    this.audio.unlock();
  }

  private groundYAt(x: number) {
    for (let index = 1; index < this.points.length; index += 1) {
      const a = this.points[index - 1];
      const b = this.points[index];
      if (x >= a.x && x <= b.x) {
        const t = (x - a.x) / Math.max(b.x - a.x, 1);
        return Phaser.Math.Linear(a.y, b.y, t);
      }
    }
    return HEIGHT;
  }

  update(_time: number, delta: number) {
    if (this.ended || this.landed) return;
    const seconds = Math.min(delta, 40) / 1000;
    if (this.thrusting) {
      this.vy -= THRUST * seconds;
      this.flame.setVisible(true);
      if (!this.started) this.begin();
    } else {
      this.flame.setVisible(false);
    }
    this.vx += this.sideInput * SIDE_THRUST * seconds + this.wind * seconds;
    this.vy += GRAVITY * seconds;
    this.landerX += this.vx * seconds;
    this.landerY += this.vy * seconds;
    this.landerX = Phaser.Math.Clamp(this.landerX, 14, WIDTH - 14);
    if (this.started) {
      this.altText.setText(`ALT ${Math.max(0, Math.round(720 - this.landerY))}`);
      this.velText.setText(`VY ${Math.round(this.vy)}  VX ${Math.round(this.vx)}`);
    }

    const groundY = this.groundYAt(this.landerX);
    if (this.landerY + 14 >= groundY) {
      this.landerY = groundY - 14;
      const onPad = this.landerX >= this.pad.x1 + 12 && this.landerX <= this.pad.x2 - 12;
      if (onPad && Math.abs(this.vy) < SAFE_VY && Math.abs(this.vx) < SAFE_VX) {
        this.touchdown();
      } else {
        this.crash(onPad ? "速度过快" : "偏离平台");
      }
    }
  }

  private touchdown() {
    this.landed = true;
    this.thrusting = false;
    const centering = 1 - Math.min(1, Math.abs(this.landerX - (this.pad.x1 + this.pad.x2) / 2) / ((this.pad.x2 - this.pad.x1) / 2));
    const earned = Math.round(100 + centering * 100 + Math.max(0, 60 - Math.abs(this.vy)) + this.level * 20);
    this.score += earned;
    this.scoreText.setText(String(this.score));
    this.refreshHigh();
    this.bridge.score(this.score);
    this.audio.tone({ freq: 480, duration: .14, type: "triangle", gain: .18 });
    this.audio.tone({ freq: 720, duration: .25, time: this.audio.now + .12, type: "triangle", gain: .18 });
    this.levelText.setText(`着陆成功 +${earned}`);
    this.time.delayedCall(1000, () => {
      this.landed = false;
      this.level += 1;
      this.landerX = CENTER_X;
      this.landerY = LANDER_Y_START;
      this.vx = 0;
      this.vy = 40;
      this.buildTerrain();
    });
  }

  private crash(reason: string) {
    this.lives -= 1;
    this.thrusting = false;
    this.cameras.main.shake(260, .016);
    this.cameras.main.flash(160, 255, 106, 81, false);
    this.audio.noise({ freq: 600, duration: .4, gain: .3, type: "lowpass" });
    for (let index = 0; index < 20; index += 1) {
      const shard = this.add.circle(this.landerX, this.landerY, Phaser.Math.FloatBetween(2, 4.5), 0xffb84d);
      this.tweens.add({
        targets: shard,
        x: shard.x + Phaser.Math.Between(-130, 130),
        y: shard.y - Phaser.Math.Between(0, 140),
        alpha: 0,
        duration: Phaser.Math.FloatBetween(400, 700),
        onComplete: () => shard.destroy(),
      });
    }
    this.lander.setVisible(false);
    this.flame.setVisible(false);
    this.levelText.setText(`坠毁 · ${reason}`);
    if (this.lives <= 0) {
      this.refreshHigh();
      this.bridge.gameOver(this.score);
      this.ended = true;
      const saved = this.storage.load();
      const highScore = Math.max(saved.highScore, this.score);
      this.storage.save({ highScore });
      this.bestText.setText(`BEST ${highScore}`);
      const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x05060a, .66)
        .setDepth(100).setInteractive({ useHandCursor: true });
      const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0x1b1d21)
        .setStrokeStyle(2, 0xdfff3f).setDepth(101);
      this.add.text(CENTER_X, 502, "任务失败", {
        fontFamily: "sans-serif", fontSize: "25px", color: "#f3f0e8", fontStyle: "bold",
      }).setOrigin(.5).setDepth(102);
      this.add.text(CENTER_X, 544, `${this.score} 分  ·  BEST ${highScore}`, {
        fontFamily: "monospace", fontSize: "12px", color: "#8f918a", letterSpacing: 1,
      }).setOrigin(.5).setDepth(102);
      const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0xdfff3f)
        .setInteractive({ useHandCursor: true }).setDepth(102);
      this.add.text(CENTER_X, 592, "重新出发  ↻", {
        fontFamily: "sans-serif", fontSize: "13px", color: "#101114", fontStyle: "bold",
      }).setOrigin(.5).setDepth(103);
      replay.on("pointerup", () => this.scene.restart());
      sharpenSceneText(this.children, RENDER_DPR);
      this.tweens.add({ targets: [shade, panel], alpha: { from: 0, to: 1 }, duration: 220 });
      return;
    }
    this.time.delayedCall(900, () => {
      this.lander.setVisible(true);
      this.lander.setAngle(0);
      this.landerX = CENTER_X;
      this.landerY = LANDER_Y_START;
      this.vx = 0;
      this.vy = 40;
      this.buildTerrain();
    });
  }

  private refreshHigh() {
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
      this.bestText.setText(`BEST ${this.score}`);
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#05060a",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: LanderScene,
});
