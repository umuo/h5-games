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
const GRAVITY = 1350;
const SLICE_RADIUS_PAD = 6;
const COMBO_WINDOW = 420;

const FRUIT_KINDS = [
  { key: "melon", color: 0x53c953, pulp: 0xff6a51, radius: 30 },
  { key: "orange", color: 0xffa63d, pulp: 0xffc24b, radius: 24 },
  { key: "apple", color: 0xff5f6d, pulp: 0xf3f0e8, radius: 24 },
  { key: "lemon", color: 0xffd94d, pulp: 0xfff3b0, radius: 22 },
  { key: "plum", color: 0x9b6bff, pulp: 0xd9c2ff, radius: 21 },
] as const;

const INK = "#101114";

interface Flying {
  container: Phaser.GameObjects.Container;
  kind: string;
  color: number;
  radius: number;
  isBomb: boolean;
  vx: number;
  vy: number;
  sliced: boolean;
}

interface Half {
  image: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  spin: number;
}

class SliceFruitScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private bladeGraphics!: Phaser.GameObjects.Graphics;
  private trail: Array<{ x: number; y: number; at: number }> = [];
  private flying: Flying[] = [];
  private halves: Half[] = [];
  private particles: Array<{ circle: Phaser.GameObjects.Arc; vx: number; vy: number }> = [];
  private pointerPrev?: Phaser.Math.Vector2;
  private sliceTimes: number[] = [];
  private nextWaveAt = 900;
  private runStart = 0;
  private score = 0;
  private lives = 3;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "slice-fruit", version: "1.0.0" });
  private storage = createGameStorage("slice-fruit", { highScore: 0 });

  constructor() { super("slice-fruit"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#f3f0e8");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 48, 48, 0xf3f0e8, 1, 0x101114, .04);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0x101114, .25);
    this.add.text(22, 43, "SLICE / 022", {
      fontFamily: "monospace", fontSize: "11px", color: INK, letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "切水果", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#74726c",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(22, 66, "0", {
      fontFamily: "monospace", fontSize: "40px", color: INK, fontStyle: "bold",
    });
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 22, 76, `BEST ${saved.highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#74726c", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.livesText = this.add.text(WIDTH - 22, 96, "● ● ●", {
      fontFamily: "monospace", fontSize: "11px", color: "#ff6a51", letterSpacing: 5,
    }).setOrigin(1, 0);
    this.comboText = this.add.text(CENTER_X, 120, "", {
      fontFamily: "monospace", fontSize: "17px", color: "#ff6a51", fontStyle: "bold", letterSpacing: 2,
    }).setOrigin(.5).setAlpha(0);

    this.bladeGraphics = this.add.graphics().setDepth(20);
    this.buildTextures();
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.trail = [];
    this.flying = [];
    this.halves = [];
    this.particles = [];
    this.pointerPrev = undefined;
    this.sliceTimes = [];
    this.nextWaveAt = 900;
    this.runStart = 0;
    this.score = 0;
    this.lives = 3;
    this.started = false;
    this.ended = false;
  }

  private buildTextures() {
    const build = (key: string, size: number, draw: (g: Phaser.GameObjects.Graphics, cx: number) => void) => {
      if (this.textures.exists(key)) return;
      const g = this.add.graphics();
      draw(g, size / 2);
      g.generateTexture(key, size, size);
      g.destroy();
    };
    for (const fruit of FRUIT_KINDS) {
      const size = fruit.radius * 2 + 8;
      build(`sf-${fruit.key}`, size, (g, cx) => {
        g.fillStyle(fruit.color, 1);
        g.fillCircle(cx, cx, fruit.radius);
        g.lineStyle(2, 0x101114, .45);
        g.strokeCircle(cx, cx, fruit.radius);
        g.fillStyle(0xffffff, .35);
        g.fillEllipse(cx - fruit.radius * .34, cx - fruit.radius * .38, fruit.radius * .6, fruit.radius * .34);
        g.fillStyle(0x5aa04a, 1);
        g.fillEllipse(cx + fruit.radius * .2, cx - fruit.radius * .92, fruit.radius * .42, fruit.radius * .2);
      });
      const halfSize = fruit.radius + 6;
      for (const side of ["l", "r"] as const) {
        build(`sf-${fruit.key}-${side}`, halfSize * 2, (g, cx) => {
          const flip = side === "r" ? -1 : 1;
          g.fillStyle(fruit.color, 1);
          g.slice(cx, cx, fruit.radius, side === "l" ? Math.PI / 2 : -Math.PI / 2, side === "l" ? Math.PI * 1.5 : Math.PI / 2, false);
          g.fillPath();
          g.fillStyle(fruit.pulp, 1);
          g.fillCircle(cx + flip * fruit.radius * .3, cx, fruit.radius * .62);
          g.fillStyle(0x101114, .35);
          for (let seed = 0; seed < 3; seed += 1) {
            g.fillCircle(cx + flip * fruit.radius * (.3 + (seed % 2) * .18), cx - fruit.radius * .18 + seed * fruit.radius * .22, 1.6);
          }
          g.lineStyle(2, 0x101114, .4);
          g.beginPath();
          g.arc(cx, cx, fruit.radius, side === "l" ? Math.PI / 2 : -Math.PI / 2, side === "l" ? Math.PI * 1.5 : Math.PI / 2, false);
          g.strokePath();
        });
      }
    }
    build("sf-bomb", 72, (g, cx) => {
      g.fillStyle(0x1b1d21, 1);
      g.fillCircle(cx, cx + 4, 26);
      g.lineStyle(2, 0x000000, .5);
      g.strokeCircle(cx, cx + 4, 26);
      g.fillStyle(0xffffff, .25);
      g.fillEllipse(cx - 9, cx - 6, 12, 7);
      g.lineStyle(3.5, 0x8d8674, 1);
      g.lineBetween(cx + 6, cx - 18, cx + 13, cx - 30);
      g.fillStyle(0xff6a51, 1);
      g.fillCircle(cx + 14, cx - 31, 4);
    });
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.pointerPrev = new Phaser.Math.Vector2(position.x, position.y);
      this.trail.push({ x: position.x, y: position.y, at: this.time.now });
      if (!this.started) {
        this.started = true;
        this.runStart = this.time.now;
        this.nextWaveAt = this.time.now + 500;
        this.bridge.started();
        this.audio.unlock();
      }
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || !pointer.isDown) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const previous = this.pointerPrev ?? new Phaser.Math.Vector2(position.x, position.y);
      this.trail.push({ x: position.x, y: position.y, at: this.time.now });
      if (this.trail.length > 16) this.trail.shift();
      this.checkSlices(previous.x, previous.y, position.x, position.y);
      this.pointerPrev = new Phaser.Math.Vector2(position.x, position.y);
    });
    const release = () => {
      this.pointerPrev = undefined;
    };
    this.input.on("pointerup", release);
    this.input.on("pointerupoutside", release);
  }

  private checkSlices(x1: number, y1: number, x2: number, y2: number) {
    if (x1 === x2 && y1 === y2) return;
    for (const item of [...this.flying]) {
      if (item.sliced) continue;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lengthSquared = dx * dx + dy * dy;
      let t = ((item.container.x - x1) * dx + (item.container.y - y1) * dy) / lengthSquared;
      t = Phaser.Math.Clamp(t, 0, 1);
      const closestX = x1 + t * dx;
      const closestY = y1 + t * dy;
      if (Phaser.Math.Distance.Between(closestX, closestY, item.container.x, item.container.y) <= item.radius + SLICE_RADIUS_PAD) {
        if (item.isBomb) this.hitBomb(item);
        else this.sliceFruit(item, x1, y1, x2, y2);
      }
    }
  }

  private sliceFruit(item: Flying, x1: number, y1: number, x2: number, y2: number) {
    item.sliced = true;
    const index = this.flying.indexOf(item);
    if (index >= 0) this.flying.splice(index, 1);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const normal = angle + Math.PI / 2;
    this.score += 2;
    this.refreshScore();
    this.spawnHalves(item, normal);
    this.spawnJuice(item.container.x, item.container.y, item.color);
    this.audio.noise({ freq: 2400, duration: .06, gain: .16 });
    this.audio.tone({ freq: 320, endFreq: 110, duration: .12, type: "triangle", gain: .14 });

    this.sliceTimes.push(this.time.now);
    this.sliceTimes = this.sliceTimes.filter((stamp) => this.time.now - stamp <= COMBO_WINDOW);
    if (this.sliceTimes.length >= 3) {
      const comboCount = this.sliceTimes.length;
      const bonus = 10 * comboCount;
      this.score += bonus;
      this.refreshScore();
      this.comboText.setText(`${comboCount} 连斩  +${bonus}`);
      this.comboText.setAlpha(1).setScale(1.25);
      this.tweens.killTweensOf(this.comboText);
      this.tweens.add({ targets: this.comboText, scale: 1, duration: 140 });
      this.tweens.add({ targets: this.comboText, alpha: 0, delay: 520, duration: 260 });
      this.audio.tone({ freq: 660, duration: .12, type: "triangle", gain: .16 });
      this.audio.tone({ freq: 880, duration: .16, time: this.audio.now + .09, type: "triangle", gain: .16 });
    }
    item.container.destroy();
  }

  private spawnHalves(item: Flying, normal: number) {
    if (item.isBomb) return;
    for (const side of ["l", "r"] as const) {
      const image = this.add.image(item.container.x, item.container.y, `sf-${item.kind}-${side}`);
      const push = side === "l" ? -1 : 1;
      const half: Half = {
        image,
        vx: item.vx + Math.cos(normal) * push * 130,
        vy: item.vy * .5 - 120 + Math.sin(normal) * push * 130,
        spin: push * Phaser.Math.FloatBetween(2, 5),
      };
      this.halves.push(half);
    }
  }

  private spawnJuice(x: number, y: number, color: number) {
    for (let index = 0; index < 11; index += 1) {
      const circle = this.add.circle(x, y, Phaser.Math.FloatBetween(2, 4.5), color);
      this.particles.push({
        circle,
        vx: Phaser.Math.FloatBetween(-170, 170),
        vy: Phaser.Math.FloatBetween(-220, 60),
      });
    }
  }

  private hitBomb(item: Flying) {
    item.sliced = true;
    const index = this.flying.indexOf(item);
    if (index >= 0) this.flying.splice(index, 1);
    item.container.destroy();
    this.lives -= 1;
    this.livesText.setText("● ● ●".slice(0, Math.max(this.lives, 0) * 2).trim() || "—");
    this.cameras.main.shake(260, .016);
    this.cameras.main.flash(160, 255, 106, 81, false);
    this.audio.noise({ freq: 700, duration: .4, gain: .32, type: "lowpass" });
    this.audio.tone({ freq: 160, endFreq: 40, duration: .5, type: "sawtooth", gain: .26 });
    for (let index2 = 0; index2 < 24; index2 += 1) {
      const circle = this.add.circle(item.container.x, item.container.y, Phaser.Math.FloatBetween(2, 5), 0xff8a3d);
      this.particles.push({
        circle,
        vx: Phaser.Math.FloatBetween(-320, 320),
        vy: Phaser.Math.FloatBetween(-320, 100),
      });
    }
    if (this.lives <= 0) this.endRun();
  }

  private spawnWave() {
    const elapsed = this.time.now - this.runStart;
    const count = Phaser.Math.Clamp(1 + Math.floor(elapsed / 14000), 1, 4);
    const bombChance = Math.min(.22, .12 + elapsed / 300000);
    for (let index = 0; index < count; index += 1) {
      this.time.delayedCall(index * Phaser.Math.Between(120, 240), () => {
        if (this.ended) return;
        const isBomb = Math.random() < bombChance;
        const kind = FRUIT_KINDS[Phaser.Math.Between(0, FRUIT_KINDS.length - 1)];
        const radius = isBomb ? 26 : kind.radius;
        const x = Phaser.Math.Between(60, WIDTH - 60);
        const apex = Phaser.Math.Between(480, 700);
        const vy = -Math.sqrt(2 * GRAVITY * apex);
        const vx = Phaser.Math.Clamp((CENTER_X - x) * Phaser.Math.FloatBetween(.3, .9), -170, 170);
        const key = isBomb ? "sf-bomb" : `sf-${kind.key}`;
        const image = this.add.image(x, HEIGHT + radius + 10, key);
        const container = this.add.container(x, HEIGHT + radius + 10, [image]);
        this.flying.push({
          container, kind: kind.key, color: isBomb ? 0xff8a3d : kind.color,
          radius, isBomb, vx, vy, sliced: false,
        });
      });
    }
  }

  private refreshScore() {
    this.scoreText.setText(String(this.score));
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
      this.bestText.setText(`BEST ${this.score}`);
    }
  }

  update(time: number, delta: number) {
    const seconds = Math.min(delta, 40) / 1000;

    if (this.started && !this.ended && time >= this.nextWaveAt) {
      const elapsed = time - this.runStart;
      this.nextWaveAt = time + Math.max(760, 1500 - elapsed / 22);
      this.spawnWave();
    }

    for (let index = this.flying.length - 1; index >= 0; index -= 1) {
      const item = this.flying[index];
      item.vy += GRAVITY * seconds;
      item.container.x += item.vx * seconds;
      item.container.y += item.vy * seconds;
      item.container.angle += 60 * seconds;
      if (item.container.y > HEIGHT + item.radius + 80) {
        this.flying.splice(index, 1);
        item.container.destroy();
        if (!item.isBomb && !item.sliced && !this.ended) {
          this.lives -= 1;
          this.livesText.setText("● ● ●".slice(0, Math.max(this.lives, 0) * 2).trim() || "—");
          this.audio.tone({ freq: 220, endFreq: 150, duration: .16, type: "sine", gain: .1 });
          if (this.lives <= 0) this.endRun();
        }
      }
    }

    for (let index = this.halves.length - 1; index >= 0; index -= 1) {
      const half = this.halves[index];
      half.vy += GRAVITY * seconds;
      half.image.x += half.vx * seconds;
      half.image.y += half.vy * seconds;
      half.image.angle += half.spin;
      half.image.alpha -= seconds * .9;
      if (half.image.alpha <= 0 || half.image.y > HEIGHT + 60) {
        half.image.destroy();
        this.halves.splice(index, 1);
      }
    }

    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.vy += GRAVITY * seconds * .8;
      particle.circle.x += particle.vx * seconds;
      particle.circle.y += particle.vy * seconds;
      particle.circle.alpha -= seconds * 1.7;
      if (particle.circle.alpha <= 0) {
        particle.circle.destroy();
        this.particles.splice(index, 1);
      }
    }

    const now = time;
    this.trail = this.trail.filter((point) => now - point.at < 130);
    this.bladeGraphics.clear();
    for (let index = 1; index < this.trail.length; index += 1) {
      const alpha = (index / this.trail.length) * .8;
      this.bladeGraphics.lineStyle(3.2, 0xffffff, alpha);
      this.bladeGraphics.lineBetween(
        this.trail[index - 1].x, this.trail[index - 1].y, this.trail[index].x, this.trail[index].y,
      );
      this.bladeGraphics.lineStyle(6.5, 0x54e0ff, alpha * .25);
      this.bladeGraphics.lineBetween(
        this.trail[index - 1].x, this.trail[index - 1].y, this.trail[index].x, this.trail[index].y,
      );
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    this.audio.tone({ freq: 280, endFreq: 70, duration: .7, type: "sawtooth", gain: .22 });
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .55)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 550, 308, 186, 0xf3f0e8)
      .setStrokeStyle(2, 0x101114).setDepth(101);
    this.add.text(CENTER_X, 512, "刀钝了", {
      fontFamily: "sans-serif", fontSize: "25px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 552, `${this.score} 分  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "12px", color: "#777872", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 600, 184, 42, 0x101114)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 600, "再战一局  ↻", {
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
  scene: SliceFruitScene,
});
