import { defineConfig } from "vite";
export default defineConfig({ base: "/games/mini-billiards/", build: { outDir: "../../public/games/mini-billiards", emptyOutDir: true, target: "es2020" } });
