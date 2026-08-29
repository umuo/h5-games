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
const ROUND_TIME = 60000;

interface Card {
  value: number;
  container: Phaser.GameObjects.Container;
  used: boolean;
  baseX: number;
  baseY: number;
}

interface Puzzle {
  cards: number[];
  solutionExpression: string;
}

/** All ways to combine four numbers with + - * /, tracking the expression. */
function solve24(numbers: number[]): string | null {
  const items: Array<{ value: number; expr: string }> = numbers.map((value) => ({ value, expr: String(value) }));
  const eps = 1e-6;
  const search = (pool: Array<{ value: number; expr: string }>): string | null => {
    if (pool.length === 1) {
      return Math.abs(pool[0].value - 24) < eps ? pool[0].expr : null;
    }
    for (let a = 0; a < pool.length; a += 1) {
      for (let b = 0; b < pool.length; b += 1) {
        if (a === b) continue;
        const rest = pool.filter((_, index) => index !== a && index !== b);
        const first = pool[a];
        const second = pool[b];
        const candidates: Array<{ value: number; expr: string; skip: boolean }> = [
          { value: first.value + second.value, expr: `(${first.expr}+${second.expr})`, skip: false },
          { value: first.value * second.value, expr: `(${first.expr}×${second.expr})`, skip: false },
          { value: first.value - second.value, expr: `(${first.expr}-${second.expr})`, skip: false },
          { value: second.value / second.value + 0, expr: "", skip: true },
        ];
        for (const candidate of candidates) {
          if (candidate.skip) continue;
          const found = search([...rest, { value: candidate.value, expr: candidate.expr }]);
          if (found) return found;
        }
        if (second.value !== 0) {
          const found = search([...rest, { value: first.value / second.value, expr: `(${first.expr}÷${second.expr})` }]);
          if (found) return found;
        }
      }
    }
    return null;
  };
  return search(items);
}

function generatePuzzle(): Puzzle {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const cards = Array.from({ length: 4 }, () => Phaser.Math.Between(1, 13));
    const solutionExpression = solve24(cards);
    if (solutionExpression) return { cards, solutionExpression };
  }
  return { cards: [4, 7, 8, 8], solutionExpression: "((8-4)×(7+8-...))" };
}

class TwentyFourScene extends Phaser.Scene {
  private roundText!: Phaser.GameObjects.Text;
  private targetText!: Phaser.GameObjects.Text;
  private expressionText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private timeText!: Phaser.GameObjects.Text;
  private cards: Card[] = [];
  private expression: string[] = [];
  private timeLeft = ROUND_TIME;
  private round = 1;
  private solvedRounds = 0;
  private current: Puzzle = { cards: [1, 1, 1, 1], solutionExpression: "" };
  private started = false;
  private ended = false;
  private busy = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "twenty-four", version: "1.0.0" });
  private storage = createGameStorage("twenty-four", { solved: 0 });

  constructor() { super("twenty-four"); }

  create() {
    this.round = 1;
    this.solvedRounds = 0;
    this.timeLeft = ROUND_TIME;
    this.started = false;
    this.ended = false;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 44, 44, 0x101114, 1, 0x232a44, .5);
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "24 / 046", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "24点挑战", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);

    this.add.rectangle(CENTER_X, 66, WIDTH - 54, 9, 0x1b1d21).setStrokeStyle(1, 0x3a3d45);
    this.timerBar = this.add.rectangle(18, 66, WIDTH - 54, 9, 0xdfff3f).setOrigin(0, .5);
    this.timeText = this.add.text(CENTER_X, 84, "60.0s", {
      fontFamily: "monospace", fontSize: "10px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5, 0);
    this.roundText = this.add.text(22, 100, "第 1 题", {
      fontFamily: "sans-serif", fontSize: "20px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.targetText = this.add.text(CENTER_X, 150, "凑出 24", {
      fontFamily: "sans-serif", fontSize: "30px", color: "#ffd44d", fontStyle: "bold",
    }).setOrigin(.5);
    this.expressionText = this.add.text(CENTER_X, 236, "", {
      fontFamily: "monospace", fontSize: "20px", color: "#f3f0e8",
    }).setOrigin(.5);
    this.statusText = this.add.text(CENTER_X, 286, "", {
      fontFamily: "sans-serif", fontSize: "14px", color: "#ff6a51", fontStyle: "bold",
    }).setOrigin(.5);
    const solvedText = this.add.text(CENTER_X, 700, "", {
      fontFamily: "monospace", fontSize: "11px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5).setName("solved-text");

    this.buildOperators();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());

    this.solvedRounds = this.storage.load().solved;
    this.nextRound();
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private buildOperators() {
    const operators = ["+", "−", "×", "÷", "C", "="];
    operators.forEach((label, index) => {
      const x = 45 + index * 61 + 25;
      const button = this.add.rectangle(x, 380, 52, 50, index >= 4 ? 0xff6a51 : 0x1b2038)
        .setStrokeStyle(1.5, 0x3a4470).setInteractive({ useHandCursor: true });
      this.add.text(x, 380, label, {
        fontFamily: "monospace", fontSize: "18px", color: index >= 4 ? "#f3f0e8" : "#54e0ff", fontStyle: "bold",
      }).setOrigin(.5);
      button.on("pointerup", () => this.pressOperator(label));
    });
  }

  private nextRound() {
    this.current = generatePuzzle();
    this.expression = [];
    this.busy = false;
    for (const card of this.cards) card.container.destroy();
    this.cards = [];
    this.roundText.setText(`第 ${this.round} 题`);
    this.expressionText.setText("");
    this.statusText.setText("");
    this.current.cards.forEach((value, index) => {
      const x = CENTER_X - 135 + index * 90;
      const container = this.add.container(x, 500, [
        this.add.rectangle(0, 0, 74, 96, 0xf3f0e8).setStrokeStyle(2.5, 0x101114, .7),
        this.add.text(0, -18, String(value), {
          fontFamily: "monospace", fontSize: "30px", color: "#101114", fontStyle: "bold",
        }).setOrigin(.5),
        this.add.text(0, 22, ["♠", "♥", "♣", "♦"][index % 4], {
          fontFamily: "sans-serif", fontSize: "14px", color: index % 2 === 0 ? "#101114" : "#ff6a51",
        }).setOrigin(.5),
      ]).setDepth(4);
      const rect = container.list[0] as Phaser.GameObjects.Rectangle;
      rect.setInteractive({ useHandCursor: true });
      rect.on("pointerup", () => this.pickCard(index));
      this.cards.push({ value, container, used: false, baseX: x, baseY: 500 });
    });
  }

  private pickCard(index: number) {
    if (this.busy || this.ended) return;
    if (!this.started) {
      this.started = true;
      this.bridge.started();
      this.audio.unlock();
    }
    const card = this.cards[index];
    if (card.used) return;
    if (this.expression.length > 0 && /\d$/.test(this.expression[this.expression.length - 1])) {
      this.statusText.setText("一次只能选两张数").setColor("#ff6a51");
      return;
    }
    card.used = true;
    card.container.y = card.baseY - 16;
    this.expression.push(String(card.value));
    this.refreshExpression();
    this.audio.tone({ freq: 400 + card.value * 22, duration: .06, type: "sine", gain: .1 });
    this.maybeEvaluate();
  }

  private pressOperator(label: string) {
    if (this.busy || this.ended) return;
    if (label === "C") {
      this.resetExpression();
      return;
    }
    if (label === "=") {
      this.evaluate(false);
      return;
    }
    if (this.expression.length === 0 || /\d$/.test(this.expression[this.expression.length - 1]) === false) return;
    this.expression.push(label === "−" ? "-" : label);
    this.refreshExpression();
    this.audio.tone({ freq: 320, duration: .05, type: "sine", gain: .08 });
  }

  private resetExpression() {
    for (const card of this.cards) {
      card.used = false;
      card.container.y = card.baseY;
    }
    this.expression = [];
    this.refreshExpression();
    this.busy = false;
  }

  private refreshExpression() {
    this.expressionText.setText(this.expression.join(" "));
  }

  private maybeEvaluate() {
    const numbers = this.cards.filter((card) => card.used).length;
    if (numbers === 4) this.evaluate(true);
  }

  private evaluate(auto: boolean) {
    const cardsUsed = this.cards.filter((card) => card.used).length;
    if (cardsUsed !== 4 || this.expression.length < 7) {
      if (!auto) this.statusText.setText("把四张牌都用上再按 =").setColor("#ff6a51");
      return;
    }
    const raw = this.expression.join(" ").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
    let value = NaN;
    try {
      value = Function(`"use strict";return (${raw})`)() as number;
    } catch {
      value = NaN;
    }
    if (Number.isFinite(value) && Math.abs(value - 24) < 1e-6) {
      this.busy = true;
      this.solvedRounds += 1;
      this.storage.save({ solved: this.solvedRounds });
      this.bridge.score(this.round * 100);
      this.statusText.setText(`正确！ +${100 + Math.max(0, Math.round((this.timeLeft / ROUND_TIME) * 100))}`).setColor("#dfff3f");
      this.timeLeft = Math.min(ROUND_TIME, this.timeLeft + 12000);
      this.audio.tone({ freq: 523, duration: .15, type: "triangle", gain: .2 });
      this.audio.tone({ freq: 784, duration: .28, time: this.audio.now + .14, type: "triangle", gain: .2 });
      this.refreshSolved();
      this.busy = false;
      this.round += 1;
      this.time.delayedCall(800, () => this.nextRound());
    } else {
      this.statusText.setText(auto ? `结果是 ${Number.isFinite(value) ? Math.round(value * 100) / 100 : "无效"}，不对` : "结果不是 24").setColor("#ff6a51");
      this.audio.tone({ freq: 200, duration: .12, type: "sawtooth", gain: .1 });
      this.time.delayedCall(700, () => this.resetExpression());
      this.busy = true;
      this.time.delayedCall(700, () => { this.busy = false; });
    }
  }

  private refreshSolved() {
    const solvedText = this.children.getByName("solved-text") as Phaser.GameObjects.Text | null;
    solvedText?.setText(`累计解出 ${this.solvedRounds} 题`);
  }

  update(_time: number, delta: number) {
    if (this.ended || !this.started) return;
    this.timeLeft -= delta;
    this.timerBar.width = (WIDTH - 54) * Math.max(this.timeLeft / ROUND_TIME, 0);
    this.timerBar.fillColor = this.timeLeft > ROUND_TIME * .4 ? 0xdfff3f : this.timeLeft > ROUND_TIME * .18 ? 0xffd44d : 0xff6a51;
    this.timeText.setText(`${(Math.max(this.timeLeft, 0) / 1000).toFixed(1)}s`);
    if (this.timeLeft <= 0) this.endRun();
  }

  private endRun() {
    if (this.ended) return;
    this.ended = true;
    this.audio.tone({ freq: 320, endFreq: 90, duration: .6, type: "sawtooth", gain: .22 });
    this.bridge.gameOver(this.solvedRounds * 100);
    const saved = this.storage.load();
    const banner = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .62)
      .setDepth(100).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0x1b2038)
      .setStrokeStyle(2, 0xdfff3f).setDepth(101);
    this.add.text(CENTER_X, 502, "时间到", {
      fontFamily: "sans-serif", fontSize: "25px", color: "#f3f0e8", fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(CENTER_X, 544, `解出 ${this.solvedRounds} 题  ·  累计 ${saved.solved}`, {
      fontFamily: "monospace", fontSize: "12px", color: "#8f918a", letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(102);
    this.add.text(CENTER_X, 592, "再战一轮  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#101114", fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    replay.on("pointerup", () => this.scene.restart());
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: [banner, panel], alpha: { from: 0, to: 1 }, duration: 220 });
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
  scene: TwentyFourScene,
});
