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
const BLOCK_HEIGHT = 26;
const BASE_WIDTH = 230;
const START_Y = 740;
const SWING_MARGIN = 24;
const PERFECT_TOLERANCE = 5;
const MIN_WIDTH = 10;

interface Slab {
  x: number;
  y: number;
  width: number;
  container: Phaser.GameObjects.Container;
}

function slabColor(floor: number) {
  return Phaser.Display.Color.HSLToColor((floor * 22 % 360) / 360, .62, .56).color;
}

class StackTowerScene extends Phaser.Scene {
  private world!: Phaser.GameObjects.Container;
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private tower: Slab[] = [];
  private moving?: { container: Phaser.GameObjects.Container; width: number; direction: number; speed: number; y: number };
  private debris: Array<{ container: Phaser.GameObjects.Container; vy: number; spin: number }> = [];
  private score = 0;
  private combo = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "stack-tower", version: "1.0.0" });
  private storage = createGameStorage("stack-tower", { highScore: 0 });

  constructor() { super("stack-tower"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#0b0e14");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 44, 44, 0x0b0e14, 1, 0x2b2d32, .4);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "STACK / 024", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "堆塔", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(WIDTH / 2, 60, "0", {
      fontFamily: "monospace", fontSize: "42px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5, 0);
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 22, 74, `BEST ${saved.highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.comboText = this.add.text(CENTER_X, 150, "", {
      fontFamily: "monospace", fontSize: "16px", color: "#ffd44d", fontStyle: "bold", letterSpacing: 2,
    }).setOrigin(.5).setAlpha(0);
    this.hintText = this.add.text(CENTER_X, 800, "点击放下方块 · 对齐中心触发完美", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    this.world = this.add.container(0, 0);
    this.layBase();

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.tower = [];
    this.moving = undefined;
    this.debris = [];
    this.score = 0;
    this.combo = 0;
    this.started = false;
    this.ended = false;
  }

  private drawSlab(container: Phaser.GameObjects.Container, width: number, color: number) {
    const g = this.add.graphics();
    const height = BLOCK_HEIGHT;
    g.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(34).color, 1);
    g.fillRect(-width / 2, 0, width, height);
    g.fillStyle(color, 1);
    g.fillRect(-width / 2, 0, width, height * .62);
    g.fillStyle(0xffffff, .22);
    g.fillRect(-width / 2 + 3, 2, width - 6, 5);
    g.lineStyle(1, 0x0b0e14, .5);
    g.strokeRect(-width / 2, 0, width, height);
    container.add(g);
  }

  private layBase() {
    const base = this.add.container(CENTER_X, START_Y);
    this.drawSlab(base, BASE_WIDTH, slabColor(0));
    this.world.add(base);
    const slab: Slab = { x: CENTER_X, y: START_Y, width: BASE_WIDTH, container: base };
    this.tower.push(slab);
    this.spawnMoving();
  }

  private topSlab() {
    return this.tower[this.tower.length - 1];
  }

  private spawnMoving() {
    const top = this.topSlab();
    const y = top.y - BLOCK_HEIGHT;
    const width = top.width;
    const container = this.add.container(SWING_MARGIN + width / 2, y);
    this.drawSlab(container, width, slabColor(this.tower.length));
    this.world.add(container);
    this.moving = {
      container,
      width,
      direction: 1,
      speed: Math.min(400, 150 + this.tower.length * 7),
      y,
    };
  }

  private bindInput() {
    this.input.on("pointerup", () => {
      if (this.ended || !this.moving) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      this.drop();
    });
  }

  private drop() {
    const moving = this.moving;
    if (!moving) return;
    const below = this.topSlab();
    this.moving = undefined;
    const left = Math.max(moving.container.x - moving.width / 2, below.x - below.width / 2);
    const right = Math.min(moving.container.x + moving.width / 2, below.x + below.width / 2);
    const overlap = right - left;
    const color = slabColor(this.tower.length);
    const offset = moving.container.x - below.x;

    if (overlap <= MIN_WIDTH) {
      this.debris.push({
        container: moving.container,
        vy: 60,
        spin: moving.direction * Phaser.Math.FloatBetween(60, 140),
      });
      this.audio.noise({ freq: 700, duration: .2, gain: .16 });
      this.endRun();
      return;
    }

    const perfect = Math.abs(offset) <= PERFECT_TOLERANCE;
    const placedWidth = perfect ? moving.width : overlap;
    const placedX = perfect ? below.x : (left + right) / 2;
    moving.container.destroy();
    const placed = this.add.container(placedX, moving.y);
    this.drawSlab(placed, placedWidth, color);
    this.world.add(placed);
    const slab: Slab = { x: placedX, y: moving.y, width: placedWidth, container: placed };
    this.tower.push(slab);

    if (perfect) {
      this.combo += 1;
      this.score += this.combo;
      const ring = this.add.rectangle(placedX, moving.y + BLOCK_HEIGHT / 2, placedWidth + 16, BLOCK_HEIGHT + 14)
        .setStrokeStyle(3, 0xffffff, .95);
      this.world.add(ring);
      this.tweens.add({ targets: ring, alpha: 0, scaleX: 1.25, duration: 300, onComplete: () => ring.destroy() });
      this.audio.tone({ freq: 560 + Math.min(this.combo, 10) * 55, duration: .16, type: "triangle", gain: .2 });
      this.comboText.setText(`完美 ×${this.combo}`);
      this.comboText.setAlpha(1).setScale(1.2);
      this.tweens.killTweensOf(this.comboText);
      this.tweens.add({ targets: this.comboText, scale: 1, duration: 140 });
      this.tweens.add({ targets: this.comboText, alpha: 0, delay: 600, duration: 240 });
    } else {
      this.combo = 0;
      this.score += 1;
      this.audio.tone({ freq: 170, endFreq: 120, duration: .1, type: "square", gain: .12 });
      const cutLeft = left - (moving.container.x - moving.width / 2);
      const cutRight = (moving.container.x + moving.width / 2) - right;
      if (cutLeft > 1) {
        this.dropDebris((left + (moving.container.x - moving.width / 2)) / 2, moving.y, cutLeft, color);
      }
      if (cutRight > 1) {
        this.dropDebris((right + (moving.container.x + moving.width / 2)) / 2, moving.y, cutRight, color);
      }
    }

    this.scoreText.setText(String(this.score));
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
      this.bestText.setText(`BEST ${this.score}`);
    }

    const worldShift = BLOCK_HEIGHT;
    this.tweens.add({
      targets: this.world,
      y: this.world.y + worldShift,
      duration: 200,
      ease: "Cubic.easeOut",
      onComplete: () => {
        for (const slab of [...this.tower]) {
          if (slab.y + this.world.y > HEIGHT + 80 && slab !== this.topSlab()) {
            this.tower.splice(this.tower.indexOf(slab), 1);
            slab.container.destroy();
          }
        }
      },
    });
    this.spawnMoving();
  }

  private dropDebris(x: number, y: number, width: number, color: number) {
    if (width <= 1) return;
    const container = this.add.container(x, y);
    this.drawSlab(container, width, color);
    this.world.add(container);
    this.debris.push({
      container,
      vy: Phaser.Math.FloatBetween(-40, 30),
      spin: Phaser.Math.FloatBetween(-160, 160),
    });
    this.audio.noise({ freq: 800, duration: .12, gain: .1 });
  }

  update(time: number, delta: number) {
    const seconds = Math.min(delta, 40) / 1000;
    const moving = this.moving;
    if (moving && !this.ended) {
      moving.container.x += moving.direction * moving.speed * seconds;
      if (moving.container.x > WIDTH - SWING_MARGIN - moving.width / 2) {
        moving.container.x = WIDTH - SWING_MARGIN - moving.width / 2;
        moving.direction = -1;
      } else if (moving.container.x < SWING_MARGIN + moving.width / 2) {
        moving.container.x = SWING_MARGIN + moving.width / 2;
        moving.direction = 1;
      }
    }
    for (let index = this.debris.length - 1; index >= 0; index -= 1) {
      const chunk = this.debris[index];
      chunk.vy += 1500 * seconds;
      chunk.container.y += chunk.vy * seconds;
      chunk.container.angle += chunk.spin * seconds;
      if (chunk.container.y > HEIGHT + 80) {
        chunk.container.destroy();
        this.debris.splice(index, 1);
      }
    }
    if (this.combo > 0) {
      this.comboText.y = 150 + Math.sin(time / 160) * 2;
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    this.cameras.main.shake(220, .012);
    this.audio.tone({ freq: 260, endFreq: 60, duration: .6, type: "sawtooth", gain: .22 });
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    const floors = this.tower.length - 1;
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x0b0e14, .62)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0x1b1d21)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(CENTER_X, 500, "塔倒了", {
      fontFamily: "sans-serif", fontSize: "25px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 542, `${floors} 层  ·  ${this.score} 分  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "重头再堆  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#0b0e14", fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    replay.on("pointerup", () => this.scene.restart());
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: [shade, panel], alpha: { from: 0, to: 1 }, duration: 220 });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#0b0e14",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: StackTowerScene,
});
