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
const TABLE_X = 35;
const TABLE_Y = 128;
const TABLE_W = 320;
const TABLE_H = 560;
const GOAL_HALF = 64;
const PUCK_RADIUS = 13;
const MALLET_RADIUS = 21;
const WIN_SCORE = 7;
const MAX_SPEED = 780;

class AirHockeyScene extends Phaser.Scene {
  private playerScoreText!: Phaser.GameObjects.Text;
  private aiScoreText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private playerMallet!: Phaser.GameObjects.Container;
  private aiMallet!: Phaser.GameObjects.Container;
  private puck!: Phaser.GameObjects.Container;
  private puckVX = 0;
  private puckVY = 0;
  private playerScore = 0;  private aiScore = 0;
  private playerX = CENTER_X;
  private playerY = TABLE_Y + TABLE_H - 90;
  private aiX = CENTER_X;
  private aiY = TABLE_Y + 90;
  private resetAt = 0;
  private playerPrevX = 0;
  private playerPrevY = 0;
  private aiPrevX = 0;
  private aiPrevY = 0;
  private lastTouchAt = 0;
  private stallClock = 0;
  private stallX = 0;
  private stallY = 0;
  private celebrating = false;
  private started = false;
  private ended = false;
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "air-hockey", version: "1.0.0" });
  private storage = createGameStorage("air-hockey", { wins: 0 });

  constructor() { super("air-hockey"); }

  create() {
    this.playerScore = 0;
    this.aiScore = 0;
    this.playerX = CENTER_X;
    this.playerY = TABLE_Y + TABLE_H - 90;
    this.aiX = CENTER_X;
    this.aiY = TABLE_Y + 90;
    this.celebrating = false;
    this.started = false;
    this.ended = false;
    this.playerPrevX = this.playerX;
    this.playerPrevY = this.playerY;
    this.aiPrevX = this.aiX;
    this.aiPrevY = this.aiY;
    this.lastTouchAt = 0;
    this.stallClock = 0;
    this.stallX = CENTER_X;
    this.stallY = TABLE_Y + TABLE_H / 2;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "HOCKEY / 043", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "气垫球", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#73757d",
    }).setOrigin(1, 0);

    const table = this.add.graphics().setDepth(1);
    table.fillStyle(0x1f2a3a, 1);
    table.fillRoundedRect(TABLE_X, TABLE_Y, TABLE_W, TABLE_H, 16);
    table.lineStyle(3, 0xdfff3f, .5);
    table.strokeRoundedRect(TABLE_X, TABLE_Y, TABLE_W, TABLE_H, 16);
    table.lineStyle(2, 0xf3f0e8, .2);
    table.lineBetween(TABLE_X, TABLE_Y + TABLE_H / 2, TABLE_X + TABLE_W, TABLE_Y + TABLE_H / 2);
    table.strokeCircle(CENTER_X, TABLE_Y + TABLE_H / 2, 44);
    table.fillStyle(0xff6a51, .85);
    table.fillRect(CENTER_X - GOAL_HALF, TABLE_Y - 4, GOAL_HALF * 2, 5);
    table.fillStyle(0x54e0ff, .85);
    table.fillRect(CENTER_X - GOAL_HALF, TABLE_Y + TABLE_H - 1, GOAL_HALF * 2, 5);

    this.playerScoreText = this.add.text(CENTER_X - 60, 66, "0", {
      fontFamily: "monospace", fontSize: "30px", color: "#54e0ff", fontStyle: "bold",
    }).setOrigin(.5);
    this.aiScoreText = this.add.text(CENTER_X + 60, 66, "0", {
      fontFamily: "monospace", fontSize: "30px", color: "#ff6a51", fontStyle: "bold",
    }).setOrigin(.5);
    this.add.text(CENTER_X, 78, "YOU", {
      fontFamily: "monospace", fontSize: "8px", color: "#73757d",
    }).setOrigin(.5, 0);
    this.statusText = this.add.text(CENTER_X, 726, "拖动蓝色球杆 · 先得 7 分获胜", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#8f918a",
    }).setOrigin(.5);

    this.playerMallet = this.add.container(this.playerX, this.playerY, [
      this.add.circle(0, 0, MALLET_RADIUS, 0x54e0ff).setStrokeStyle(2.5, 0x101114, .7),
      this.add.circle(0, 0, 9, 0x1f2a3a),
    ]).setDepth(6);
    this.aiMallet = this.add.container(this.aiX, this.aiY, [
      this.add.circle(0, 0, MALLET_RADIUS, 0xff6a51).setStrokeStyle(2.5, 0x101114, .7),
      this.add.circle(0, 0, 9, 0x1f2a3a),
    ]).setDepth(6);
    this.puck = this.add.container(CENTER_X, TABLE_Y + TABLE_H / 2, [
      this.add.circle(0, 0, PUCK_RADIUS, 0xf3f0e8).setStrokeStyle(2, 0x101114, .7),
      this.add.circle(0, 0, 5, 0xff6a51),
    ]).setDepth(7);

    this.resetPuck(false);
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetPuck(towardPlayer: boolean) {
    this.puck.setPosition(CENTER_X, TABLE_Y + TABLE_H / 2);
    this.puckVX = 0;
    this.puckVY = towardPlayer ? 260 : -260;
    this.resetAt = this.time.now + 700;
    this.lastTouchAt = this.time.now;
    this.stallClock = 0;
    this.stallX = CENTER_X;
    this.stallY = TABLE_Y + TABLE_H / 2;
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
      this.playerX = Phaser.Math.Clamp(position.x, TABLE_X + MALLET_RADIUS, TABLE_X + TABLE_W - MALLET_RADIUS);
      this.playerY = Phaser.Math.Clamp(position.y, TABLE_Y + TABLE_H / 2, TABLE_Y + TABLE_H - MALLET_RADIUS);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || !pointer.isDown) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.playerX = Phaser.Math.Clamp(position.x, TABLE_X + MALLET_RADIUS, TABLE_X + TABLE_W - MALLET_RADIUS);
      this.playerY = Phaser.Math.Clamp(position.y, TABLE_Y + TABLE_H / 2, TABLE_Y + TABLE_H - MALLET_RADIUS);
    });
  }

  private collideMallet(malletX: number, malletY: number, malletVX: number, malletVY: number, isPlayer: boolean) {
    const distance = Phaser.Math.Distance.Between(this.puck.x, this.puck.y, malletX, malletY);
    if (distance >= PUCK_RADIUS + MALLET_RADIUS) return;
    const angle = Phaser.Math.Angle.Between(malletX, malletY, this.puck.x, this.puck.y);
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const overlap = PUCK_RADIUS + MALLET_RADIUS - distance;
    this.puck.x += nx * overlap;
    this.puck.y += ny * overlap;

    // treat the mallet as a moving body: reflect the closing speed, keep tangential drift
    const relVX = this.puckVX - malletVX;
    const relVY = this.puckVY - malletVY;
    const approach = relVX * nx + relVY * ny;
    let outVX = this.puckVX;
    let outVY = this.puckVY;
    if (approach < 0) {
      outVX = malletVX + relVX - 2 * approach * nx;
      outVY = malletVY + relVY - 2 * approach * ny;
    }

    if (!isPlayer && ny > .5) {
      // AI striking downward: aim for the goal mouth away from the player's mallet
      const aimX = CENTER_X + (this.playerX <= CENTER_X ? 1 : -1) * GOAL_HALF * .82;
      const shot = Phaser.Math.Angle.Between(this.puck.x, this.puck.y, aimX, TABLE_Y + TABLE_H + 10);
      const power = Phaser.Math.Clamp(Math.hypot(outVX, outVY), 400, 640);
      outVX = Math.cos(shot) * power;
      outVY = Math.sin(shot) * power;
    }

    // scatter every hit slightly so perfectly symmetric rallies can't loop forever
    const speed = Math.hypot(outVX, outVY);
    if (speed <= 0) return;
    const jitter = Phaser.Math.FloatBetween(-.05, .05);
    const cosJ = Math.cos(jitter);
    const sinJ = Math.sin(jitter);
    const scale = Math.min(speed, MAX_SPEED) / speed;
    this.puckVX = (outVX * cosJ - outVY * sinJ) * scale;
    this.puckVY = (outVX * sinJ + outVY * cosJ) * scale;
    this.lastTouchAt = this.time.now;
    this.audio.tone({ freq: isPlayer ? 300 : 260, duration: .05, type: "square", gain: .1 });
  }

  private scoreGoal(playerScored: boolean) {
    if (playerScored) {
      this.playerScore += 1;
      this.playerScoreText.setText(String(this.playerScore));
      this.audio.tone({ freq: 660, duration: .16, type: "triangle", gain: .2 });
      this.bridge.score(this.playerScore);
    } else {
      this.aiScore += 1;
      this.aiScoreText.setText(String(this.aiScore));
      this.audio.tone({ freq: 220, endFreq: 130, duration: .3, type: "sawtooth", gain: .18 });
    }
    if (this.playerScore >= WIN_SCORE || this.aiScore >= WIN_SCORE) {
      this.ended = true;
      const playerWon = this.playerScore >= WIN_SCORE;
      if (playerWon) {
        const saved = this.storage.load();
        this.storage.save({ wins: saved.wins + 1 });
        this.bridge.gameOver(this.playerScore * 100);
      } else {
        this.bridge.gameOver(this.playerScore * 100);
      }
      const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x101114, .62)
        .setDepth(100).setInteractive({ useHandCursor: true });
      const panel = this.add.rectangle(CENTER_X, 540, 308, 190, 0x1b1d21)
        .setStrokeStyle(2, playerWon ? 0x54e0ff : 0xff6a51).setDepth(101);
      this.add.text(CENTER_X, 502, playerWon ? "胜利！" : "惜败", {
        fontFamily: "sans-serif", fontSize: "26px", color: "#f3f0e8", fontStyle: "bold",
      }).setOrigin(.5).setDepth(102);
      this.add.text(CENTER_X, 544, `${this.playerScore} : ${this.aiScore}`, {
        fontFamily: "monospace", fontSize: "20px", color: "#f3f0e8", fontStyle: "bold",
      }).setOrigin(.5).setDepth(102);
      const replay = this.add.rectangle(CENTER_X, 600, 184, 42, playerWon ? 0x54e0ff : 0xdfff3f)
        .setInteractive({ useHandCursor: true }).setDepth(102);
      this.add.text(CENTER_X, 600, "再战一局  ↻", {
        fontFamily: "sans-serif", fontSize: "13px", color: "#101114", fontStyle: "bold",
      }).setOrigin(.5).setDepth(103);
      replay.on("pointerup", () => this.scene.restart());
      sharpenSceneText(this.children, RENDER_DPR);
      this.tweens.add({ targets: [shade, panel], alpha: { from: 0, to: 1 }, duration: 220 });
      return;
    }
    this.resetPuck(!playerScored);
  }

  update(_time: number, delta: number) {
    if (this.ended) return;
    const seconds = Math.min(delta, 40) / 1000;
    const now = this.time.now;

    const playerVX = seconds > 0 ? (this.playerX - this.playerPrevX) / seconds : 0;
    const playerVY = seconds > 0 ? (this.playerY - this.playerPrevY) / seconds : 0;
    const aiVX = seconds > 0 ? (this.aiX - this.aiPrevX) / seconds : 0;
    const aiVY = seconds > 0 ? (this.aiY - this.aiPrevY) / seconds : 0;
    this.playerPrevX = this.playerX;
    this.playerPrevY = this.playerY;
    this.aiPrevX = this.aiX;
    this.aiPrevY = this.aiY;

    this.playerMallet.setPosition(this.playerX, this.playerY);
    this.updateAi(seconds);
    this.aiMallet.setPosition(this.aiX, this.aiY);

    if (now < this.resetAt) return;

    this.puckVX *= .997;
    this.puckVY *= .997;
    const speed = Math.hypot(this.puckVX, this.puckVY);
    const steps = Math.min(4, Math.max(1, Math.ceil((speed * seconds) / 11)));
    for (let i = 0; i < steps; i++) {
      this.puck.x += this.puckVX * (seconds / steps);
      this.puck.y += this.puckVY * (seconds / steps);
      if (this.puckEnvironment()) break;
      this.collideMallet(this.playerX, this.playerY, playerVX, playerVY, true);
      this.collideMallet(this.aiX, this.aiY, aiVX, aiVY, false);
    }
    if (this.ended) return;

    this.watchdog(now, seconds);
  }

  private updateAi(seconds: number) {
    const HALF_Y = TABLE_Y + TABLE_H / 2;
    const ramp = 3.2 + this.playerScore * .12;
    let targetX = CENTER_X + (this.puck.x - CENTER_X) * .5;
    let targetY = TABLE_Y + 92;
    let speed = ramp;
    const glued = this.puck.y < TABLE_Y + 34;
    if (this.puck.y < HALF_Y && !glued) {
      if (this.aiY < this.puck.y - 12 && Math.abs(this.aiX - this.puck.x) < 16) {
        // lined up over the puck: drive down through it
        targetX = this.puck.x;
        targetY = Math.min(HALF_Y - MALLET_RADIUS, this.puck.y + 46);
        speed = ramp * 2.2;
      } else if (this.aiY < this.puck.y + 6) {
        targetX = this.puck.x;
        targetY = Math.max(TABLE_Y + MALLET_RADIUS, this.puck.y - (MALLET_RADIUS + PUCK_RADIUS + 12));
      } else {
        // below the puck: swing wide first instead of climbing straight into it
        targetX = this.puck.x + (this.aiX <= this.puck.x ? -1 : 1) * 58;
        targetY = Math.max(TABLE_Y + MALLET_RADIUS, this.puck.y - 54);
      }
    }
    this.aiX = Phaser.Math.Linear(this.aiX, targetX, Math.min(1, seconds * speed));
    this.aiY = Phaser.Math.Linear(this.aiY, targetY, Math.min(1, seconds * speed * 1.2));
  }

  private puckEnvironment(): boolean {
    if (this.puck.x < TABLE_X + PUCK_RADIUS) {
      this.puck.x = TABLE_X + PUCK_RADIUS;
      this.puckVX = Math.abs(this.puckVX);
      this.audio.tone({ freq: 420, duration: .04, type: "square", gain: .07 });
    }
    if (this.puck.x > TABLE_X + TABLE_W - PUCK_RADIUS) {
      this.puck.x = TABLE_X + TABLE_W - PUCK_RADIUS;
      this.puckVX = -Math.abs(this.puckVX);
      this.audio.tone({ freq: 420, duration: .04, type: "square", gain: .07 });
    }
    const inGoalBandX = Math.abs(this.puck.x - CENTER_X) < GOAL_HALF;
    if (inGoalBandX) {
      if (this.puck.y < TABLE_Y - 12) {
        this.scoreGoal(true);
        return true;
      }
      if (this.puck.y > TABLE_Y + TABLE_H + 12) {
        this.scoreGoal(false);
        return true;
      }
    } else {
      if (this.puck.y < TABLE_Y + PUCK_RADIUS) {
        this.puck.y = TABLE_Y + PUCK_RADIUS;
        this.puckVY = Math.abs(this.puckVY);
        this.audio.tone({ freq: 420, duration: .04, type: "square", gain: .07 });
      }
      if (this.puck.y > TABLE_Y + TABLE_H - PUCK_RADIUS) {
        this.puck.y = TABLE_Y + TABLE_H - PUCK_RADIUS;
        this.puckVY = -Math.abs(this.puckVY);
        this.audio.tone({ freq: 420, duration: .04, type: "square", gain: .07 });
      }
    }
    return false;
  }

  private watchdog(now: number, seconds: number) {
    this.stallClock += seconds;
    if (this.stallClock >= .4) {
      const moved = Phaser.Math.Distance.Between(this.puck.x, this.puck.y, this.stallX, this.stallY);
      if (moved < 8 && now - this.lastTouchAt > 900 && this.puck.y < TABLE_Y + TABLE_H / 2) {
        this.unstickPuck(now);
      }
      this.stallClock = 0;
      this.stallX = this.puck.x;
      this.stallY = this.puck.y;
    }
    if (now - this.lastTouchAt > 6000) {
      const speed = Math.hypot(this.puckVX, this.puckVY);
      if (speed > 30 || this.puck.y < TABLE_Y + TABLE_H / 2) {
        // nobody reached the puck for a long while: steer it back toward the middle
        this.puckVX += (this.puck.x < CENTER_X ? 1 : -1) * 170;
        this.puckVY = Math.max(this.puckVY, 80);
        this.lastTouchAt = now;
      }
    }
  }

  private unstickPuck(now: number) {
    const aimX = CENTER_X + Phaser.Math.FloatBetween(-70, 70);
    const angle = Phaser.Math.Angle.Between(this.puck.x, this.puck.y, aimX, TABLE_Y + TABLE_H * .7);
    this.puckVX = Math.cos(angle) * 430;
    this.puckVY = Math.sin(angle) * 430;
    this.lastTouchAt = now;
    this.audio.tone({ freq: 520, duration: .06, type: "triangle", gain: .06 });
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
  scene: AirHockeyScene,
});
