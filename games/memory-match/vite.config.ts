import { defineConfig } from "vite";
export default defineConfig({ base: "/games/memory-match/", build: { outDir: "../../public/games/memory-match", emptyOutDir: true, target: "es2020" } });
