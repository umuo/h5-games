import { defineConfig } from "vite";
export default defineConfig({ base: "/games/reversi/", build: { outDir: "../../public/games/reversi", emptyOutDir: true, target: "es2020" } });
