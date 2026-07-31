import Phaser from "phaser";
import {
  bindGameLifecycle,
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
const PLAYER_Y = 724;

class ThunderStrikeScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
  private powerUps!: Phaser.Physics.Arcade.Group;
  private stars: Phaser.GameObjects.Rectangle[] = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private startLayer!: Phaser.GameObjects.Container;
  private scoreText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private started = false;
  private ended = false;
  private dragging = false;
  private score = 0;
  private lives = 3;
  private level = 1;
  private elapsedMs = 0;
  private targetX = WIDTH / 2;
  private targetY = PLAYER_Y;
  private nextFireAt = 0;
  private nextEnemyAt = 0;
  private invulnerableUntil = 0;
  private rapidUntil = 0;
  private bridge = createGameBridge({ gameId: "thunder-strike", version: "1.1.0" });
  private storage = createGameStorage("thunder-strike", { highScore: 0 });

  constructor() {
    super("thunder-strike");
  }

  preload() {
    this.load.setPath("/games/thunder-strike/assets");
    this.load.image("thunder-player", "player-ship.png");
    this.load.image("thunder-enemy", "enemy-scout.png");
    this.load.image("thunder-heavy", "enemy-heavy.png");
    this.load.image("thunder-power", "rapid-power.png");
  }

  create() {
    this.resetState();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#090b16");
    this.physics.world.setBounds(16, 116, WIDTH - 32, HEIGHT - 130);
    this.createTextures();
    this.createStars();
    this.createHud();
    this.createActors();
    this.createInput();
    bindGameLifecycle(this, {
      onInterrupt: () => {
        this.dragging = false;
      },
    });
    this.createStartLayer();
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  update(time: number, delta: number) {
    this.updateStars(delta);
    if (this.ended) return;

    this.updatePlayer(delta);
    this.recycleOffscreenObjects();
    this.updateEnemies(time);
    this.resolveManualCollisions();

    if (!this.started) return;
    this.elapsedMs += delta;
    this.level = Math.min(9, Math.floor(this.score / 900) + 1);
    this.levelText.setText(`LEVEL ${String(this.level).padStart(2, "0")}`);

    const fireInterval = time < this.rapidUntil ? 92 : 175;
    if (time >= this.nextFireAt) {
      this.firePlayerBullet();
      this.nextFireAt = time + fireInterval;
    }

    if (time >= this.nextEnemyAt) {
      this.spawnEnemy(time);
      const delay = Math.max(330, 820 - this.level * 48 - this.elapsedMs / 2400);
      this.nextEnemyAt = time + delay;
    }

    if (this.rapidUntil > time) {
      this.statusText.setText(`RAPID FIRE  ${Math.ceil((this.rapidUntil - time) / 1000)}s`);
    } else if (this.statusText.text.startsWith("RAPID")) {
      this.statusText.setText("拖动战机 · 自动射击");
    }
  }

  private resetState() {
    this.stars = [];
    this.started = false;
    this.ended = false;
    this.dragging = false;
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.elapsedMs = 0;
    this.targetX = WIDTH / 2;
    this.targetY = PLAYER_Y;
    this.nextFireAt = 0;
    this.nextEnemyAt = 0;
    this.invulnerableUntil = 0;
    this.rapidUntil = 0;
  }

  private createTextures() {
    if (this.textures.exists("thunder-shot")) return;
    const graphics = this.make.graphics({ x: 0, y: 0 });

    graphics.fillStyle(0xdfff3f);
    graphics.fillRoundedRect(0, 0, 5, 18, 2);
    graphics.generateTexture("thunder-shot", 5, 18);
    graphics.clear();

    graphics.fillStyle(0xff6a51);
    graphics.fillCircle(6, 6, 6);
    graphics.fillStyle(0xffd369);
    graphics.fillCircle(6, 6, 2);
    graphics.generateTexture("thunder-enemy-shot", 12, 12);
    graphics.clear();

    graphics.destroy();
  }

  private createStars() {
    for (let index = 0; index < 72; index += 1) {
      const size = Phaser.Math.Between(1, 3);
      const star = this.add.rectangle(
        Phaser.Math.Between(8, WIDTH - 8),
        Phaser.Math.Between(112, HEIGHT),
        size,
        size * Phaser.Math.Between(1, 3),
        index % 7 === 0 ? 0x5c7cff : 0xffffff,
        Phaser.Math.FloatBetween(.22, .8),
      );
      star.setData("speed", Phaser.Math.Between(35, 145));
      this.stars.push(star);
    }
  }

  private createHud() {
    this.add.rectangle(WIDTH / 2, 58, WIDTH, 116, 0x101114);
    this.add.text(22, 22, "THUNDER / 007", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#dfff3f",
      letterSpacing: 2,
      fontStyle: "bold",
    });
    this.levelText = this.add.text(WIDTH - 22, 22, "LEVEL 01", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#77787c",
      letterSpacing: 1,
    }).setOrigin(1, 0);
    this.scoreText = this.add.text(22, 48, "000000", {
      fontFamily: "monospace",
      fontSize: "34px",
      color: "#ffffff",
      fontStyle: "bold",
    });
    this.livesText = this.add.text(WIDTH - 22, 59, "◆ ◆ ◆", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#ff6a51",
      letterSpacing: 4,
    }).setOrigin(1, 0);
    this.statusText = this.add.text(WIDTH / 2, 96, "拖动战机 · 自动射击", {
      fontFamily: "sans-serif",
      fontSize: "10px",
      color: "#77787c",
    }).setOrigin(.5);
    const best = this.storage.load().highScore;
    this.bestText = this.add.text(WIDTH / 2, HEIGHT - 24, `BEST ${String(best).padStart(6, "0")}`, {
      fontFamily: "monospace",
      fontSize: "9px",
      color: "#55575d",
      letterSpacing: 2,
    }).setOrigin(.5);
  }

  private createActors() {
    this.playerBullets = this.physics.add.group({ defaultKey: "thunder-shot", maxSize: 80 });
    this.enemyBullets = this.physics.add.group({ defaultKey: "thunder-enemy-shot", maxSize: 70 });
    this.enemies = this.physics.add.group({ defaultKey: "thunder-enemy", maxSize: 45 });
    this.powerUps = this.physics.add.group({ defaultKey: "thunder-power", maxSize: 8 });

    this.player = this.physics.add.sprite(WIDTH / 2, PLAYER_Y, "thunder-player");
    this.player.setDisplaySize(56, 74);
    this.player.setCollideWorldBounds(true);
    this.player.body?.setSize(this.player.width * .52, this.player.height * .62);

    this.physics.add.overlap(this.playerBullets, this.enemies, (bullet, enemy) => {
      this.hitEnemy(
        bullet as Phaser.Physics.Arcade.Sprite,
        enemy as Phaser.Physics.Arcade.Sprite,
      );
    });
    this.physics.add.overlap(this.enemyBullets, this.player, (_player, bullet) => {
      this.recycle(this.enemyBullets, bullet as Phaser.Physics.Arcade.Sprite);
      this.damagePlayer();
    });
    this.physics.add.overlap(this.enemies, this.player, (_player, enemy) => {
      this.recycle(this.enemies, enemy as Phaser.Physics.Arcade.Sprite);
      this.damagePlayer();
    });
    this.physics.add.overlap(this.powerUps, this.player, (_player, powerUp) => {
      this.collectPowerUp(powerUp as Phaser.Physics.Arcade.Sprite);
    });
  }

  private createInput() {
    this.cursors = this.input.keyboard?.createCursorKeys() ?? {} as Phaser.Types.Input.Keyboard.CursorKeys;

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended) return;
      if (!this.started) this.startGame();
      this.dragging = true;
      this.setTarget(pointer);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (pointer.isDown && !this.ended) {
        this.dragging = true;
        this.setTarget(pointer);
      }
    });
    this.input.on("pointerup", () => {
      this.dragging = false;
    });
  }

  private createStartLayer() {
    const shade = this.add.rectangle(WIDTH / 2, 470, WIDTH, HEIGHT - 116, 0x090b16, .8);
    const ring = this.add.circle(WIDTH / 2, 338, 72, 0x101114)
      .setStrokeStyle(2, 0xdfff3f);
    const ship = this.add.image(WIDTH / 2, 338, "thunder-player").setDisplaySize(70, 94);
    const title = this.add.text(WIDTH / 2, 450, "雷电射击", {
      fontFamily: "sans-serif",
      fontSize: "38px",
      color: "#ffffff",
      fontStyle: "bold",
    }).setOrigin(.5);
    const description = this.add.text(WIDTH / 2, 500, "按住拖动战机，武器会自动开火", {
      fontFamily: "sans-serif",
      fontSize: "13px",
      color: "#a8a9ad",
    }).setOrigin(.5);
    const button = this.add.rectangle(WIDTH / 2, 570, 226, 54, 0xdfff3f)
      .setStrokeStyle(2, 0x101114);
    const buttonText = this.add.text(WIDTH / 2, 570, "点击屏幕出击  ↗", {
      fontFamily: "sans-serif",
      fontSize: "15px",
      color: "#101114",
      fontStyle: "bold",
    }).setOrigin(.5);
    this.startLayer = this.add.container(0, 0, [shade, ring, ship, title, description, button, buttonText]).setDepth(100);
  }

  private startGame() {
    this.started = true;
    this.nextFireAt = this.time.now;
    this.nextEnemyAt = this.time.now + 450;
    this.startLayer.setVisible(false);
    this.bridge.started();
  }

  private setTarget(pointer: Phaser.Input.Pointer) {
    const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    this.targetX = Phaser.Math.Clamp(position.x, 28, WIDTH - 28);
    this.targetY = Phaser.Math.Clamp(position.y, 250, HEIGHT - 68);
  }

  private updatePlayer(delta: number) {
    const keyboardSpeed = .34 * delta;
    let usedKeyboard = false;
    if (this.cursors.left?.isDown) {
      this.targetX -= keyboardSpeed;
      usedKeyboard = true;
    }
    if (this.cursors.right?.isDown) {
      this.targetX += keyboardSpeed;
      usedKeyboard = true;
    }
    if (this.cursors.up?.isDown) {
      this.targetY -= keyboardSpeed;
      usedKeyboard = true;
    }
    if (this.cursors.down?.isDown) {
      this.targetY += keyboardSpeed;
      usedKeyboard = true;
    }
    if (usedKeyboard && !this.started) this.startGame();

    this.targetX = Phaser.Math.Clamp(this.targetX, 28, WIDTH - 28);
    this.targetY = Phaser.Math.Clamp(this.targetY, 250, HEIGHT - 68);
    const follow = Math.min(1, delta / (this.dragging ? 42 : 70));
    this.player.x = Phaser.Math.Linear(this.player.x, this.targetX, follow);
    this.player.y = Phaser.Math.Linear(this.player.y, this.targetY, follow);
  }

  private updateStars(delta: number) {
    this.stars.forEach((star) => {
      star.y += (star.getData("speed") as number) * delta / 1000;
      if (star.y > HEIGHT) {
        star.y = 112;
        star.x = Phaser.Math.Between(8, WIDTH - 8);
      }
    });
  }

  private firePlayerBullet() {
    const rapid = this.time.now < this.rapidUntil;
    const offsets = rapid ? [-10, 10] : [0];
    offsets.forEach((offset) => {
      const bullet = this.obtain(this.playerBullets, this.player.x + offset, this.player.y - 30, "thunder-shot");
      bullet?.setVelocityY(-650);
    });
  }

  private spawnEnemy(time: number) {
    const heavy = this.level >= 2 && Math.random() < Math.min(.35, .1 + this.level * .025);
    const texture = heavy ? "thunder-heavy" : "thunder-enemy";
    const x = Phaser.Math.Between(38, WIDTH - 38);
    const enemy = this.obtain(this.enemies, x, 130, texture);
    if (!enemy) return;
    enemy.setData("hp", heavy ? 3 : 1);
    enemy.setData("value", heavy ? 260 : 100);
    enemy.setData("baseX", x);
    enemy.setData("phase", Phaser.Math.FloatBetween(0, Math.PI * 2));
    enemy.setData("amplitude", Phaser.Math.Between(16, heavy ? 34 : 58));
    enemy.setData("nextShot", time + Phaser.Math.Between(850, 1900));
    enemy.setVelocityY((heavy ? 68 : 92) + this.level * 7);
    enemy.setDisplaySize(heavy ? 72 : 52, heavy ? 68 : 62);
    enemy.body?.setSize(enemy.width * (heavy ? .74 : .68), enemy.height * .68);
  }

  private updateEnemies(time: number) {
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) continue;
      const baseX = enemy.getData("baseX") as number;
      const phase = enemy.getData("phase") as number;
      const amplitude = enemy.getData("amplitude") as number;
      enemy.x = Phaser.Math.Clamp(baseX + Math.sin(time * .0017 + phase) * amplitude, 24, WIDTH - 24);

      if (this.started && enemy.y > 160 && enemy.y < 560 && time >= (enemy.getData("nextShot") as number)) {
        this.fireEnemyBullet(enemy);
        enemy.setData("nextShot", time + Phaser.Math.Between(1150, 2300) - this.level * 45);
      }
    }
  }

  private fireEnemyBullet(enemy: Phaser.Physics.Arcade.Sprite) {
    const bullet = this.obtain(this.enemyBullets, enemy.x, enemy.y + 18, "thunder-enemy-shot");
    if (!bullet) return;
    bullet.setDisplaySize(12, 12);
    this.physics.moveToObject(bullet, this.player, 150 + this.level * 11);
  }

  private hitEnemy(bullet: Phaser.Physics.Arcade.Sprite, enemy: Phaser.Physics.Arcade.Sprite) {
    if (!bullet.active || !enemy.active || this.ended) return;
    this.recycle(this.playerBullets, bullet);
    const hp = (enemy.getData("hp") as number) - 1;
    enemy.setData("hp", hp);

    if (hp > 0) {
      enemy.setTintFill(0xffffff);
      this.time.delayedCall(55, () => enemy.active && enemy.clearTint());
      return;
    }

    const value = enemy.getData("value") as number;
    const x = enemy.x;
    const y = enemy.y;
    this.recycle(this.enemies, enemy);
    this.score += value;
    this.scoreText.setText(String(this.score).padStart(6, "0"));
    this.bridge.score(this.score);
    this.createExplosion(x, y);

    if (Math.random() < .12) {
      const powerUp = this.obtain(this.powerUps, x, y, "thunder-power");
      powerUp?.setVelocityY(112);
    }
  }

  private collectPowerUp(powerUp: Phaser.Physics.Arcade.Sprite) {
    if (
      powerUp === this.player
      || powerUp.texture.key !== "thunder-power"
      || !this.powerUps.contains(powerUp)
      || !powerUp.active
      || powerUp.getData("collected") === true
      || this.ended
    ) return;
    powerUp.setData("collected", true);
    powerUp.disableBody(true, true);
    powerUp.setActive(false).setVisible(false).setPosition(-200, -200).setVelocity(0, 0);
    this.powerUps.remove(powerUp, true, true);
    this.rapidUntil = Math.max(this.rapidUntil, this.time.now) + 7000;
    this.statusText.setText("RAPID FIRE  7s");
    this.score += 80;
    this.scoreText.setText(String(this.score).padStart(6, "0"));
    navigator.vibrate?.(24);
  }

  private damagePlayer() {
    if (this.ended || this.time.now < this.invulnerableUntil) return;
    this.lives -= 1;
    this.invulnerableUntil = this.time.now + 900;
    this.livesText.setText(Array.from({ length: 3 }, (_, index) => index < this.lives ? "◆" : "◇").join(" "));
    this.statusText.setText(this.lives > 0 ? `HIT · 剩余 ${this.lives} 条生命` : "机体损毁");
    this.cameras.main.shake(130, .009);
    navigator.vibrate?.(70);

    if (this.lives <= 0) {
      this.finishGame();
      return;
    }

    this.tweens.add({
      targets: this.player,
      alpha: .18,
      duration: 90,
      yoyo: true,
      repeat: 5,
      onComplete: () => {
        this.player.setAlpha(1);
        if (!this.ended && this.time.now >= this.rapidUntil) this.statusText.setText("拖动战机 · 自动射击");
      },
    });
  }

  private resolveManualCollisions() {
    if (!this.started || this.ended) return;

    for (const child of this.enemyBullets.getChildren()) {
      const bullet = child as Phaser.Physics.Arcade.Sprite;
      if (!bullet.active) continue;
      if (Phaser.Math.Distance.Between(bullet.x, bullet.y, this.player.x, this.player.y) <= 24) {
        this.recycle(this.enemyBullets, bullet);
        this.damagePlayer();
      }
    }

    for (const child of this.enemies.getChildren()) {
      const enemy = child as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) continue;
      const hitRadius = enemy.texture.key === "thunder-heavy" ? 44 : 34;
      if (Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y) <= hitRadius) {
        this.recycle(this.enemies, enemy);
        this.damagePlayer();
      }
    }

    for (const child of [...this.powerUps.getChildren()]) {
      const powerUp = child as Phaser.Physics.Arcade.Sprite;
      if (!powerUp.active || powerUp.getData("collected") === true) continue;
      if (Phaser.Math.Distance.Between(powerUp.x, powerUp.y, this.player.x, this.player.y) <= 34) {
        this.collectPowerUp(powerUp);
      }
    }
  }

  private createExplosion(x: number, y: number) {
    for (let index = 0; index < 8; index += 1) {
      const particle = this.add.circle(x, y, Phaser.Math.Between(2, 5), index % 2 ? 0xff6a51 : 0xdfff3f);
      const angle = index / 8 * Math.PI * 2;
      const distance = Phaser.Math.Between(18, 38);
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: .2,
        duration: 260,
        onComplete: () => particle.destroy(),
      });
    }
  }

  private recycleOffscreenObjects() {
    for (const child of this.playerBullets.getChildren()) {
      const bullet = child as Phaser.Physics.Arcade.Sprite;
      if (bullet.active && bullet.y < 105) this.recycle(this.playerBullets, bullet);
    }
    for (const child of this.enemyBullets.getChildren()) {
      const bullet = child as Phaser.Physics.Arcade.Sprite;
      if (bullet.active && (bullet.y > HEIGHT + 20 || bullet.x < -20 || bullet.x > WIDTH + 20)) {
        this.recycle(this.enemyBullets, bullet);
      }
    }
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Phaser.Physics.Arcade.Sprite;
      if (enemy.active && enemy.y > HEIGHT + 40) this.recycle(this.enemies, enemy);
    }
    for (const child of this.powerUps.getChildren()) {
      const powerUp = child as Phaser.Physics.Arcade.Sprite;
      if (powerUp.active && powerUp.y > HEIGHT + 30) this.recycle(this.powerUps, powerUp);
    }
  }

  private obtain(group: Phaser.Physics.Arcade.Group, x: number, y: number, texture: string) {
    const sprite = group.get(x, y, texture) as Phaser.Physics.Arcade.Sprite | null;
    if (!sprite) return null;
    sprite.enableBody(true, x, y, true, true);
    sprite.setTexture(texture).setActive(true).setVisible(true).setAlpha(1).clearTint();
    sprite.setVelocity(0, 0);
    if (texture === "thunder-power") {
      sprite.setData("collected", false);
      sprite.setDisplaySize(38, 38);
    }
    return sprite;
  }

  private recycle(group: Phaser.Physics.Arcade.Group, sprite: Phaser.Physics.Arcade.Sprite) {
    if (sprite === this.player || sprite.texture.key === "thunder-player") return;
    sprite.disableBody(true, true);
    sprite.setVelocity(0, 0).setActive(false).setVisible(false).setPosition(-200, -200);
    group.killAndHide(sprite);
  }

  private finishGame() {
    this.ended = true;
    const saved = this.storage.load();
    const highScore = Math.max(saved.highScore, this.score);
    this.storage.save({ highScore });
    this.bestText.setText(`BEST ${String(highScore).padStart(6, "0")}`);
    this.bridge.gameOver(this.score);

    for (const group of [this.playerBullets, this.enemyBullets, this.enemies, this.powerUps]) {
      for (const child of group.getChildren()) {
        const sprite = child as Phaser.Physics.Arcade.Sprite;
        if (sprite.active) sprite.setVelocity(0, 0);
      }
    }

    const shade = this.add.rectangle(WIDTH / 2, 480, WIDTH, HEIGHT - 116, 0x090b16, .82).setDepth(200);
    const panel = this.add.rectangle(WIDTH / 2, 434, 310, 278, 0xf3f0e8)
      .setStrokeStyle(2, 0x101114)
      .setDepth(201);
    const badge = this.add.circle(WIDTH / 2, 338, 30, 0xff6a51)
      .setStrokeStyle(2, 0x101114)
      .setDepth(202);
    this.add.text(WIDTH / 2, 338, "×", {
      fontFamily: "sans-serif",
      fontSize: "30px",
      color: "#101114",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(203);
    this.add.text(WIDTH / 2, 388, "战机失联", {
      fontFamily: "sans-serif",
      fontSize: "30px",
      color: "#101114",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(202);
    this.add.text(WIDTH / 2, 435, `SCORE  ${String(this.score).padStart(6, "0")}`, {
      fontFamily: "monospace",
      fontSize: "15px",
      color: "#77756f",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(202);
    this.add.text(WIDTH / 2, 465, `LEVEL ${String(this.level).padStart(2, "0")}`, {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#77756f",
    }).setOrigin(.5).setDepth(202);

    const button = this.add.rectangle(WIDTH / 2, 530, 210, 50, 0x101114)
      .setDepth(202)
      .setInteractive({ cursor: "pointer" });
    this.add.text(WIDTH / 2, 530, "重新出击  ↗", {
      fontFamily: "sans-serif",
      fontSize: "15px",
      color: "#ffffff",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(203);
    button.on("pointerup", () => this.scene.restart());

    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: [shade, panel, badge, button], alpha: { from: 0, to: 1 }, duration: 220 });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#090b16",
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: ThunderStrikeScene,
});
