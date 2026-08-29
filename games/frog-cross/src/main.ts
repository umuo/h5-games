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
const COLS = 10;
const CELL_X = WIDTH / COLS;
const ROW_HEIGHT = 52;
const LANES_TOP = 84;
const ROWS = 13;
const GOAL_ROW = 0;
const RIVER_ROWS = [1, 2, 3, 4];
const MEDIAN_ROW = 5;
const ROAD_ROWS = [6, 7, 8, 9, 10];
const START_ROW = 12;
const PAD_COLUMNS = [1, 3, 5, 7, 9];
const SWIPE_MIN = 22;

interface Vehicle {
  container: Phaser.GameObjects.Container;
  lane: number;
  vx: number;
  half: number;
}

interface Pad {
  col: number;
  filled: boolean;
  shape: Phaser.GameObjects.Ellipse;
}

class FrogCrossScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private frog!: Phaser.GameObjects.Container;
  private vehicles: Vehicle[] = [];
  private pads: Pad[] = [];
  private frogX = CENTER_X;
  private frogRow = START_ROW;
  private ridingVehicle: Vehicle | null = null;
  private lives = 3;
  private score = 0;
  private level = 1;
  private started = false;
  private ended = false;
  private dead = false;
  private invulnUntil = 0;
  private swipeStart?: Phaser.Math.Vector2;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "frog-cross", version: "1.0.0" });
  private storage = createGameStorage("frog-cross", { highScore: 0 });

  constructor() { super("frog-cross"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");

    for (let row = 0; row < ROWS; row += 1) {
      const y = LANES_TOP + row * ROW_HEIGHT;
      let color = 0x2f5d33;
      if (ROAD_ROWS.includes(row)) color = row % 2 === 0 ? 0x2b2d32 : 0x303239;
      else if (RIVER_ROWS.includes(row)) color = row % 2 === 0 ? 0x1c3f66 : 0x1e4570;
      else if (row === GOAL_ROW) color = 0x396b3d;
      else if (row === MEDIAN_ROW || row >= 11) color = row % 2 === 0 ? 0x356b3a : 0x397540;
      this.add.rectangle(CENTER_X, y + ROW_HEIGHT / 2, WIDTH, ROW_HEIGHT, color);
      if (ROAD_ROWS.includes(row)) {
        for (let dash = 0; dash < 5; dash += 1) {
          this.add.rectangle(39 + dash * 78, y + ROW_HEIGHT / 2, 30, 3, 0xf3f0e8, .35);
        }
      }
      if (RIVER_ROWS.includes(row)) {
        for (let wave = 0; wave < 4; wave += 1) {
          this.add.rectangle(48 + wave * 97 + (row % 2) * 20, y + ROW_HEIGHT / 2, 26, 2.5, 0xdfefff, .18);
        }
      }
    }
    for (const col of PAD_COLUMNS) {
      const shape = this.add.ellipse(col * CELL_X + CELL_X / 2, LANES_TOP + ROW_HEIGHT / 2, 34, 26, 0x9fe08a)
        .setStrokeStyle(2, 0x2f5d33, 1);
      this.pads.push({ col, filled: false, shape });
    }

    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "FROG / 028", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "青蛙过河", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#9dbb9f",
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(CENTER_X, 60, "0", {
      fontFamily: "monospace", fontSize: "26px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5, 0);
    this.livesText = this.add.text(22, 66, "● ● ●", {
      fontFamily: "monospace", fontSize: "12px", color: "#ff6a51", letterSpacing: 4,
    });
    this.levelText = this.add.text(WIDTH - 22, 68, "LV 1", {
      fontFamily: "monospace", fontSize: "12px", color: "#dfff3f", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.hintText = this.add.text(CENTER_X, 796, "滑动或轻点跳跃 · 踩浮木过河 · 荷叶收集齐过关", {
      fontFamily: "sans-serif", fontSize: "11.5px", color: "#cfe3cf",
    }).setOrigin(.5);

    this.frog = this.add.container(this.frogX, this.rowY(START_ROW) - 6, [
      this.add.ellipse(0, 6, 34, 26, 0x4caf50).setStrokeStyle(2, 0x1b4a20, 1),
      this.add.circle(-7, -8, 4.5, 0x1b4a20),
      this.add.circle(7, -8, 4.5, 0x1b4a20),
      this.add.circle(-6.5, -9.5, 2, 0xffffff),
      this.add.circle(7.5, -9.5, 2, 0xffffff),
    ]);
    this.frog.setDepth(6);

    this.buildTraffic();
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.vehicles = [];
    this.pads = [];
    this.frogX = CENTER_X;
    this.frogRow = START_ROW;
    this.ridingVehicle = null;
    this.lives = 3;
    this.score = 0;
    this.level = 1;
    this.started = false;
    this.ended = false;
    this.dead = false;
    this.invulnUntil = 0;
    this.swipeStart = undefined;
  }

  private rowY(row: number) {
    return LANES_TOP + row * ROW_HEIGHT + ROW_HEIGHT / 2;
  }

  private buildTraffic() {
    const speedScale = 1 + (this.level - 1) * .18;
    const roadLanes: Array<{ lane: number; count: number; speed: number; kind: "car" | "truck" }> = [
      { lane: 10, count: 2, speed: 105, kind: "car" },
      { lane: 9, count: 3, speed: 150, kind: "car" },
      { lane: 8, count: 2, speed: 85, kind: "truck" },
      { lane: 7, count: 3, speed: 170, kind: "car" },
      { lane: 6, count: 2, speed: 120, kind: "truck" },
    ];
    for (const lane of roadLanes) {
      const direction = Math.random() < .5 ? -1 : 1;
      for (let index = 0; index < lane.count; index += 1) {
        const width = lane.kind === "truck" ? 84 : 58;
        const color = Phaser.Utils.Array.GetRandom([0xff6a51, 0xffc24b, 0x54e0ff, 0x9b6bff, 0xf3f0e8]);
        const body = this.add.rectangle(0, 0, width, 34, color).setStrokeStyle(1.5, 0x101114, .5);
        const cab = this.add.rectangle(direction > 0 ? width * .3 : -width * .3, 0, width * .26, 22, 0x101114, .35);
        const container = this.add.container(
          (index / lane.count) * WIDTH + Phaser.Math.Between(-30, 30),
          this.rowY(lane.lane),
          [body, cab],
        );
        this.vehicles.push({
          container,
          lane: lane.lane,
          vx: direction * lane.speed * speedScale,
          half: width / 2,
        });
      }
    }
    const riverLanes: Array<{ lane: number; count: number; speed: number; length: number }> = [
      { lane: 4, count: 3, speed: 95, length: 130 },
      { lane: 3, count: 2, speed: 130, length: 100 },
      { lane: 2, count: 3, speed: 85, length: 150 },
      { lane: 1, count: 2, speed: 150, length: 95 },
    ];
    for (const lane of riverLanes) {
      const direction = Math.random() < .5 ? -1 : 1;
      for (let index = 0; index < lane.count; index += 1) {
        const log = this.add.rectangle(0, 0, lane.length, 30, 0x8a5a34).setStrokeStyle(2, 0x5a3a1e, 1);
        const container = this.add.container(
          (index / lane.count) * WIDTH + Phaser.Math.Between(-40, 40),
          this.rowY(lane.lane),
          [log],
        );
        this.vehicles.push({
          container,
          lane: lane.lane,
          vx: direction * lane.speed * speedScale,
          half: lane.length / 2,
        });
      }
    }
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || this.dead) return;
      if (!this.started) {
        this.started = true;
        this.bridge.started();
        this.audio.unlock();
      }
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.swipeStart = new Phaser.Math.Vector2(position.x, position.y);
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || this.dead) return;
      const start = this.swipeStart;
      this.swipeStart = undefined;
      if (!start) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const deltaX = position.x - start.x;
      const deltaY = position.y - start.y;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_MIN) {
        this.hop(0, -1);
        return;
      }
      if (Math.abs(deltaX) > Math.abs(deltaY)) this.hop(Math.sign(deltaX), 0);
      else this.hop(0, Math.sign(deltaY));
    });
  }

  private hop(dx: number, dy: number) {
    if (this.dead || this.ended) return;
    this.frogX += dx * CELL_X;
    this.frogRow += dy;
    this.frogX = Phaser.Math.Clamp(this.frogX, 20, WIDTH - 20);
    if (this.frogRow < GOAL_ROW || this.frogRow > START_ROW) {
      this.frogRow = Phaser.Math.Clamp(this.frogRow, GOAL_ROW, START_ROW);
      this.frogX -= dx * CELL_X;
      return;
    }
    if (dy !== 0) this.ridingVehicle = null;

    this.audio.tone({ freq: 480, duration: .05, type: "square", gain: .07 });
    this.tweens.add({
      targets: this.frog,
      x: this.frogX,
      y: this.rowY(this.frogRow) - 6,
      duration: 110,
      ease: "Cubic.easeOut",
    });

    if (this.frogRow === GOAL_ROW) {
      const pad = this.pads.find((entry) => !entry.filled
        && Math.abs(entry.col * CELL_X + CELL_X / 2 - this.frogX) <= 24);
      if (pad) {
        pad.filled = true;
        pad.shape.setFillStyle(0xffd44d);
        this.score += 20;
        this.refreshScore();
        this.audio.tone({ freq: 720, duration: .16, type: "triangle", gain: .18 });
        this.frogX = CENTER_X;
        this.frogRow = START_ROW;
        this.ridingVehicle = null;
        this.time.delayedCall(200, () => {
          this.tweens.add({ targets: this.frog, x: this.frogX, y: this.rowY(START_ROW) - 6, duration: 200 });
        });
        if (this.pads.every((entry) => entry.filled)) {
          this.score += 100;
          this.refreshScore();
          this.level += 1;
          this.levelText.setText(`LV ${this.level}`);
          this.pads.forEach((entry) => {
            entry.filled = false;
            entry.shape.setFillStyle(0x9fe08a);
          });
          this.audio.tone({ freq: 520, duration: .15, type: "triangle", gain: .18 });
          this.audio.tone({ freq: 660, duration: .18, time: this.audio.now + .12, type: "triangle", gain: .18 });
          this.audio.tone({ freq: 880, duration: .25, time: this.audio.now + .26, type: "triangle", gain: .2 });
          this.cameras.main.flash(200, 223, 255, 63, false);
        }
      } else {
        this.frogRow += 1;
        this.frogX -= dx * CELL_X;
        this.hintText.setText("要落在荷叶上！").setColor("#ffd44d");
        this.time.delayedCall(900, () => this.hintText.setText("滑动或轻点跳跃 · 踩浮木过河 · 荷叶收集齐过关").setColor("#cfe3cf"));
        this.tweens.add({
          targets: this.frog,
          x: this.frogX,
          y: this.rowY(this.frogRow) - 6,
          duration: 110,
        });
      }
    }
  }

  private refreshScore() {
    this.scoreText.setText(String(this.score));
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
    }
  }

  private die(cause: "car" | "water") {
    if (this.dead || this.ended) return;
    this.dead = true;
    this.ridingVehicle = null;
    this.lives -= 1;
    this.livesText.setText("● ● ●".slice(0, Math.max(this.lives, 0) * 2).trim() || "—");
    if (cause === "car") {
      this.frog.setScale(1.3, .25);
      this.audio.tone({ freq: 170, endFreq: 70, duration: .3, type: "square", gain: .18 });
      this.cameras.main.shake(160, .01);
    } else {
      this.tweens.add({ targets: this.frog, scale: .2, alpha: 0, duration: 340 });
      this.audio.noise({ freq: 500, duration: .3, gain: .18, type: "lowpass" });
    }
    this.time.delayedCall(560, () => {
      if (this.lives <= 0) {
        this.endRun();
        return;
      }
      this.dead = false;
      this.frogX = CENTER_X;
      this.frogRow = START_ROW;
      this.frog.setScale(1).setAlpha(1);
      this.frog.setPosition(this.frogX, this.rowY(START_ROW) - 6);
      this.invulnUntil = this.time.now + 1100;
      this.tweens.add({ targets: this.frog, alpha: { from: .3, to: 1 }, duration: 160, yoyo: true, repeat: 3 });
    });
  }

  update(time: number, delta: number) {
    if (this.ended) return;
    const seconds = Math.min(delta, 40) / 1000;

    for (const vehicle of this.vehicles) {
      vehicle.container.x += vehicle.vx * seconds;
      if (vehicle.vx > 0 && vehicle.container.x - vehicle.half > WIDTH + 40) vehicle.container.x = -vehicle.half - 20;
      if (vehicle.vx < 0 && vehicle.container.x + vehicle.half < -40) vehicle.container.x = WIDTH + vehicle.half + 20;
    }

    if (this.dead || !this.started) return;

    if (this.invulnUntil > time && this.frog) this.frog.setAlpha(.4 + Math.sin(time / 60) * .3);
    else if (this.frog) this.frog.setAlpha(1);

    if (RIVER_ROWS.includes(this.frogRow) && !this.dead) {
      const laneVehicle = this.vehicles.find((vehicle) =>
        vehicle.lane === this.frogRow
        && Math.abs(vehicle.container.x - this.frogX) <= vehicle.half + 6);
      if (laneVehicle) {
        this.ridingVehicle = laneVehicle;
        this.frogX += laneVehicle.vx * seconds;
        this.frog.setPosition(this.frogX, this.rowY(this.frogRow) - 6);
        if (this.frogX < 12 || this.frogX > WIDTH - 12) {
          this.die("water");
        }
      } else {
        this.ridingVehicle = null;
        this.die("water");
      }
    }

    if (ROAD_ROWS.includes(this.frogRow) && !this.dead) {
      const hit = this.vehicles.some((vehicle) =>
        vehicle.lane === this.frogRow
        && Math.abs(vehicle.container.x - this.frogX) <= vehicle.half + 10);
      if (hit) this.die("car");
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
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .62)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 196, 0x1b1d21)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(CENTER_X, 500, "呱哇…", {
      fontFamily: "sans-serif", fontSize: "26px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `${this.score} 分  ·  LV ${this.level}  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "再跳一次  ↻", {
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
  scene: FrogCrossScene,
});
