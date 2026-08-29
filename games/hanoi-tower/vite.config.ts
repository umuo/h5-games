import { defineConfig } from "vite";
export default defineConfig({ base: "/games/hanoi-tower/", build: { outDir: "../../public/games/hanoi-tower", emptyOutDir: true, target: "es2020" } });
