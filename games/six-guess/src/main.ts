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
const DIGITS = [1, 2, 3, 4, 5, 6];
const SECRET_LENGTH = 4;
const MAX_GUESSES = 8;

class SixGuessScene extends Phaser.Scene {
  private roundText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private historyText!: Phaser.GameObjects.Text;
  private guessSlots: Phaser.GameObjects.Text[] = [];
  private secret: number[] = [];
  private entry: number[] = [];
  private history: Array<{ guess: string; a: number; b: number }> = [];
  private round = 1;
  private solvedStreak = 0;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "six-guess", version: "1.0.0" });
  private storage = createGameStorage("six-guess", { bestStreak: 0 });

  constructor() { super("six-guess"); }

  create() {
    this.round = 1;
    this.solvedStreak = 0;
    this.started = false;
    this.ended = false;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 44, 44, 0x101114, 1, 0x232a44, .5);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "GUESS / 049", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "猜数字", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);
    this.roundText = this.add.text(22, 70, "第 1 轮", {
      fontFamily: "sans-serif", fontSize: "21px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.statusText = this.add.text(CENTER_X, 78, "破译 4 位不重复密码 (1-6)", {
      fontFamily: "monospace", fontSize: "12px", color: "#dfff3f", letterSpacing: 1,
    }).setOrigin(1, 0);

    this.historyText = this.add.text(CENTER_X, 220, "", {
      fontFamily: "monospace", fontSize: "15px", color: "#f3f0e8", align: "center", lineSpacing: 8,
    }).setOrigin(.5, 0);

    for (let index = 0; index < SECRET_LENGTH; index += 1) {
      const slot = this.add.text(CENTER_X - 90 + index * 60, 132, "·", {
        fontFamily: "monospace", fontSize: "30px", color: "#dfff3f", fontStyle: "bold",
      }).setOrigin(.5);
      this.guessSlots.push(slot);
    }

    this.buildKeypad();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.newSecret();
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private newSecret() {
    const pool = [...DIGITS];
    this.secret = [];
    for (let index = 0; index < SECRET_LENGTH; index += 1) {
      this.secret.push(...pool.splice(Phaser.Math.Between(0, pool.length - 1), 1));
    }
    this.entry = [];
    this.history = [];
    this.historyText.setText("");
    this.refreshSlots();
  }

  private buildKeypad() {
    const labels = ["1", "2", "3", "4", "5", "6", "←", "✓"];
    labels.forEach((label, index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      const x = CENTER_X - 100 + col * 68;
      const y = 560 + row * 64;
      const isAction = index >= 6;
      const button = this.add.rectangle(x, y, 58, 52, isAction ? (index === 7 ? 0xdfff3f : 0xff6a51) : 0x1b2038)
        .setStrokeStyle(1.5, 0x3a4470).setInteractive({ useHandCursor: true });
      this.add.text(x, y, label, {
        fontFamily: "monospace", fontSize: "20px",
        color: isAction ? (index === 7 ? "#101114" : "#f3f0e8") : "#f3f0e8", fontStyle: "bold",
      }).setOrigin(.5);
      button.on("pointerup", () => this.press(label));
    });
    this.hintText = this.add.text(CENTER_X, 700, "● 位置正确 ○ 数字对位置错", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#8f918a",
    }).setOrigin(.5);
  }

  private press(label: string) {
    if (this.ended) return;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.audio.unlock();
    }
    if (label === "←") {
      this.entry.pop();
      this.refreshSlots();
      this.audio.tone({ freq: 240, duration: .04, type: "sine", gain: .07 });
      return;
    }
    if (label === "✓") {
      this.submit();
      return;
    }
    const digit = Number(label);
    if (this.entry.length >= SECRET_LENGTH || this.entry.includes(digit)) {
      this.audio.tone({ freq: 190, duration: .07, type: "sawtooth", gain: .07 });
      return;
    }
    this.entry.push(digit);
    this.refreshSlots();
    this.audio.tone({ freq: 380 + digit * 40, duration: .05, type: "sine", gain: .08 });
    if (this.entry.length === SECRET_LENGTH) {
      this.time.delayedCall(160, () => this.submit());
    }
  }

  private refreshSlots() {
    for (let index = 0; index < SECRET_LENGTH; index += 1) {
      this.guessSlots[index].setText(this.entry[index] !== undefined ? String(this.entry[index]) : "·");
    }
  }

  private submit() {
    if (this.ended || this.entry.length !== SECRET_LENGTH) return;
    let exact = 0;
    let partial = 0;
    this.entry.forEach((digit, index) => {
      if (this.secret[index] === digit) exact += 1;
      else if (this.secret.includes(digit)) partial += 1;
    });
    this.history.push({
      guess: this.entry.join(" "),
      a: exact,
      b: partial,
    });
    this.audio.tone({ freq: exact === SECRET_LENGTH ? 700 : 340, duration: .1, type: "triangle", gain: .12 });
    this.historyText.setText(
      this.history.map((entry, index) =>
        `${String(index + 1).padStart(2, " ")}   ${entry.guess}    ●${entry.a} ○${entry.b}`).join("\n"),
    );
    if (exact === SECRET_LENGTH) {
      this.winRound();
      return;
    }
    this.entry = [];
    this.refreshSlots();
    if (this.history.length >= MAX_GUESSES) {
      this.loseRound();
    }
  }

  private winRound() {
    this.ended = true;
    this.solvedStreak += 1;
    const saved = this.storage.load();
    this.storage.save({ bestStreak: Math.max(saved.bestStreak, this.solvedStreak) });
    this.bridge.score(this.round * 100);
    this.statusText.setText(`破译成功！连续 ${this.solvedStreak}`).setColor("#dfff3f");
    this.audio.tone({ freq: 523, duration: .15, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .14, type: "triangle", gain: .2 });
    this.time.delayedCall(1000, () => {
      this.round += 1;
      this.roundText.setText(`第 ${this.round} 轮`);
      this.ended = false;
      this.newSecret();
    });
  }

  private loseRound() {
    this.ended = true;
    this.solvedStreak = 0;
    this.statusText.setText(`密码是 ${this.secret.join(" ")}`).setColor("#ff6a51");
    this.audio.tone({ freq: 260, endFreq: 90, duration: .55, type: "sawtooth", gain: .2 });
    this.time.delayedCall(1400, () => {
      this.round = 1;
      this.roundText.setText("第 1 轮");
      this.statusText.setText("破译 4 位不重复密码 (1-6)").setColor("#dfff3f");
      this.ended = false;
      this.newSecret();
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
  scene: SixGuessScene,
});
