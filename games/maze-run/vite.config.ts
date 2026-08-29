import { defineConfig } from "vite";
export default defineConfig({ base: "/games/maze-run/", build: { outDir: "../../public/games/maze-run", emptyOutDir: true, target: "es2020" } });
