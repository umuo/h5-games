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
const GOAL_X = CENTER_X;
const GOAL_Y = 330;
const GOAL_HALF_WIDTH = 130;
const GOAL_HEIGHT = 90;
const KEEPER_RADIUS = 30;
const BALL_START_Y = 640;
const KICKS_PER_SIDE = 5;

type Phase = "aim" | "flying" | "keeping" | "aiShoot" | "between" | "over";

class PenaltyKickScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private goalFrame!: Phaser.GameObjects.Graphics;
  private keeper!: Phaser.GameObjects.Container;
  private ball!: Phaser.GameObjects.Arc;
  private crosshair!: Phaser.GameObjects.Container;
  private netFlash!: Phaser.GameObjects.Rectangle;
  private crossX = CENTER_X;
  private crossY = GOAL_Y + 30;
  private phase: Phase = "between";
  private kickIndex = 0;
  private playerGoals = 0;
  private aiGoals = 0;
  private started = false;
  private ended = false;
  private keeperTarget = { x: CENTER_X, y: GOAL_Y };
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "penalty-kick", version: "1.0.0" });
  private storage = createGameStorage("penalty-kick", { bestGoals: 0 });

  constructor() { super("penalty-kick"); }

  create() {
    this.playerGoals = 0;
    this.aiGoals = 0;
    this.kickIndex = 0;
    this.started = false;
    this.ended = false;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#1a3a1e");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "PENALTY / 059", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "点球大战", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#9dbb9f",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(22, 66, "你 0", {
      fontFamily: "monospace", fontSize: "22px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.aiGoals = 0;
    this.bestText = this.add.text(WIDTH - 22, 72, "AI 0", {
      fontFamily: "monospace", fontSize: "22px", color: "#ff6a51", fontStyle: "bold",
    }).setOrigin(1, 0);
    this.roundText = this.add.text(CENTER_X, 112, "第 1 / 5 轮 · 你主罚", {
      fontFamily: "sans-serif", fontSize: "14px", color: "#dfff3f", fontStyle: "bold",
    }).setOrigin(.5);
    this.statusText = this.add.text(CENTER_X, 148, "", {
      fontFamily: "sans-serif", fontSize: "14px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5);

    const pitch = this.add.graphics().setDepth(1);
    pitch.fillStyle(0x2f6b3a, 1);
    pitch.fillRect(0, 180, WIDTH, HEIGHT - 180);
    for (let index = 0; index < 8; index += 1) {
      pitch.fillStyle(0x357a42, 1);
      pitch.fillRect(0, 180 + index * 90, WIDTH, 45);
    }
    // 球门
    this.goalFrame = this.add.graphics().setDepth(3);
    this.goalFrame.fillStyle(0x0d2410, 1);
    this.goalFrame.fillRect(GOAL_X - GOAL_HALF_WIDTH, GOAL_Y, GOAL_HALF_WIDTH * 2, GOAL_HEIGHT);
    this.goalFrame.lineStyle(4, 0xf3f0e8, .95);
    this.goalFrame.strokeRect(GOAL_X - GOAL_HALF_WIDTH, GOAL_Y, GOAL_HALF_WIDTH * 2, GOAL_HEIGHT);
    this.goalFrame.lineStyle(1.2, 0xf3f0e8, .3);
    for (let index = 1; index < 8; index += 1) {
      this.goalFrame.lineBetween(GOAL_X - GOAL_HALF_WIDTH + index * (GOAL_HALF_WIDTH * 2 / 8), GOAL_Y, GOAL_X - GOAL_HALF_WIDTH + index * (GOAL_HALF_WIDTH * 2 / 8), GOAL_Y + GOAL_HEIGHT);
    }
    for (let index = 1; index < 4; index += 1) {
      this.goalFrame.lineBetween(GOAL_X - GOAL_HALF_WIDTH, GOAL_Y + index * (GOAL_HEIGHT / 4), GOAL_X + GOAL_HALF_WIDTH, GOAL_Y + index * (GOAL_HEIGHT / 4));
    }
    this.netFlash = this.add.rectangle(GOAL_X, GOAL_Y + GOAL_HEIGHT / 2, GOAL_HALF_WIDTH * 2, GOAL_HEIGHT, 0xff6a51, 0).setDepth(4);

    this.keeper = this.add.container(GOAL_X, GOAL_Y + GOAL_HEIGHT / 2, [
      this.add.rectangle(0, 0, 26, 44, 0xffb84d).setStrokeStyle(2, 0x101114, .7),
      this.add.circle(0, -24, 9, 0xffd44d).setStrokeStyle(1.5, 0x101114, .7),
    ]).setDepth(5);

    this.ball = this.add.circle(CENTER_X, BALL_START_Y, 12, 0xf7f4ec).setStrokeStyle(2, 0x101114, .6).setDepth(6);
    this.crosshair = this.add.container(CENTER_X, GOAL_Y + 30, [
      this.add.circle(0, 0, 14).setStrokeStyle(2.5, 0xff6a51, .95),
      this.add.circle(0, 0, 2.5, 0xff6a51),
      this.add.line(0, 0, -22, 0, -8, 0, 0xff6a51).setLineWidth(2),
      this.add.line(0, 0, 8, 0, 22, 0, 0xff6a51).setLineWidth(2),
    ]).setDepth(7);

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.startPlayerKick();
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private refreshScore() {
    this.scoreText.setText(`你 ${this.playerGoals}`);
    this.bestText.setText(`AI ${this.aiGoals}`);
  }

  private startPlayerKick() {
    this.phase = "aim";
    this.crosshair.setVisible(true).setPosition(CENTER_X, GOAL_Y + 30);
    this.keeper.setPosition(GOAL_X, GOAL_Y + GOAL_HEIGHT / 2);
    this.ball.setPosition(CENTER_X, BALL_START_Y);
    this.roundText.setText(`第 ${this.kickIndex + 1} / ${KICKS_PER_SIDE} 轮 · 你主罚`);
    this.statusText.setText("点击球门内任意一点射门").setColor("#dfff3f");
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
      if (this.phase === "aim") {
        if (position.y < GOAL_Y || position.y > GOAL_Y + GOAL_HEIGHT) return;
        if (Math.abs(position.x - GOAL_X) > GOAL_HALF_WIDTH) return;
        this.shoot(position.x, position.y);
      } else if (this.phase === "keeping") {
        const zones: Array<{ x: number; y: number }> = [
          { x: GOAL_X - 80, y: GOAL_Y + 45 },
          { x: GOAL_X, y: GOAL_Y + 45 },
          { x: GOAL_X + 80, y: GOAL_Y + 45 },
        ];
        for (const zone of zones) {
          if (Phaser.Math.Distance.Between(position.x, position.y, zone.x, zone.y) < 70) {
            this.dive(zone.x);
            return;
          }
        }
      }
    });
  }

  private shoot(x: number, y: number) {
    this.phase = "flying";
    this.crosshair.setVisible(false);
    const keeperX = GOAL_X + Phaser.Math.Between(-1, 1) * Phaser.Math.Between(20, 85);
    const keeperY = GOAL_Y + Phaser.Math.Between(20, GOAL_HEIGHT - 20);
    this.tweens.add({ targets: this.keeper, x: keeperX, y: keeperY, duration: 260, ease: "Cubic.easeOut" });
    this.tweens.add({
      targets: this.ball,
      x,
      y,
      duration: 320,
      ease: "Cubic.easeIn",
      onComplete: () => {
        const saved = Phaser.Math.Distance.Between(keeperX, keeperY, x, y) < KEEPER_RADIUS;
        if (saved) {
          this.netFlash.setFillStyle(0x3a5a8a, .4);
          this.statusText.setText("被扑出！").setColor("#7a8fb3");
          this.audio.tone({ freq: 240, duration: .15, type: "square", gain: .14 });
        } else {
          this.playerGoals += 1;
          this.refreshScore();
          this.netFlash.setFillStyle(0x9fe08a, .45);
          this.statusText.setText("球进了！").setColor("#dfff3f");
          this.audio.tone({ freq: 660, duration: .16, type: "triangle", gain: .2 });
          this.audio.tone({ freq: 990, duration: .22, time: this.audio.now + .12, type: "triangle", gain: .16 });
        }
        this.tweens.add({ targets: this.netFlash, alpha: { from: .45, to: 0 }, duration: 500 });
        this.time.delayedCall(900, () => this.nextKick());
      },
    });
    this.audio.noise({ freq: 1300, duration: .09, gain: .12 });
  }

  private nextKick() {
    this.kickIndex += 1;
    if (this.kickIndex < KICKS_PER_SIDE) {
      this.startPlayerKick();
      return;
    }
    // 玩家主罚结束 → AI 主罚阶段
    this.kickIndex = 0;
    this.startAiKick();
  }

  private startAiKick() {
    this.phase = "keeping";
    this.ball.setPosition(CENTER_X, BALL_START_Y);
    this.keeper.setPosition(GOAL_X, GOAL_Y + GOAL_HEIGHT / 2);
    this.roundText.setText(`第 ${this.kickIndex + 1} / ${KICKS_PER_SIDE} 轮 · 你守门`);
    this.statusText.setText("点击左 / 中 / 右 扑救！").setColor("#ffb84d");
    this.time.delayedCall(Phaser.Math.Between(900, 1600), () => {
      if (this.phase !== "keeping") return;
      const aimX = GOAL_X + Phaser.Math.Between(-1, 1) * Phaser.Math.Between(30, 100);
      const aimY = GOAL_Y + Phaser.Math.Between(25, GOAL_HEIGHT - 25);
      this.tweens.add({
        targets: this.ball,
        x: aimX,
        y: aimY,
        duration: 300,
        ease: "Cubic.easeIn",
        onComplete: () => {
          const saved = Math.abs(this.keeper.x - aimX) < 55;
          if (saved) {
            this.netFlash.setFillStyle(0x3a5a8a, .4);
            this.statusText.setText("扑出啦！").setColor("#dfff3f");
            this.audio.tone({ freq: 520, duration: .14, type: "triangle", gain: .18 });
          } else {
            this.aiGoals += 1;
            this.refreshScore();
            this.netFlash.setFillStyle(0xff6a51, .4);
            this.statusText.setText("失球…").setColor("#ff6a51");
            this.audio.tone({ freq: 240, endFreq: 130, duration: .25, type: "sawtooth", gain: .16 });
          }
          this.tweens.add({ targets: this.netFlash, alpha: { from: .4, to: 0 }, duration: 480 });
          this.time.delayedCall(850, () => this.afterAiKick());
        },
      });
    });
  }

  private dive(x: number) {
    if (this.phase !== "keeping") return;
    this.phase = "aiShoot";
    this.tweens.add({ targets: this.keeper, x, duration: 240, ease: "Cubic.easeOut" });
  }

  private afterAiKick() {
    this.kickIndex += 1;
    if (this.kickIndex < KICKS_PER_SIDE) {
      this.startAiKick();
      return;
    }
    if (this.playerGoals === this.aiGoals) {
      // 平局 → 骤死
      this.phase = "between";
      this.statusText.setText("平局 · 骤死战！").setColor("#ffd44d");
      this.time.delayedCall(1100, () => {
        this.kickIndex = 0;
        this.startPlayerKick();
      });
      return;
    }
    this.endRun(this.playerGoals > this.aiGoals);
  }

  private endRun(playerWon: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.phase = "over";
    const score = this.playerGoals * 100 + (playerWon ? 200 : 0);
    this.bridge.gameOver(score);
    const saved = this.storage.load();
    this.storage.save({ bestGoals: Math.max(saved.bestGoals, this.playerGoals) });
    if (playerWon) {
      this.audio.tone({ freq: 523, duration: .16, type: "triangle", gain: .2 });
      this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .14, type: "triangle", gain: .2 });
    } else {
      this.audio.tone({ freq: 300, endFreq: 110, duration: .5, type: "sawtooth", gain: .2 });
    }
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x0d2410, .68)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 420, 308, 190, 0x14261a)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(CENTER_X, 382, playerWon ? "点球大战获胜！" : "点球大战落败", {
      fontFamily: "sans-serif", fontSize: "25px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 424, `${this.playerGoals} : ${this.aiGoals}`, {
      fontFamily: "monospace", fontSize: "22px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 474, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 474, "再来一轮  ↻", {
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
  backgroundColor: "#1a3a1e",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: PenaltyKickScene,
});
