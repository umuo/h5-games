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
const PILE_START = [3, 5, 7];

class NimStonesScene extends Phaser.Scene {
  private roundText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private recordText!: Phaser.GameObjects.Text;
  private stoneContainers: Array<Array<Phaser.GameObjects.Ellipse>> = [];
  private countLabels: Phaser.GameObjects.Text[] = [];
  private piles: number[] = [];
  private playerTurn = true;
  private round = 1;
  private finished = false;
  private streak = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "nim-stones", version: "1.0.0" });
  private storage = createGameStorage("nim-stones", { bestStreak: 0 });

  constructor() { super("nim-stones"); }

  create() {
    this.round = 1;
    this.streak = 0;
    this.started = false;
    this.ended = false;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 44, 44, 0x101114, 1, 0x232a44, .5);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "NIM / 055", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "取石子", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.roundText = this.add.text(22, 70, "第 1 局", {
      fontFamily: "sans-serif", fontSize: "21px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.statusText = this.add.text(CENTER_X, 78, "点击石堆取石 · 拿走最后一颗者胜", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#dfff3f", fontStyle: "bold",
    }).setOrigin(.5);
    this.recordText = this.add.text(CENTER_X, 116, "", {
      fontFamily: "monospace", fontSize: "12px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5);

    const saved = this.storage.load();
    this.recordText.setText(`连胜纪录 ${saved.bestStreak}`);

    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.startRound();
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private startRound() {
    this.finished = false;
    this.playerTurn = true;
    this.piles = PILE_START.map((count) => count + this.round - 1);
    this.drawPiles();
  }

  private drawPiles() {
    for (const column of this.stoneContainers) {
      for (const stone of column) stone.destroy();
    }
    for (const label of this.countLabels) label.destroy();
    this.stoneContainers = [];
    this.countLabels = [];
    const columnWidth = WIDTH / this.piles.length;
    this.piles.forEach((count, pileIndex) => {
      const stones: Array<Phaser.GameObjects.Ellipse> = [];
      const centerX = columnWidth * pileIndex + columnWidth / 2;
      for (let index = 0; index < count; index += 1) {
        const y = 480 - Math.floor(index / 2) * 34;
        const offset = index % 2 === 0 ? -14 : 14;
        const stone = this.add.ellipse(centerX + offset, y, 30, 26, 0x9fe08a)
          .setStrokeStyle(2, 0x1b4a20, .9)
          .setInteractive({ useHandCursor: true });
        stone.setData("pile", pileIndex);
        stone.on("pointerup", () => this.takeFrom(pileIndex, 1));
        this.add.text(centerX, 560, `堆 ${pileIndex + 1}`, {
          fontFamily: "sans-serif", fontSize: "11px", color: "#73757d",
        }).setOrigin(.5);
        stones.push(stone);
      }
      this.stoneContainers.push(stones);
      const countLabel = this.add.text(centerX, 200, `${count}`, {
        fontFamily: "monospace", fontSize: "20px", color: "#dfff3f", fontStyle: "bold",
      }).setOrigin(.5);
      this.countLabels.push(countLabel);
    });
  }

  private takeFrom(pileIndex: number, amount: number) {
    if (this.finished || !this.playerTurn) return;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.audio.unlock();
    }
    if (this.piles[pileIndex] < amount) return;
    this.piles[pileIndex] -= amount;
    for (let removed = 0; removed < amount; removed += 1) {
      const column = this.stoneContainers[pileIndex];
      const stone = column.find((entry) => entry.getData?.("pile") === pileIndex && entry.visible);
      const target = stone ?? column[0];
      if (target) {
        this.tweens.add({
          targets: target,
          y: 640,
          alpha: 0,
          duration: 220,
          onComplete: () => target.destroy(),
        });
      }
    }
    this.audio.tone({ freq: 340, duration: .07, type: "sine", gain: .1 });
    this.playerTurn = false;
    this.time.delayedCall(430, () => this.afterPlayerTake());
  }

  private redrawPileCounts() {
    this.piles.forEach((count, pileIndex) => {
      this.countLabels[pileIndex]?.setText(String(count));
    });
  }

  private afterPlayerTake() {
    this.redrawPileCounts();
    if (this.piles.every((pile) => pile === 0)) {
      this.endRound(true);
      return;
    }
    const move = this.nimMove();
    this.piles[move.pile] -= move.take;
    for (let removed = 0; removed < move.take; removed += 1) {
      const column = this.stoneContainers[move.pile];
      const target = column.find((entry) => entry.getData?.("pile") === move.pile && entry.visible);
      if (target) {
        this.tweens.add({
          targets: target,
          y: 200,
          alpha: 0,
          duration: 200,
          onComplete: () => target.destroy(),
        });
      }
    }
    this.audio.tone({ freq: 260, duration: .08, type: "sine", gain: .1 });
    this.time.delayedCall(380, () => {
      this.redrawPileCounts();
      if (this.piles.every((pile) => pile === 0)) {
        this.endRound(false);
        return;
      }
      this.playerTurn = true;
      this.statusText.setText("轮到你取石");
    });
  }

  /** Win if XOR of piles is non-zero: move to make it zero. */
  private nimMove(): { pile: number; take: number } {
    const xor = this.piles.reduce((acc, pile) => acc ^ pile, 0);
    if (xor !== 0) {
      for (let pileIndex = 0; pileIndex < this.piles.length; pileIndex += 1) {
        const target = this.piles[pileIndex] ^ xor;
        if (target < this.piles[pileIndex]) {
          return { pile: pileIndex, take: this.piles[pileIndex] - target };
        }
      }
    }
    // Losing position: take one from the largest pile.
    const largest = this.piles.indexOf(Math.max(...this.piles));
    return { pile: largest, take: 1 };
  }

  private endRound(playerWon: boolean) {
    this.finished = true;
    if (playerWon) {
      this.streak += 1;
      const saved = this.storage.load();
      this.storage.save({ bestStreak: Math.max(saved.bestStreak, this.streak) });
      this.statusText.setText(`你赢了！连胜 ${this.streak}`).setColor("#dfff3f");
      this.bridge.score(this.round * 100);
      this.audio.tone({ freq: 523, duration: .15, type: "triangle", gain: .2 });
      this.audio.tone({ freq: 784, duration: .28, time: this.audio.now + .14, type: "triangle", gain: .2 });
    } else {
      this.streak = 0;
      this.statusText.setText("AI 拿走了最后一颗").setColor("#ff6a51");
      this.audio.tone({ freq: 280, endFreq: 90, duration: .5, type: "sawtooth", gain: .2 });
    }
    const saved = this.storage.load();
    this.recordText.setText(`连胜纪录 ${Math.max(saved.bestStreak, this.streak)}`);
    this.round += 1;
    this.time.delayedCall(1500, () => {
      this.roundText.setText(`第 ${this.round} 局`);
      this.startRound();
    });
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
  scene: NimStonesScene,
});
