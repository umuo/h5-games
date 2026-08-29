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
const RUN_TIME = 45000;
const HOLE_COLUMNS = [78, 195, 312];
const HOLE_ROWS = [400, 540, 680];
const HOLE_RADIUS = 52;

type MoleKind = "normal" | "golden" | "bomb";

interface Mole {
  kind: MoleKind;
  container: Phaser.GameObjects.Container;
  holeIndex: number;
  expiresAt: number;
  hit: boolean;
}

const KIND_SPEC: Record<MoleKind, { score: number; lifespan: [number, number]; texture: string }> = {
  normal: { score: 10, lifespan: [1150, 900], texture: "mole-normal" },
  golden: { score: 30, lifespan: [760, 620], texture: "mole-golden" },
  bomb: { score: -30, lifespan: [1050, 820], texture: "mole-bomb" },
};

class WhackMoleScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private moles: Mole[] = [];
  private holeTaken = new Array<boolean>(9).fill(false);
  private hammer?: Phaser.GameObjects.Container;
  private score = 0;
  private combo = 0;
  private lastHitAt = 0;
  private timeLeft = RUN_TIME;
  private nextSpawnAt = 700;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "whack-mole", version: "1.0.0" });
  private storage = createGameStorage("whack-mole", { highScore: 0 });

  constructor() { super("whack-mole"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#1d3a1f");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 48, 48, 0x1d3a1f, 1, 0x0d2410, .5);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .25);
    this.add.text(22, 43, "WHACK / 025", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "打地鼠", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#9dbb9f",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(22, 66, "0", {
      fontFamily: "monospace", fontSize: "38px", color: "#f3f0e8", fontStyle: "bold",
    });
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 22, 76, `BEST ${saved.highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#9dbb9f", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.comboText = this.add.text(CENTER_X, 112, "", {
      fontFamily: "monospace", fontSize: "15px", color: "#ffd44d", fontStyle: "bold", letterSpacing: 2,
    }).setOrigin(.5).setAlpha(0);

    this.add.rectangle(CENTER_X, 152, WIDTH - 54, 10, 0x0d2410).setStrokeStyle(1, 0x35543a);
    this.timerBar = this.add.rectangle(27, 152, WIDTH - 54, 10, 0xdfff3f).setOrigin(0, .5);
    this.timerText = this.add.text(CENTER_X, 172, "45.0s", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 1,
    }).setOrigin(.5, 0);

    this.buildTextures();
    for (let index = 0; index < 9; index += 1) {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = HOLE_COLUMNS[col];
      const y = HOLE_ROWS[row];
      this.add.ellipse(x, y, HOLE_RADIUS * 1.9, HOLE_RADIUS * .9, 0x0d2410).setStrokeStyle(3, 0x35543a, 1);
      this.add.ellipse(x, y + 4, HOLE_RADIUS * 1.7, HOLE_RADIUS * .72, 0x060d07);
    }

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.moles = [];
    this.holeTaken = new Array<boolean>(9).fill(false);
    this.score = 0;
    this.combo = 0;
    this.lastHitAt = 0;
    this.timeLeft = RUN_TIME;
    this.nextSpawnAt = 700;
    this.started = false;
    this.ended = false;
  }

  private buildTextures() {
    const build = (key: string, body: number, belly: number, expression: "happy" | "fuse") => {
      if (this.textures.exists(key)) return;
      const g = this.add.graphics();
      const c = 32;
      g.fillStyle(body, 1);
      g.fillEllipse(c, c + 6, 44, 50);
      g.fillStyle(belly, 1);
      g.fillEllipse(c, c + 16, 26, 22);
      g.fillStyle(0x101114, 1);
      g.fillCircle(c - 9, c - 8, 4.5);
      g.fillCircle(c + 9, c - 8, 4.5);
      g.fillStyle(0xffffff, .9);
      g.fillCircle(c - 7.5, c - 9.5, 1.6);
      g.fillCircle(c + 10.5, c - 9.5, 1.6);
      if (expression === "happy") {
        g.fillStyle(0xff9db4, 1);
        g.fillEllipse(c, c + 2, 12, 9);
        g.fillStyle(0x101114, 1);
        g.fillCircle(c - 3, c + 1, 1.2);
        g.fillCircle(c + 3, c + 1, 1.2);
      } else {
        g.lineStyle(3, 0x8d8674, 1);
        g.lineBetween(c + 8, c - 22, c + 16, c - 32);
        g.fillStyle(0xff6a51, 1);
        g.fillCircle(c + 17, c - 33, 4.5);
      }
      g.generateTexture(key, 64, 64);
      g.destroy();
    };
    build("mole-normal", 0x8a5a34, 0xc9995f, "happy");
    build("mole-golden", 0xd9a520, 0xffe08a, "happy");
    build("mole-bomb", 0x2b2d32, 0x3a3d45, "fuse");
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
      this.swingHammer(position.x, position.y);
      for (const mole of [...this.moles]) {
        if (mole.hit) continue;
        const holeCol = mole.holeIndex % 3;
        const holeRow = Math.floor(mole.holeIndex / 3);
        const x = HOLE_COLUMNS[holeCol];
        const y = HOLE_ROWS[holeRow];
        if (Phaser.Math.Distance.Between(position.x, position.y, x, y - 20) <= HOLE_RADIUS + 8) {
          this.whack(mole);
          return;
        }
      }
    });
  }

  private swingHammer(x: number, y: number) {
    if (!this.hammer) {
      const handle = this.add.rectangle(0, 26, 8, 44, 0x8a5a34).setAngle(24);
      const head = this.add.rectangle(0, -2, 34, 20, 0x6b7280).setStrokeStyle(2, 0x101114, .6);
      this.hammer = this.add.container(x, y, [handle, head]).setDepth(30).setAlpha(0);
    }
    this.hammer.setPosition(x + 18, y - 8);
    this.hammer.setAlpha(1).setAngle(-30);
    this.tweens.add({
      targets: this.hammer,
      angle: 30,
      duration: 90,
      yoyo: true,
      onComplete: () => this.tweens.add({ targets: this.hammer, alpha: 0, duration: 140 }),
    });
  }

  private whack(mole: Mole) {
    mole.hit = true;
    const spec = KIND_SPEC[mole.kind];
    const now = this.time.now;
    this.combo = mole.kind === "bomb" ? 0 : (now - this.lastHitAt < 900 ? this.combo + 1 : 1);
    this.lastHitAt = now;
    const earned = spec.score + (mole.kind !== "bomb" && this.combo > 2 ? this.combo * 2 : 0);
    this.score = Math.max(0, this.score + earned);
    this.scoreText.setText(String(this.score));
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
      this.bestText.setText(`BEST ${this.score}`);
    }

    const holeCol = mole.holeIndex % 3;
    const holeRow = Math.floor(mole.holeIndex / 3);
    const x = HOLE_COLUMNS[holeCol];
    const y = HOLE_ROWS[holeRow];
    const labelColor = earned >= 0 ? "#dfff3f" : "#ff6a51";
    const label = this.add.text(x, y - 60, `${earned >= 0 ? "+" : ""}${earned}`, {
      fontFamily: "monospace", fontSize: "15px", color: labelColor, fontStyle: "bold",
    }).setOrigin(.5).setDepth(25);
    this.tweens.add({ targets: label, y: y - 92, alpha: 0, duration: 520, onComplete: () => label.destroy() });

    if (mole.kind === "bomb") {
      this.cameras.main.shake(220, .014);
      this.cameras.main.flash(150, 255, 106, 81, false);
      this.audio.noise({ freq: 650, duration: .35, gain: .3, type: "lowpass" });
      this.tweens.add({ targets: mole.container, scale: 0, angle: 160, duration: 180, onComplete: () => mole.container.destroy() });
    } else {
      this.tweens.add({ targets: mole.container, scaleY: .25, duration: 110, onComplete: () => mole.container.destroy() });
      for (let index = 0; index < 6; index += 1) {
        const star = this.add.star(x + Phaser.Math.Between(-18, 18), y - 34, 5, 4, 9, 0xffd44d);
        this.tweens.add({
          targets: star,
          y: star.y - Phaser.Math.Between(26, 52),
          angle: Phaser.Math.Between(-120, 120),
          alpha: 0,
          duration: 380,
          onComplete: () => star.destroy(),
        });
      }
      this.audio.tone({ freq: mole.kind === "golden" ? 880 : 560, duration: .1, type: "triangle", gain: .18 });
    }
    this.tweens.add({ targets: mole.container, alpha: 0, delay: 120, duration: 120 });

    if (this.combo >= 3 && mole.kind !== "bomb") {
      this.comboText.setText(`连击 ×${this.combo}`);
      this.comboText.setAlpha(1).setScale(1.2);
      this.tweens.killTweensOf(this.comboText);
      this.tweens.add({ targets: this.comboText, scale: 1, duration: 130 });
      this.tweens.add({ targets: this.comboText, alpha: 0, delay: 500, duration: 220 });
    }
  }

  private spawnMole() {
    const elapsed = RUN_TIME - this.timeLeft;
    const free: number[] = [];
    for (let index = 0; index < 9; index += 1) {
      if (!this.holeTaken[index]) free.push(index);
    }
    if (free.length === 0) return;
    const holeIndex = Phaser.Utils.Array.GetRandom(free);
    this.holeTaken[holeIndex] = true;
    const roll = Math.random();
    const kind: MoleKind = roll < .15 ? "golden" : roll < .15 + Math.min(.22, .13 + elapsed / 400000) ? "bomb" : "normal";
    const spec = KIND_SPEC[kind];
    const lifespan = Phaser.Math.Between(
      Math.max(460, spec.lifespan[0] - elapsed / 60),
      Math.max(560, spec.lifespan[1] - elapsed / 45),
    );
    const holeCol = holeIndex % 3;
    const holeRow = Math.floor(holeIndex / 3);
    const x = HOLE_COLUMNS[holeCol];
    const y = HOLE_ROWS[holeRow];
    const image = this.add.image(0, 46, spec.texture);
    const container = this.add.container(x, y, [image]).setDepth(10);
    const mole: Mole = { kind, container, holeIndex, expiresAt: this.time.now + lifespan, hit: false };
    this.moles.push(mole);
    this.tweens.add({ targets: container, y: y - 34, duration: 150, ease: "Back.easeOut" });
  }

  private despawnMole(mole: Mole, squashed: boolean) {
    const index = this.moles.indexOf(mole);
    if (index >= 0) this.moles.splice(index, 1);
    this.holeTaken[mole.holeIndex] = false;
    this.tweens.add({
      targets: mole.container,
      y: mole.container.y + 60,
      alpha: squashed ? 0 : 1,
      duration: squashed ? 60 : 130,
      onComplete: () => mole.container.destroy(),
    });
  }

  update(time: number, delta: number) {
    if (this.ended || !this.started) return;
    this.timeLeft -= delta;
    this.timerBar.width = (WIDTH - 54) * Math.max(this.timeLeft / RUN_TIME, 0);
    this.timerBar.fillColor = this.timeLeft > RUN_TIME * .4 ? 0xdfff3f : this.timeLeft > RUN_TIME * .18 ? 0xffd44d : 0xff6a51;
    this.timerText.setText(`${(Math.max(this.timeLeft, 0) / 1000).toFixed(1)}s`);
    if (this.timeLeft <= 0) {
      this.endRun();
      return;
    }

    if (time >= this.nextSpawnAt) {
      const elapsed = RUN_TIME - this.timeLeft;
      this.nextSpawnAt = time + Math.max(320, 780 - elapsed / 70);
      this.spawnMole();
    }

    for (const mole of [...this.moles]) {
      if (mole.hit) continue;
      if (time >= mole.expiresAt) {
        if (mole.kind !== "bomb") {
          this.combo = 0;
        }
        this.despawnMole(mole, false);
      }
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    for (const mole of [...this.moles]) {
      mole.container.destroy();
    }
    this.moles = [];
    this.audio.tone({ freq: 520, duration: .18, type: "triangle", gain: .18 });
    this.audio.tone({ freq: 392, duration: .3, time: this.audio.now + .16, type: "triangle", gain: .18 });
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x0d2410, .68)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0x14261a)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(CENTER_X, 500, "时间到！", {
      fontFamily: "sans-serif", fontSize: "25px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 542, `${this.score} 分  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "12px", color: "#9dbb9f", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "再战一轮  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#0d2410", fontStyle: "bold",
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
  backgroundColor: "#1d3a1f",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: WhackMoleScene,
});
