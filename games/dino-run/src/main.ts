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
const GROUND_Y = 690;
const JUMP_VELOCITY = -760;
const GRAVITY = 2100;
const HOLD_GRAVITY = 1250;
const DINO_X = 92;

interface Obstacle {
  container: Phaser.GameObjects.Container;
  width: number;
  flyHeight: number;
  counted: boolean;
}

class DinoRunScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private dino!: Phaser.GameObjects.Container;
  private dinoLegs!: Phaser.GameObjects.Rectangle;
  private obstacles: Obstacle[] = [];
  private clouds: Array<{ ellipse: Phaser.GameObjects.Ellipse; speed: number }> = [];
  private dinoY = GROUND_Y;
  private vy = 0;
  private jumping = false;
  private ducking = false;
  private distance = 0;
  private nextSpawnDistance = 320;
  private started = false;
  private ended = false;
  private swipeStart?: Phaser.Math.Vector2;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "dino-run", version: "1.0.0" });
  private storage = createGameStorage("dino-run", { highScore: 0 });

  constructor() { super("dino-run"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#f7f4ec");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0x101114, .25);
    this.add.text(22, 43, "RUN / 030", {
      fontFamily: "monospace", fontSize: "11px", color: INK, letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "恐龙快跑", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#74726c",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(WIDTH - 26, 70, "0m", {
      fontFamily: "monospace", fontSize: "26px", color: INK, fontStyle: "bold",
    }).setOrigin(1, 0);
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 26, 106, `BEST ${saved.highScore}m`, {
      fontFamily: "monospace", fontSize: "10px", color: "#74726c", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.hintText = this.add.text(CENTER_X, 760, "轻点跳跃 · 长按跳得高 · 下滑低头", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8a8881",
    }).setOrigin(.5);

    for (let index = 0; index < 5; index += 1) {
      const ellipse = this.add.ellipse(
        Phaser.Math.Between(30, WIDTH - 30),
        Phaser.Math.Between(120, 320),
        Phaser.Math.Between(46, 90),
        Phaser.Math.Between(12, 20),
        0xffffff,
      ).setAlpha(.85);
      this.clouds.push({ ellipse, speed: Phaser.Math.FloatBetween(12, 30) });
    }
    this.add.rectangle(CENTER_X, GROUND_Y + 34, WIDTH, 2, 0x101114, .5);

    const body = this.add.rectangle(0, -18, 34, 34, 0x5a8f5a).setStrokeStyle(2, 0x101114, .6);
    const head = this.add.rectangle(16, -38, 28, 20, 0x5a8f5a).setStrokeStyle(2, 0x101114, .6);
    const eye = this.add.circle(22, -42, 2.6, 0x101114);
    const tail = this.add.triangle(-24, -12, -22, -14, -6, -12, -22, 4, 0x5a8f5a).setStrokeStyle(1, 0x101114, .5);
    this.dinoLegs = this.add.rectangle(0, 0, 26, 10, 0x3d6b3d);
    this.dino = this.add.container(DINO_X, this.dinoY, [tail, this.dinoLegs, body, head, eye]);
    this.dino.setDepth(5);

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.obstacles = [];
    this.dinoY = GROUND_Y;
    this.vy = 0;
    this.jumping = false;
    this.ducking = false;
    this.distance = 0;
    this.nextSpawnDistance = 320;
    this.started = false;
    this.ended = false;
    this.swipeStart = undefined;
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
      this.swipeStart = new Phaser.Math.Vector2(position.x, position.y);
      if (!this.jumping) {
        this.jumping = true;
        this.vy = JUMP_VELOCITY;
        this.audio.tone({ freq: 340, endFreq: 560, duration: .12, type: "square", gain: .09 });
      }
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      const start = this.swipeStart;
      this.swipeStart = undefined;
      if (!start || this.ended) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      if (position.y - start.y > 34) this.ducking = false;
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const start = this.swipeStart;
      if (!start || !pointer.isDown || this.ended) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.ducking = position.y - start.y > 34 && !this.jumping;
    });
  }

  private spawnObstacle(distance: number) {
    const container = this.add.container(WIDTH + 60, GROUND_Y);
    const roll = Math.random();
    let width = 34;
    let flyHeight = 0;
    if (roll < .62) {
      const cactusCount = Phaser.Math.Between(1, 3);
      for (let index = 0; index < cactusCount; index += 1) {
        const height = Phaser.Math.Between(38, 54);
        const trunk = this.add.rectangle(index * 18 - (cactusCount - 1) * 9, -height / 2, 12, height, 0x3d8f5a)
          .setStrokeStyle(1.5, 0x101114, .5);
        const arm = this.add.rectangle(index * 18 - (cactusCount - 1) * 9 + 8, -height * .62, 10, 6, 0x3d8f5a);
        container.add([trunk, arm]);
      }
      width = cactusCount * 18 + 8;
    } else {
      flyHeight = roll < .82 ? 96 : 148;
      const birdBody = this.add.ellipse(0, -flyHeight, 34, 20, 0x8a6bff).setStrokeStyle(1.5, 0x101114, .5);
      const wing = this.add.rectangle(0, -flyHeight - 8, 26, 8, 0xc9b8ff);
      container.add([birdBody, wing]);
      width = 34;
      container.setData("wing", wing);
    }
    container.setPosition(WIDTH + 60 + (distance % 40), GROUND_Y);
    this.obstacles.push({ container, width, flyHeight, counted: false });
  }

  update(_time: number, delta: number) {
    if (this.ended) return;
    const seconds = Math.min(delta, 40) / 1000;
    if (!this.started) {
      this.dinoY = GROUND_Y;
      return;
    }

    const speed = 240 + Math.min(this.distance * .06, 260);
    this.distance += speed * seconds;
    this.scoreText.setText(`${Math.floor(this.distance / 10)}m`);
    this.bridge.score(Math.floor(this.distance / 10));

    if (this.jumping) {
      const gravity = this.vy < 0 && this.ducking ? HOLD_GRAVITY : GRAVITY;
      this.vy += gravity * seconds;
      this.dinoY += this.vy * seconds;
      if (this.dinoY >= GROUND_Y) {
        this.dinoY = GROUND_Y;
        this.vy = 0;
        this.jumping = false;
        this.ducking = false;
      }
    }
    this.dino.setScale(1, this.ducking ? .6 : 1);
    this.dino.setPosition(DINO_X, this.dinoY);
    this.dinoLegs.y = this.jumping ? -2 : Math.sin(_time / 45) * 2;

    for (const cloud of this.clouds) {
      cloud.ellipse.x -= cloud.speed * seconds;
      if (cloud.ellipse.x < -60) cloud.ellipse.x = WIDTH + 60;
    }

    if (this.distance >= this.nextSpawnDistance) {
      const gap = Phaser.Math.Between(280, 460) + Math.min(this.distance * .05, 200);
      this.nextSpawnDistance = this.distance + gap;
      this.spawnObstacle(this.distance);
    }

    for (let index = this.obstacles.length - 1; index >= 0; index -= 1) {
      const obstacle = this.obstacles[index];
      obstacle.container.x -= speed * seconds;
      const wing = obstacle.container.getData("wing") as Phaser.GameObjects.Rectangle | undefined;
      if (wing) wing.angle = Math.sin(_time / 90) * 28;

      const dinoTop = this.ducking ? this.dinoY - 22 : this.dinoY - 52;
      const dinoBottom = this.dinoY;
      const obstacleCenter = GROUND_Y - obstacle.flyHeight;
      const overlapsX = Math.abs(obstacle.container.x - DINO_X) < obstacle.width / 2 + 16;
      const obstacleBottom = obstacleCenter + (obstacle.flyHeight ? 10 : 0);
      const obstacleTop = obstacleCenter - (obstacle.flyHeight ? 10 : 56);
      const overlapsY = dinoBottom > obstacleTop && dinoTop < obstacleBottom;
      if (overlapsX && overlapsY) {
        this.endRun();
        return;
      }
      if (obstacle.container.x < -80) {
        obstacle.container.destroy();
        this.obstacles.splice(index, 1);
      }
    }
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    const meters = Math.floor(this.distance / 10);
    this.audio.tone({ freq: 300, endFreq: 70, duration: .6, type: "sawtooth", gain: .22 });
    this.cameras.main.shake(200, .012);
    this.dino.setAngle(90).setPosition(DINO_X, GROUND_Y - 10);
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, meters);
    this.storage.save({ highScore });
    this.bridge.gameOver(meters);
    this.bestText.setText(`BEST ${highScore}m`);
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .55)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0xf7f4ec)
      .setStrokeStyle(2, 0x101114).setDepth(101);
    this.add.text(CENTER_X, 502, "撞上了", {
      fontFamily: "sans-serif", fontSize: "25px", color: INK, fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `${meters}m  ·  BEST ${highScore}m`, {
      fontFamily: "monospace", fontSize: "12px", color: "#777872", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0x101114)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "再跑一次  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#f7f4ec", fontStyle: "bold",
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
  backgroundColor: "#f7f4ec",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: DinoRunScene,
});
