import { defineConfig } from "vite";
export default defineConfig({ base: "/games/peg-solitaire/", build: { outDir: "../../public/games/peg-solitaire", emptyOutDir: true, target: "es2020" } });
