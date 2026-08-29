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
const GRID = 5;
const CELL = 62;
const BOARD_X = CENTER_X - (GRID * CELL) / 2;
const BOARD_Y = 210;

interface Lamp {
  rect: Phaser.GameObjects.Rectangle;
  glow: Phaser.GameObjects.Rectangle;
  on: boolean;
}

class LightsOutScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private movesText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private lamps: Lamp[] = [];
  private level = 1;
  private moves = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "lights-out", version: "1.0.0" });
  private storage = createGameStorage("lights-out", { level: 1 });

  constructor() { super("lights-out"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#0b1024");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 44, 44, 0x0b1024, 1, 0x232a44, .5);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "LIGHTS / 044", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "熄灯挑战", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 72, "第 1 关", {
      fontFamily: "sans-serif", fontSize: "21px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.movesText = this.add.text(WIDTH - 22, 80, "点击 0 次", {
      fontFamily: "monospace", fontSize: "11px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.hintText = this.add.text(CENTER_X, 660, "点亮一盏会翻转十字相邻 · 全灭即过关", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    const restart = this.add.rectangle(CENTER_X, 716, 160, 44, 0x1b2038)
      .setStrokeStyle(1.5, 0x3a4470).setInteractive({ useHandCursor: true });
    this.add.text(CENTER_X, 716, "重新打乱", {
      fontFamily: "sans-serif", fontSize: "14px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5);
    restart.on("pointerup", () => this.loadLevel(this.level));

    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.buildBoard();
    this.level = this.storage.load().level;
    this.loadLevel(this.level);
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private buildBoard() {
    for (let row = 0; row < GRID; row += 1) {
      for (let col = 0; col < GRID; col += 1) {
        const x = BOARD_X + col * CELL + CELL / 2;
        const y = BOARD_Y + row * CELL + CELL / 2;
        const glow = this.add.rectangle(x, y, CELL - 8, CELL - 8, 0xffd44d, 0).setDepth(2);
        const rect = this.add.rectangle(x, y, CELL - 8, CELL - 8, 0x1b2038)
          .setStrokeStyle(2, 0x3a4470, 1).setInteractive({ useHandCursor: true }).setDepth(3);
        rect.setData("index", row * GRID + col);
        rect.on("pointerup", () => this.tapLamp(row * GRID + col));
        this.lamps.push({ rect, glow, on: false });
      }
    }
  }

  private loadLevel(level: number) {
    this.level = level;
    this.moves = 0;
    this.movesText.setText("点击 0 次");
    this.levelText.setText(`第 ${level} 关`);
    this.ended = false;

    for (const lamp of this.lamps) lamp.on = false;
    // Generate by applying N random taps from a solved (all-off) board — always solvable.
    const taps = 3 + Math.min(level, 12);
    const chosen = new Set<number>();
    while (chosen.size < taps) chosen.add(Phaser.Math.Between(0, this.lamps.length - 1));
    for (const index of chosen) this.applyToggle(index, true);
    this.refreshLamps();
  }

  private applyToggle(index: number, silent: boolean) {
    const row = Math.floor(index / GRID);
    const col = index % GRID;
    const targets = [
      index,
      col > 0 ? index - 1 : -1,
      col < GRID - 1 ? index + 1 : -1,
      row > 0 ? index - GRID : -1,
      row < GRID - 1 ? index + GRID : -1,
    ];
    for (const target of targets) {
      if (target < 0) continue;
      const lamp = this.lamps[target];
      lamp.on = !lamp.on;
      if (!silent) {
        this.tweens.add({ targets: lamp.glow, alpha: lamp.on ? .95 : 0, duration: 130 });
        this.tweens.add({ targets: lamp.rect, scale: { from: .92, to: 1 }, duration: 130 });
      }
    }
    if (!silent) this.audio.tone({ freq: 300 + row * 40, duration: .06, type: "sine", gain: .1 });
  }

  private refreshLamps() {
    for (const lamp of this.lamps) {
      lamp.glow.setAlpha(lamp.on ? .95 : 0);
      lamp.rect.setFillStyle(lamp.on ? 0x6b5a1e : 0x1b2038);
    }
  }

  private tapLamp(index: number) {
    if (this.ended) return;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.audio.unlock();
    }
    this.moves += 1;
    this.movesText.setText(`点击 ${this.moves} 次`);
    this.applyToggle(index, false);
    if (this.lamps.every((lamp) => !lamp.on)) {
      this.ended = true;
      this.storage.save({ level: this.level + 1 });
      this.bridge.score(this.level * 100);
      this.audio.tone({ freq: 523, duration: .15, type: "triangle", gain: .2 });
      this.audio.tone({ freq: 659, duration: .18, time: this.audio.now + .13, type: "triangle", gain: .2 });
      this.audio.tone({ freq: 880, duration: .3, time: this.audio.now + .28, type: "triangle", gain: .22 });
      const banner = this.add.text(CENTER_X, BOARD_Y + (GRID * CELL) / 2, "全灭通关！", {
        fontFamily: "sans-serif", fontSize: "30px", color: "#ffd44d", fontStyle: "bold", letterSpacing: 6,
      }).setOrigin(.5).setDepth(20).setAlpha(0);
      this.tweens.add({
        targets: banner,
        alpha: 1,
        scale: { from: .7, to: 1 },
        duration: 260,
        ease: "Back.easeOut",
        onComplete: () => {
          this.tweens.add({
            targets: banner,
            alpha: 0,
            delay: 800,
            duration: 280,
            onComplete: () => this.loadLevel(this.level + 1),
          });
        },
      });
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#0b1024",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: LightsOutScene,
});
