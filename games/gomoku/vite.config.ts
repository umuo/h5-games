import { defineConfig } from "vite";
export default defineConfig({ base: "/games/gomoku/", build: { outDir: "../../public/games/gomoku", emptyOutDir: true, target: "es2020" } });
