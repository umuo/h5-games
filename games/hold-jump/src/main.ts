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
const INK = "#101114";
const ANCHOR_X = 195;
const ANCHOR_Y = 620;
const SLOPE = 0.5;
const CHARGE_TIME = 1050;
const MIN_JUMP = 120;
const MAX_JUMP = 450;
const PERFECT_TOLERANCE = 9;
const TOP_COLORS = [0xdfff3f, 0x54e0ff, 0xffb84d, 0xff8fa3, 0x9b6bff, 0x9fe08a];
const DECOR_COLORS = [0xff6a51, 0x101114, 0xffc24b, 0x5c7cff];

interface Platform {
  x: number;
  y: number;
  radius: number;
  color: number;
  container: Phaser.GameObjects.Container;
}

class HoldJumpScene extends Phaser.Scene {
  private world!: Phaser.GameObjects.Container;
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private player!: Phaser.GameObjects.Container;
  private playerBody!: Phaser.GameObjects.Ellipse;
  private playerHead!: Phaser.GameObjects.Arc;
  private chargeRing!: Phaser.GameObjects.Graphics;
  private platforms: Platform[] = [];
  private current?: Platform;
  private next?: Platform;
  private chargeStart = 0;
  private charging = false;
  private flight?: { from: Phaser.Math.Vector2; toX: number; planeY: number; start: number; duration: number; sign: number };
  private falling?: { start: number; x: number; y: number; vx: number; vy: number };
  private score = 0;
  private combo = 0;
  private started = false;
  private ended = false;
  private lastDirection = 1;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "hold-jump", version: "1.0.0" });
  private storage = createGameStorage("hold-jump", { highScore: 0 });

  constructor() { super("hold-jump"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#f3f0e8");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 48, 48, 0xf3f0e8, 1, 0x101114, .04);

    this.world = this.add.container(0, 0);

    this.add.rectangle(WIDTH / 2, 31, WIDTH - 36, 1, 0x101114, .25);
    this.add.text(22, 43, "JUMP / 018", {
      fontFamily: "monospace", fontSize: "11px", color: INK, letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "跳一跳", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#74726c",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(WIDTH / 2, 62, "0", {
      fontFamily: "monospace", fontSize: "44px", color: INK, fontStyle: "bold",
    }).setOrigin(.5, 0);
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 22, 74, `BEST ${saved.highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#74726c", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.comboText = this.add.text(WIDTH / 2, 132, "", {
      fontFamily: "monospace", fontSize: "15px", color: "#ff6a51", fontStyle: "bold", letterSpacing: 2,
    }).setOrigin(.5).setAlpha(0);
    this.hintText = this.add.text(WIDTH / 2, 786, "按住蓄力 · 松手起跳 · 中心连击翻倍", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8a8881",
    }).setOrigin(.5);

    this.chargeRing = this.add.graphics();
    this.buildPlayer();
    this.spawnInitialPlatforms();
    this.placePlayer(this.platforms[0]);

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.platforms = [];
    this.current = undefined;
    this.next = undefined;
    this.chargeStart = 0;
    this.charging = false;
    this.flight = undefined;
    this.falling = undefined;
    this.score = 0;
    this.combo = 0;
    this.started = false;
    this.ended = false;
    this.lastDirection = 1;
  }

  private buildPlayer() {
    this.playerBody = this.add.ellipse(0, -10, 22, 30, 0x101114);
    this.playerHead = this.add.circle(0, -32, 9, 0xff6a51).setStrokeStyle(1.5, 0x101114, .8);
    this.player = this.add.container(0, 0, [this.playerBody, this.playerHead]);
    this.world.add(this.player);
  }

  private spawnInitialPlatforms() {
    this.current = this.addPlatform(ANCHOR_X, ANCHOR_Y, 48);
    this.next = this.addPlatform(ANCHOR_X + 150, ANCHOR_Y - 75, 46);
  }

  private addPlatform(x: number, y: number, radius: number): Platform {
    const color = TOP_COLORS[this.platforms.length % TOP_COLORS.length];
    const container = this.add.container(x, y);
    const graphics = this.add.graphics();
    graphics.fillStyle(0x101114, .18);
    graphics.fillEllipse(0, 20, radius * 2 + 14, radius * .9 + 10);
    graphics.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(28).color, 1);
    graphics.fillEllipse(0, 20, radius * 2, radius * .9);
    graphics.fillRect(-radius, 0, radius * 2, 20);
    graphics.fillEllipse(0, 20, radius * 2, radius * .9);
    graphics.fillStyle(color, 1);
    graphics.fillEllipse(0, 0, radius * 2, radius * .9);
    graphics.lineStyle(1.5, 0x101114, .35);
    graphics.strokeEllipse(0, 0, radius * 2, radius * .9);
    container.add(graphics);
    if (this.platforms.length > 0 && Math.random() < .5) {
      const decor = this.add.rectangle(
        Phaser.Math.Between(-radius * .4, radius * .4),
        -Phaser.Math.Between(6, 12),
        Phaser.Math.Between(8, 13),
        Phaser.Math.Between(8, 13),
        Phaser.Utils.Array.GetRandom(DECOR_COLORS),
      ).setStrokeStyle(1, 0x101114, .4);
      container.add(decor);
    }
    this.world.add(container);
    const platform: Platform = { x, y, radius, color, container };
    this.platforms.push(platform);
    return platform;
  }

  private bindInput() {
    this.input.on("pointerdown", () => {
      if (this.ended || this.flight || this.falling) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      this.charging = true;
      this.chargeStart = this.time.now;
    });
    this.input.on("pointerup", () => {
      if (this.ended || !this.charging) return;
      this.charging = false;
      const power = this.currentPower();
      this.chargeRing.clear();
      this.jump(power);
    });
  }

  private currentPower() {
    return Math.min(1, (this.time.now - this.chargeStart) / CHARGE_TIME);
  }

  private placePlayer(platform: Platform) {
    this.player.setPosition(platform.x, platform.y - 2);
    this.player.setScale(1);
    this.player.setAngle(0);
    this.player.setAlpha(1);
  }

  private jump(power: number) {
    const current = this.current;
    const next = this.next;
    if (!current || !next) return;
    const sign = Math.sign(next.x - current.x) || 1;
    const distance = MIN_JUMP + power * (MAX_JUMP - MIN_JUMP);
    const duration = 480 + distance * .35;
    const peak = 80 + distance * .28;
    const from = new Phaser.Math.Vector2(current.x, current.y - 2);
    const planeY = next.y - 2;
    this.flight = { from, toX: current.x + sign * distance, planeY, start: this.time.now, duration, sign };
    this.audio.noise({ freq: 900, duration: .14, gain: .12 });
    this.audio.tone({ freq: 320 + power * 240, endFreq: 190, duration: .18, type: "triangle", gain: .12 });
  }

  private updateFlight(time: number, delta: number) {
    const flight = this.flight;
    if (!flight) return;
    const p = Math.min(1, (time - flight.start) / flight.duration);
    const next = this.next;
    if (!next) return;
    const x = Phaser.Math.Linear(flight.from.x, flight.toX, p);
    const surfaceY = Phaser.Math.Linear(flight.from.y, flight.planeY, p);
    const peak = 80 + Math.abs(flight.toX - flight.from.x) * .28;
    const y = surfaceY - peak * 4 * p * (1 - p);
    this.player.setPosition(x, y);
    if (p < 1) return;

    this.flight = undefined;
    const landingOffset = Math.abs(flight.toX - next.x);
    if (landingOffset <= next.radius) {
      this.landOn(next, flight.toX, landingOffset);
    } else {
      this.startFall(flight.toX, flight.planeY, flight.sign);
    }
    void delta;
  }

  private landOn(platform: Platform, x: number, offset: number) {
    this.current = platform;
    this.next = this.generateNextPlatform();
    const perfect = offset <= PERFECT_TOLERANCE;
    if (perfect) {
      this.combo += 1;
      const bonus = Math.min(2 ** Math.min(this.combo, 6), 64);
      this.score += 1 + bonus;
      this.showCombo(bonus);
      this.audio.tone({ freq: 620 + Math.min(this.combo, 8) * 60, duration: .22, type: "triangle", gain: .24 });
      this.audio.tone({ freq: (620 + Math.min(this.combo, 8) * 60) * 1.5, duration: .16, time: this.audio.now + .06, type: "triangle", gain: .12 });
      const ring = this.add.circle(x, platform.y - 2, 12).setStrokeStyle(3, 0xffffff, .95);
      this.world.add(ring);
      this.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: 340, onComplete: () => ring.destroy() });
    } else {
      this.combo = 0;
      this.score += 1;
      this.audio.tone({ freq: 190, endFreq: 150, duration: .1, type: "sine", gain: .14 });
    }
    this.scoreText.setText(String(this.score));
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
      this.bestText.setText(`BEST ${this.score}`);
    }
    this.placePlayer(platform);
    this.player.setScale(1.18, .8);
    this.tweens.add({ targets: this.player, scale: 1, duration: 170, ease: "Back.easeOut" });
    this.panCameraTo(platform);
    this.generateNextPlatform();
  }

  private showCombo(bonus: number) {
    this.comboText.setText(`完美连击 ×${this.combo}  +${bonus + 1}`);
    this.comboText.setAlpha(1).setScale(1.25);
    this.tweens.killTweensOf(this.comboText);
    this.tweens.add({ targets: this.comboText, scale: 1, duration: 150 });
    this.tweens.add({ targets: this.comboText, alpha: 0, delay: 700, duration: 300 });
  }

  private panCameraTo(platform: Platform) {
    const targetY = ANCHOR_Y - platform.y;
    this.tweens.add({
      targets: this.world,
      y: targetY,
      duration: 320,
      ease: "Cubic.easeInOut",
    });
  }

  private generateNextPlatform(): Platform {
    const last = this.platforms[this.platforms.length - 1];
    const direction = Math.random() < .58 ? this.lastDirection : -this.lastDirection;
    const distance = Phaser.Math.Clamp(125 + this.score * 1.6 + Phaser.Math.Between(0, 55), 125, 250);
    let x = last.x + direction * distance;
    if (x < 60 || x > WIDTH - 60) {
      x = last.x - direction * distance;
    }
    this.lastDirection = Math.sign(x - last.x) || this.lastDirection;
    const radius = Math.max(30, 48 - this.score * .45);
    const y = last.y - Math.abs(x - last.x) * SLOPE;
    const platform = this.addPlatform(x, y, radius);
    for (const item of [...this.platforms]) {
      if (item !== this.current && item !== this.next && item !== platform && item.y + this.world.y > HEIGHT + 120) {
        this.platforms.splice(this.platforms.indexOf(item), 1);
        item.container.destroy();
      }
    }
    return platform;
  }

  private startFall(x: number, y: number, sign: number) {
    this.falling = { start: this.time.now, x, y, vx: sign * 90, vy: 60 };
    this.audio.tone({ freq: 320, endFreq: 60, duration: .55, type: "sawtooth", gain: .2 });
    this.cameras.main.shake(160, .008);
  }

  private updateFall(time: number, delta: number) {
    const fall = this.falling;
    if (!fall) return;
    const seconds = Math.min(delta, 40) / 1000;
    fall.vy += 1500 * seconds;
    fall.x += fall.vx * seconds;
    fall.y += fall.vy * seconds;
    this.player.setPosition(fall.x, fall.y);
    this.player.setAngle(this.player.angle + 240 * seconds);
    this.player.setAlpha(Math.max(0, 1 - (time - fall.start) / 620));
    if (time - fall.start > 620) {
      this.falling = undefined;
      this.endRun();
    }
  }

  update(time: number, delta: number) {
    if (this.ended) return;
    if (this.flight) {
      this.updateFlight(time, delta);
    } else if (this.falling) {
      this.updateFall(time, delta);
    } else if (this.charging) {
      const power = this.currentPower();
      this.player.setScale(1 - power * .26, 1 + power * .3);
      this.playerHead.setPosition(0, -32 + power * 9);
      const current = this.current;
      if (!current) return;
      this.chargeRing.clear();
      this.chargeRing.lineStyle(4, power >= 1 ? 0xff453a : 0xff6a51, .85);
      this.chargeRing.beginPath();
      this.chargeRing.arc(current.x, current.y, current.radius + 10, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
      this.chargeRing.strokePath();
      if (power >= 1) this.player.setAngle(Math.sin(time / 40) * 2.4);
    } else {
      this.playerBody.setScale(1 + Math.sin(time / 420) * .03);
    }
  }

  private endRun() {
    this.ended = true;
    this.charging = false;
    this.chargeRing.clear();
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bestText.setText(`BEST ${highScore}`);
    this.bridge.gameOver(this.score);

    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .5)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(WIDTH / 2, 560, 308, 186, 0xf3f0e8)
      .setStrokeStyle(2, 0x101114).setDepth(101);
    this.add.text(WIDTH / 2, 522, "跳空了", {
      fontFamily: "sans-serif", fontSize: "25px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(WIDTH / 2, 562, `${this.score} 步  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "12px", color: "#777872", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(WIDTH / 2, 610, 184, 42, 0x101114)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(WIDTH / 2, 610, "再跳一次  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    replay.on("pointerup", () => this.scene.restart());
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: [shade, panel], alpha: { from: 0, to: 1 }, duration: 200 });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#f3f0e8",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: HoldJumpScene,
});
