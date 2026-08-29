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
const CREAM = "#f7f1e3";
const WALL_LEFT = 26;
const WALL_RIGHT = WIDTH - 26;
const FLOOR_TOP = 840;
const SPAWN_Y = 142;
const DANGER_Y = 196;
const DROP_COOLDOWN = 560;
const DANGER_LIMIT = 1500;

const FRUIT_RADII = [15, 20, 26, 32, 39, 46, 54, 62, 70, 78, 86];
const FRUIT_COLORS = [
  0xff5f6d, 0xff8fa3, 0xa88bff, 0xffb84d, 0xff8a3d, 0xff4d5e,
  0xc6e84f, 0xffb3c1, 0xffd94d, 0x9fe08a, 0x53c953,
];
const FRUIT_NAMES = ["樱桃", "草莓", "葡萄", "橘子", "柿子", "苹果", "青梨", "蜜桃", "菠萝", "蜜瓜", "西瓜"];
const MERGE_POINTS = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66];

interface Fruit {
  image: Phaser.Physics.Matter.Image;
  tier: number;
  merging: boolean;
  armed: boolean;
  bornAt: number;
}

function fruitTextureKey(tier: number) {
  return `fruit-${tier}`;
}

class FruitMergeScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private dangerLine!: Phaser.GameObjects.Graphics;
  private aimGraphics!: Phaser.GameObjects.Graphics;
  private currentPreview!: Phaser.GameObjects.Image;
  private nextPreview!: Phaser.GameObjects.Image;
  private chainText!: Phaser.GameObjects.Text;
  private fruits: Fruit[] = [];
  private aimX = CENTER_X;
  private currentTier = 0;
  private nextTier = 1;
  private dropReadyAt = 0;
  private dangerMs = 0;
  private chain = 0;
  private chainExpireAt = 0;
  private score = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.42 });
  private bridge = createGameBridge({ gameId: "fruit-merge", version: "1.0.0" });
  private storage = createGameStorage("fruit-merge", { highScore: 0 });

  constructor() { super("fruit-merge"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor(CREAM);
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 44, 44, 0xf7f1e3, 1, 0x101114, .045);
    this.add.rectangle(WIDTH / 2, 31, WIDTH - 36, 1, 0x101114, .25);
    this.add.text(22, 43, "FRUIT / 015", {
      fontFamily: "monospace", fontSize: "11px", color: INK, letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "合成果实", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#8d8674",
    }).setOrigin(1, 0);

    this.scoreText = this.add.text(22, 74, "00000", {
      fontFamily: "monospace", fontSize: "40px", color: INK, fontStyle: "bold",
    });
    const saved = this.storage.load();
    this.add.text(WIDTH - 22, 84, `BEST  ${String(saved.highScore).padStart(5, "0")}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#8d8674", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");

    this.dangerLine = this.add.graphics();
    this.drawDangerLine(0x101114, .3);
    this.aimGraphics = this.add.graphics();
    this.chainText = this.add.text(CENTER_X, 300, "", {
      fontFamily: "sans-serif", fontSize: "24px", color: "#ff6a51", fontStyle: "bold",
    }).setOrigin(.5).setAlpha(0);

    this.hintText = this.add.text(CENTER_X, 240, "拖动瞄准 · 松手投放", {
      fontFamily: "sans-serif", fontSize: "15px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setAlpha(.85);

    this.buildStaticBodies();
    this.buildFruitTextures();
    this.buildHudPreviews();
    this.bindInput();
    this.matter.world.on("collisionstart", this.handleCollisions);
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.matter.world.off("collisionstart", this.handleCollisions);
      this.audio.suspend();
    });
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.fruits = [];
    this.aimX = CENTER_X;
    this.currentTier = 0;
    this.nextTier = 1;
    this.dropReadyAt = 0;
    this.dangerMs = 0;
    this.chain = 0;
    this.chainExpireAt = 0;
    this.score = 0;
    this.started = false;
    this.ended = false;
  }

  private buildStaticBodies() {
    this.matter.world.resume();
    this.matter.world.setBounds(WALL_LEFT, -260, WALL_RIGHT - WALL_LEFT, FLOOR_TOP + 260, 64, true, true, false, true);
  }

  private buildFruitTextures() {
    for (let tier = 0; tier < FRUIT_RADII.length; tier += 1) {
      const key = fruitTextureKey(tier);
      if (this.textures.exists(key)) continue;
      const radius = FRUIT_RADII[tier];
      const size = Math.ceil(radius * 2 + 8);
      const g = this.add.graphics();
      const cx = size / 2;
      const cy = size / 2;
      g.fillStyle(FRUIT_COLORS[tier], 1);
      g.fillCircle(cx, cy, radius);
      g.lineStyle(2, 0x101114, .5);
      g.strokeCircle(cx, cy, radius);
      g.fillStyle(0xffffff, .4);
      g.fillEllipse(cx - radius * .38, cy - radius * .42, radius * .5, radius * .3);
      g.fillStyle(0x4a332b, 1);
      g.fillCircle(cx - radius * .3, cy - radius * .05, Math.max(2, radius * .12));
      g.fillCircle(cx + radius * .3, cy - radius * .05, Math.max(2, radius * .12));
      g.fillStyle(0xffffff, .9);
      g.fillCircle(cx - radius * .27, cy - radius * .09, Math.max(1, radius * .04));
      g.fillCircle(cx + radius * .33, cy - radius * .09, Math.max(1, radius * .04));
      g.lineStyle(Math.max(2, radius * .09), 0x4a332b, .85);
      g.beginPath();
      g.arc(cx, cy + radius * .18, radius * .32, Phaser.Math.DegToRad(25), Phaser.Math.DegToRad(155));
      g.strokePath();
      g.fillStyle(0x5aa04a, 1);
      g.fillEllipse(cx + radius * .18, cy - radius * .88, radius * .38, radius * .18);
      g.generateTexture(key, size, size);
      g.destroy();
    }
  }

  private buildHudPreviews() {
    this.nextPreview = this.add.image(WIDTH - 44, 140, fruitTextureKey(this.nextTier)).setScale(.5);
    this.add.text(WIDTH - 44, 108, "NEXT", {
      fontFamily: "monospace", fontSize: "8px", color: "#8d8674", letterSpacing: 2,
    }).setOrigin(.5);
    this.currentPreview = this.add.image(this.aimX, SPAWN_Y, fruitTextureKey(this.currentTier));
  }

  private bindInput() {
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.ended) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const radius = FRUIT_RADII[this.currentTier];
      this.aimX = Phaser.Math.Clamp(position.x, WALL_LEFT + radius, WALL_RIGHT - radius);
    });
    this.input.on("pointerup", () => {
      if (this.ended) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      this.dropFruit();
    });
  }

  private dropFruit() {
    if (this.time.now < this.dropReadyAt) return;
    this.dropReadyAt = this.time.now + DROP_COOLDOWN;
    const tier = this.currentTier;
    const fruit = this.spawnFruit(this.aimX, SPAWN_Y, tier);
    fruit.image.setVelocity(Phaser.Math.FloatBetween(-.4, .4), 2);
    this.currentTier = this.nextTier;
    this.nextTier = this.randomSpawnTier();
    this.currentPreview.setTexture(fruitTextureKey(this.currentTier));
    this.nextPreview.setTexture(fruitTextureKey(this.nextTier));
    this.audio.tone({ freq: 240 + tier * 18, endFreq: 170, duration: .12, type: "triangle", gain: .18 });
    this.tweens.add({
      targets: this.currentPreview,
      scale: { from: .8, to: 1 },
      duration: 160,
      ease: "Back.easeOut",
    });
  }

  private randomSpawnTier() {
    const weights = [5, 4, 3, 2, 1];
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = Math.random() * total;
    for (let tier = 0; tier < weights.length; tier += 1) {
      roll -= weights[tier];
      if (roll < 0) return tier;
    }
    return 0;
  }

  private spawnFruit(x: number, y: number, tier: number): Fruit {
    const radius = FRUIT_RADII[tier];
    const image = this.matter.add.image(x, y, fruitTextureKey(tier), undefined, {
      shape: { type: "circle", radius },
      restitution: .12,
      friction: .35,
      frictionStatic: .6,
      density: .0012,
    });
    const fruit: Fruit = { image, tier, merging: false, armed: false, bornAt: this.time.now };
    image.setData("fruit", fruit);
    this.fruits.push(fruit);
    return fruit;
  }

  private handleCollisions = (event: {
    pairs: Array<{ bodyA: { gameObject?: Phaser.GameObjects.GameObject }; bodyB: { gameObject?: Phaser.GameObjects.GameObject } }>;
  }) => {
    if (this.ended) return;
    for (const pair of event.pairs) {
      const a = pair.bodyA.gameObject?.getData("fruit") as Fruit | undefined;
      const b = pair.bodyB.gameObject?.getData("fruit") as Fruit | undefined;
      if (!a || !b || a === b) continue;
      if (a.merging || b.merging || a.tier !== b.tier) continue;
      this.mergePair(a, b);
    }
  };

  private mergePair(a: Fruit, b: Fruit) {
    a.merging = true;
    b.merging = true;
    const tier = a.tier;
    const x = (a.image.x + b.image.x) / 2;
    const y = (a.image.y + b.image.y) / 2;
    this.removeFruit(a);
    this.removeFruit(b);

    this.chain = this.time.now < this.chainExpireAt ? this.chain + 1 : 1;
    this.chainExpireAt = this.time.now + 1100;

    const points = MERGE_POINTS[tier] * this.chain;
    this.score += points;
    this.scoreText.setText(String(this.score).padStart(5, "0"));
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.highScore) this.storage.save({ highScore: this.score });

    this.spawnMergeFx(x, y, tier, points);

    const nextTier = tier + 1;
    if (nextTier < FRUIT_RADII.length) {
      const merged = this.spawnFruit(x, y, nextTier);
      merged.image.setVelocity(Phaser.Math.FloatBetween(-1, 1), -1.2);
      merged.image.setScale(.6);
      this.tweens.add({ targets: merged.image, scale: 1, duration: 170, ease: "Back.easeOut" });
      this.audio.tone({ freq: 300 + nextTier * 42, endFreq: (300 + nextTier * 42) * 1.6, duration: .16, type: "triangle", gain: .26 });
    } else {
      this.score += 500;
      this.scoreText.setText(String(this.score).padStart(5, "0"));
      this.spawnMergeFx(x, y, tier, 500);
      this.cameras.main.shake(260, .014);
      this.audio.tone({ freq: 523, duration: .3, type: "triangle", gain: .3 });
      this.audio.tone({ freq: 659, duration: .3, time: this.audio.now + .1, type: "triangle", gain: .3 });
      this.audio.tone({ freq: 784, duration: .4, time: this.audio.now + .2, type: "triangle", gain: .3 });
    }

    if (this.chain >= 2) {
      this.chainText.setText(`连锁 ×${this.chain}！`);
      this.chainText.setAlpha(1).setScale(1.3);
      this.tweens.add({ targets: this.chainText, scale: 1, duration: 180, ease: "Cubic.easeOut" });
      this.tweens.add({ targets: this.chainText, alpha: 0, delay: 420, duration: 260 });
      for (let note = 0; note < Math.min(this.chain, 4); note += 1) {
        this.audio.tone({
          freq: 620 + note * 130,
          duration: .1,
          time: this.audio.now + .05 + note * .06,
          type: "square",
          gain: .12,
        });
      }
    }
  }

  private removeFruit(fruit: Fruit) {
    const index = this.fruits.indexOf(fruit);
    if (index >= 0) this.fruits.splice(index, 1);
    fruit.image.destroy();
  }

  private spawnMergeFx(x: number, y: number, tier: number, points: number) {
    const color = FRUIT_COLORS[tier];
    const ring = this.add.circle(x, y, FRUIT_RADII[tier] * .8).setStrokeStyle(3, color, .9);
    this.tweens.add({
      targets: ring,
      scale: 2.1,
      alpha: 0,
      duration: 300,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
    for (let index = 0; index < 12; index += 1) {
      const shard = this.add.circle(x, y, Phaser.Math.FloatBetween(2.5, 5), color);
      const angle = Math.random() * Math.PI * 2;
      const speed = Phaser.Math.FloatBetween(70, 190);
      this.tweens.add({
        targets: shard,
        x: x + Math.cos(angle) * speed * .38,
        y: y + Math.sin(angle) * speed * .38 + 40,
        alpha: 0,
        scale: .3,
        duration: Phaser.Math.FloatBetween(320, 520),
        ease: "Cubic.easeOut",
        onComplete: () => shard.destroy(),
      });
    }
    const label = this.add.text(x, y - 18, `+${points}`, {
      fontFamily: "monospace", fontSize: "15px", color: INK, fontStyle: "bold",
    }).setOrigin(.5);
    this.tweens.add({
      targets: label,
      y: y - 52,
      alpha: 0,
      duration: 620,
      ease: "Cubic.easeOut",
      onComplete: () => label.destroy(),
    });
    if (tier >= 6) this.cameras.main.shake(110, .005);
  }

  private drawDangerLine(color: number, alpha: number) {
    this.dangerLine.clear();
    this.dangerLine.lineStyle(2, color, alpha);
    for (let x = WALL_LEFT; x < WALL_RIGHT; x += 18) {
      this.dangerLine.lineBetween(x, DANGER_Y, Math.min(x + 10, WALL_RIGHT), DANGER_Y);
    }
  }

  update(time: number, delta: number) {
    if (this.ended) return;
    this.currentPreview.setPosition(this.aimX, SPAWN_Y);
    this.aimGraphics.clear();
    this.aimGraphics.lineStyle(1.5, 0x101114, .14);
    this.aimGraphics.lineBetween(this.aimX, SPAWN_Y + FRUIT_RADII[this.currentTier] + 4, this.aimX, FLOOR_TOP - 6);

    let anyArmedAbove = false;
    for (const fruit of this.fruits) {
      if (!fruit.armed) {
        if (fruit.image.y - FRUIT_RADII[fruit.tier] > DANGER_Y + 6 || time - fruit.bornAt > 2600) {
          fruit.armed = true;
        }
      }
      if (fruit.armed && fruit.image.y - FRUIT_RADII[fruit.tier] < DANGER_Y) {
        anyArmedAbove = true;
      }
    }

    if (anyArmedAbove) {
      this.dangerMs += delta;
      const pulse = .45 + Math.sin(time / 90) * .3;
      this.drawDangerLine(0xff453a, pulse);
      if (this.dangerMs > DANGER_LIMIT) {
        this.endRun();
        return;
      }
    } else {
      this.dangerMs = Math.max(0, this.dangerMs - delta * 2.4);
      this.drawDangerLine(0x101114, .3);
    }

    if (this.chain > 0 && time > this.chainExpireAt) this.chain = 0;
  }

  private endRun() {
    this.ended = true;
    this.matter.world.pause();
    this.audio.tone({ freq: 330, endFreq: 110, duration: .7, type: "sawtooth", gain: .22 });
    this.cameras.main.shake(240, .012);
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    const bestText = this.children.getByName("best-score") as Phaser.GameObjects.Text | null;
    bestText?.setText(`BEST  ${String(highScore).padStart(5, "0")}`);
    this.bridge.gameOver(this.score);

    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .5)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(WIDTH / 2, 560, 312, 190, 0xf7f1e3)
      .setStrokeStyle(2, 0x101114).setDepth(101);
    this.add.text(WIDTH / 2, 524, "果酱了！", {
      fontFamily: "sans-serif", fontSize: "26px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    const biggest = this.fruits.reduce((max, fruit) => Math.max(max, fruit.tier), 0);
    this.add.text(WIDTH / 2, 562, `最大 ${FRUIT_NAMES[biggest]}  ·  ${this.score} 分  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#777872", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(WIDTH / 2, 610, 184, 42, 0x101114)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(WIDTH / 2, 610, "再来一筐  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: CREAM, fontStyle: "bold",
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
  backgroundColor: CREAM,
  physics: {
    default: "matter",
    matter: { gravity: { x: 0, y: 1.3 }, enableSleeping: true },
  },
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: FruitMergeScene,
});
