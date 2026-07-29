import Phaser from "phaser";
import {
  configureHiDpiCamera,
  createGameBridge,
  getGameRenderDpr,
  sharpenSceneText,
} from "@web-games/game-sdk";
import "./style.css";

const WIDTH = __GAME_WIDTH__;
const HEIGHT = __GAME_HEIGHT__;
const RENDER_DPR = getGameRenderDpr();

class MainScene extends Phaser.Scene {
  create() {
    configureHiDpiCamera(this.cameras.main, WIDTH, HEIGHT, RENDER_DPR);
    this.cameras.main.setBackgroundColor("#101114");
    this.add.text(WIDTH / 2, HEIGHT / 2 - 24, "__GAME_TITLE__", { color: "#dfff3f", fontFamily: "sans-serif", fontSize: "28px", fontStyle: "bold" }).setOrigin(.5);
    this.add.text(WIDTH / 2, HEIGHT / 2 + 28, "从这里开始你的玩法", { color: "#f3f0e8", fontFamily: "sans-serif", fontSize: "15px" }).setOrigin(.5);
    sharpenSceneText(this.children, RENDER_DPR);
    createGameBridge({ gameId: "__GAME_ID__", version: "0.1.0" }).ready();
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: WIDTH * RENDER_DPR,
  height: HEIGHT * RENDER_DPR,
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH * RENDER_DPR,
    height: HEIGHT * RENDER_DPR,
  },
  scene: MainScene,
});
