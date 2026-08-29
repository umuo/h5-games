import { defineConfig } from "vite";
export default defineConfig({ base: "/games/one-stroke/", build: { outDir: "../../public/games/one-stroke", emptyOutDir: true, target: "es2020" } });
