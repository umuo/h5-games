import { defineConfig } from "vite";
export default defineConfig({ base: "/games/mini-sudoku/", build: { outDir: "../../public/games/mini-sudoku", emptyOutDir: true, target: "es2020" } });
