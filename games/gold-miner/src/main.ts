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
const MINER_X = CENTER_X;
const MINER_Y = 170;
const SWING_SPEED = 1.5;
const RETRACT_SPEED = 520;
const ROUND_TIME = 45000;

interface Loot {
  image: Phaser.GameObjects.Shape;
  value: number;
  weight: number;
  grabbed: boolean;
}

class GoldMinerScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private goalText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private hintText!: Phaser.GameObjects.Text;
  private ropeGraphics!: Phaser.GameObjects.Graphics;
  private claw!: Phaser.GameObjects.Triangle;
  private loots: Loot[] = [];
  private angle = Math.PI / 2;
  private angleDirection = 1;
  private clawX = MINER_X;
  private clawY = MINER_Y + 26;
  private state: "swing" | "extend" | "retract" | "haul" = "swing";
  private hooked?: Loot;
  private hookX = 0;
  private hookY = 0;
  private retraction = 0;
  private haulTimer = 0;
  private money = 0;
  private goal = 400;
  private timeLeft = ROUND_TIME;
  private level = 1;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "gold-miner", version: "1.0.0" });
  private storage = createGameStorage("gold-miner", { highScore: 0 });

  constructor() { super("gold-miner"); }

  create() {
    this.money = 0;
    this.timeLeft = ROUND_TIME;
    this.level = 1;
    this.goal = 400;
    this.started = false;
    this.ended = false;
    this.state = "swing";
    this.hooked = undefined;
    this.loots = [];
    this.angle = Math.PI / 2;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#3a2b1e");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "GOLD / 051", {
      fontFamily: "monospace", fontSize: "11px", color: "#ffd44d", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "黄金矿工", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#c9a34d",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(22, 66, "$0", {
      fontFamily: "monospace", fontSize: "34px", color: "#ffd44d", fontStyle: "bold",
    });
    this.goalText = this.add.text(WIDTH - 22, 76, `目标 $${this.goal}`, {
      fontFamily: "monospace", fontSize: "12px", color: "#c9a34d", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.add.rectangle(CENTER_X, 106, WIDTH - 54, 9, 0x241a10).setStrokeStyle(1, 0x4a3820);
    this.timerBar = this.add.rectangle(18, 106, WIDTH - 54, 9, 0xdfff3f).setOrigin(0, .5);
    this.timerText = this.add.text(CENTER_X, 124, "45.0s", {
      fontFamily: "monospace", fontSize: "10px", color: "#c9a34d", letterSpacing: 1,
    }).setOrigin(.5, 0);
    this.hintText = this.add.text(CENTER_X, 798, "点击放下钩爪 · 大金块重但值钱", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#c9a34d",
    }).setOrigin(.5);

    const miner = this.add.container(MINER_X, MINER_Y, [
      this.add.rectangle(0, 0, 40, 40, 0x8a5a34).setStrokeStyle(2, 0x101114, .6),
      this.add.circle(-8, -8, 3.4, 0x101114),
      this.add.circle(8, -8, 3.4, 0x101114),
      this.add.rectangle(0, 24, 52, 10, 0x5a3a1e),
    ]).setDepth(6);
    void miner;

    this.ropeGraphics = this.add.graphics().setDepth(4);
    this.claw = this.add.triangle(0, 0, -11, -8, 11, -8, 0, 12, 0xc9c9c9).setStrokeStyle(2, 0x101114, .7).setDepth(5);

    this.scatterLoot();
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private scatterLoot() {
    for (const loot of this.loots) loot.image.destroy();
    this.loots = [];
    const plan: Array<{ key: string; color: number; value: number; weight: number; radius: number; count: number }> = [
      { key: "gold-s", color: 0xffd44d, value: 50, weight: 1.1, radius: 13, count: 4 },
      { key: "gold-m", color: 0xffc24b, value: 120, weight: 1.8, radius: 19, count: 3 },
      { key: "gold-l", color: 0xffb84d, value: 300, weight: 3, radius: 26, count: 1 },
      { key: "rock-s", color: 0x74726c, value: 11, weight: 1.6, radius: 15, count: 3 },
      { key: "rock-l", color: 0x5a5852, value: 20, weight: 2.6, radius: 24, count: 2 },
      { key: "gem", color: 0x54e0ff, value: 200, weight: .8, radius: 11, count: 1 },
    ];
    for (const item of plan) {
      for (let index = 0; index < item.count; index += 1) {
        const x = Phaser.Math.Between(30, WIDTH - 30);
        const y = Phaser.Math.Between(460, 760);
        const image = this.add.circle(x, y, item.radius, item.color).setStrokeStyle(2, 0x101114, .55).setDepth(4);
        if (item.key === "gem") {
          image.setFillStyle(0x54e0ff);
          this.add.rectangle(x, y, 6, 6, 0xffffff, .5).setDepth(4);
        }
        this.loots.push({ image, value: item.value, weight: item.weight, grabbed: false });
      }
    }
  }

  private bindInput() {
    this.input.on("pointerdown", () => {
      if (this.ended) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      if (this.state === "swing") {
        this.state = "extend";
        this.audio.noise({ freq: 1100, duration: .1, gain: .1 });
      }
    });
  }

  update(_time: number, delta: number) {
    if (this.ended) return;
    const seconds = Math.min(delta, 40) / 1000;

    if (this.started) {
      this.timeLeft -= delta;
      this.timerBar.width = (WIDTH - 54) * Math.max(this.timeLeft / ROUND_TIME, 0);
      this.timerBar.fillColor = this.timeLeft > ROUND_TIME * .4 ? 0xdfff3d : this.timeLeft > ROUND_TIME * .18 ? 0xffd44d : 0xff6a51;
      this.timerText.setText(`${(Math.max(this.timeLeft, 0) / 1000).toFixed(1)}s`);
      if (this.timeLeft <= 0) {
        this.endRun(this.money >= this.goal);
        return;
      }
    }

    if (this.state === "swing") {
      this.angle += SWING_SPEED * this.angleDirection * seconds;
      if (this.angle > Math.PI - .35) {
        this.angle = Math.PI - .35;
        this.angleDirection = -1;
      } else if (this.angle < .35) {
        this.angle = .35;
        this.angleDirection = 1;
      }
      this.clawX = MINER_X + Math.cos(this.angle) * 42;
      this.clawY = MINER_Y + 26 + Math.sin(this.angle) * 42;
    } else if (this.state === "extend") {
      this.clawX += Math.cos(this.angle) * RETRACT_SPEED * seconds;
      this.clawY += Math.sin(this.angle) * RETRACT_SPEED * seconds;
      for (const loot of this.loots) {
        if (loot.grabbed) continue;
        if (Phaser.Math.Distance.Between(this.clawX, this.clawY, loot.image.x, loot.image.y) < 20) {
          loot.grabbed = true;
          this.hooked = loot;
          this.state = "retract";
          this.retraction = 0;
          this.audio.tone({ freq: 480, duration: .08, type: "triangle", gain: .14 });
          break;
        }
      }
      if (this.clawX < 0 || this.clawX > WIDTH || this.clawY > HEIGHT - 10) {
        this.state = "retract";
        this.retraction = 0;
      }
    } else if (this.state === "retract") {
      const speed = this.hooked ? RETRACT_SPEED / this.hooked.weight : RETRACT_SPEED;
      this.clawX -= Math.cos(this.angle) * speed * seconds;
      this.clawY -= Math.sin(this.angle) * speed * seconds;
      if (this.hooked) {
        this.hooked.image.setPosition(this.clawX, this.clawY + 6);
      }
      if (this.clawY <= MINER_Y + 26 || this.clawX <= MINER_X - 44 || this.clawX >= MINER_X + 44) {
        if (this.hooked) {
          this.money += this.hooked.value;
          this.scoreText.setText(`$${this.money}`);
          this.bridge.score(this.money);
          this.refreshHigh();
          this.hooked.image.destroy();
          this.hooked = undefined;
          this.audio.tone({ freq: 620, duration: .1, type: "triangle", gain: .16 });
          if (this.money >= this.goal) {
            this.endRun(true);
            return;
          }
        }
        this.state = "swing";
      }
    }

    const ropeX = this.state === "swing" ? this.clawX : this.clawX;
    this.ropeGraphics.clear();
    this.ropeGraphics.lineStyle(2, 0x8a5a34, 1);
    this.ropeGraphics.lineBetween(MINER_X, MINER_Y + 24, ropeX, this.clawY);
    this.claw.setPosition(this.clawX, this.clawY);
    this.claw.angle = (this.angle - Math.PI / 2) * 57.3 + 180;
  }

  private refreshHigh() {
    const saved = this.storage.load();
    if (this.money > saved.highScore) {
      this.storage.save({ highScore: this.money });
      this.bestText.setText(`BEST $${this.money}`);
    }
  }

  private endRun(goalMet: boolean) {
    if (this.ended) return;
    this.ended = true;
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.money);
    this.storage.save({ highScore });
    this.bestText.setText(`BEST $${highScore}`);
    this.bridge.gameOver(this.money);
    if (goalMet) {
      this.level += 1;
      this.goal += 350;
      this.goalText.setText(`目标 $${this.goal}`);
      this.audio.tone({ freq: 523, duration: .16, type: "triangle", gain: .2 });
      this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .14, type: "triangle", gain: .2 });
    } else {
      this.audio.tone({ freq: 280, endFreq: 80, duration: .6, type: "sawtooth", gain: .22 });
    }
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x241a10, .72)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0x3a2b1e)
      .setStrokeStyle(2, 0xffd44d).setDepth(101);
    this.add.text(CENTER_X, 502, goalMet ? "目标达成！下一轮更难" : "时间到", {
      fontFamily: "sans-serif", fontSize: "24px", color: "#ffd44d", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `$${this.money}  ·  目标 $${this.goal}  ·  BEST $${highScore}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#c9a34d", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0xffd44d)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, goalMet ? "继续挖矿  →" : "再来一局  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#241a10", fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    replay.on("pointerup", () => {
      if (!goalMet) {
        this.scene.restart();
        return;
      }
      this.ended = false;
      this.timeLeft = ROUND_TIME;
      this.money = 0;
      this.scoreText.setText("$0");
      this.state = "swing";
      this.scatterLoot();
      shade.destroy();
      panel.destroy();
      replay.destroy();
    });
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: [shade, panel], alpha: { from: 0, to: 1 }, duration: 220 });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#3a2b1e",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: GoldMinerScene,
});
