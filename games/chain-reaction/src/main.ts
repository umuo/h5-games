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
const ARENA_TOP = 140;
const ARENA_BOTTOM = 740;

interface Orb {
  circle: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
  radius: number;
}

interface Explosion {
  ring: Phaser.GameObjects.Arc;
  x: number;
  y: number;
  radius: number;
  growth: number;
}

class ChainReactionScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private targetText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private orbs: Orb[] = [];
  private explosions: Explosion[] = [];
  private destroyedCount = 0;
  private target = 0;
  private level = 1;
  private placed = false;
  private chainDone = true;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "chain-reaction", version: "1.0.0" });
  private storage = createGameStorage("chain-reaction", { level: 1 });

  constructor() { super("chain-reaction"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#05060a");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 44, 44, 0x05060a, 1, 0x232a44, .45);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "CHAIN / 048", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "连锁反应", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 70, "第 1 关", {
      fontFamily: "sans-serif", fontSize: "21px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.targetText = this.add.text(WIDTH - 22, 78, "", {
      fontFamily: "monospace", fontSize: "12px", color: "#dfff3f", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.hintText = this.add.text(CENTER_X, 780, "点击放置引爆点 · 引爆链会吞掉路过的光球", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.level = this.storage.load().level;
    this.loadLevel(this.level);
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private loadLevel(level: number) {
    this.level = level;
    this.destroyedCount = 0;
    this.placed = false;
    this.chainDone = true;
    this.ended = false;
    for (const orb of this.orbs) orb.circle.destroy();
    for (const explosion of this.explosions) explosion.ring.destroy();
    this.orbs = [];
    this.explosions = [];
    this.levelText.setText(`第 ${level} 关`);
    const orbCount = 8 + level * 2;
    this.target = Math.ceil(orbCount * .62);
    this.targetText.setText(`目标引爆 ${this.target} / ${orbCount}`);
    for (let index = 0; index < orbCount; index += 1) {
      const radius = Phaser.Math.Between(7, 11);
      const circle = this.add.circle(
        Phaser.Math.Between(40, WIDTH - 40),
        Phaser.Math.Between(ARENA_TOP + 30, ARENA_BOTTOM - 30),
        radius,
        Phaser.Utils.Array.GetRandom([0xff5f6d, 0x54e0ff, 0x9fe08a, 0xffd44d, 0x9b6bff]),
      ).setStrokeStyle(1.5, 0xffffff, .5).setDepth(5);
      this.orbs.push({
        circle,
        vx: Phaser.Math.FloatBetween(-60, 60),
        vy: Phaser.Math.FloatBetween(-60, 60),
        radius,
      });
    }
    this.hintText.setText("点击放置引爆点 · 引爆链会吞掉路过的光球").setColor("#8f918a");
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      if (this.placed || !this.chainDone) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      if (position.y < ARENA_TOP || position.y > ARENA_BOTTOM) return;
      this.placed = true;
      this.chainDone = false;
      this.spawnExplosion(position.x, position.y);
      this.audio.tone({ freq: 420, duration: .1, type: "triangle", gain: .14 });
    });
  }

  private spawnExplosion(x: number, y: number) {
    const ring = this.add.circle(x, y, 6).setStrokeStyle(3, 0xdfff3f, .9).setDepth(6);
    this.explosions.push({ ring, x, y, radius: 6, growth: 130 });
  }

  update(_time: number, delta: number) {
    if (this.ended) return;
    const seconds = Math.min(delta, 40) / 1000;

    for (const orb of this.orbs) {
      orb.circle.x += orb.vx * seconds;
      orb.circle.y += orb.vy * seconds;
      if (orb.circle.x < orb.radius || orb.circle.x > WIDTH - orb.radius) orb.vx *= -1;
      if (orb.circle.y < ARENA_TOP + orb.radius || orb.circle.y > ARENA_BOTTOM - orb.radius) orb.vy *= -1;
      orb.circle.x = Phaser.Math.Clamp(orb.circle.x, orb.radius, WIDTH - orb.radius);
      orb.circle.y = Phaser.Math.Clamp(orb.circle.y, ARENA_TOP + orb.radius, ARENA_BOTTOM - orb.radius);
    }

    for (let index = this.explosions.length - 1; index >= 0; index -= 1) {
      const explosion = this.explosions[index];
      explosion.radius += explosion.growth * seconds;
      explosion.growth *= .965;
      explosion.ring.setRadius(explosion.radius);
      explosion.ring.setStrokeStyle(3, 0xdfff3f, Math.max(0, .9 - explosion.radius / 140));

      for (let orbIndex = this.orbs.length - 1; orbIndex >= 0; orbIndex -= 1) {
        const orb = this.orbs[orbIndex];
        if (Phaser.Math.Distance.Between(explosion.x, explosion.y, orb.circle.x, orb.circle.y) <= explosion.radius + orb.radius) {
          this.orbs.splice(orbIndex, 1);
          orb.circle.destroy();
          this.destroyedCount += 1;
          this.targetText.setText(`已引爆 ${this.destroyedCount} / ${this.target + this.destroyedCount}`);
          this.audio.tone({ freq: 300 + this.destroyedCount * 24, duration: .07, type: "triangle", gain: .1 });
          this.spawnExplosion(orb.circle.x, orb.circle.y);
        }
      }

      if (explosion.radius > 150) {
        explosion.ring.destroy();
        this.explosions.splice(index, 1);
      }
    }

    if (this.placed && this.explosions.length === 0) {
      if (this.orbs.length === 0 || this.destroyedCount >= this.target) {
        this.winLevel();
      } else {
        this.failLevel();
      }
    }
  }

  private winLevel() {
    this.ended = true;
    this.chainDone = true;
    this.storage.save({ level: this.level + 1 });
    this.bridge.score(this.level * 100);
    this.audio.tone({ freq: 523, duration: .15, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .14, type: "triangle", gain: .2 });
    const banner = this.add.text(CENTER_X, HEIGHT / 2 - 30, `引爆 ${this.destroyedCount} 颗！`, {
      fontFamily: "sans-serif", fontSize: "30px", color: "#dfff3f", fontStyle: "bold", letterSpacing: 4,
    }).setOrigin(.5).setDepth(20).setAlpha(0);
    this.tweens.add({
      targets: banner,
      alpha: 1,
      scale: { from: .7, to: 1 },
      duration: 260,
      ease: "Back.easeOut",
      onComplete: () => {
        this.tweens.add({
          targets: banner,
          alpha: 0,
          delay: 800,
          duration: 280,
          onComplete: () => this.loadLevel(this.level + 1),
        });
      },
    });
  }

  private failLevel() {
    this.ended = true;
    this.chainDone = true;
    this.audio.tone({ freq: 240, endFreq: 90, duration: .5, type: "sawtooth", gain: .2 });
    const banner = this.add.text(CENTER_X, HEIGHT / 2 - 30,
      `差一点！引爆 ${this.destroyedCount} / ${this.target}`, {
        fontFamily: "sans-serif", fontSize: "26px", color: "#ff6a51", fontStyle: "bold",
      }).setOrigin(.5).setDepth(20).setAlpha(0);
    const replay = this.add.rectangle(CENTER_X, HEIGHT / 2 + 46, 184, 44, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(21).setAlpha(0);
    this.add.text(CENTER_X, HEIGHT / 2 + 46, "重试本关  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#05060a", fontStyle: "bold",
    }).setOrigin(.5).setDepth(22);
    this.tweens.add({ targets: [banner, replay], alpha: 1, duration: 220 });
    replay.on("pointerup", () => this.loadLevel(this.level));
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
  scene: ChainReactionScene,
});
