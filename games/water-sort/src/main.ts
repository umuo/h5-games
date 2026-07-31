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
const CAPACITY = 4;
const TUBE_WIDTH = 48;
const TUBE_HEIGHT = 122;
const SEGMENT_HEIGHT = 24;
const RENDER_DPR = getGameRenderDpr();

const LIQUID_COLORS = [
  0xff6a51,
  0x5c7cff,
  0xdfff3f,
  0xffc94a,
  0x9b6bff,
  0x36d7d0,
  0xff8fbe,
  0xff9548,
] as const;

const DIFFICULTIES = {
  easy: { id: "easy", label: "简单", colors: 4, columns: 3, scrambleMoves: 28 },
  normal: { id: "normal", label: "普通", colors: 6, columns: 4, scrambleMoves: 48 },
  hard: { id: "hard", label: "困难", colors: 8, columns: 5, scrambleMoves: 72 },
} as const;

type DifficultyId = keyof typeof DIFFICULTIES;
type Difficulty = (typeof DIFFICULTIES)[DifficultyId];

interface BestScores {
  easy: number;
  normal: number;
  hard: number;
}

interface TubeView {
  index: number;
  container: Phaser.GameObjects.Container;
  graphics: Phaser.GameObjects.Graphics;
  baseX: number;
  baseY: number;
}

interface Snapshot {
  tubes: number[][];
  moves: number;
}

const cloneTubes = (tubes: number[][]) => tubes.map((tube) => [...tube]);

class WaterSortScene extends Phaser.Scene {
  private difficultyId: DifficultyId = "easy";
  private difficulty: Difficulty = DIFFICULTIES.easy;
  private tubes: number[][] = [];
  private views: TubeView[] = [];
  private history: Snapshot[] = [];
  private selected: number | null = null;
  private moves = 0;
  private started = false;
  private busy = false;
  private ended = false;
  private movesText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private solvedText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private undoButton!: Phaser.GameObjects.Rectangle;
  private undoText!: Phaser.GameObjects.Text;
  private storage = createGameStorage<BestScores>("water-sort", { easy: 0, normal: 0, hard: 0 });
  private bridge = createGameBridge({
    gameId: "water-sort",
    version: "1.1.1",
    onCommand: (event) => {
      if (event.type === "PAUSE") this.scene.pause();
      if (event.type === "RESUME" && !this.ended) this.scene.resume();
      if (event.type === "RESTART") this.scene.restart({ difficulty: this.difficultyId });
    },
  });

  constructor() {
    super("water-sort");
  }

  init(data: { difficulty?: DifficultyId }) {
    if (data?.difficulty && data.difficulty in DIFFICULTIES) {
      this.difficultyId = data.difficulty;
    }
    this.difficulty = DIFFICULTIES[this.difficultyId];
  }

  create() {
    this.resetState();
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#09141d");
    this.drawInterface();
    sharpenSceneText(this.children, RENDER_DPR);
    this.tubes = this.createPuzzle();
    this.createTubeViews();
    this.refreshAll();

    const handleBoardPointer = (pointer: Phaser.Input.Pointer) => this.handleBoardTap(pointer);
    this.input.on("pointerup", handleBoardPointer);
    bindGameLifecycle(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off("pointerup", handleBoardPointer);
    });

    this.bridge.ready();
  }

  private resetState() {
    this.tubes = [];
    this.views = [];
    this.history = [];
    this.selected = null;
    this.moves = 0;
    this.started = false;
    this.busy = false;
    this.ended = false;
  }

  private drawInterface() {
    this.add.grid(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 34, 34, 0x09141d, 1, 0x6eb8d2, .08);
    [
      { x: 336, y: 91, radius: 11, color: 0x79e6ff, alpha: .08 },
      { x: 355, y: 116, radius: 5, color: 0x79e6ff, alpha: .16 },
      { x: 35, y: 585, radius: 9, color: 0x9b6bff, alpha: .1 },
      { x: 54, y: 610, radius: 4, color: 0xff8fbe, alpha: .18 },
    ].forEach((bubble) => {
      this.add.circle(bubble.x, bubble.y, bubble.radius, bubble.color, bubble.alpha)
        .setStrokeStyle(1, bubble.color, bubble.alpha + .08);
    });
    this.add.rectangle(WIDTH / 2, 24, WIDTH - 38, 1, 0xd8f5ff, .22);
    this.add.text(22, 35, "LIQUID / 008", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#79e6ff",
      letterSpacing: 2,
      fontStyle: "bold",
    });
    this.add.text(WIDTH - 22, 35, "益智", {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#8ba7b3",
    }).setOrigin(1, 0);
    this.add.text(22, 62, "水排序", {
      fontFamily: "sans-serif",
      fontSize: "38px",
      color: "#f3fbff",
      fontStyle: "bold",
    });
    this.add.text(24, 108, "把相同颜色的液体装进同一支试管", {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#8ba7b3",
    });

    Object.values(DIFFICULTIES).forEach((difficulty, index) => {
      const x = 78 + index * 117;
      const active = difficulty.id === this.difficultyId;
      const button = this.add.rectangle(x, 151, 108, 42, active ? 0x79e6ff : 0x102632)
        .setStrokeStyle(1.5, active ? 0x79e6ff : 0x41606d, 1)
        .setInteractive({ useHandCursor: true });
      this.add.text(x, 145, difficulty.label, {
        fontFamily: "sans-serif",
        fontSize: "13px",
        color: active ? "#09141d" : "#eaf9ff",
        fontStyle: "bold",
      }).setOrigin(.5);
      this.add.text(x, 162, `${difficulty.colors} 色 · ${difficulty.colors + 2} 瓶`, {
        fontFamily: "monospace",
        fontSize: "7px",
        color: active ? "#20414d" : "#8ba7b3",
      }).setOrigin(.5);
      button.on("pointerup", () => {
        if (difficulty.id !== this.difficultyId) this.scene.restart({ difficulty: difficulty.id });
      });
    });

    this.add.rectangle(WIDTH / 2, 211, WIDTH - 48, 58, 0x102632)
      .setStrokeStyle(1, 0x42616d, .7);
    this.movesText = this.add.text(42, 202, "00", this.statValueStyle());
    this.solvedText = this.add.text(WIDTH / 2, 202, `0/${this.difficulty.colors}`, this.statValueStyle()).setOrigin(.5, 0);
    const best = this.storage.load()[this.difficultyId];
    this.bestText = this.add.text(WIDTH - 42, 202, best ? String(best).padStart(2, "0") : "--", this.statValueStyle()).setOrigin(1, 0);
    this.add.text(42, 225, "步数", this.statLabelStyle());
    this.add.text(WIDTH / 2, 225, "完成", this.statLabelStyle()).setOrigin(.5, 0);
    this.add.text(WIDTH - 42, 225, "最佳", this.statLabelStyle()).setOrigin(1, 0);

    this.statusText = this.add.text(WIDTH / 2, 626, "先选择一支有颜色的试管", {
      fontFamily: "sans-serif",
      fontSize: "14px",
      color: "#eaf9ff",
      fontStyle: "bold",
    }).setOrigin(.5);
    this.add.text(WIDTH / 2, 651, "只能倒入空瓶或顶部同色的试管", {
      fontFamily: "sans-serif",
      fontSize: "10px",
      color: "#8ba7b3",
    }).setOrigin(.5);

    this.undoButton = this.add.rectangle(108, 697, 164, 50, 0x102632)
      .setStrokeStyle(1.5, 0x41606d)
      .setInteractive({ useHandCursor: true });
    this.undoText = this.add.text(108, 697, "↶  撤销", {
      fontFamily: "sans-serif",
      fontSize: "14px",
      color: "#718d98",
      fontStyle: "bold",
    }).setOrigin(.5);
    this.undoButton.on("pointerup", () => this.undoMove());

    const restart = this.add.rectangle(286, 697, 140, 50, 0x79e6ff)
      .setStrokeStyle(1.5, 0xbaf3ff)
      .setInteractive({ useHandCursor: true });
    this.add.text(286, 697, "重新打乱  ↻", {
      fontFamily: "sans-serif",
      fontSize: "14px",
      color: "#09141d",
      fontStyle: "bold",
    }).setOrigin(.5);
    restart.on("pointerup", () => this.scene.restart({ difficulty: this.difficultyId }));

    this.add.text(WIDTH / 2, HEIGHT - 40, "TAP · POUR · SORT  /  LOCAL BEST", {
      fontFamily: "monospace",
      fontSize: "9px",
      color: "#7895a1",
      letterSpacing: 1,
    }).setOrigin(.5);
  }

  private createPuzzle() {
    let bestCandidate: number[][] | null = null;
    let bestScore = -1;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const tubes: number[][] = Array.from(
        { length: this.difficulty.colors },
        (_, color) => Array(CAPACITY).fill(color),
      );
      tubes.push([], []);

      let completedMoves = 0;
      let guard = this.difficulty.scrambleMoves * 18;
      while (completedMoves < this.difficulty.scrambleMoves && guard > 0) {
        guard -= 1;
        const from = Phaser.Math.Between(0, tubes.length - 1);
        const source = tubes[from];
        if (source.length === 0) continue;

        const color = source[source.length - 1];
        const groupSize = this.topGroupSize(source);
        const maxRemovable = groupSize === source.length ? groupSize : groupSize - 1;
        if (maxRemovable <= 0) continue;

        const destinations = tubes
          .map((tube, index) => ({ tube, index }))
          .filter(({ tube, index }) => (
            index !== from
            && tube.length < CAPACITY
            && (tube.length === 0 || tube[tube.length - 1] !== color)
          ));
        if (destinations.length === 0) continue;

        const target = Phaser.Utils.Array.GetRandom(destinations);
        const amount = Phaser.Math.Between(1, Math.min(maxRemovable, CAPACITY - target.tube.length));
        const moved = source.splice(source.length - amount, amount);
        target.tube.push(...moved);
        completedMoves += 1;
      }

      const mixedTubes = tubes.filter((tube) => new Set(tube).size > 1).length;
      const candidateScore = completedMoves + mixedTubes * 12;
      if (mixedTubes > 0 && candidateScore > bestScore) {
        bestCandidate = cloneTubes(tubes);
        bestScore = candidateScore;
      }
      if (completedMoves >= this.difficulty.scrambleMoves * .8 && mixedTubes >= Math.max(2, this.difficulty.colors - 2)) {
        return Phaser.Utils.Array.Shuffle(tubes).map((tube) => [...tube]);
      }
    }

    return Phaser.Utils.Array.Shuffle(bestCandidate ?? this.createFallbackPuzzle()).map((tube) => [...tube]);
  }

  private createFallbackPuzzle() {
    const tubes: number[][] = Array.from(
      { length: this.difficulty.colors },
      (_, color) => Array(CAPACITY).fill(color),
    );
    tubes.push([], []);
    const emptyIndexes = [this.difficulty.colors, this.difficulty.colors + 1];
    emptyIndexes.forEach((targetIndex, pass) => {
      for (let offset = 0; offset < CAPACITY; offset += 1) {
        const color = (pass * CAPACITY + offset) % this.difficulty.colors;
        const moved = tubes[color].pop();
        if (moved !== undefined) tubes[targetIndex].push(moved);
      }
    });
    return tubes;
  }

  private createTubeViews() {
    const total = this.tubes.length;
    const columns = this.difficulty.columns;
    const rows = Math.ceil(total / columns);
    const rowY = rows === 1 ? [430] : [354, 512];

    this.views = this.tubes.map((_tube, index) => {
      const row = Math.floor(index / columns);
      const rowStart = row * columns;
      const countInRow = Math.min(columns, total - rowStart);
      const column = index - rowStart;
      const gap = columns === 5 ? 67 : columns === 4 ? 78 : 92;
      const x = WIDTH / 2 + (column - (countInRow - 1) / 2) * gap;
      const y = rowY[row] ?? 512;
      const graphics = this.add.graphics();
      const container = this.add.container(x, y, [graphics]);
      container.setSize(60, 146).setInteractive(
        new Phaser.Geom.Rectangle(-30, -72, 60, 146),
        Phaser.Geom.Rectangle.Contains,
      );
      if (container.input) container.input.cursor = "pointer";
      return { index, container, graphics, baseX: x, baseY: y };
    });
  }

  private handleBoardTap(pointer: Phaser.Input.Pointer) {
    if (this.busy || this.ended) return;
    const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const view = this.views.find((candidate) => (
      Math.abs(position.x - candidate.baseX) <= 31
      && Math.abs(position.y - candidate.baseY) <= 74
    ));
    if (!view) return;
    this.handleTubeTap(view.index);
  }

  private handleTubeTap(index: number) {
    const tube = this.tubes[index];
    if (this.selected === null) {
      if (tube.length === 0) {
        this.statusText.setText("这支试管是空的");
        return;
      }
      this.selectTube(index);
      return;
    }

    if (this.selected === index) {
      this.clearSelection();
      this.statusText.setText("已取消选择");
      return;
    }

    if (this.canPour(this.selected, index)) {
      this.performPour(this.selected, index);
      return;
    }

    if (tube.length > 0) {
      this.selectTube(index);
      this.statusText.setText("已切换试管");
    } else {
      this.statusText.setText("颜色不同，不能倒入这里").setColor("#ff8fbe");
      this.shakeView(this.views[this.selected]);
    }
  }

  private selectTube(index: number) {
    if (this.selected !== null) {
      const previous = this.views[this.selected];
      this.tweens.killTweensOf(previous.container);
      previous.container.setAngle(0);
      this.tweens.add({ targets: previous.container, y: previous.baseY, scale: 1, duration: 100 });
    }
    this.selected = index;
    const view = this.views[index];
    this.tweens.killTweensOf(view.container);
    this.tweens.add({ targets: view.container, y: view.baseY - 13, scale: 1.035, duration: 120, ease: "Quad.easeOut" });
    this.statusText.setText("再选择要倒入的试管").setColor("#eaf9ff");
    this.refreshAll();
  }

  private clearSelection() {
    if (this.selected === null) return;
    const view = this.views[this.selected];
    this.tweens.killTweensOf(view.container);
    view.container.setAngle(0);
    this.tweens.add({ targets: view.container, x: view.baseX, y: view.baseY, scale: 1, duration: 100 });
    this.selected = null;
    this.refreshAll();
  }

  private canPour(from: number, to: number) {
    const source = this.tubes[from];
    const target = this.tubes[to];
    if (source.length === 0 || target.length >= CAPACITY) return false;
    return target.length === 0 || target[target.length - 1] === source[source.length - 1];
  }

  private performPour(from: number, to: number) {
    const source = this.tubes[from];
    const target = this.tubes[to];
    const amount = Math.min(this.topGroupSize(source), CAPACITY - target.length);
    if (amount <= 0) return;

    this.history.push({ tubes: cloneTubes(this.tubes), moves: this.moves });
    this.moves += 1;
    this.busy = true;
    this.selected = null;
    const sourceView = this.views[from];
    const targetView = this.views[to];
    const direction = targetView.baseX >= sourceView.baseX ? 1 : -1;
    const color = source[source.length - 1];
    const pourX = targetView.baseX - direction * 55;
    const pourY = targetView.baseY - 34;

    this.tweens.killTweensOf(sourceView.container);
    sourceView.container.setDepth(30);
    this.statusText.setText("正在倾倒…").setColor("#79e6ff");
    this.tweens.add({
      targets: sourceView.container,
      x: sourceView.baseX,
      y: sourceView.baseY - 25,
      angle: 0,
      scale: 1.045,
      duration: 105,
      ease: "Quad.easeOut",
      onComplete: () => {
        this.tweens.add({
          targets: sourceView.container,
          x: pourX,
          y: pourY,
          angle: direction * 68,
          scale: 1.06,
          duration: 235,
          ease: "Sine.easeInOut",
          onComplete: () => this.animateLiquidFlow(source, target, sourceView, targetView, amount, color),
        });
      },
    });
  }

  private animateLiquidFlow(
    source: number[],
    target: number[],
    sourceView: TubeView,
    targetView: TubeView,
    amount: number,
    colorIndex: number,
  ) {
    const color = LIQUID_COLORS[colorIndex];
    const targetTop = targetView.baseY - TUBE_HEIGHT / 2 - 4;
    const flowDuration = 220 + amount * 58;
    const stream = this.add.rectangle(targetView.baseX, targetTop + 2, 7, 42, color, .96)
      .setOrigin(.5, 0)
      .setScale(1, 0)
      .setStrokeStyle(1, 0xffffff, .24)
      .setDepth(28);
    const glow = this.add.circle(targetView.baseX, targetTop + 35, 13, color, .14)
      .setScale(.4)
      .setDepth(27);

    this.tweens.add({
      targets: stream,
      scaleY: 1,
      duration: 85,
      ease: "Quad.easeOut",
    });
    this.tweens.add({
      targets: glow,
      scale: 1.15,
      alpha: .03,
      duration: flowDuration,
      ease: "Sine.easeOut",
    });

    [0, 72, 142].forEach((delay, index) => {
      const drop = this.add.circle(
        targetView.baseX + (index - 1) * 3,
        targetTop - 2,
        3 - index * .35,
        color,
        .95,
      ).setDepth(29);
      this.tweens.add({
        targets: drop,
        y: targetTop + 35,
        scale: .45,
        alpha: .35,
        duration: 190,
        delay,
        ease: "Quad.easeIn",
        onComplete: () => drop.destroy(),
      });
    });

    this.time.delayedCall(Math.round(flowDuration * .48), () => {
      const moved = source.splice(source.length - amount, amount);
      target.push(...moved);
      this.refreshAll();
      this.createSplash(targetView, color);
      this.tweens.add({
        targets: targetView.container,
        scaleX: 1.055,
        scaleY: .965,
        duration: 95,
        yoyo: true,
        ease: "Quad.easeOut",
      });
      navigator.vibrate?.(18);
    });

    this.time.delayedCall(flowDuration, () => {
      this.tweens.add({
        targets: [stream, glow],
        alpha: 0,
        duration: 75,
        onComplete: () => {
          stream.destroy();
          glow.destroy();
        },
      });
      this.tweens.add({
        targets: sourceView.container,
        x: sourceView.baseX,
        y: sourceView.baseY,
        angle: 0,
        scale: 1,
        duration: 265,
        ease: "Back.easeOut",
        onComplete: () => {
          sourceView.container.setDepth(0);
          this.finishPour();
        },
      });
    });
  }

  private createSplash(targetView: TubeView, color: number) {
    const y = targetView.baseY - TUBE_HEIGHT / 2 + 12;
    [-9, -4, 4, 9].forEach((offset, index) => {
      const splash = this.add.circle(targetView.baseX + offset * .25, y, index % 2 === 0 ? 3 : 2.2, color, .9)
        .setDepth(29);
      this.tweens.add({
        targets: splash,
        x: targetView.baseX + offset,
        y: y - 10 - Math.abs(offset) * .35,
        scale: .35,
        alpha: 0,
        duration: 230,
        ease: "Quad.easeOut",
        onComplete: () => splash.destroy(),
      });
    });
  }

  private finishPour() {
    this.busy = false;
    this.refreshAll();
    if (!this.started) {
      this.started = true;
      this.bridge.started();
    }
    this.bridge.score(this.moves * 10);

    if (this.isSolved()) {
      this.finishGame();
    } else {
      this.statusText.setText("继续整理颜色").setColor("#eaf9ff");
    }
  }

  private undoMove() {
    if (this.busy || this.ended) return;
    const snapshot = this.history.pop();
    if (!snapshot) {
      this.statusText.setText("还没有可以撤销的步骤").setColor("#6f8994");
      return;
    }
    this.clearSelection();
    this.tubes = cloneTubes(snapshot.tubes);
    this.moves = snapshot.moves;
    this.views.forEach((view) => {
      this.tweens.killTweensOf(view.container);
      view.container.setPosition(view.baseX, view.baseY).setScale(1).setAngle(0);
    });
    this.refreshAll();
    this.statusText.setText("已撤销上一步").setColor("#79e6ff");
    this.bridge.score(this.moves * 10);
  }

  private refreshAll() {
    this.views.forEach((view) => this.drawTube(view));
    this.movesText?.setText(String(this.moves).padStart(2, "0"));
    const complete = this.tubes.filter((tube) => this.isCompleteTube(tube)).length;
    this.solvedText?.setText(`${complete}/${this.difficulty.colors}`);
    const enabled = this.history.length > 0 && !this.busy && !this.ended;
    this.undoButton?.setStrokeStyle(1.5, enabled ? 0x79e6ff : 0x41606d);
    this.undoText?.setColor(enabled ? "#79e6ff" : "#718d98");
  }

  private drawTube(view: TubeView) {
    const graphics = view.graphics;
    const tube = this.tubes[view.index];
    graphics.clear();

    if (this.selected === view.index) {
      graphics.fillStyle(0x79e6ff, .11);
      graphics.fillRoundedRect(-31, -69, 62, 138, 17);
      graphics.lineStyle(1, 0x79e6ff, .42);
      graphics.strokeRoundedRect(-31, -69, 62, 138, 17);
    }

    graphics.fillStyle(0xd8f5ff, .035);
    graphics.fillRoundedRect(-TUBE_WIDTH / 2, -TUBE_HEIGHT / 2, TUBE_WIDTH, TUBE_HEIGHT, 15);

    tube.forEach((colorIndex, level) => {
      const y = TUBE_HEIGHT / 2 - 9 - (level + 1) * SEGMENT_HEIGHT;
      graphics.fillStyle(LIQUID_COLORS[colorIndex], 1);
      graphics.fillRoundedRect(-TUBE_WIDTH / 2 + 5, y, TUBE_WIDTH - 10, SEGMENT_HEIGHT + 1, level === 0 ? 7 : 3);
      graphics.fillStyle(0xffffff, .2);
      graphics.fillRoundedRect(-TUBE_WIDTH / 2 + 9, y + 4, 4, SEGMENT_HEIGHT - 8, 2);
    });
    if (tube.length > 0) {
      const topColor = LIQUID_COLORS[tube[tube.length - 1]];
      const surfaceY = TUBE_HEIGHT / 2 - 8 - tube.length * SEGMENT_HEIGHT;
      graphics.fillStyle(topColor, 1);
      graphics.fillEllipse(0, surfaceY, TUBE_WIDTH - 10, 8);
      graphics.fillStyle(0xffffff, .26);
      graphics.fillEllipse(-7, surfaceY - 1, 12, 3);
    }

    graphics.lineStyle(2.5, 0xe7faff, .9);
    graphics.strokeRoundedRect(-TUBE_WIDTH / 2, -TUBE_HEIGHT / 2, TUBE_WIDTH, TUBE_HEIGHT, 15);
    graphics.lineStyle(6, 0x09141d, 1);
    graphics.lineBetween(-13, -TUBE_HEIGHT / 2, 13, -TUBE_HEIGHT / 2);
    graphics.lineStyle(2, 0x79e6ff, .78);
    graphics.lineBetween(-14, -TUBE_HEIGHT / 2 - 2, 14, -TUBE_HEIGHT / 2 - 2);
    graphics.lineStyle(1, 0xffffff, .3);
    graphics.lineBetween(-TUBE_WIDTH / 2 + 6, -TUBE_HEIGHT / 2 + 14, -TUBE_WIDTH / 2 + 6, TUBE_HEIGHT / 2 - 18);
  }

  private shakeView(view: TubeView) {
    this.tweens.add({
      targets: view.container,
      x: { from: view.container.x - 4, to: view.container.x + 4 },
      duration: 48,
      yoyo: true,
      repeat: 2,
      onComplete: () => view.container.setX(view.baseX),
    });
    navigator.vibrate?.(35);
  }

  private topGroupSize(tube: number[]) {
    if (tube.length === 0) return 0;
    const color = tube[tube.length - 1];
    let count = 1;
    for (let index = tube.length - 2; index >= 0 && tube[index] === color; index -= 1) count += 1;
    return count;
  }

  private isCompleteTube(tube: number[]) {
    return tube.length === CAPACITY && tube.every((color) => color === tube[0]);
  }

  private isSolved() {
    return this.tubes.every((tube) => tube.length === 0 || this.isCompleteTube(tube));
  }

  private finishGame() {
    this.ended = true;
    this.busy = false;
    const saved = this.storage.load();
    const previousBest = saved[this.difficultyId];
    const best = previousBest === 0 ? this.moves : Math.min(previousBest, this.moves);
    this.storage.save({ ...saved, [this.difficultyId]: best });
    this.bestText.setText(String(best).padStart(2, "0"));
    const score = Math.max(200, this.difficulty.colors * 900 - this.moves * 35);
    this.bridge.score(score);
    this.bridge.gameOver(score);
    navigator.vibrate?.([35, 35, 80]);
    this.showResult(score, previousBest === 0 || this.moves < previousBest);
  }

  private showResult(score: number, newBest: boolean) {
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x061016, .78).setDepth(100);
    const panel = this.add.rectangle(WIDTH / 2, 432, 310, 268, 0x102632)
      .setStrokeStyle(2, 0x79e6ff, .9)
      .setDepth(101);
    const badge = this.add.circle(WIDTH / 2, 350, 29, 0x79e6ff)
      .setStrokeStyle(2, 0xd8f5ff, .6)
      .setDepth(102);
    this.add.text(WIDTH / 2, 350, "✓", {
      fontFamily: "sans-serif",
      fontSize: "27px",
      color: "#09141d",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    this.add.text(WIDTH / 2, 397, "全部分好啦！", {
      fontFamily: "sans-serif",
      fontSize: "27px",
      color: "#f3fbff",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    this.add.text(WIDTH / 2, 436, `${this.difficulty.label} · ${this.moves} 步 · ${score} 分`, {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#85a0aa",
      letterSpacing: 1,
    }).setOrigin(.5).setDepth(102);
    this.add.text(WIDTH / 2, 465, newBest ? "NEW BEST" : "SORT COMPLETE", {
      fontFamily: "monospace",
      fontSize: "9px",
      color: newBest ? "#dfff3f" : "#79e6ff",
      letterSpacing: 2,
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(102);
    const replay = this.add.rectangle(WIDTH / 2, 521, 202, 48, 0x79e6ff)
      .setStrokeStyle(1, 0xd8f5ff, .6)
      .setInteractive({ useHandCursor: true })
      .setDepth(102);
    this.add.text(WIDTH / 2, 521, "再玩一局  ↻", {
      fontFamily: "sans-serif",
      fontSize: "14px",
      color: "#09141d",
      fontStyle: "bold",
    }).setOrigin(.5).setDepth(103);
    replay.on("pointerup", () => this.scene.restart({ difficulty: this.difficultyId }));
    sharpenSceneText(this.children, RENDER_DPR);
    this.tweens.add({
      targets: [shade, panel, badge, replay],
      alpha: { from: 0, to: 1 },
      duration: 190,
    });
  }

  private statValueStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: "monospace", fontSize: "19px", color: "#eaf9ff", fontStyle: "bold" };
  }

  private statLabelStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: "sans-serif", fontSize: "8px", color: "#8ba7b3" };
  }

}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  backgroundColor: "#09141d",
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: WaterSortScene,
});
