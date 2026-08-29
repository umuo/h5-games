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
const SIZE = 8;
const CELL = 40;
const PLAYER_GRID_X = CENTER_X - (SIZE * CELL) / 2 - 8;
const ENEMY_GRID_X = CENTER_X - (SIZE * CELL) / 2 + 8;
const PLAYER_GRID_Y = 210;
const ENEMY_GRID_Y = 210;
const EMPTY = 0;
const SHIP = 1;
const HIT = 2;
const MISS = 3;
const FLEET = [4, 3, 3, 2];

class BattleshipScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private recordText!: Phaser.GameObjects.Text;
  private playerBoard: number[][] = [];
  private enemyBoard: number[][] = [];
  private enemyRemaining = FLEET.reduce((sum, ship) => sum + ship, 0);
  private playerRemaining = FLEET.reduce((sum, ship) => sum + ship, 0);
  private playerTurn = true;
  private finished = false;
  private wins = 0;
  private losses = 0;
  private enemyMarkers: Array<Phaser.GameObjects.Rectangle> = [];
  private playerMarkers: Array<Phaser.GameObjects.Rectangle> = [];
  private audio = createAudioKit({ masterGain: 0.45 });
  private bridge = createGameBridge({ gameId: "battleship", version: "1.0.0" });
  private storage = createGameStorage("battleship", { wins: 0, losses: 0 });

  constructor() { super("battleship"); }

  create() {
    this.playerBoard = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(EMPTY));
    this.enemyBoard = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(EMPTY));
    this.playerTurn = true;
    this.finished = false;
    this.enemyRemaining = FLEET.reduce((sum, ship) => sum + ship, 0);
    this.playerRemaining = this.enemyRemaining;
    this.enemyMarkers = [];
    this.playerMarkers = [];
    const saved = this.storage.load();
    this.wins = saved.wins;
    this.losses = saved.losses;

    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#0a1628");
    this.add.rectangle(CENTER_X, 31, WIDTH - 36, 1, 0xf3f0e8, .22);
    this.add.text(22, 43, "NAVY / 057", {
      fontFamily: "monospace", fontSize: "11px", color: "#dfff3f", letterSpacing: 2,
    });
    this.add.text(WIDTH - 22, 43, "海战棋", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#7a8fb3",
    }).setOrigin(1, 0);
    this.statusText = this.add.text(CENTER_X, 74, "你的舰队已就位 · 点击敌方海域开火", {
      fontFamily: "sans-serif", fontSize: "13px", color: "#dfff3f", fontStyle: "bold",
    }).setOrigin(.5);
    this.recordText = this.add.text(CENTER_X, 620, `战绩 ${this.wins} 胜 ${this.losses} 负`, {
      fontFamily: "monospace", fontSize: "12px", color: "#7a8fb3", letterSpacing: 1,
    }).setOrigin(.5);
    const hint = this.add.text(CENTER_X, 652, "上：敌方海域 · 下：你的舰队", {
      fontFamily: "sans-serif", fontSize: "11px", color: "#5d7d95",
    }).setOrigin(.5);
    void hint;

    this.drawGrid(PLAYER_GRID_X, PLAYER_GRID_Y, true);
    this.drawGrid(ENEMY_GRID_X, ENEMY_GRID_Y, false);
    this.placeFleet(this.playerBoard, PLAYER_GRID_X, PLAYER_GRID_Y, true);
    this.placeFleet(this.enemyBoard, ENEMY_GRID_X, ENEMY_GRID_Y, false);

    this.bindInput();
    bindGameLifecycle(this, { onInterrupt: () => this.audio.suspend() });
    this.events.on(Phaser.Scenes.Events.RESUME, () => this.audio.resume());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.suspend());
    sharpenSceneText(this.children, RENDER_DPR);
    this.bridge.ready();
  }

  private drawGrid(gridX: number, gridY: number, isPlayer: boolean) {
    const g = this.add.graphics();
    g.lineStyle(1, 0x3a5a8a, .9);
    for (let index = 0; index <= SIZE; index += 1) {
      g.lineBetween(gridX, gridY + index * CELL, gridX + SIZE * CELL, gridY + index * CELL);
      g.lineBetween(gridX + index * CELL, gridY, gridX + index * CELL, gridY + SIZE * CELL);
    }
    this.add.text(gridX, gridY - 20, isPlayer ? "你的舰队" : "敌方海域", {
      fontFamily: "sans-serif", fontSize: "12px", color: "#7a8fb3",
    });
  }

  private placeFleet(board: number[][], gridX: number, gridY: number, isPlayer: boolean) {
    for (const shipLength of FLEET) {
      let placed = false;
      let attempts = 0;
      while (!placed && attempts < 300) {
        attempts += 1;
        const horizontal = Math.random() < .5;
        const col = Phaser.Math.Between(0, SIZE - (horizontal ? shipLength : 1) - 1);
        const row = Phaser.Math.Between(0, SIZE - (horizontal ? 1 : shipLength) - 1);
        const cells: Array<{ col: number; row: number }> = [];
        for (let index = 0; index < shipLength; index += 1) {
          cells.push({ col: col + (horizontal ? index : 0), row: row + (horizontal ? 0 : index) });
        }
        if (cells.some((cell) => this.neighborsOccupied(board, cell.col, cell.row))) continue;
        for (const cell of cells) board[cell.row][cell.col] = SHIP;
        if (isPlayer) {
          for (const cell of cells) {
            const { x, y } = this.cellCenter(gridX, gridY, cell.col, cell.row);
            this.add.rectangle(x, y, CELL - 5, CELL - 5, 0x5d7d95).setDepth(3);
          }
        }
        placed = true;
      }
    }
  }

  private neighborsOccupied(board: number[][], col: number, row: number) {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const c = col + dc;
        const r = row + dr;
        if (c >= 0 && c < SIZE && r >= 0 && r < SIZE && board[r][c] === SHIP) return true;
      }
    }
    return false;
  }

  private cellCenter(gridX: number, gridY: number, col: number, row: number) {
    return { x: gridX + col * CELL + CELL / 2, y: gridY + row * CELL + CELL / 2 };
  }

  private bindInput() {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.finished || !this.playerTurn) return;
      this.audio.unlock();
      const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      const col = Math.floor((position.x - ENEMY_GRID_X) / CELL);
      const row = Math.floor((position.y - ENEMY_GRID_Y) / CELL);
      if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return;
      if (this.enemyBoard[row][col] === HIT || this.enemyBoard[row][col] === MISS) return;
      this.playerTurn = false;
      const isHit = this.enemyBoard[row][col] === SHIP;
      this.enemyBoard[row][col] = isHit ? HIT : MISS;
      if (isHit) this.enemyRemaining -= 1;
      this.markShot(ENEMY_GRID_X, ENEMY_GRID_Y, col, row, isHit, this.enemyMarkers);
      this.audio.tone({ freq: isHit ? 620 : 240, duration: isHit ? .12 : .08, type: isHit ? "triangle" : "sine", gain: .14 });
      if (this.enemyRemaining === 0) {
        this.endGame(true);
        return;
      }
      this.statusText.setText(isHit ? "命中！继续开火" : "落空 · AI 回击…");
      this.time.delayedCall(700, () => this.aiTurn());
    });
  }

  private markShot(gridX: number, gridY: number, col: number, row: number, isHit: boolean, layer: Array<Phaser.GameObjects.Rectangle>) {
    const { x, y } = this.cellCenter(gridX, gridY, col, row);
    const marker = this.add.rectangle(x, y, CELL - 8, CELL - 8, isHit ? 0xff6a51 : 0x3a5a8a)
      .setStrokeStyle(1.5, 0xf3f0e8, isHit ? .8 : .3).setDepth(5);
    layer.push(marker);
  }

  private aiTurn() {
    if (this.finished) return;
    // Hunt: remember hits and target adjacent cells first.
    const huntTargets: Array<{ col: number; row: number }> = [];
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        if (this.playerBoard[row][col] === HIT) {
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const c = col + dc;
            const r = row + dr;
            if (c >= 0 && c < SIZE && r >= 0 && r < SIZE
              && this.playerBoard[r][c] !== HIT && this.playerBoard[r][c] !== MISS) {
              huntTargets.push({ col: c, row: r });
            }
          }
        }
      }
    }
    let target: { col: number; row: number };
    if (huntTargets.length > 0) {
      target = Phaser.Utils.Array.GetRandom(huntTargets);
    } else {
      do {
        target = { col: Phaser.Math.Between(0, SIZE - 1), row: Phaser.Math.Between(0, SIZE - 1) };
      } while (this.playerBoard[target.row][target.col] === HIT || this.playerBoard[target.row][target.col] === MISS);
    }
    const isHit = this.playerBoard[target.row][target.col] === SHIP;
    this.playerBoard[target.row][target.col] = isHit ? HIT : MISS;
    if (isHit) this.playerRemaining -= 1;
    this.markShot(PLAYER_GRID_X, PLAYER_GRID_Y, target.col, target.row, isHit, this.playerMarkers);
    this.audio.tone({ freq: isHit ? 500 : 220, duration: isHit ? .12 : .08, type: isHit ? "triangle" : "sine", gain: .12 });
    if (this.playerRemaining === 0) {
      this.endGame(false);
      return;
    }
    this.playerTurn = true;
    this.statusText.setText(isHit ? "你的船被击中！" : "AI 落空 · 轮到你开火");
  }

  private endGame(playerWon: boolean) {
    this.finished = true;
    if (playerWon) {
      this.wins += 1;
      this.statusText.setText("全部击沉 · 你赢了！");
      this.audio.tone({ freq: 523, duration: .16, type: "triangle", gain: .2 });
      this.audio.tone({ freq: 784, duration: .3, time: this.audio.now + .14, type: "triangle", gain: .2 });
    } else {
      this.losses += 1;
      this.statusText.setText("舰队全灭 · AI 获胜");
      this.audio.tone({ freq: 300, endFreq: 110, duration: .5, type: "sawtooth", gain: .2 });
    }
    this.storage.save({ wins: this.wins, losses: this.losses });
    this.recordText.setText(`战绩 ${this.wins} 胜 ${this.losses} 负`);
    this.bridge.gameOver(playerWon ? 100 : 0);
    const restart = this.add.rectangle(CENTER_X, 690, 170, 44, 0xdfff3f)
      .setInteractive({ useHandCursor: true }).setDepth(20);
    this.add.text(CENTER_X, 690, "重新开战  ↻", {
      fontFamily: "sans-serif", fontSize: "14px", color: "#0a1628", fontStyle: "bold",
    }).setOrigin(.5).setDepth(21);
    restart.on("pointerup", () => this.scene.restart());
    sharpenSceneText(this.children, RENDER_DPR);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#0a1628",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: BattleshipScene,
});
