import { defineConfig } from "vite";
export default defineConfig({ base: "/games/lunar-lander/", build: { outDir: "../../public/games/lunar-lander", emptyOutDir: true, target: "es2020" } });
