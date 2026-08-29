import { defineConfig } from "vite";
export default defineConfig({ base: "/games/beat-line/", build: { outDir: "../../public/games/beat-line", emptyOutDir: true, target: "es2020" } });
