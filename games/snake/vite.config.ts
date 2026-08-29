import { defineConfig } from "vite";
export default defineConfig({ base: "/games/snake/", build: { outDir: "../../public/games/snake", emptyOutDir: true, target: "es2020" } });
