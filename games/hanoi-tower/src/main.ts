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
const PEG_X = [85, 195, 305];
const PEG_BASE_Y = 620;
const MAX_DISKS = 6;

class HanoiTowerScene extends Phaser.Scene {
  private levelText!: Phaser.GameObjects.Text;
  private movesText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private towers: number[][] = [[], [], []];
  private diskShapes: Map<number, Phaser.GameObjects.Rectangle> = new Map();
  private selected?: { peg: number; disk: number };
  private level = 1;
  private moves = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "hanoi-tower", version: "1.0.0" });
  private storage = createGameStorage("hanoi-tower", { bestMoves: 0, level: 1 });

  constructor() { super("hanoi-tower"); }

  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 44, 44, 0x101114, 1, 0x232a44, .5);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "HANOI / 056", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "汉诺塔", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.levelText = this.add.text(22, 70, "第 1 关 · 3 盘", {
      fontFamily: "sans-serif", fontSize: "20px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.movesText = this.add.text(WIDTH - 22, 78, "步数 0", {
      fontFamily: "monospace", fontSize: "12px", color: "#dfff3f", letterSpacing: 1,
    }).setOrigin(1, 0);
    const saved = this.storage.load();
    this.bestText = this.add.text(WIDTH - 22, 100, `最佳 ${saved.bestMoves || "-"} 步`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.hintText = this.add.text(CENTER_X, 742, "点击柱子取盘 · 再点目标柱放下", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    for (let peg = 0; peg < 3; peg += 1) {
      this.add.rectangle(PEG_X[peg], PEG_BASE_Y - 130, 10, 260, 0x3a4470).setDepth(1);
      const base = this.add.rectangle(PEG_X[peg], PEG_BASE_Y + 6, 118, 14, 0x3a4470).setDepth(1);
      base.setInteractive({ useHandCursor: true });
      base.setData("peg", peg);
      base.on("pointerup", () => this.tapPeg(peg));
    }

    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.level = Math.min(MAX_DISKS - 2, this.storage.load().level || 1);
    this.loadLevel(this.level);
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private loadLevel(level: number) {
    const diskCount = Math.min(MAX_DISKS, 2 + level);
    this.level = level;
    this.moves = 0;
    this.started = false;
    this.ended = false;
    this.selected = undefined;
    for (const shape of this.diskShapes.values()) shape.destroy();
    this.diskShapes.clear();
    this.towers = [[], [], []];
    for (let disk = diskCount; disk >= 1; disk -= 1) {
      this.towers[0].push(disk);
      const width = 44 + disk * 14;
      const shape = this.add.rectangle(
        PEG_X[0], PEG_BASE_Y - 6 - (this.towers[0].length - 1) * 20,
        width, 18,
        Phaser.Display.Color.HSLToColor((disk * 40 % 360) / 360, .6, .58).color,
      ).setStrokeStyle(1.5, 0x101114, .6).setDepth(3)
        .setInteractive({ useHandCursor: true });
      shape.setData("disk", disk);
      shape.on("pointerup", () => this.tapPeg(this.pegOfDisk(disk)));
      this.diskShapes.set(disk, shape);
    }
    this.levelText.setText(`第 ${level} 关 · ${diskCount} 盘`);
    this.movesText.setText("步数 0");
  }

  private pegOfDisk(disk: number) {
    return this.towers.findIndex((tower) => tower.includes(disk));
  }

  private tapPeg(peg: number) {
    if (this.ended) return;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.audio.unlock();
    }
    if (this.selected !== undefined) {
      const from = this.selected;
      this.selected = undefined;
      const index = this.towers[from.peg].indexOf(from.disk);
      const shape = this.diskShapes.get(from.disk);
      if (shape) {
        const { x, y } = this.diskTarget(from.peg, index);
        shape.setPosition(x, y);
        shape.setStrokeStyle(1.5, 0x101114, .6);
      }
      if (from.peg === peg) return;
      const disk = this.towers[from.peg][this.towers[from.peg].length - 1];
      const target = this.towers[peg];
      if (target.length > 0 && target[target.length - 1] < disk) {
        this.audio.tone({ freq: 190, duration: .08, type: "sawtooth", gain: .08 });
        this.hintText.setText("大盘不能压小盘").setColor("#ff6a51");
        this.time.delayedCall(900, () => this.hintText.setText("点击柱子取盘 · 再点目标柱放下").setColor("#8f918a"));
        return;
      }
      this.towers[from.peg].pop();
      target.push(disk);
      this.moves += 1;
      this.movesText.setText(`步数 ${this.moves}`);
      this.animateTower(from.peg);
      this.animateTower(peg);
      this.audio.tone({ freq: 340, duration: .07, type: "sine", gain: .1 });
      if (peg === 2 && this.towers[2].length === this.diskShapes.size) {
        this.completeLevel();
      }
      return;
    }
    const tower = this.towers[peg];
    if (tower.length === 0) return;
    this.selected = { peg, disk: tower[tower.length - 1] };
    const shape = this.diskShapes.get(tower[tower.length - 1]);
    shape?.setY(shape.y - 10).setStrokeStyle(3, 0xdfff3f, 1);
    this.audio.tone({ freq: 420, duration: .05, type: "sine", gain: .08 });
    this.hintText.setText("已拿起 · 点击目标柱放下").setColor("#dfff3f");
  }

  private animateTower(peg: number) {
    this.towers[peg].forEach((disk, index) => {
      const shape = this.diskShapes.get(disk);
      if (!shape) return;
      const { x, y } = this.diskTarget(peg, index);
      this.tweens.add({ targets: shape, x, y, duration: 160, ease: "Cubic.easeOut" });
      shape.setStrokeStyle(1.5, 0x101114, .6);
    });
  }

  private diskTarget(peg: number, stackIndex: number) {
    return { x: PEG_X[peg], y: PEG_BASE_Y - 6 - stackIndex * 20 };
  }

  private completeLevel() {
    this.ended = true;
    const optimal = Math.pow(2, this.diskShapes.size) - 1;
    const saved = this.storage.load();
    const bestMoves = saved.bestMoves > 0 ? Math.min(saved.bestMoves, this.moves) : this.moves;
    this.storage.save({ bestMoves: bestMoves, level: Math.min(MAX_DISKS - 2, this.level + 1) });
    this.bridge.score(Math.max(0, 1000 - this.moves * 40));
    this.bestText.setText(`最佳 ${bestMoves} 步`);
    this.audio.tone({ freq: 523, duration: .15, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 659, duration: .18, time: this.audio.now + .13, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .28, type: "triangle", gain: .22 });
    const banner = this.add.text(CENTER_X, 180, `${this.moves} 步完成${this.moves === optimal ? " · 最优解！" : ""}`, {
      fontFamily: "sans-serif", fontSize: "24px", color: "#dfff3f", fontStyle: "bold",
    }).setOrigin(.5).setDepth(20).setAlpha(0);
    this.tweens.add({ targets: banner, alpha: 1, duration: 220 });
    this.time.delayedCall(1400, () => this.loadLevel(this.level + 1));
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
  scene: HanoiTowerScene,
});
