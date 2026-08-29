import { defineConfig } from "vite";
export default defineConfig({ base: "/games/gem-match/", build: { outDir: "../../public/games/gem-match", emptyOutDir: true, target: "es2020" } });
