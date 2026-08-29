import { defineConfig } from "vite";
export default defineConfig({ base: "/games/tic-tac-toe/", build: { outDir: "../../public/games/tic-tac-toe", emptyOutDir: true, target: "es2020" } });
