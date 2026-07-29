import { defineConfig } from "vite";
export default defineConfig({ base: "/games/minesweeper/", build: { outDir: "../../public/games/minesweeper", emptyOutDir: true, target: "es2020" } });
