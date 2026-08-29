import { defineConfig } from "vite";
export default defineConfig({ base: "/games/pendulum-jump/", build: { outDir: "../../public/games/pendulum-jump", emptyOutDir: true, target: "es2020" } });
