import Phaser from "phaser";
import {
  configureHiDpiCamera,
  createGameBridge,
  createGameStorage,
  getGameRenderDpr,
  sharpenSceneText,
} from "@web-games/game-sdk";
import "./style.css";

const WIDTH = 390;
const HEIGHT = 844;
const RENDER_DPR = getGameRenderDpr();
const CARD_WIDTH = 76;
const CARD_HEIGHT = 96;
const CARD_GAP = 12;
const BOARD_LEFT = 25;
const BOARD_TOP = 222;

const SYMBOLS = [
  { key: "memory-rocket", accent: 0xff6a51 },
  { key: "memory-planet", accent: 0x5c7cff },
  { key: "memory-star", accent: 0xffc94a },
  { key: "memory-lightning", accent: 0x9b6bff },
  { key: "memory-heart", accent: 0xff6a51 },
  { key: "memory-crystal", accent: 0x55d6be },
  { key: "memory-crown", accent: 0xffc94a },
  { key: "memory-note", accent: 0xff8fb8 },
] as const;

interface MemoryCard {
  pair: number;
  container: Phaser.GameObjects.Container;
  back: Phaser.GameObjects.Container;
  face: Phaser.GameObjects.Container;
  faceUp: boolean;
  matched: boolean;
}

class MemoryMatchScene extends Phaser.Scene {
  private cards: MemoryCard[] = [];
  private firstCard: MemoryCard | null = null;
  private moves = 0;
  private pairs = 0;
  private elapsedMs = 0;
  private started = false;
  private ended = false;
  private locked = false;
  private movesText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private pairsText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private bridge = createGameBridge({ gameId: "memory-match", version: "1.2.0" });
  private storage = createGameStorage("memory-match", { bestMoves: 0, bestTime: 0 });

  constructor() {
    super("memory-match");
  }

  preload() {
    SYMBOLS.forEach((symbol) => {
      this.load.image(symbol.key, `assets/${symbol.key}.png`);
    });
  }

  create() {
    this.resetState();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#f3f0e8");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 36, 36, 0xf3f0e8, 1, 0x101114, .055);

    this.add.text(24, 28, "MEMORY / 005", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#101114",
      letterSpacing: 2,
      fontStyle: "bold",
    });
    this.add.text(WIDTH - 24, 28, "益智", {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#77756f",
    }).setOrigin(1, 0);
    this.add.text(24, 59, "记忆翻牌", {
      fontFamily: "sans-serif",
      fontSize: "38px",
      color: "#101114",
      fontStyle: "bold",
    });
    this.add.text(26, 107, "翻开两张相同图形，找出全部配对", {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#77756f",
    });

    this.add.rectangle(WIDTH / 2, 166, WIDTH - 48, 64, 0x101114).setStrokeStyle(1, 0x101114);
    this.movesText = this.add.text(42, 150, "00", this.statValueStyle());
    this.timeText = this.add.text(WIDTH / 2, 150, "00:00", this.statValueStyle()).setOrigin(.5, 0);
    this.pairsText = this.add.text(WIDTH - 42, 150, "0/8", this.statValueStyle()).setOrigin(1, 0);
    this.add.text(42, 177, "步数", this.statLabelStyle());
    this.add.text(WIDTH / 2, 177, "用时", this.statLabelStyle()).setOrigin(.5, 0);
    this.add.text(WIDTH - 42, 177, "配对", this.statLabelStyle()).setOrigin(1, 0);

    const pairs = Phaser.Utils.Array.Shuffle([...Array(8).keys(), ...Array(8).keys()]);
    this.cards = pairs.map((pair, index) => this.createCard(pair, index));
    const handleBoardPointer = (pointer: Phaser.Input.Pointer) => this.handleBoardTap(pointer);
    this.input.on("pointerup", handleBoardPointer);

    this.hintText = this.add.text(WIDTH / 2, 688, "点击任意卡片开始", {
      fontFamily: "sans-serif",
      fontSize: "15px",
      color: "#101114",
      fontStyle: "bold",
    }).setOrigin(.5);
    this.add.text(WIDTH / 2, 718, "翻错的卡片会自动盖回", {
      fontFamily: "sans-serif",
      fontSize: "11px",
      color: "#77756f",
    }).setOrigin(.5);

    const best = this.storage.load();
    this.bestText = this.add.text(WIDTH / 2, HEIGHT - 40, this.formatBest(best.bestMoves, best.bestTime), {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#77756f",
      letterSpacing: 1,
    }).setOrigin(.5);

    const pauseGame = () => this.scene.pause();
    const resumeGame = () => {
      if (!this.ended) this.scene.resume();
    };
    this.game.events.on(Phaser.Core.Events.BLUR, pauseGame);
    this.game.events.on(Phaser.Core.Events.FOCUS, resumeGame);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off("pointerup", handleBoardPointer);
      this.game.events.off(Phaser.Core.Events.BLUR, pauseGame);
      this.game.events.off(Phaser.Core.Events.FOCUS, resumeGame);
    });

    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  update(_time: number, delta: number) {
    if (!this.started || this.ended) return;
    this.elapsedMs += delta;
    this.timeText.setText(this.formatTime(Math.floor(this.elapsedMs / 1000)));
  }

  private resetState() {
    this.cards = [];
    this.firstCard = null;
    this.moves = 0;
    this.pairs = 0;
    this.elapsedMs = 0;
    this.started = false;
    this.ended = false;
    this.locked = false;
  }

  private createCard(pair: number, index: number): MemoryCard {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = BOARD_LEFT + CARD_WIDTH / 2 + column * (CARD_WIDTH + CARD_GAP);
    const y = BOARD_TOP + CARD_HEIGHT / 2 + row * (CARD_HEIGHT + CARD_GAP);
    const symbol = SYMBOLS[pair];

    const shadow = this.add.rectangle(3, 4, CARD_WIDTH, CARD_HEIGHT, 0x101114, .16).setOrigin(.5);
    const backBackground = this.add.rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT, 0x101114)
      .setStrokeStyle(2, 0x101114)
      .setOrigin(.5);
    const backDiamond = this.add.rectangle(0, -7, 34, 34, 0x5c7cff)
      .setStrokeStyle(2, 0xf3f0e8)
      .setAngle(45);
    const backDot = this.add.circle(0, -7, 8, 0xdfff3f).setStrokeStyle(2, 0x101114);
    const backLabel = this.add.text(0, 29, "PAIR", {
      fontFamily: "monospace",
      fontSize: "8px",
      color: "#f3f0e8",
      letterSpacing: 2,
      fontStyle: "bold",
    }).setOrigin(.5);
    const back = this.add.container(0, 0, [backBackground, backDiamond, backDot, backLabel]);

    const faceBackground = this.add.rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT, 0xfffdf4)
      .setStrokeStyle(2, 0x101114)
      .setOrigin(.5);
    const faceAccent = this.add.rectangle(0, 35, CARD_WIDTH - 4, 18, symbol.accent, .24);
    const faceMark = this.add.image(0, -6, symbol.key).setDisplaySize(58, 58);
    const faceNumber = this.add.text(0, 34, String(pair + 1).padStart(2, "0"), {
      fontFamily: "monospace",
      fontSize: "8px",
      color: "#77756f",
      letterSpacing: 1,
    }).setOrigin(.5);
    const face = this.add.container(0, 0, [faceBackground, faceAccent, faceMark, faceNumber]).setVisible(false);

    const container = this.add.container(x, y, [shadow, back, face]);
    container.setSize(CARD_WIDTH, CARD_HEIGHT).setInteractive(
      new Phaser.Geom.Rectangle(-CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT),
      Phaser.Geom.Rectangle.Contains,
    );
    if (container.input) container.input.cursor = "pointer";

    const card: MemoryCard = { pair, container, back, face, faceUp: false, matched: false };
    return card;
  }

  private handleBoardTap(pointer: Phaser.Input.Pointer) {
    const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const card = this.cards.find((candidate) => (
      Math.abs(position.x - candidate.container.x) <= CARD_WIDTH / 2
      && Math.abs(position.y - candidate.container.y) <= CARD_HEIGHT / 2
    ));
    if (card) this.chooseCard(card);
  }

  private chooseCard(card: MemoryCard) {
    if (this.locked || this.ended || card.faceUp || card.matched) return;
    if (!this.started) {
      this.started = true;
      this.hintText.setText("记住每一张牌的位置");
      this.bridge.started();
    }

    this.locked = true;
    this.flipCard(card, true, () => {
      if (!this.firstCard) {
        this.firstCard = card;
        this.locked = false;
        return;
      }

      const previous = this.firstCard;
      this.firstCard = null;
      this.moves += 1;
      this.movesText.setText(String(this.moves).padStart(2, "0"));

      if (previous.pair === card.pair) {
        previous.matched = true;
        card.matched = true;
        this.pairs += 1;
        this.pairsText.setText(`${this.pairs}/8`);
        this.hintText.setText("配对成功！");
        this.tweens.add({
          targets: [previous.container, card.container],
          scale: 1.07,
          duration: 130,
          yoyo: true,
          ease: "Quad.easeOut",
        });
        navigator.vibrate?.(24);
        this.locked = false;
        this.bridge.score(this.pairs * 100);

        if (this.pairs === 8) {
          this.locked = true;
          this.time.delayedCall(500, () => this.finishGame());
        }
      } else {
        this.hintText.setText("再想一想…");
        this.time.delayedCall(560, () => {
          this.flipCard(previous, false, () => {
            this.flipCard(card, false, () => {
              this.locked = false;
              this.hintText.setText("继续寻找相同图形");
            });
          });
        });
      }
    });
  }

  private flipCard(card: MemoryCard, faceUp: boolean, complete: () => void) {
    this.tweens.killTweensOf(card.container);
    card.container.setScale(card.container.scaleX, 1);
    this.tweens.add({
      targets: card.container,
      scaleX: 0,
      duration: 105,
      ease: "Quad.easeIn",
      onComplete: () => {
        card.faceUp = faceUp;
        card.face.setVisible(faceUp);
        card.back.setVisible(!faceUp);
        this.tweens.add({
          targets: card.container,
          scaleX: 1,
          duration: 105,
          ease: "Quad.easeOut",
          onComplete: complete,
        });
      },
    });
  }

  private finishGame() {
    this.ended = true;
    const elapsedSeconds = Math.max(1, Math.floor(this.elapsedMs / 1000));
    const score = Math.max(100, 3200 - this.moves * 65 - elapsedSeconds * 8);
    const saved = this.storage.load();
    const bestMoves = saved.bestMoves === 0 ? this.moves : Math.min(saved.bestMoves, this.moves);
    const bestTime = saved.bestTime === 0 ? elapsedSeconds : Math.min(saved.bestTime, elapsedSeconds);
    this.storage.save({ bestMoves, bestTime });
    this.bestText.setText(this.formatBest(bestMoves, bestTime));
    this.bridge.score(score);
    this.bridge.gameOver(score);
    navigator.vibrate?.([35, 35, 70]);

    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .78).setDepth(100);
    const panel = this.add.rectangle(WIDTH / 2, 426, 318, 278, 0xf3f0e8)
      .setStrokeStyle(2, 0x101114)
      .setDepth(101);
    const mark = this.add.circle(WIDTH / 2, 344, 28, 0xdfff3f)
      .setStrokeStyle(2, 0x101114)
      .setDepth(102);
    this.add.text(WIDTH / 2, 344, "✓", {
      fontFamily: "sans-serif",
      fontSize: "28px",
      color: "#101114",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    this.add.text(WIDTH / 2, 389, "全部找到！", {
      fontFamily: "sans-serif",
      fontSize: "28px",
      color: "#101114",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(WIDTH / 2, 433, `${this.moves} 步  ·  ${this.formatTime(elapsedSeconds)}`, {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#77756f",
    }).setOrigin(.5).setDepth(102);

    const button = this.add.rectangle(WIDTH / 2, 508, 218, 52, 0x101114)
      .setStrokeStyle(2, 0x101114)
      .setDepth(102)
      .setInteractive({ cursor: "pointer" });
    this.add.text(WIDTH / 2, 508, "再玩一次  ↗", {
      fontFamily: "sans-serif",
      fontSize: "15px",
      color: "#ffffff",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    button.on("pointerup", () => this.scene.restart());

    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({
      targets: [shade, panel, mark, button],
      alpha: { from: 0, to: 1 },
      duration: 220,
    });
  }

  private statValueStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: "monospace", fontSize: "20px", color: "#ffffff", fontStyle: "bold" };
  }

  private statLabelStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: "sans-serif", fontSize: "9px", color: "#77787c" };
  }

  private formatTime(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  private formatBest(moves: number, time: number) {
    if (!moves || !time) return "BEST  -- STEPS  ·  --:--";
    return `BEST  ${String(moves).padStart(2, "0")} STEPS  ·  ${this.formatTime(time)}`;
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#f3f0e8",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: MemoryMatchScene,
});
