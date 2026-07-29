import Phaser from "phaser";
import { createGameBridge } from "@web-games/game-sdk";
import "./style.css";

const WIDTH = __GAME_WIDTH__;
const HEIGHT = __GAME_HEIGHT__;

class MainScene extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#101114");
    this.add.text(WIDTH / 2, HEIGHT / 2 - 24, "__GAME_TITLE__", { color: "#dfff3f", fontFamily: "sans-serif", fontSize: "28px", fontStyle: "bold" }).setOrigin(.5);
    this.add.text(WIDTH / 2, HEIGHT / 2 + 28, "从这里开始你的玩法", { color: "#f3f0e8", fontFamily: "sans-serif", fontSize: "15px" }).setOrigin(.5);
    createGameBridge({ gameId: "__GAME_ID__", version: "0.1.0" }).ready();
  }
}

new Phaser.Game({ type: Phaser.AUTO, parent: "game-root", width: WIDTH, height: HEIGHT, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: MainScene });
