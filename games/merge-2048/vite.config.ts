import { defineConfig } from "vite";
export default defineConfig({ base: "/games/merge-2048/", build: { outDir: "../../public/games/merge-2048", emptyOutDir: true, target: "es2020" } });
