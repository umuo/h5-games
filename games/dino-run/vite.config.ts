import { defineConfig } from "vite";
export default defineConfig({ base: "/games/dino-run/", build: { outDir: "../../public/games/dino-run", emptyOutDir: true, target: "es2020" } });
