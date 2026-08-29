import { defineConfig } from "vite";
export default defineConfig({ base: "/games/mini-golf/", build: { outDir: "../../public/games/mini-golf", emptyOutDir: true, target: "es2020" } });
