import { defineConfig } from "vite";
export default defineConfig({ base: "/games/breakout/", build: { outDir: "../../public/games/breakout", emptyOutDir: true, target: "es2020" } });
