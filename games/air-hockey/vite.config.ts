import { defineConfig } from "vite";
export default defineConfig({ base: "/games/air-hockey/", build: { outDir: "../../public/games/air-hockey", emptyOutDir: true, target: "es2020" } });
