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
const GRID_SPACING = 30;
const GRID_STIFFNESS = 120;
const GRID_DAMPING = 8.5;
const PLAYER_SPEED = 330;
const BULLET_SPEED = 560;
const FIRE_INTERVAL = 230;
const INVULNERABLE_MS = 1600;
const CHAIN_WINDOW = 2200;

const ENEMY_COLOR = {
  chaser: 0xff4dd2,
  mini: 0xff8ade,
  drifter: 0xdfff3f,
  weaver: 0xffa63d,
  shooter: 0x9b6bff,
} as const;

type EnemyType = keyof typeof ENEMY_COLOR;

const ENEMY_SPEC: Record<EnemyType, { radius: number; speed: number; score: number; from: number }> = {
  chaser: { radius: 15, speed: 105, score: 25, from: 0 },
  mini: { radius: 10, speed: 155, score: 15, from: 0 },
  drifter: { radius: 18, speed: 85, score: 40, from: 15000 },
  weaver: { radius: 14, speed: 95, score: 30, from: 30000 },
  shooter: { radius: 17, speed: 60, score: 50, from: 50000 },
};

interface GridPoint {
  baseX: number;
  baseY: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
}

interface Enemy {
  image: Phaser.GameObjects.Image;
  type: EnemyType;
  radius: number;
  speed: number;
  wobble: number;
  fireAt: number;
  driftX: number;
  driftY: number;
}

interface Bullet {
  circle: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
}

interface SpawnWarning {
  graphic: Phaser.GameObjects.Graphics;
  type: EnemyType;
  at: number;
  x: number;
  y: number;
}

class NeonRaidScene extends Phaser.Scene {
  private scoreText!: Phaser.GameObjects.Text;
  private multText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private trailGraphics!: Phaser.GameObjects.Graphics;
  private joyGraphics!: Phaser.GameObjects.Graphics;
  private player!: Phaser.GameObjects.Image;
  private grid: GridPoint[] = [];
  private gridCols = 0;
  private gridRows = 0;
  private enemies: Enemy[] = [];
  private bullets: Bullet[] = [];
  private enemyBullets: Bullet[] = [];
  private warnings: SpawnWarning[] = [];
  private trail: Phaser.Math.Vector2[] = [];
  private emitters = new Map<EnemyType | "player", Phaser.GameObjects.Particles.ParticleEmitter>();
  private joyAnchor?: Phaser.Math.Vector2;
  private joyVector = new Phaser.Math.Vector2();
  private fireAt = 0;
  private started = false;
  private ended = false;
  private score = 0;
  private mult = 1;
  private chain = 0;
  private chainExpireAt = 0;
  private lives = 3;
  private invulnUntil = 0;
  private runStart = 0;
  private nextWaveAt = 15000;
  private wave = 1;
  private spawnAt = 1400;
  private audio = createAudioKit({ masterGain: 0.4 });
  private bridge = createGameBridge({ gameId: "neon-raid", version: "1.0.0" });
  private storage = createGameStorage("neon-raid", { highScore: 0 });

  constructor() { super("neon-raid"); }

  create() {
    this.resetRun();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#05060a");

    this.buildGrid();
    this.buildTextures();
    this.buildEmitters();
    this.buildHud();
    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private resetRun() {
    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.warnings = [];
    this.trail = [];
    this.joyAnchor = undefined;
    this.joyVector.set(0, 0);
    this.fireAt = 0;
    this.started = false;
    this.ended = false;
    this.score = 0;
    this.mult = 1;
    this.chain = 0;
    this.lives = 3;
    this.invulnUntil = 0;
    this.runStart = 0;
    this.nextWaveAt = 15000;
    this.wave = 1;
    this.spawnAt = 1400;
  }

  private buildGrid() {
    this.gridGraphics = this.add.graphics().setDepth(0);
    this.gridCols = Math.floor(WIDTH / GRID_SPACING) + 2;
    this.gridRows = Math.floor(HEIGHT / GRID_SPACING) + 2;
    this.grid = [];
    for (let row = 0; row < this.gridRows; row += 1) {
      for (let col = 0; col < this.gridCols; col += 1) {
        this.grid.push({ baseX: col * GRID_SPACING, baseY: row * GRID_SPACING, ox: 0, oy: 0, vx: 0, vy: 0 });
      }
    }
  }

  private buildTextures() {
    const make = (key: string, size: number, draw: (g: Phaser.GameObjects.Graphics, c: number) => void, color: number) => {
      if (this.textures.exists(key)) return;
      const g = this.add.graphics();
      draw(g, color);
      g.generateTexture(key, size, size);
      g.destroy();
    };
    const polygon = (sides: number, radius: number) => (g: Phaser.GameObjects.Graphics, color: number) => {
      g.translateCanvas(24, 24);
      g.lineStyle(2.5, color, 1);
      g.beginPath();
      for (let index = 0; index <= sides; index += 1) {
        const angle = (index / sides) * Math.PI * 2 - Math.PI / 2;
        const point = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
        if (index === 0) g.moveTo(point.x, point.y);
        else g.lineTo(point.x, point.y);
      }
      g.strokePath();
      g.lineStyle(5, color, .16);
      g.strokePath();
    };
    make("raid-chaser", 48, polygon(3, 13), ENEMY_COLOR.chaser);
    make("raid-mini", 48, polygon(3, 9), ENEMY_COLOR.mini);
    make("raid-drifter", 48, polygon(4, 15), ENEMY_COLOR.drifter);
    make("raid-weaver", 48, polygon(4, 13), ENEMY_COLOR.weaver);
    make("raid-shooter", 48, polygon(5, 14), ENEMY_COLOR.shooter);
    make("raid-player", 48, (g, color) => {
      g.translateCanvas(24, 24);
      g.rotateCanvas(Math.PI / 2);
      g.lineStyle(2.5, color, 1);
      g.beginPath();
      g.moveTo(0, -15);
      g.lineTo(11, 12);
      g.lineTo(0, 6);
      g.lineTo(-11, 12);
      g.closePath();
      g.strokePath();
      g.lineStyle(5, color, .18);
      g.strokePath();
      g.fillStyle(color, .9);
      g.fillCircle(0, 0, 3);
    }, 0x54e0ff);
    make("raid-dot", 16, (g, color) => {
      g.translateCanvas(8, 8);
      g.fillStyle(color, .35);
      g.fillCircle(0, 0, 7);
      g.fillStyle(color, .8);
      g.fillCircle(0, 0, 3.6);
    }, 0xffffff);
  }

  private buildEmitters() {
    const entries: Array<[EnemyType | "player", number]> = [
      ["chaser", ENEMY_COLOR.chaser],
      ["mini", ENEMY_COLOR.mini],
      ["drifter", ENEMY_COLOR.drifter],
      ["weaver", ENEMY_COLOR.weaver],
      ["shooter", ENEMY_COLOR.shooter],
      ["player", 0x54e0ff],
    ];
    for (const [key, color] of entries) {
      const emitter = this.add.particles(0, 0, "raid-dot", {
        speed: { min: 60, max: 300 },
        lifespan: { min: 260, max: 560 },
        scale: { start: 1.1, end: 0 },
        alpha: { start: .95, end: 0 },
        blendMode: "ADD",
        tint: color,
        emitting: false,
      }).setDepth(6);
      this.emitters.set(key, emitter);
    }
  }

  private buildHud() {
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0x54e0ff, .3);
    this.add.text(22, 43, "RAID / 016", {
      fontFamily: "monospace", fontSize: "11px", color: "#54e0ff", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "霓虹深空", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#5d6b8a",
    }).setOrigin(1, 0);

    this.scoreText = this.add.text(22, 64, "000000", {
      fontFamily: "monospace", fontSize: "34px", color: "#f3f0e8", fontStyle: "bold",
    });
    this.multText = this.add.text(WIDTH - 22, 72, "×1", {
      fontFamily: "monospace", fontSize: "26px", color: "#dfff3f", fontStyle: "bold",
    }).setOrigin(1, 0);
    this.livesText = this.add.text(WIDTH - 22, 106, "◀ ◀ ◀", {
      fontFamily: "monospace", fontSize: "11px", color: "#54e0ff", letterSpacing: 3,
    }).setOrigin(1, 0);
    this.waveText = this.add.text(22, 106, "WAVE 01", {
      fontFamily: "monospace", fontSize: "10px", color: "#5d6b8a", letterSpacing: 2,
    });

    this.trailGraphics = this.add.graphics().setDepth(3);
    this.joyGraphics = this.add.graphics().setDepth(7);
    this.player = this.add.image(CENTER_X, 640, "raid-player").setDepth(5);

    this.hintText = this.add.text(CENTER_X, 760, "按住拖动移动 · 自动开火", {
      fontFamily: "sans-serif", fontSize: "15px", color: "#8fa2c5", fontStyle: "bold",
    }).setOrigin(.5).setDepth(8);
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.joyAnchor = new Phaser.Math.Vector2(position.x, position.y);
      this.joyVector.set(0, 0);
      if (!this.started) {
        this.started = true;
        this.runStart = this.time.now;
        this.bridge.started();
        this.audio.unlock();
        this.tweens.add({ targets: this.hintText, alpha: 0, duration: 400 });
      }
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.ended || !this.joyAnchor || !pointer.isDown) return;
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.joyVector.set(position.x - this.joyAnchor.x, position.y - this.joyAnchor.y);
      if (this.joyVector.length() > 70) this.joyVector.setLength(70);
    });
    const release = () => {
      this.joyAnchor = undefined;
      this.joyVector.set(0, 0);
    };
    this.input.on("pointerup", release);
    this.input.on("pointerupoutside", release);
  }

  private availableEnemyTypes(): EnemyType[] {
    const elapsed = this.time.now - this.runStart;
    return (Object.keys(ENEMY_SPEC) as EnemyType[])
      .filter((type) => type !== "mini" && elapsed >= ENEMY_SPEC[type].from);
  }

  private scheduleSpawn() {
    const elapsed = this.time.now - this.runStart;
    if (elapsed < this.spawnAt || this.ended) return;
    const interval = Math.max(560, 1700 - elapsed / 46);
    this.spawnAt = elapsed + interval;
    const types = this.availableEnemyTypes();
    const type = Phaser.Utils.Array.GetRandom(types);
    const x = Phaser.Math.Between(40, WIDTH - 40);
    const y = Phaser.Math.Between(190, HEIGHT - 90);
    if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 130) return;
    const graphic = this.add.graphics().setDepth(4);
    this.warnings.push({ graphic, type, at: this.time.now + 720, x, y });
  }

  private drawWarning(warning: SpawnWarning) {
    warning.graphic.clear();
    const color = ENEMY_COLOR[warning.type];
    const blink = Math.sin(this.time.now / 60) > 0 ? .9 : .25;
    warning.graphic.lineStyle(2, color, blink);
    const radius = ENEMY_SPEC[warning.type].radius + 6;
    warning.graphic.strokeCircle(warning.x, warning.y, radius);
    warning.graphic.lineBetween(warning.x - radius - 5, warning.y, warning.x - radius + 1, warning.y);
    warning.graphic.lineBetween(warning.x + radius - 1, warning.y, warning.x + radius + 5, warning.y);
  }

  private spawnEnemy(type: EnemyType, x: number, y: number) {
    const spec = ENEMY_SPEC[type];
    const image = this.add.image(x, y, `raid-${type}`).setDepth(5);
    image.setScale(spec.radius / 15);
    const enemy: Enemy = {
      image, type, radius: spec.radius, speed: spec.speed,
      wobble: Math.random() * Math.PI * 2, fireAt: this.time.now + 1200,
      driftX: Math.random() < .5 ? -1 : 1, driftY: Math.random() < .5 ? -1 : 1,
    };
    this.enemies.push(enemy);
    this.rippleGrid(x, y, 90, 120);
  }

  private fire() {
    let target: Enemy | null = null;
    let bestDistance = 460;
    for (const enemy of this.enemies) {
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.image.x, enemy.image.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        target = enemy;
      }
    }
    const angle = target
      ? Phaser.Math.Angle.Between(this.player.x, this.player.y, target.image.x, target.image.y)
      : (this.joyVector.lengthSq() > 4 ? this.joyVector.angle() : -Math.PI / 2);
    this.player.setRotation(angle + Math.PI / 2);
    const circle = this.add.circle(
      this.player.x + Math.cos(angle) * 16,
      this.player.y + Math.sin(angle) * 16,
      3.4, 0xbdf3ff,
    ).setDepth(4).setBlendMode("ADD");
    this.bullets.push({ circle, vx: Math.cos(angle) * BULLET_SPEED, vy: Math.sin(angle) * BULLET_SPEED });
    this.audio.tone({ freq: 1180, endFreq: 720, duration: .05, type: "square", gain: .05 });
  }

  private enemyFire(enemy: Enemy) {
    const angle = Phaser.Math.Angle.Between(enemy.image.x, enemy.image.y, this.player.x, this.player.y);
    const circle = this.add.circle(enemy.image.x, enemy.image.y, 4.4, ENEMY_COLOR.shooter)
      .setDepth(4).setBlendMode("ADD");
    this.enemyBullets.push({ circle, vx: Math.cos(angle) * 175, vy: Math.sin(angle) * 175 });
    this.audio.tone({ freq: 320, endFreq: 190, duration: .12, type: "sawtooth", gain: .08 });
  }

  private killEnemy(enemy: Enemy, awardScore: boolean) {
    const index = this.enemies.indexOf(enemy);
    if (index < 0) return;
    this.enemies.splice(index, 1);
    const color = ENEMY_COLOR[enemy.type];
    this.emitters.get(enemy.type)?.explode(16, enemy.image.x, enemy.image.y);
    this.rippleGrid(enemy.image.x, enemy.image.y, 130, 210);
    this.cameras.main.shake(60, .004);
    this.audio.noise({ freq: 1100, duration: .16, gain: .16 });
    this.audio.tone({ freq: 130, endFreq: 45, duration: .22, type: "sine", gain: .2 });

    if (!awardScore) {
      enemy.image.destroy();
      return;
    }

    this.chain += 1;
    this.chainExpireAt = this.time.now + CHAIN_WINDOW;
    if (this.chain % 3 === 0 && this.mult < 20) {
      this.mult += 1;
      this.multText.setText(`×${this.mult}`);
      this.tweens.add({ targets: this.multText, scale: { from: 1.35, to: 1 }, duration: 160 });
      this.audio.tone({ freq: 540 + this.mult * 40, duration: .1, type: "triangle", gain: .14 });
    }
    const earned = ENEMY_SPEC[enemy.type].score * this.mult;
    this.score += earned;
    this.scoreText.setText(String(this.score).padStart(6, "0"));
    this.bridge.score(this.score);
    const saved = this.storage.load();
    if (this.score > saved.highScore) this.storage.save({ highScore: this.score });
    const label = this.add.text(enemy.image.x, enemy.image.y - 14, `+${earned}`, {
      fontFamily: "monospace", fontSize: "11px", color: colorToCss(color), fontStyle: "bold",
    }).setOrigin(.5).setDepth(8);
    this.tweens.add({ targets: label, y: enemy.image.y - 44, alpha: 0, duration: 520, onComplete: () => label.destroy() });

    if (enemy.type === "drifter") {
      for (const offset of [-14, 14]) {
        this.spawnEnemy("mini", enemy.image.x + offset, enemy.image.y);
      }
    }
    enemy.image.destroy();
  }

  private playerHit() {
    if (this.time.now < this.invulnUntil || this.ended) return;
    this.lives -= 1;
    this.mult = 1;
    this.chain = 0;
    this.multText.setText("×1");
    this.livesText.setText(["◀", "◀ ◀", "◀ ◀ ◀"][Math.max(this.lives - 1, 0)] ?? "");
    this.invulnUntil = this.time.now + INVULNERABLE_MS;
    this.cameras.main.shake(220, .014);
    this.cameras.main.flash(140, 255, 106, 81, false);
    this.audio.tone({ freq: 220, endFreq: 55, duration: .45, type: "sawtooth", gain: .26 });
    this.emitters.get("player")?.explode(24, this.player.x, this.player.y);
    this.rippleGrid(this.player.x, this.player.y, 190, 300);
    for (const enemy of [...this.enemies]) {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.image.x, enemy.image.y) < 140) {
        this.killEnemy(enemy, false);
      }
    }
    for (const bullet of [...this.enemyBullets]) bullet.circle.destroy();
    this.enemyBullets = [];
    if (this.lives <= 0) {
      this.endRun();
      return;
    }
    this.tweens.add({
      targets: this.player,
      alpha: { from: .25, to: 1 },
      duration: 130,
      yoyo: true,
      repeat: 5,
    });
  }

  private rippleGrid(x: number, y: number, radius: number, force: number) {
    for (const point of this.grid) {
      const distance = Phaser.Math.Distance.Between(x, y, point.baseX, point.baseY);
      if (distance > radius) continue;
      const falloff = 1 - distance / radius;
      const scale = force * falloff * falloff;
      const inv = distance < 1 ? 0 : 1 / distance;
      point.vx += (point.baseX - x) * inv * scale;
      point.vy += (point.baseY - y) * inv * scale;
    }
  }

  private updateGrid(delta: number) {
    const seconds = Math.min(delta, 40) / 1000;
    for (const point of this.grid) {
      point.vx += (-GRID_STIFFNESS * point.ox - GRID_DAMPING * point.vx) * seconds;
      point.vy += (-GRID_STIFFNESS * point.oy - GRID_DAMPING * point.vy) * seconds;
      point.ox += point.vx * seconds;
      point.oy += point.vy * seconds;
    }
    const g = this.gridGraphics;
    g.clear();
    g.lineStyle(1, 0x2a3550, .55);
    for (let row = 0; row < this.gridRows; row += 1) {
      for (let col = 0; col < this.gridCols; col += 1) {
        const point = this.grid[row * this.gridCols + col];
        const displaced = Math.abs(point.ox) + Math.abs(point.oy) > 2.2;
        if (displaced) {
          g.lineStyle(1.4, 0x54e0ff, Math.min(.75, .2 + (Math.abs(point.ox) + Math.abs(point.oy)) * .03));
        }
        if (col + 1 < this.gridCols) {
          const right = this.grid[row * this.gridCols + col + 1];
          g.lineBetween(point.baseX + point.ox, point.baseY + point.oy, right.baseX + right.ox, right.baseY + right.oy);
        }
        if (row + 1 < this.gridRows) {
          const below = this.grid[(row + 1) * this.gridCols + col];
          g.lineBetween(point.baseX + point.ox, point.baseY + point.oy, below.baseX + below.ox, below.baseY + below.oy);
        }
        if (displaced) g.lineStyle(1, 0x2a3550, .55);
      }
    }
  }

  update(time: number, delta: number) {
    const seconds = Math.min(delta, 45) / 1000;
    this.updateGrid(delta);
    if (this.ended) return;

    if (this.started) {
      if (time - this.runStart >= this.nextWaveAt) {
        this.wave += 1;
        this.nextWaveAt += 15000;
        this.waveText.setText(`WAVE ${String(this.wave).padStart(2, "0")}`);
        this.showWaveBanner();
      }
      this.scheduleSpawn();
    }

    const velocity = this.joyVector.clone().scale(PLAYER_SPEED / 70);
    if (velocity.length() > PLAYER_SPEED) velocity.setLength(PLAYER_SPEED);
    this.player.x = Phaser.Math.Clamp(this.player.x + velocity.x * seconds, 20, WIDTH - 20);
    this.player.y = Phaser.Math.Clamp(this.player.y + velocity.y * seconds, 140, HEIGHT - 30);

    this.trail.push(new Phaser.Math.Vector2(this.player.x, this.player.y));
    if (this.trail.length > 14) this.trail.shift();
    this.trailGraphics.clear();
    for (let index = 1; index < this.trail.length; index += 1) {
      const alpha = (index / this.trail.length) * .4;
      this.trailGraphics.lineStyle(2.4, 0x54e0ff, alpha);
      this.trailGraphics.lineBetween(
        this.trail[index - 1].x, this.trail[index - 1].y, this.trail[index].x, this.trail[index].y,
      );
    }

    if (this.started && time >= this.fireAt) {
      this.fireAt = time + FIRE_INTERVAL;
      this.fire();
    }

    this.joyGraphics.clear();
    if (this.joyAnchor) {
      this.joyGraphics.lineStyle(1.6, 0x54e0ff, .35);
      this.joyGraphics.strokeCircle(this.joyAnchor.x, this.joyAnchor.y, 46);
      this.joyGraphics.fillStyle(0x54e0ff, .4);
      this.joyGraphics.fillCircle(
        this.joyAnchor.x + this.joyVector.x, this.joyAnchor.y + this.joyVector.y, 14,
      );
    }

    for (let index = this.bullets.length - 1; index >= 0; index -= 1) {
      const bullet = this.bullets[index];
      bullet.circle.x += bullet.vx * seconds;
      bullet.circle.y += bullet.vy * seconds;
      if (bullet.circle.y < -20 || bullet.circle.y > HEIGHT + 20 || bullet.circle.x < -20 || bullet.circle.x > WIDTH + 20) {
        bullet.circle.destroy();
        this.bullets.splice(index, 1);
        continue;
      }
      for (const enemy of [...this.enemies]) {
        if (Phaser.Math.Distance.Between(bullet.circle.x, bullet.circle.y, enemy.image.x, enemy.image.y) < enemy.radius + 5) {
          this.killEnemy(enemy, true);
          bullet.circle.destroy();
          this.bullets.splice(index, 1);
          break;
        }
      }
    }

    for (let index = this.warnings.length - 1; index >= 0; index -= 1) {
      const warning = this.warnings[index];
      this.drawWarning(warning);
      if (time >= warning.at) {
        warning.graphic.destroy();
        this.warnings.splice(index, 1);
        this.spawnEnemy(warning.type, warning.x, warning.y);
      }
    }

    for (const enemy of this.enemies) {
      const dx = this.player.x - enemy.image.x;
      const dy = this.player.y - enemy.image.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      enemy.image.rotation += seconds * 1.8;
      if (enemy.type === "chaser" || enemy.type === "mini") {
        enemy.image.x += (dx / distance) * enemy.speed * seconds;
        enemy.image.y += (dy / distance) * enemy.speed * seconds;
      } else if (enemy.type === "drifter") {
        enemy.image.x += enemy.driftX * enemy.speed * seconds;
        enemy.image.y += enemy.driftY * enemy.speed * seconds;
        if (enemy.image.x < 30 || enemy.image.x > WIDTH - 30) enemy.driftX *= -1;
        if (enemy.image.y < 160 || enemy.image.y > HEIGHT - 40) enemy.driftY *= -1;
      } else if (enemy.type === "weaver") {
        enemy.wobble += seconds * 5;
        const perpendicular = { x: -dy / distance, y: dx / distance };
        enemy.image.x += ((dx / distance) + Math.cos(enemy.wobble) * perpendicular.x * .9) * enemy.speed * seconds;
        enemy.image.y += ((dy / distance) + Math.sin(enemy.wobble) * perpendicular.y * .9) * enemy.speed * seconds;
      } else if (enemy.type === "shooter") {
        const approach = distance > 250 ? 1 : distance < 190 ? -1 : 0;
        enemy.image.x += (dx / distance) * enemy.speed * approach * seconds;
        enemy.image.y += (dy / distance) * enemy.speed * approach * seconds;
        enemy.wobble += seconds * 2;
        enemy.image.x += Math.cos(enemy.wobble) * 24 * seconds;
        if (time >= enemy.fireAt) {
          enemy.fireAt = time + 2100;
          this.enemyFire(enemy);
        }
      }
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.image.x, enemy.image.y) < enemy.radius + 9) {
        this.playerHit();
      }
    }

    for (let index = this.enemyBullets.length - 1; index >= 0; index -= 1) {
      const bullet = this.enemyBullets[index];
      bullet.circle.x += bullet.vx * seconds;
      bullet.circle.y += bullet.vy * seconds;
      if (bullet.circle.y < -20 || bullet.circle.y > HEIGHT + 20 || bullet.circle.x < -20 || bullet.circle.x > WIDTH + 20) {
        bullet.circle.destroy();
        this.enemyBullets.splice(index, 1);
        continue;
      }
      if (Phaser.Math.Distance.Between(bullet.circle.x, bullet.circle.y, this.player.x, this.player.y) < 12) {
        bullet.circle.destroy();
        this.enemyBullets.splice(index, 1);
        this.playerHit();
      }
    }

    if (this.chain > 0 && time > this.chainExpireAt) {
      this.chain = 0;
      if (this.mult > 1) {
        this.mult = 1;
        this.multText.setText("×1");
      }
    }
  }

  private showWaveBanner() {
    const text = this.add.text(CENTER_X, 420, `WAVE ${String(this.wave).padStart(2, "0")}`, {
      fontFamily: "monospace", fontSize: "30px", color: "#54e0ff", fontStyle: "bold", letterSpacing: 6,
    }).setOrigin(.5).setDepth(9).setAlpha(0);
    this.audio.tone({ freq: 440, duration: .14, type: "triangle", gain: .14 });
    this.audio.tone({ freq: 660, duration: .2, time: this.audio.now + .12, type: "triangle", gain: .14 });
    this.tweens.add({
      targets: text,
      alpha: 1,
      scale: { from: .8, to: 1 },
      duration: 240,
      ease: "Back.easeOut",
      onComplete: () => {
        this.tweens.add({ targets: text, alpha: 0, delay: 640, duration: 300, onComplete: () => text.destroy() });
      },
    });
  }

  private endRun() {
    this.ended = true;
    this.player.setVisible(false);
    this.emitters.get("player")?.explode(60, this.player.x, this.player.y);
    this.rippleGrid(this.player.x, this.player.y, 320, 380);
    this.cameras.main.shake(420, .02);
    this.audio.tone({ freq: 300, endFreq: 40, duration: .9, type: "sawtooth", gain: .3 });
    this.time.delayedCall(420, () => {
      for (const enemy of [...this.enemies]) this.killEnemy(enemy, false);
      for (const bullet of [...this.enemyBullets]) bullet.circle.destroy();
      this.enemyBullets = [];
    });
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bridge.gameOver(this.score);
    this.time.delayedCall(950, () => {
      const shade = this.add.rectangle(CENTER_X, HEIGHT / 2, WIDTH, HEIGHT, 0x05060a, .72)
        .setDepth(20).setInteractive({ useHandCursor: true });
      const panel = this.add.rectangle(CENTER_X, 540, 312, 196, 0x0b0f1a)
        .setStrokeStyle(2, 0x54e0ff).setDepth(21);
      this.add.text(CENTER_X, 500, "深空陨落", {
        fontFamily: "sans-serif", fontSize: "26px", color: "#f3f0e8", fontStyle: "bold",
      }).setOrigin(.5).setDepth(22);
      this.add.text(CENTER_X, 542, `${this.score} 分  ·  WAVE ${this.wave}  ·  BEST ${highScore}`, {
        fontFamily: "monospace", fontSize: "11px", color: "#8fa2c5", letterSpacing: 1,
      }).setOrigin(.5).setDepth(22);
      const replay = this.add.rectangle(CENTER_X, 592, 184, 42, 0x54e0ff)
        .setInteractive({ useHandCursor: true }).setDepth(22);
      this.add.text(CENTER_X, 592, "重返深空  ↻", {
        fontFamily: "sans-serif", fontSize: "13px", color: "#05060a", fontStyle: "bold",
      }).setOrigin(.5).setDepth(23);
      replay.on("pointerup", () => this.scene.restart());
      sharpenSceneText(this.children, RENDER_DPR);
      this.tweens.add({ targets: [shade, panel], alpha: { from: 0, to: 1 }, duration: 240 });
    });
  }
}

function colorToCss(color: number) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#05060a",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: NeonRaidScene,
});
