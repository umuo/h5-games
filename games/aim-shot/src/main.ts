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
const ARENA_TOP = 150;
const ARENA_BOTTOM = 730;

interface Target {
  container: Phaser.GameObjects.Container;
  radius: number;
  vx: number;
  isBomb: boolean;
  points: number;
}

class AimShotScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private targets: Target[] = [];
  private tracer?: Phaser.GameObjects.Line;
  private timeLeft = RUN_TIME;
  private nextSpawnAt = 500;
  private runStart = 0;
  private score = 0;
  private shots = 0;
  private hits = 0;
  private combo = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "aim-shot", version: "1.0.0" });
  private storage = createGameStorage("aim-shot", { highScore: 0 });

  constructor() { super("aim-shot"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 40, 40, 0x101114, 1, 0x2b2d32, .35);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "AIM / 036", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "射击靶场", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(22, 66, "0", {
      fontFamily: "monospace", fontSize: "38px", color: "#f3f0e8", fontStyle: "bold",
    });
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 22, 76, `BEST ${saved.highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.comboText = this.add.text(CENTER_X, 110, "", {
      fontFamily: "monospace", fontSize: "15px", color: "#dfff3f", fontStyle: "bold", letterSpacing: 2,
    }).setOrigin(.5).setAlpha(0);
    this.add.rectangle(CENTER_X, 150, WIDTH - 54, 9, 0x1b1d21).setStrokeStyle(1, 0x3a3d45);
    this.timerBar = this.add.rectangle(18, 150, WIDTH - 54, 9, 0xdfff3f).setOrigin(0, .5);
    this.timerText = this.add.text(CENTER_X, 168, "45.0s", {
      fontFamily: "monospace", fontSize: "10px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5, 0);
    this.hintLine = this.add.text(CENTER_X, 766, "点击靶子开火 · 黑靶千万别碰", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }
  private hintLine!: Phaser.GameObjects.Text;

  private resetRun() {
    this.targets = [];
    this.tracer = undefined;
    this.timeLeft = RUN_TIME;
    this.nextSpawnAt = 500;
    this.runStart = 0;
    this.score = 0;
    this.shots = 0;
    this.hits = 0;
    this.combo = 0;
    this.started = false;
    this.ended = false;
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended) return;
      if (!this.started) {
        this.started = true;
        this.runStart = this.time.now;
        this.nextSpawnAt = this.time.now + 350;
        this.bridge.started();
        this.audio.unlock();
      }
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.shoot(position.x, position.y);
    });
  }

  private shoot(x: number, y: number) {
    if (y < ARENA_TOP - 20 || y > ARENA_BOTTOM + 20) return;
    this.shots += 1;
    this.tracer?.destroy();
    this.tracer = this.add.line(0, 0, x - 26, y + 38, x, y, 0xdfff3f, .5);
    this.time.delayedCall(70, () => this.tracer?.destroy());
    const muzzle = this.add.circle(x, y, 3, 0xdfff3f).setAlpha(.9);
    this.tweens.add({ targets: muzzle, scale: 3, alpha: 0, duration: 130, onComplete: () => muzzle.destroy() });
    this.audio.noise({ freq: 1600, duration: .05, gain: .12 });

    let hitTarget: Target | null = null;
    for (const target of this.targets) {
      if (Phaser.Math.Distance.Between(x, y, target.container.x, target.container.y) <= target.radius + 4) {
        hitTarget = target;
        break;
      }
    }
    if (!hitTarget) {
      this.combo = 0;
      return;
    }
    this.hits += 1;
    if (hitTarget.isBomb) {
      this.combo = 0;
      this.score = Math.max(0, this.score - 40);
      this.refreshScore();
      this.cameras.main.shake(200, .012);
      this.cameras.main.flash(140, 255, 106, 81, false);
      this.audio.noise({ freq: 600, duration: .3, gain: .26, type: "lowpass" });
      for (let index = 0; index < 18; index += 1) {
        const shard = this.add.circle(hitTarget.container.x, hitTarget.container.y, Phaser.Math.FloatBetween(2, 4), 0xff6a51);
        this.tweens.add({
          targets: shard,
          x: shard.x + Phaser.Math.Between(-140, 140),
          y: shard.y + Phaser.Math.Between(-140, 140),
          alpha: 0,
          duration: 420,
          onComplete: () => shard.destroy(),
        });
      }
    } else {
      this.combo += 1;
      const earned = hitTarget.points * (1 + Math.floor(this.combo / 4));
      this.score += earned;
      this.refreshScore();
      this.audio.tone({ freq: 520 + Math.min(this.combo, 10) * 45, duration: .1, type: "triangle", gain: .16 });
      const label = this.add.text(hitTarget.container.x, hitTarget.container.y - 24, `+${earned}`, {
        fontFamily: "monospace", fontSize: "14px", color: "#dfff3f", fontStyle: "bold",
      }).setOrigin(.5);
      this.tweens.add({ targets: label, y: label.y - 30, alpha: 0, duration: 460, onComplete: () => label.destroy() });
      for (let index = 0; index < 9; index += 1) {
        const shard = this.add.circle(hitTarget.container.x, hitTarget.container.y, Phaser.Math.FloatBetween(1.5, 3), 0xffb84d);
        this.tweens.add({
          targets: shard,
          x: shard.x + Phaser.Math.Between(-90, 90),
          y: shard.y + Phaser.Math.Between(-90, 90),
          alpha: 0,
          duration: 340,
          onComplete: () => shard.destroy(),
        });
      }
      if (this.combo >= 3) {
        this.comboText.setText(`连击 ×${this.combo}`);
        this.comboText.setAlpha(1).setScale(1.2);
        this.tweens.killTweensOf(this.comboText);
        this.tweens.add({ targets: this.comboText, scale: 1, duration: 130 });
        this.tweens.add({ targets: this.comboText, alpha: 0, delay: 500, duration: 220 });
      }
    }
    const index = this.targets.indexOf(hitTarget);
    if (index >= 0) this.targets.splice(index, 1);
    hitTarget.container.destroy();
  }

  private spawnTarget() {
    const elapsed = this.time.now - this.runStart;
    const isBomb = Math.random() < Math.min(.22, .1 + elapsed / 240000);
    const small = Math.random() < .35;
    const radius = isBomb ? 22 : small ? 17 : 26;
    const container = this.add.container(0, 0);
    const g = this.add.graphics();
    if (isBomb) {
      g.fillStyle(0x1b1d21, 1);
      g.fillCircle(0, 0, radius);
      g.lineStyle(2.5, 0xff6a51, 1);
      g.strokeCircle(0, 0, radius);
      g.lineStyle(2, 0x101114, 1);
      g.lineBetween(-radius * .4, -radius * .4, radius * .4, radius * .4);
      g.lineBetween(radius * .4, -radius * .4, -radius * .4, radius * .4);
    } else {
      const rings = [[radius, 0xf3f0e8], [radius * .68, 0xff6a51], [radius * .36, 0xdfff3f]] as const;
      for (const [ringRadius, color] of rings) {
        g.fillStyle(color, 1);
        g.fillCircle(0, 0, ringRadius);
        g.lineStyle(1.2, 0x101114, .4);
        g.strokeCircle(0, 0, ringRadius);
      }
    }
    container.add(g);
    const y = Phaser.Math.Between(ARENA_TOP + radius + 14, ARENA_BOTTOM - radius - 14);
    container.setPosition(isBomb ? WIDTH + radius : -radius, y);
    this.targets.push({
      container,
      radius,
      vx: (Math.random() < .5 ? -1 : 1) * Phaser.Math.Between(60, 150) * (1 + Math.min(elapsed / 60000, .8)),
      isBomb,
      points: isBomb ? -40 : (small ? 30 : 15) + Math.round(radius),
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

  update(time: number, delta: number) {
    if (this.ended) return;
    const seconds = Math.min(delta, 40) / 1000;
    if (this.started) {
      this.timeLeft -= delta;
      this.timerBar.width = (WIDTH - 54) * Math.max(this.timeLeft / RUN_TIME, 0);
      this.timerBar.fillColor = this.timeLeft > RUN_TIME * .4 ? 0xdfff3f : this.timeLeft > RUN_TIME * .18 ? 0xffd44d : 0xff6a51;
      this.timerText.setText(`${(Math.max(this.timeLeft, 0) / 1000).toFixed(1)}s`);
      if (this.timeLeft <= 0) {
        this.endRun();
        return;
      }
      if (time >= this.nextSpawnAt) {
        this.nextSpawnAt = time + Math.max(340, 900 - (time - this.runStart) / 40);
        this.spawnTarget();
      }
    }

    for (let index = this.targets.length - 1; index >= 0; index -= 1) {
      const target = this.targets[index];
      target.container.x += target.vx * seconds;
      target.container.y += Math.sin(time / 400 + index) * 18 * seconds;
      if (target.container.x < -target.radius - 40 || target.container.x > WIDTH + target.radius + 40) {
        target.container.destroy();
        this.targets.splice(index, 1);
      }
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    const accuracy = this.shots > 0 ? Math.round(this.hits / this.shots * 100) : 0;
    this.audio.tone({ freq: 520, duration: .2, type: "triangle", gain: .18 });
    this.audio.tone({ freq: 392, duration: .3, time: this.audio.now + .18, type: "triangle", gain: .18 });
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    this.bestText.setText(`BEST ${highScore}`);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .62)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 196, 0x1b1d21)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(CENTER_X, 500, "时间到！", {
      fontFamily: "sans-serif", fontSize: "25px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `${this.score} 分  ·  命中率 ${accuracy}%  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "再来一轮  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#101114", fontStyle: "bold",
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
  backgroundColor: "#101114",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: AimShotScene,
});
