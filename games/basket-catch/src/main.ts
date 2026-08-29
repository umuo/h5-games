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
const BASKET_Y = 736;
const BASKET_HALF = 46;
const GROUND_Y = 800;

interface Drop {
  container: Phaser.GameObjects.Container;
  kind: "chick" | "golden" | "bomb";
  vy: number;
  spin: number;
}

class BasketCatchScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private basket!: Phaser.GameObjects.Container;
  private drops: Drop[] = [];
  private basketX = CENTER_X;
  private lives = 3;
  private score = 0;
  private combo = 0;
  private lastCatchAt = 0;
  private nextSpawnAt = 800;
  private runStart = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "basket-catch", version: "1.0.0" });
  private storage = createGameStorage("basket-catch", { highScore: 0 });

  constructor() { super("basket-catch"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#fdf6e3");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 48, 48, 0xfdf6e3, 1, 0x101114, .04);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0x101114, .25);
    this.add.text(22, 43, "CATCH / 032", {
      fontFamily: "monospace", fontSize: "11px", color: INK, letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "天降小鸡", {
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
      fontFamily: "monospace", fontSize: "16px", color: "#ff9d3d", fontStyle: "bold", letterSpacing: 2,
    }).setOrigin(.5).setAlpha(0);
    this.add.rectangle(CENTER_X, GROUND_Y + 22, WIDTH, 44, 0x9fe08a);
    this.add.rectangle(CENTER_X, GROUND_Y + 2, WIDTH, 3, 0x2f5d33, .6);

    this.buildTextures();
    const weave = this.add.graphics();
    weave.fillStyle(0xc9995f, 1);
    weave.fillRoundedRect(-BASKET_HALF, -18, BASKET_HALF * 2, 40, 6);
    weave.lineStyle(2, 0x8a5a34, .8);
    for (let index = -2; index <= 2; index += 1) {
      weave.lineBetween(index * 18, -16, index * 16, 20);
    }
    weave.strokeRoundedRect(-BASKET_HALF, -18, BASKET_HALF * 2, 40, 6);
    weave.fillStyle(0x8a5a34, 1);
    weave.fillRect(-BASKET_HALF - 3, -20, BASKET_HALF * 2 + 6, 7);
    this.basket = this.add.container(this.basketX, BASKET_Y, [weave]).setDepth(10);

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.drops = [];
    this.basketX = CENTER_X;
    this.lives = 3;
    this.score = 0;
    this.combo = 0;
    this.lastCatchAt = 0;
    this.nextSpawnAt = 700;
    this.runStart = 0;
    this.started = false;
    this.ended = false;
  }

  private buildTextures() {
    const build = (key: string, body: number, belly: number) => {
      if (this.textures.exists(key)) return;
      const g = this.add.graphics();
      const c = 22;
      g.fillStyle(body, 1);
      g.fillCircle(c, c, 18);
      g.fillStyle(belly, .85);
      g.fillEllipse(c, c + 7, 20, 13);
      g.fillStyle(0xff9d3d, 1);
      g.fillTriangle(c - 4, c, c + 4, c, c, c + 6);
      g.fillStyle(0x101114, 1);
      g.fillCircle(c - 7, c - 6, 2.6);
      g.fillCircle(c + 7, c - 6, 2.6);
      g.fillStyle(0xffffff, .9);
      g.fillCircle(c - 6, c - 7, 1);
      g.fillCircle(c + 8, c - 7, 1);
      g.fillStyle(body, .8);
      g.fillEllipse(c - 15, c + 2, 9, 5);
      g.fillEllipse(c + 15, c + 2, 9, 5);
      g.generateTexture(key, 44, 44);
      g.destroy();
    };
    build("drop-chick", 0xffd44d, 0xfff3b0);
    build("drop-golden", 0xffb84d, 0xffe08a);
    const bomb = this.add.graphics();
    bomb.fillStyle(0x1b1d21, 1);
    bomb.fillCircle(22, 24, 17);
    bomb.fillStyle(0xffffff, .25);
    bomb.fillEllipse(16, 16, 10, 6);
    bomb.lineStyle(3, 0x8d8674, 1);
    bomb.lineBetween(27, 10, 34, 2);
    bomb.fillStyle(0xff6a51, 1);
    bomb.fillCircle(35, 1, 4);
    bomb.generateTexture("drop-bomb", 44, 44);
    bomb.destroy();
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended) return;
      if (!this.started) {
        this.started = true;
        this.runStart = this.time.now;
        this.nextSpawnAt = this.time.now + 400;
        this.bridge.started();
        this.audio.unlock();
      }
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.basketX = Phaser.Math.Clamp(position.x, BASKET_HALF, WIDTH - BASKET_HALF);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || !pointer.isDown) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.basketX = Phaser.Math.Clamp(position.x, BASKET_HALF, WIDTH - BASKET_HALF);
    });
  }

  private spawnDrop() {
    const elapsed = this.time.now - this.runStart;
    const roll = Math.random();
    const kind: Drop["kind"] = roll < .12 ? "golden" : roll < .12 + Math.min(.24, .14 + elapsed / 240000) ? "bomb" : "chick";
    const speed = 190 + Math.min(elapsed / 24, 260) + Phaser.Math.Between(-20, 30);
    const key = kind === "bomb" ? "drop-bomb" : kind === "golden" ? "drop-golden" : "drop-chick";
    const image = this.add.image(0, 0, key);
    const container = this.add.container(
      Phaser.Math.Between(40, WIDTH - 40),
      -30,
      [image],
    ).setDepth(5);
    this.drops.push({
      container, kind,
      vy: speed,
      spin: Phaser.Math.FloatBetween(-70, 70),
    });
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

  private catchDrop(drop: Drop) {
    const index = this.drops.indexOf(drop);
    if (index >= 0) this.drops.splice(index, 1);
    drop.container.destroy();
    const now = this.time.now;
    if (drop.kind === "bomb") {
      this.lives -= 1;
      this.livesText.setText("● ● ●".slice(0, Math.max(this.lives, 0) * 2).trim() || "—");
      this.combo = 0;
      this.cameras.main.shake(220, .014);
      this.cameras.main.flash(150, 255, 106, 81, false);
      this.audio.noise({ freq: 650, duration: .3, gain: .28, type: "lowpass" });
      if (this.lives <= 0) this.endRun();
      return;
    }
    this.combo = now - this.lastCatchAt < 2200 ? this.combo + 1 : 1;
    this.lastCatchAt = now;
    const base = drop.kind === "golden" ? 30 : 10;
    const earned = base + (this.combo > 2 ? this.combo * 2 : 0);
    this.score += earned;
    this.refreshScore();
    this.audio.tone({ freq: drop.kind === "golden" ? 880 : 620, duration: .1, type: "triangle", gain: .16 });
    for (let index2 = 0; index2 < 6; index2 += 1) {
      const star = this.add.star(this.basketX + Phaser.Math.Between(-20, 20), BASKET_Y - 24, 5, 3.5, 8,
        drop.kind === "golden" ? 0xffd44d : 0xfff3b0);
      this.tweens.add({
        targets: star,
        y: star.y - Phaser.Math.Between(24, 48),
        angle: Phaser.Math.Between(-90, 90),
        alpha: 0,
        duration: 360,
        onComplete: () => star.destroy(),
      });
    }
    if (this.combo >= 3) {
      this.comboText.setText(`连击 ×${this.combo}`);
      this.comboText.setAlpha(1).setScale(1.2);
      this.tweens.killTweensOf(this.comboText);
      this.tweens.add({ targets: this.comboText, scale: 1, duration: 130 });
      this.tweens.add({ targets: this.comboText, alpha: 0, delay: 520, duration: 220 });
    }
  }

  private missDrop(drop: Drop) {
    const index = this.drops.indexOf(drop);
    if (index >= 0) this.drops.splice(index, 1);
    drop.container.destroy();
    if (drop.kind === "bomb") return;
    this.lives -= 1;
    this.livesText.setText("● ● ●".slice(0, Math.max(this.lives, 0) * 2).trim() || "—");
    this.combo = 0;
    this.audio.tone({ freq: 220, endFreq: 150, duration: .16, type: "sine", gain: .1 });
    if (this.lives <= 0) this.endRun();
  }

  update(time: number, delta: number) {
    if (this.ended) return;
    const seconds = Math.min(delta, 40) / 1000;
    this.basket.x = Phaser.Math.Linear(this.basket.x, this.basketX, Math.min(1, seconds * 10));

    if (this.started && time >= this.nextSpawnAt) {
      const elapsed = time - this.runStart;
      this.nextSpawnAt = time + Math.max(320, 850 - elapsed / 20);
      this.spawnDrop();
    }

    for (let index = this.drops.length - 1; index >= 0; index -= 1) {
      const drop = this.drops[index];
      drop.vy += 60 * seconds;
      drop.container.y += drop.vy * seconds;
      drop.container.angle += drop.spin * seconds;
      if (Math.abs(drop.container.x - this.basket.x) < BASKET_HALF - 6
        && drop.container.y > BASKET_Y - 26 && drop.container.y < BASKET_Y + 8) {
        this.catchDrop(drop);
        continue;
      }
      if (drop.container.y > GROUND_Y - 6) {
        if (drop.kind !== "bomb") {
          const splat = this.add.ellipse(drop.container.x, GROUND_Y - 4, 22, 7, drop.kind === "golden" ? 0xffb84d : 0xffd44d, .8);
          this.tweens.add({ targets: splat, alpha: 0, duration: 500, onComplete: () => splat.destroy() });
        }
        this.missDrop(drop);
      }
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    this.audio.tone({ freq: 300, endFreq: 80, duration: .6, type: "sawtooth", gain: .22 });
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .55)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0xfdf6e3)
      .setStrokeStyle(2, 0x101114).setDepth(101);
    this.add.text(CENTER_X, 502, "篮子翻了", {
      fontFamily: "sans-serif", fontSize: "25px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `${this.score} 分  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "12px", color: "#777872", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0x101114)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "再来一篮  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#fdf6e3", fontStyle: "bold",
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
  backgroundColor: "#fdf6e3",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: BasketCatchScene,
});
