import { defineConfig } from "vite";
export default defineConfig({ base: "/games/slide-puzzle/", build: { outDir: "../../public/games/slide-puzzle", emptyOutDir: true, target: "es2020" } });
