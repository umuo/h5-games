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
const INK = "#101114";
const GRAVITY = 1500;
const JUMP_VELOCITY = -800;
const SPRING_VELOCITY = -1280;
const PLATFORM_WIDTH = 66;
const PLATFORM_HEIGHT = 13;
const DEATH_SCREEN_Y = 920;

type PlatformKind = "normal" | "moving" | "breakable";

interface Platform {
  kind: PlatformKind;
  container: Phaser.GameObjects.Container;
  width: number;
  x: number;
  y: number;
  originX: number;
  moveRange: number;
  moveSpeed: number;
  broken: boolean;
  hasSpring: boolean;
}

class SkyHopScene extends Phaser.Scene {
  private world!: Phaser.GameObjects.Container;
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private character!: Phaser.GameObjects.Container;
  private platforms: Platform[] = [];
  private highestY = 0;
  private charX = CENTER_X;
  private charY = 0;
  private vy = JUMP_VELOCITY * .8;
  private targetX = CENTER_X;
  private score = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "sky-hop", version: "1.0.0" });
  private storage = createGameStorage("sky-hop", { highScore: 0 });

  constructor() { super("sky-hop"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#dff1fb");
    for (let index = 0; index < 16; index += 1) {
      this.add.circle(
        Phaser.Math.Between(10, WIDTH - 10),
        Phaser.Math.Between(0, HEIGHT),
        Phaser.Math.FloatBetween(1, 2.4),
        0x8fc7e8,
      ).setAlpha(Phaser.Math.FloatBetween(.25, .5));
    }

    this.world = this.add.container(0, 0);

    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0x101114, .2);
    this.add.text(22, 43, "HOP / 029", {
      fontFamily: "monospace", fontSize: "11px", color: "#101114", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "云端跳跳", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#5d7d95",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(WIDTH / 2, 60, "0m", {
      fontFamily: "monospace", fontSize: "36px", color: "#101114", fontStyle: "bold",
    }).setOrigin(.5, 0);
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 22, 106, `BEST ${saved.highScore}m`, {
      fontFamily: "monospace", fontSize: "10px", color: "#5d7d95", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.hintText = this.add.text(CENTER_X, 800, "左右拖动控制方向 · 自动弹跳向上", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#5d7d95",
    }).setOrigin(.5);

    this.buildCharacter();
    this.platforms.push(this.makePlatform(CENTER_X, 780, "normal", 96));
    while (this.highestY > -600) this.generatePlatform();
    this.charX = CENTER_X;
    this.charY = 700;

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.platforms = [];
    this.highestY = 760;
    this.charX = CENTER_X;
    this.charY = 700;
    this.vy = JUMP_VELOCITY * .8;
    this.targetX = CENTER_X;
    this.score = 0;
    this.started = false;
    this.ended = false;
  }

  private buildCharacter() {
    const body = this.add.ellipse(0, 0, 34, 30, 0xffffff).setStrokeStyle(2, 0x101114, .6);
    const eyeL = this.add.circle(-7, -4, 3.4, 0x101114);
    const eyeR = this.add.circle(7, -4, 3.4, 0x101114);
    const glintL = this.add.circle(-6, -5, 1.2, 0xffffff);
    const glintR = this.add.circle(8, -5, 1.2, 0xffffff);
    const beak = this.add.triangle(0, 4, -6, 0, 6, 0, 0, 8, 0xffb84d).setStrokeStyle(1, 0x101114, .5);
    this.character = this.add.container(this.charX, this.charY, [body, beak, eyeL, eyeR, glintL, glintR]);
    this.world.add(this.character);
  }

  private makePlatform(x: number, y: number, kind: PlatformKind, width = PLATFORM_WIDTH): Platform {
    const container = this.add.container(x, y);
    const g = this.add.graphics();
    const color = kind === "moving" ? 0x54a8ff : kind === "breakable" ? 0xffa63d : 0x67c784;
    g.fillStyle(color, 1);
    g.fillRoundedRect(-width / 2, 0, width, PLATFORM_HEIGHT, 6);
    g.fillStyle(0xffffff, .3);
    g.fillRoundedRect(-width / 2 + 4, 2, width - 8, 4, 2);
    g.lineStyle(1.5, 0x101114, .4);
    g.strokeRoundedRect(-width / 2, 0, width, PLATFORM_HEIGHT, 6);
    if (kind === "breakable") {
      g.lineStyle(2, 0x101114, .55);
      g.lineBetween(-6, 0, -2, PLATFORM_HEIGHT);
      g.lineBetween(8, 0, 12, PLATFORM_HEIGHT);
    }
    container.add(g);
    let spring: Phaser.GameObjects.Rectangle | null = null;
    if (kind === "normal" && Math.random() < .16) {
      spring = this.add.rectangle(0, -7, 12, 12, 0xff6a51).setStrokeStyle(1.5, 0x101114, .6);
      container.add(spring);
    }
    this.world.add(container);
    const platform: Platform = {
      kind, container, width, x, y,
      originX: x,
      moveRange: Phaser.Math.Between(40, 80),
      moveSpeed: Phaser.Math.FloatBetween(40, 90),
      broken: false,
      hasSpring: spring !== null,
    };
    this.platforms.push(platform);
    if (y < this.highestY) this.highestY = y;
    return platform;
  }

  private generatePlatform() {
    const top = Math.min(...this.platforms.map((platform) => platform.y));
    const gap = Phaser.Math.Between(82, 128);
    const y = top - gap;
    const difficulty = Math.min(1, Math.abs(this.highestY) / 12000);
    const roll = Math.random();
    const kind: PlatformKind = roll < .1 + difficulty * .18
      ? "moving"
      : roll < .22 + difficulty * .3
        ? "breakable"
        : "normal";
    const x = Phaser.Math.Between(50, WIDTH - 50);
    return this.makePlatform(x, y, kind);
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
      this.targetX = position.x;
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || !pointer.isDown) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.targetX = position.x;
    });
  }

  update(time: number, delta: number) {
    if (this.ended) return;
    const seconds = Math.min(delta, 40) / 1000;

    for (const platform of this.platforms) {
      if (platform.kind !== "moving" || platform.broken) continue;
      platform.x = platform.originX + Math.sin(time / 1000 * platform.moveSpeed * .05) * platform.moveRange;
      platform.container.x = platform.x;
    }

    if (!this.started) {
      this.character.y += Math.sin(time / 300) * .3;
      return;
    }

    this.vy += GRAVITY * seconds;
    const previousFeet = this.charY + 16;
    this.charY += this.vy * seconds;
    const newFeet = this.charY + 16;

    this.charX = Phaser.Math.Linear(this.charX, this.targetX, Math.min(1, seconds * 6));
    if (this.charX < -18) this.charX = WIDTH + 18;
    if (this.charX > WIDTH + 18) this.charX = -18;
    this.character.setPosition(this.charX, this.charY);

    if (this.vy > 0) {
      for (const platform of this.platforms) {
        if (platform.broken) continue;
        if (Math.abs(this.charX - platform.x) > platform.width / 2 + 12) continue;
        const top = platform.y;
        if (previousFeet <= top + 4 && newFeet >= top) {
          if (platform.kind === "breakable") {
            platform.broken = true;
            this.audio.noise({ freq: 1200, duration: .12, gain: .12 });
            this.tweens.add({
              targets: platform.container,
              y: platform.y + 90,
              alpha: 0,
              angle: 20,
              duration: 420,
              onComplete: () => platform.container.destroy(),
            });
            break;
          }
          const onSpring = platform.hasSpring;
          this.vy = onSpring ? SPRING_VELOCITY : JUMP_VELOCITY;
          if (onSpring) {
            this.audio.tone({ freq: 700, endFreq: 1200, duration: .2, type: "triangle", gain: .2 });
          } else {
            this.audio.tone({ freq: 380, endFreq: 560, duration: .09, type: "sine", gain: .12 });
          }
          this.character.setScale(1.15, .85);
          this.tweens.add({ targets: this.character, scale: 1, duration: 150 });
          break;
        }
      }
    }

    const screenY = this.charY + this.world.y;
    const targetWorldY = Math.min(0, HEIGHT * .42 - this.charY);
    if (targetWorldY > this.world.y) {
      this.world.y = targetWorldY;
      const climbed = Math.max(0, Math.floor((-this.charY + 700) / 10));
      if (climbed > this.score) {
        this.score = climbed;
        this.scoreText.setText(`${this.score}m`);
        this.bridge.score(this.score);
        const saved = this.storage.load();
        if (this.score > saved.highScore) {
          this.storage.save({ highScore: this.score });
          this.bestText.setText(`BEST ${this.score}m`);
        }
      }
    }

    while (Math.min(...this.platforms.map((platform) => platform.y)) > this.charY - 900) {
      this.generatePlatform();
    }
    for (const platform of [...this.platforms]) {
      if (platform.y + this.world.y > DEATH_SCREEN_Y + 60) {
        this.platforms.splice(this.platforms.indexOf(platform), 1);
        platform.container.destroy();
      }
    }

    if (screenY > DEATH_SCREEN_Y) {
      this.endRun();
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    this.audio.tone({ freq: 300, endFreq: 70, duration: .65, type: "sawtooth", gain: .22 });
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .55)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0xf3f0e8)
      .setStrokeStyle(2, 0x101114).setDepth(101);
    this.add.text(CENTER_X, 502, "掉下去了", {
      fontFamily: "sans-serif", fontSize: "25px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `${this.score}m  ·  BEST ${highScore}m`, {
      fontFamily: "monospace", fontSize: "12px", color: "#777872", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0x101114)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "再跳一程  ↻", {
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
  backgroundColor: "#dff1fb",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: SkyHopScene,
});
