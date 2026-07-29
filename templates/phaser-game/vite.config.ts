import { defineConfig } from "vite";
export default defineConfig({ base: "/games/__GAME_ID__/", build: { outDir: "../../public/games/__GAME_ID__", emptyOutDir: true, target: "es2020" } });
