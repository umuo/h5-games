import { defineConfig } from "vite";
export default defineConfig({ base: "/games/gold-miner/", build: { outDir: "../../public/games/gold-miner", emptyOutDir: true, target: "es2020" } });
