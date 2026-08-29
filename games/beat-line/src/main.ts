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
const INK = "#f3f0e8";
const BPM = 126;
const STEP = 60 / BPM / 4;
const BAR_STEPS = 16;
const TRAVEL = 1.5;
const PERFECT_WINDOW = 0.065;
const GOOD_WINDOW = 0.135;
const LANE_X = 31;
const LANE_COUNT = 4;
const LANE_WIDTH = 82;
const JUDGE_Y = 700;
const SPAWN_Y = -40;
const PAD_Y = 778;
const START_DELAY = 0.4;
const LANE_COLORS = [0xdfff3f, 0x54e0ff, 0x9b6bff, 0xff6a51];

const CHORD_ROOTS = [45, 41, 48, 43];
const PENTATONIC = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79];
const LEAD_PATTERNS: number[][] = [
  [0, -1, -1, 2, -1, -1, 4, -1, -1, 2, -1, -1, 1, -1, -1, -1],
  [0, -1, 2, -1, 4, -1, 5, -1, 4, -1, 2, -1, 1, -1, 2, -1],
  [0, 2, 4, 2, 5, 4, 7, 4, 5, 2, 4, 2, 1, 2, 4, -1],
  [0, 4, 2, 4, 5, 7, 5, 4, 7, 5, 4, 2, 4, 5, 7, 9],
];

interface ActiveNote {
  lane: number;
  hitTime: number;
  degree: number;
  glow: Phaser.GameObjects.Rectangle;
  core: Phaser.GameObjects.Rectangle;
  judged: boolean;
}

function midiToFreq(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function leadNoteAt(step: number): { degree: number; lane: number } | null {
  const bar = Math.floor(step / BAR_STEPS);
  const stepInBar = step % BAR_STEPS;
  const intensity = Math.min(3, Math.floor(bar / 4));
  const degree = LEAD_PATTERNS[intensity][stepInBar];
  if (degree < 0) return null;
  return { degree, lane: degree % LANE_COUNT };
}

class BeatLineScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private accText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private barText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private judgeLine!: Phaser.GameObjects.Rectangle;
  private judgeGlow!: Phaser.GameObjects.Rectangle;
  private startGate!: Phaser.GameObjects.Container;
  private laneFlash: Phaser.GameObjects.Rectangle[] = [];
  private lanePad: Phaser.GameObjects.Rectangle[] = [];
  private stars: Phaser.GameObjects.Arc[] = [];
  private notes: ActiveNote[] = [];
  private audio = createAudioKit({ masterGain: 0.5 });
  private playing = false;
  private ended = false;
  private songStart = 0;
  private schedulerAt = 0;
  private nextStepTime = 0;
  private stepIndex = 0;
  private plannedStep = 0;
  private lastKickTime = -10;
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private perfectCount = 0;
  private goodCount = 0;
  private missCount = 0;
  private lives = 3;
  private intensity = 0;
  private startRetries = 0;
  private bridge = createGameBridge({ gameId: "beat-line", version: "1.0.0" });
  private storage = createGameStorage("beat-line", { highScore: 0 });

  constructor() { super("beat-line"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#0b0e14");

    for (let index = 0; index < 26; index += 1) {
      const star = this.add.circle(
        Phaser.Math.Between(10, WIDTH - 10),
        Phaser.Math.Between(0, HEIGHT),
        Phaser.Math.FloatBetween(.8, 1.8),
        0xffffff,
      ).setAlpha(Phaser.Math.FloatBetween(.05, .16)).setDepth(0);
      this.stars.push(star);
    }

    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      const x = LANE_X + lane * LANE_WIDTH + LANE_WIDTH / 2;
      this.add.rectangle(x, (SPAWN_Y + JUDGE_Y) / 2, 1, JUDGE_Y - SPAWN_Y, LANE_COLORS[lane], .07).setDepth(1);
      const flash = this.add.rectangle(x, (SPAWN_Y + JUDGE_Y) / 2, LANE_WIDTH - 6, JUDGE_Y - SPAWN_Y, LANE_COLORS[lane], 0).setDepth(2);
      this.laneFlash.push(flash);
      const pad = this.add.rectangle(x, PAD_Y, LANE_WIDTH - 10, 52)
        .setStrokeStyle(2, LANE_COLORS[lane], .8).setDepth(3);
      this.lanePad.push(pad);
      if (lane > 0) {
        this.add.rectangle(LANE_X + lane * LANE_WIDTH, (SPAWN_Y + JUDGE_Y) / 2, 1, JUDGE_Y - SPAWN_Y, 0xffffff, .08).setDepth(1);
      }
    }

    this.judgeGlow = this.add.rectangle(CENTER_X, JUDGE_Y, WIDTH - 2 * LANE_X, 18, 0xdfff3f, 0).setDepth(3);
    this.judgeLine = this.add.rectangle(CENTER_X, JUDGE_Y, WIDTH - 2 * LANE_X, 3, 0xdfff3f, .9).setDepth(3);

    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "BEAT / 017", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "律动光轨", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);

    this.scoreText = this.add.text(22, 66, "000000", {
      fontFamily: "monospace", fontSize: "38px", color: INK, fontStyle: "bold",
    });
    this.bestText = this.add.text(WIDTH - 22, 74, `BEST ${String(this.storage.load().highScore).padStart(6, "0")}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0).setName("best-score");
    this.accText = this.add.text(WIDTH - 22, 92, "ACC --%", {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(1, 0);
    this.livesText = this.add.text(WIDTH - 22, 112, "● ● ●", {
      fontFamily: "monospace", fontSize: "11px", color: "#ff6a51", letterSpacing: 5,
    }).setOrigin(1, 0);
    this.barText = this.add.text(22, 112, "BAR 00", {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 2,
    });
    this.levelText = this.add.text(CENTER_X, 150, "", {
      fontFamily: "monospace", fontSize: "16px", color: "#54e0ff", letterSpacing: 4,
    }).setOrigin(.5).setAlpha(0);
    this.comboText = this.add.text(CENTER_X, 560, "", {
      fontFamily: "monospace", fontSize: "30px", color: INK, fontStyle: "bold", letterSpacing: 2,
    }).setOrigin(.5).setAlpha(0);

    this.buildStartGate();
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.notes = [];
    this.playing = false;
    this.ended = false;
    this.songStart = 0;
    this.nextStepTime = 0;
    this.stepIndex = 0;
    this.plannedStep = 0;
    this.lastKickTime = -10;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.perfectCount = 0;
    this.goodCount = 0;
    this.missCount = 0;
    this.lives = 3;
    this.intensity = 0;
    this.startRetries = 0;
    this.laneFlash = [];
    this.lanePad = [];
    this.stars = [];
  }

  private buildStartGate() {
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x0b0e14, .78).setDepth(30)
      .setInteractive({ useHandCursor: true });
    const title = this.add.text(CENTER_X, 360, "律动光轨", {
      fontFamily: "sans-serif", fontSize: "34px", color: INK, fontStyle: "bold", letterSpacing: 8,
    }).setOrigin(.5).setDepth(31);
    const subtitle = this.add.text(CENTER_X, 410, "命中节拍 · 你就是主旋律", {
      fontFamily: "sans-serif", fontSize: "14px", color: "#9a9ca4",
    }).setOrigin(.5).setDepth(31);
    const prompt = this.add.text(CENTER_X, 470, "▸ 点击开始", {
      fontFamily: "monospace", fontSize: "16px", color: "#dfff3f", letterSpacing: 3,
    }).setOrigin(.5).setDepth(31);
    this.tweens.add({ targets: prompt, alpha: { from: 1, to: .35 }, duration: 700, yoyo: true, repeat: -1 });
    this.startGate = this.add.container(0, 0, [shade, title, subtitle, prompt]).setDepth(30);
    shade.on("pointerup", () => this.startSong());
  }

  private startSong() {
    if (this.playing) return;
    this.audio.unlock();
    const now = this.audio.now;
    if (now <= 0) {
      this.startRetries += 1;
      if (this.startRetries > 10) return;
      this.time.delayedCall(80, () => this.startSong());
      return;
    }
    this.playing = true;
    this.songStart = now + START_DELAY;
    this.nextStepTime = this.songStart;
    this.startRetries = 0;
    this.tweens.killAll();
    this.startGate.destroy(true);
    this.bridge.started();
    this.time.addEvent({ delay: 30, loop: true, callback: () => this.runScheduler() });
  }

  private runScheduler() {
    if (!this.playing || this.ended) return;
    const now = this.audio.now;
    while (this.nextStepTime < now + 0.2) {
      this.scheduleStep(this.stepIndex, this.nextStepTime);
      this.nextStepTime += STEP;
      this.stepIndex += 1;
    }
  }

  private scheduleStep(step: number, time: number) {
    const bar = Math.floor(step / BAR_STEPS);
    const stepInBar = step % BAR_STEPS;
    const intensity = Math.min(3, Math.floor(bar / 4));

    if (intensity === 0 ? stepInBar % 8 === 0 : stepInBar % 4 === 0) {
      this.audio.tone({ freq: 150, endFreq: 42, time, duration: .13, type: "sine", gain: .5 });
      this.lastKickTime = time;
    }
    if (intensity >= 1 && stepInBar % 4 === 2) {
      this.audio.noise({ time, freq: 6800, duration: .05, gain: .09, type: "highpass" });
    }
    if (intensity >= 2 && stepInBar % 2 === 1) {
      this.audio.noise({ time, freq: 8200, duration: .03, gain: .05, type: "highpass" });
    }
    if (intensity >= 1 && (stepInBar === 4 || stepInBar === 12)) {
      this.audio.noise({ time, freq: 1700, duration: .12, gain: .2 });
      this.audio.tone({ freq: 190, endFreq: 120, time, duration: .1, type: "triangle", gain: .12 });
    }

    const root = CHORD_ROOTS[bar % CHORD_ROOTS.length];
    if (stepInBar % 2 === 0) {
      const octave = stepInBar === 6 || stepInBar === 14 ? 12 : 0;
      this.audio.tone({
        freq: midiToFreq(root + octave),
        time,
        duration: .15,
        type: "sawtooth",
        gain: intensity >= 2 ? .15 : .11,
      });
    }
  }

  private planNotes() {
    if (!this.playing || this.ended) return;
    const now = this.audio.now;
    while (this.songStart + this.plannedStep * STEP < now + TRAVEL + 0.25) {
      const hitTime = this.songStart + this.plannedStep * STEP;
      const note = leadNoteAt(this.plannedStep);
      this.plannedStep += 1;
      if (!note) continue;
      const laneCenter = LANE_X + note.lane * LANE_WIDTH + LANE_WIDTH / 2;
      const glow = this.add.rectangle(laneCenter, SPAWN_Y, LANE_WIDTH - 14, 16, LANE_COLORS[note.lane], .3).setDepth(4);
      const core = this.add.rectangle(laneCenter, SPAWN_Y, LANE_WIDTH - 26, 8, LANE_COLORS[note.lane], 1).setDepth(5);
      this.notes.push({ lane: note.lane, hitTime, degree: note.degree, glow, core, judged: false });
    }
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || !this.playing) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const lane = Phaser.Math.Clamp(Math.floor((position.x - LANE_X) / LANE_WIDTH), 0, LANE_COUNT - 1);
      this.judgeLane(lane);
    });
  }

  private judgeLane(lane: number) {
    const now = this.audio.now + this.audio.latencyOffset;
    let best: ActiveNote | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const note of this.notes) {
      if (note.judged || note.lane !== lane) continue;
      const distance = Math.abs(now - note.hitTime);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = note;
      }
    }
    this.flashLane(lane, .16);
    if (!best || bestDistance > GOOD_WINDOW) {
      this.audio.tone({ freq: 190, endFreq: 150, duration: .06, type: "sine", gain: .06 });
      return;
    }
    best.judged = true;
    const perfect = bestDistance <= PERFECT_WINDOW;
    if (perfect) this.perfectCount += 1;
    else this.goodCount += 1;
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = 1 + Math.floor(this.combo / 8);
    const gained = (perfect ? 300 : 120) * mult;
    this.score += gained;
    this.scoreText.setText(String(this.score).padStart(6, "0"));
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.highScore) {
      this.storage.save({ highScore: this.score });
      this.bestText.setText(`BEST ${String(this.score).padStart(6, "0")}`);
    }

    const laneCenter = LANE_X + lane * LANE_WIDTH + LANE_WIDTH / 2;
    const pitch = midiToFreq(PENTATONIC[best.degree % PENTATONIC.length] + 12);
    if (perfect) {
      this.audio.tone({ freq: pitch, duration: .34, type: "triangle", gain: .3 });
      this.audio.tone({ freq: pitch * 2, duration: .18, type: "square", gain: .07 });
    } else {
      this.audio.tone({ freq: pitch, duration: .22, type: "sine", gain: .17 });
    }
    const ring = this.add.circle(laneCenter, JUDGE_Y, 10, LANE_COLORS[lane], 0)
      .setStrokeStyle(3, LANE_COLORS[lane], .9).setDepth(6);
    this.tweens.add({
      targets: ring,
      scale: perfect ? 3.4 : 2.2,
      alpha: 0,
      duration: 260,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
    const label = this.add.text(laneCenter, JUDGE_Y - 42, perfect ? "PERFECT" : "GOOD", {
      fontFamily: "monospace", fontSize: "11px", color: perfect ? "#dfff3f" : "#54e0ff", letterSpacing: 2,
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(7);
    this.tweens.add({ targets: label, y: JUDGE_Y - 70, alpha: 0, duration: 380, onComplete: () => label.destroy() });
    this.flashLane(lane, perfect ? .3 : .18);
    this.lanePad[lane].setScale(1.12);
    this.tweens.add({ targets: this.lanePad[lane], scale: 1, duration: 140 });

    if (this.combo >= 4) {
      this.comboText.setText(`×${this.combo} COMBO`);
      this.comboText.setAlpha(1).setScale(1.18);
      this.tweens.add({ targets: this.comboText, scale: 1, duration: 130 });
    }
    this.updateAccuracy();
  }

  private missNote(note: ActiveNote) {
    note.judged = true;
    this.missCount += 1;
    this.combo = 0;
    this.comboText.setAlpha(0);
    this.lives -= 1;
    this.livesText.setText(["●", "● ●", "● ● ●"][Math.max(this.lives - 1, 0)] ?? "");
    this.flashLane(note.lane, .22, 0xff453a);
    this.audio.tone({ freq: 140, endFreq: 70, duration: .22, type: "sawtooth", gain: .16 });
    this.cameras.main.shake(120, .006);
    this.updateAccuracy();
    if (this.lives <= 0) this.endRun();
  }

  private flashLane(lane: number, alpha: number, color?: number) {
    const flash = this.laneFlash[lane];
    flash.setFillStyle(color ?? LANE_COLORS[lane]);
    flash.setAlpha(alpha);
    this.tweens.add({ targets: flash, alpha: 0, duration: 240 });
  }

  private updateAccuracy() {
    const total = this.perfectCount + this.goodCount + this.missCount;
    if (total === 0) return;
    const acc = (this.perfectCount + this.goodCount * .5) / total * 100;
    this.accText.setText(`ACC ${acc.toFixed(0)}%`);
  }

  update() {
    if (!this.playing || this.ended) return;
    const now = this.audio.now;
    const audible = this.audio.latencyOffset;

    this.planNotes();

    for (const note of this.notes) {
      if (note.judged) continue;
      const remaining = note.hitTime - (now + audible);
      const progress = 1 - remaining / TRAVEL;
      const y = SPAWN_Y + progress * (JUDGE_Y - SPAWN_Y);
      note.glow.setPosition(note.glow.x, y);
      note.core.setPosition(note.core.x, y);
      const proximity = Math.max(0, 1 - Math.abs(remaining) / .25);
      note.core.setSize(LANE_WIDTH - 26, 8 + proximity * 4);
      if (now + audible > note.hitTime + GOOD_WINDOW) {
        this.missNote(note);
      }
    }
    this.notes = this.notes.filter((note) => {
      if (!note.judged) return true;
      note.glow.destroy();
      note.core.destroy();
      return false;
    });

    const sinceKick = (now - this.lastKickTime) % (STEP * 4);
    const pulse = Math.max(0, 1 - sinceKick / .3);
    this.judgeGlow.setAlpha(pulse * .16);
    this.judgeLine.setScale(1 + pulse * .04, 1 + pulse * 1.4);

    const bar = Math.max(0, Math.floor((now - this.songStart) / (STEP * BAR_STEPS)));
    this.barText.setText(`BAR ${String(bar).padStart(2, "0")}`);
    const nextIntensity = Math.min(3, Math.floor(bar / 4));
    if (nextIntensity > this.intensity) {
      this.intensity = nextIntensity;
      this.levelText.setText(`LEVEL ${["I", "II", "III", "IV"][this.intensity]}`);
      this.tweens.add({ targets: this.levelText, alpha: 1, duration: 200, yoyo: true, hold: 700 });
      this.audio.tone({ freq: 520, duration: .12, type: "triangle", gain: .16 });
      this.audio.tone({ freq: 780, duration: .18, time: this.audio.now + .12, type: "triangle", gain: .16 });
    }

    for (const star of this.stars) {
      star.y += .16 + pulse * .5;
      if (star.y > HEIGHT + 4) star.y = -4;
    }
  }

  private endRun() {
    this.ended = true;
    this.playing = false;
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    this.audio.tone({ freq: 392, duration: .3, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 311, duration: .3, time: this.audio.now + .22, type: "triangle", gain: .2 });
    this.audio.tone({ freq: 262, duration: .5, time: this.audio.now + .44, type: "triangle", gain: .2 });

    const total = this.perfectCount + this.goodCount + this.missCount;
    const acc = total > 0 ? (this.perfectCount + this.goodCount * .5) / total * 100 : 0;
    const grade = acc >= 95 ? "S" : acc >= 85 ? "A" : acc >= 70 ? "B" : acc >= 50 ? "C" : "D";
    const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x0b0e14, .8)
      .setDepth(30).setInteractive({ useHandCursor: true });
    const panel = this.add.rectangle(CENTER_X, 520, 312, 226, 0x12151d)
      .setStrokeStyle(2, 0xdfff3f).setDepth(31);
    this.add.text(CENTER_X, 452, grade, {
      fontFamily: "monospace", fontSize: "56px", color: "#dfff3f", fontStyle: "bold",
    }).setOrigin(.5).setDepth(32);
    this.add.text(CENTER_X, 508, `${this.score} 分  ·  准确率 ${acc.toFixed(1)}%`, {
      fontFamily: "monospace", fontSize: "12px", color: INK, letterSpacing: 1,
    }).setOrigin(.5).setDepth(32);
    this.add.text(CENTER_X, 534, `MAX COMBO ${this.maxCombo}  ·  BEST ${highScore}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#73757d", letterSpacing: 1,
    }).setOrigin(.5).setDepth(32);
    const replay = this.add.rectangle(CENTER_X, 584, 184, 42, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(32);
    this.add.text(CENTER_X, 584, "再来一曲  ↻", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#0b0e14", fontStyle: "bold",
    }).setOrigin(.5).setDepth(33);
    replay.on("pointerup", () => this.scene.restart());
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: [shade, panel], alpha: { from: 0, to: 1 }, duration: 260 });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#0b0e14",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: BeatLineScene,
});
