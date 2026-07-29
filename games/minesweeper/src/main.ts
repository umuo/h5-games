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
const BOARD_MAX_WIDTH = 352;
const BOARD_MAX_HEIGHT = 352;
const BOARD_TOP = 252;

const DIFFICULTIES = {
  easy: { id: "easy", label: "简单", rows: 8, columns: 8, mines: 10 },
  normal: { id: "normal", label: "普通", rows: 12, columns: 12, mines: 24 },
  hard: { id: "hard", label: "困难", rows: 16, columns: 16, mines: 48 },
} as const;

type DifficultyId = keyof typeof DIFFICULTIES;
type Difficulty = (typeof DIFFICULTIES)[DifficultyId];

interface MineCell {
  row: number;
  column: number;
  mine: boolean;
  adjacent: number;
  revealed: boolean;
  flagged: boolean;
  exploded: boolean;
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  pressTimer: Phaser.Time.TimerEvent | null;
  longPressed: boolean;
}

interface BestTimes {
  easy: number;
  normal: number;
  hard: number;
}

class MinesweeperScene extends Phaser.Scene {
  private difficultyId: DifficultyId = "easy";
  private difficulty: Difficulty = DIFFICULTIES.easy;
  private cells: MineCell[][] = [];
  private minesPlaced = false;
  private started = false;
  private ended = false;
  private won = false;
  private flagMode = false;
  private elapsedMs = 0;
  private revealedCount = 0;
  private flaggedCount = 0;
  private remainingText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private flagButton!: Phaser.GameObjects.Rectangle;
  private flagButtonText!: Phaser.GameObjects.Text;
  private bridge = createGameBridge({ gameId: "minesweeper", version: "1.2.0" });
  private storage = createGameStorage<BestTimes>("minesweeper", { easy: 0, normal: 0, hard: 0 });

  constructor() {
    super("minesweeper");
  }

  init(data: { difficulty?: DifficultyId }) {
    if (data?.difficulty && data.difficulty in DIFFICULTIES) {
      this.difficultyId = data.difficulty;
    }
    this.difficulty = DIFFICULTIES[this.difficultyId];
  }

  create() {
    this.resetState();
    this.input.mouse?.disableContextMenu();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#f3f0e8");
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 32, 32, 0xf3f0e8, 1, 0x101114, .055);

    this.add.text(24, 27, "MINES / 006", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#101114",
      letterSpacing: 2,
      fontStyle: "bold",
    });
    this.add.text(WIDTH - 24, 27, "益智", {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#77756f",
    }).setOrigin(1, 0);
    this.add.text(24, 56, "扫雷", {
      fontFamily: "sans-serif",
      fontSize: "40px",
      color: "#101114",
      fontStyle: "bold",
    });
    this.add.text(26, 105, "避开地雷，翻开所有安全区域", {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#77756f",
    });

    this.createDifficultySelector();
    this.createStats();
    this.createBoard();
    this.createControls();

    const pauseGame = () => this.scene.pause();
    const resumeGame = () => {
      if (!this.ended) this.scene.resume();
    };
    this.game.events.on(Phaser.Core.Events.BLUR, pauseGame);
    this.game.events.on(Phaser.Core.Events.FOCUS, resumeGame);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
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
    this.cells = [];
    this.minesPlaced = false;
    this.started = false;
    this.ended = false;
    this.won = false;
    this.flagMode = false;
    this.elapsedMs = 0;
    this.revealedCount = 0;
    this.flaggedCount = 0;
  }

  private createDifficultySelector() {
    const options = Object.values(DIFFICULTIES);
    options.forEach((option, index) => {
      const x = 78 + index * 117;
      const active = option.id === this.difficultyId;
      const background = this.add.rectangle(x, 145, 108, 42, active ? 0x101114 : 0xf3f0e8)
        .setStrokeStyle(1.5, 0x101114)
        .setInteractive({ cursor: "pointer" });
      this.add.text(x, 139, option.label, {
        fontFamily: "sans-serif",
        fontSize: "13px",
        color: active ? "#ffffff" : "#101114",
        fontStyle: "bold",
      }).setOrigin(.5);
      this.add.text(x, 156, `${option.rows}×${option.columns} · ${option.mines}雷`, {
        fontFamily: "monospace",
        fontSize: "7px",
        color: active ? "#dfff3f" : "#77756f",
      }).setOrigin(.5);
      background.on("pointerup", () => {
        if (option.id !== this.difficultyId) this.scene.restart({ difficulty: option.id });
      });
    });
  }

  private createStats() {
    this.add.rectangle(WIDTH / 2, 208, WIDTH - 48, 60, 0x101114);
    this.add.text(42, 193, "剩余地雷", this.statLabelStyle());
    this.add.text(WIDTH / 2, 193, "计时", this.statLabelStyle()).setOrigin(.5, 0);
    this.add.text(WIDTH - 42, 193, "最佳", this.statLabelStyle()).setOrigin(1, 0);

    this.remainingText = this.add.text(42, 208, String(this.difficulty.mines).padStart(2, "0"), this.statValueStyle());
    this.timeText = this.add.text(WIDTH / 2, 208, "00:00", this.statValueStyle()).setOrigin(.5, 0);
    const best = this.storage.load()[this.difficultyId];
    this.bestText = this.add.text(WIDTH - 42, 208, best ? this.formatTime(best) : "--:--", this.statValueStyle()).setOrigin(1, 0);
  }

  private createBoard() {
    const cellSize = Math.floor(Math.min(
      BOARD_MAX_WIDTH / this.difficulty.columns,
      BOARD_MAX_HEIGHT / this.difficulty.rows,
    ));
    const boardWidth = cellSize * this.difficulty.columns;
    const boardHeight = cellSize * this.difficulty.rows;
    const left = Math.round((WIDTH - boardWidth) / 2);
    const top = BOARD_TOP + Math.round((BOARD_MAX_HEIGHT - boardHeight) / 2);

    const frame = this.add.rectangle(WIDTH / 2, BOARD_TOP + BOARD_MAX_HEIGHT / 2, boardWidth + 8, boardHeight + 8, 0x101114)
      .setStrokeStyle(2, 0x101114);
    frame.setDepth(0);

    this.cells = Array.from({ length: this.difficulty.rows }, (_, row) =>
      Array.from({ length: this.difficulty.columns }, (_, column) => {
        const x = left + column * cellSize + cellSize / 2;
        const y = top + row * cellSize + cellSize / 2;
        const background = this.add.rectangle(0, 0, cellSize - 2, cellSize - 2, 0x303137)
          .setStrokeStyle(1, 0xf3f0e8, .18);
        const label = this.add.text(0, 0, "", {
          fontFamily: "Arial, sans-serif",
          fontSize: `${Math.max(11, Math.floor(cellSize * .48))}px`,
          color: "#101114",
          fontStyle: "bold",
        }).setOrigin(.5);
        const container = this.add.container(x, y, [background, label])
          .setSize(cellSize - 1, cellSize - 1)
          .setInteractive({ cursor: "pointer" });

        const cell: MineCell = {
          row,
          column,
          mine: false,
          adjacent: 0,
          revealed: false,
          flagged: false,
          exploded: false,
          container,
          background,
          label,
          pressTimer: null,
          longPressed: false,
        };
        this.bindCellInput(cell);
        return cell;
      }),
    );
  }

  private createControls() {
    this.statusText = this.add.text(WIDTH / 2, 628, "短按翻开 · 长按插旗", {
      fontFamily: "sans-serif",
      fontSize: "13px",
      color: "#101114",
      fontStyle: "bold",
    }).setOrigin(.5);

    this.flagButton = this.add.rectangle(108, 674, 164, 50, 0xf3f0e8)
      .setStrokeStyle(1.5, 0x101114)
      .setInteractive({ cursor: "pointer" });
    this.flagButtonText = this.add.text(108, 674, "⚑  插旗模式", {
      fontFamily: "sans-serif",
      fontSize: "14px",
      color: "#101114",
      fontStyle: "bold",
    }).setOrigin(.5);
    this.flagButton.on("pointerup", () => this.toggleFlagMode());

    const restart = this.add.rectangle(286, 674, 140, 50, 0x101114)
      .setStrokeStyle(1.5, 0x101114)
      .setInteractive({ cursor: "pointer" });
    this.add.text(286, 674, "重新开局  ↗", {
      fontFamily: "sans-serif",
      fontSize: "14px",
      color: "#ffffff",
      fontStyle: "bold",
    }).setOrigin(.5);
    restart.on("pointerup", () => this.scene.restart({ difficulty: this.difficultyId }));

    this.add.text(WIDTH / 2, 724, "数字代表周围八格中的地雷数量", {
      fontFamily: "sans-serif",
      fontSize: "11px",
      color: "#77756f",
    }).setOrigin(.5);
    this.add.text(WIDTH / 2, HEIGHT - 38, "FIRST TAP SAFE  ·  LOCAL BEST", {
      fontFamily: "monospace",
      fontSize: "9px",
      color: "#77756f",
      letterSpacing: 1,
    }).setOrigin(.5);
  }

  private bindCellInput(cell: MineCell) {
    cell.container.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.ended) return;
      this.tweens.killTweensOf(cell.container);
      this.tweens.add({ targets: cell.container, scale: .94, duration: 70 });
      cell.longPressed = false;
      cell.pressTimer?.remove(false);
      cell.pressTimer = this.time.delayedCall(430, () => {
        if (pointer.isDown && !cell.revealed && !this.ended) {
          cell.longPressed = true;
          this.toggleFlag(cell);
          navigator.vibrate?.(24);
        }
      });
    });

    cell.container.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      this.tweens.killTweensOf(cell.container);
      this.tweens.add({ targets: cell.container, scale: 1, duration: 90 });
      cell.pressTimer?.remove(false);
      cell.pressTimer = null;
      if (this.ended || cell.longPressed) return;
      if (pointer.rightButtonReleased() || this.flagMode) this.toggleFlag(cell);
      else this.revealCell(cell);
    });

    cell.container.on("pointerout", () => {
      this.tweens.killTweensOf(cell.container);
      this.tweens.add({ targets: cell.container, scale: 1, duration: 90 });
      cell.pressTimer?.remove(false);
      cell.pressTimer = null;
    });
  }

  private toggleFlagMode() {
    if (this.ended) return;
    this.flagMode = !this.flagMode;
    this.flagButton.setFillStyle(this.flagMode ? 0xff6a51 : 0xf3f0e8);
    this.flagButtonText.setText(this.flagMode ? "⚑  插旗中" : "⚑  插旗模式");
    this.statusText.setText(this.flagMode ? "点击格子插旗或取消" : "短按翻开 · 长按插旗");
  }

  private toggleFlag(cell: MineCell) {
    if (this.ended || cell.revealed) return;
    if (!cell.flagged && this.flaggedCount >= this.difficulty.mines) {
      this.statusText.setText("旗子已经用完");
      return;
    }
    cell.flagged = !cell.flagged;
    this.flaggedCount += cell.flagged ? 1 : -1;
    this.updateCell(cell);
    this.remainingText.setText(String(this.difficulty.mines - this.flaggedCount).padStart(2, "0"));
    this.statusText.setText(this.flagMode ? "点击格子插旗或取消" : "短按翻开 · 长按插旗");
  }

  private revealCell(cell: MineCell) {
    if (this.ended || cell.flagged) return;
    if (cell.revealed) {
      this.chordCell(cell);
      return;
    }

    if (!this.minesPlaced) {
      this.placeMines(cell);
      this.started = true;
      this.bridge.started();
      this.statusText.setText("小心数字周围的地雷");
    }

    if (cell.mine) {
      cell.exploded = true;
      this.finish(false);
      return;
    }

    this.revealSafeArea(cell);
    if (this.revealedCount === this.difficulty.rows * this.difficulty.columns - this.difficulty.mines) {
      this.finish(true);
    }
  }

  private chordCell(cell: MineCell) {
    if (cell.adjacent <= 0) return;
    const neighbors = this.neighbors(cell);
    const flagged = neighbors.filter((neighbor) => neighbor.flagged).length;
    if (flagged !== cell.adjacent) {
      this.statusText.setText(`周围需要 ${cell.adjacent} 面旗子`);
      return;
    }

    const hidden = neighbors.filter((neighbor) => !neighbor.flagged && !neighbor.revealed);
    const mine = hidden.find((neighbor) => neighbor.mine);
    if (mine) {
      mine.exploded = true;
      this.finish(false);
      return;
    }

    hidden.forEach((neighbor) => this.revealSafeArea(neighbor));
    this.statusText.setText("已连开周围安全区域");
    navigator.vibrate?.(18);
    if (this.revealedCount === this.difficulty.rows * this.difficulty.columns - this.difficulty.mines) {
      this.finish(true);
    }
  }

  private placeMines(firstCell: MineCell) {
    const safe = new Set(
      this.neighbors(firstCell, true).map((cell) => `${cell.row}:${cell.column}`),
    );
    const candidates = this.cells.flat().filter((cell) => !safe.has(`${cell.row}:${cell.column}`));
    Phaser.Utils.Array.Shuffle(candidates)
      .slice(0, this.difficulty.mines)
      .forEach((cell) => { cell.mine = true; });

    this.cells.flat().forEach((cell) => {
      cell.adjacent = this.neighbors(cell).filter((neighbor) => neighbor.mine).length;
    });
    this.minesPlaced = true;
  }

  private revealSafeArea(start: MineCell) {
    const queue = [start];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const cell = queue.shift();
      if (!cell) continue;
      const key = `${cell.row}:${cell.column}`;
      if (visited.has(key) || cell.revealed || cell.flagged || cell.mine) continue;
      visited.add(key);
      cell.revealed = true;
      this.revealedCount += 1;
      this.updateCell(cell);

      if (cell.adjacent === 0) {
        this.neighbors(cell).forEach((neighbor) => {
          if (!neighbor.mine && !neighbor.flagged && !neighbor.revealed) queue.push(neighbor);
        });
      }
    }
    this.bridge.score(this.revealedCount * 10);
  }

  private neighbors(cell: MineCell, includeSelf = false) {
    const result: MineCell[] = [];
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        if (!includeSelf && rowOffset === 0 && columnOffset === 0) continue;
        const row = cell.row + rowOffset;
        const column = cell.column + columnOffset;
        const neighbor = this.cells[row]?.[column];
        if (neighbor) result.push(neighbor);
      }
    }
    return result;
  }

  private updateCell(cell: MineCell) {
    if (cell.revealed) {
      cell.background.setFillStyle(cell.exploded ? 0xff6a51 : 0xf3f0e8);
      cell.background.setStrokeStyle(1, 0x101114, .24);
      if (cell.mine) {
        cell.label.setText("●").setColor("#101114");
      } else if (cell.adjacent > 0) {
        cell.label.setText(String(cell.adjacent)).setColor(this.numberColor(cell.adjacent));
      } else {
        cell.label.setText("");
      }
      return;
    }

    if (cell.flagged) {
      cell.background.setFillStyle(0xff6a51);
      cell.label.setText("⚑").setColor("#101114");
    } else {
      cell.background.setFillStyle(0x303137);
      cell.label.setText("");
    }
  }

  private finish(won: boolean) {
    this.ended = true;
    this.won = won;
    this.cells.flat().forEach((cell) => {
      cell.pressTimer?.remove(false);
      if (cell.mine) cell.revealed = true;
      if (!cell.mine && cell.flagged) {
        cell.background.setFillStyle(0xffd369);
        cell.label.setText("×").setColor("#101114");
      } else {
        this.updateCell(cell);
      }
    });

    const elapsedSeconds = Math.max(1, Math.floor(this.elapsedMs / 1000));
    if (won) {
      const saved = this.storage.load();
      const previousBest = saved[this.difficultyId];
      if (!previousBest || elapsedSeconds < previousBest) {
        this.storage.save({ ...saved, [this.difficultyId]: elapsedSeconds });
        this.bestText.setText(this.formatTime(elapsedSeconds));
      }
      const score = Math.max(100, this.difficulty.mines * 120 - elapsedSeconds * 4);
      this.bridge.score(score);
      this.bridge.gameOver(score);
      this.statusText.setText("区域已清除！");
      navigator.vibrate?.([35, 35, 70]);
    } else {
      this.bridge.gameOver(this.revealedCount * 10);
      this.statusText.setText("踩到地雷了");
      this.cameras.main.shake(180, .008);
      navigator.vibrate?.(100);
    }
    this.showResult();
  }

  private showResult() {
    const shade = this.add.rectangle(WIDTH / 2, BOARD_TOP + BOARD_MAX_HEIGHT / 2, 364, 364, 0x101114, .78)
      .setDepth(100);
    const panel = this.add.rectangle(WIDTH / 2, 424, 292, 220, 0xf3f0e8)
      .setStrokeStyle(2, 0x101114)
      .setDepth(101);
    const badge = this.add.circle(WIDTH / 2, 356, 27, this.won ? 0xdfff3f : 0xff6a51)
      .setStrokeStyle(2, 0x101114)
      .setDepth(102);
    this.add.text(WIDTH / 2, 356, this.won ? "✓" : "×", {
      fontFamily: "sans-serif",
      fontSize: "26px",
      color: "#101114",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    this.add.text(WIDTH / 2, 399, this.won ? "排雷成功！" : "任务失败", {
      fontFamily: "sans-serif",
      fontSize: "27px",
      color: "#101114",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(WIDTH / 2, 435, `${this.difficulty.label} · ${this.formatTime(Math.max(1, Math.floor(this.elapsedMs / 1000)))}`, {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#77756f",
    }).setOrigin(.5).setDepth(102);

    const button = this.add.rectangle(WIDTH / 2, 492, 206, 48, 0x101114)
      .setDepth(102)
      .setInteractive({ cursor: "pointer" });
    this.add.text(WIDTH / 2, 492, "再来一局  ↗", {
      fontFamily: "sans-serif",
      fontSize: "14px",
      color: "#ffffff",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    button.on("pointerup", () => this.scene.restart({ difficulty: this.difficultyId }));

    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({ targets: [shade, panel, badge, button], alpha: { from: 0, to: 1 }, duration: 220 });
  }

  private numberColor(value: number) {
    return ["#101114", "#5c7cff", "#189b70", "#e34f38", "#7b57d1", "#d97706", "#188fa7", "#101114", "#77756f"][value];
  }

  private statValueStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: "monospace", fontSize: "18px", color: "#ffffff", fontStyle: "bold" };
  }

  private statLabelStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: "sans-serif", fontSize: "8px", color: "#77787c" };
  }

  private formatTime(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  scene: MinesweeperScene,
});
