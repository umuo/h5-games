import { defineConfig } from "vite";
export default defineConfig({ base: "/games/memory-sequence/", build: { outDir: "../../public/games/memory-sequence", emptyOutDir: true, target: "es2020" } });
