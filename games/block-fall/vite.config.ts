import { defineConfig } from "vite";
export default defineConfig({ base: "/games/block-fall/", build: { outDir: "../../public/games/block-fall", emptyOutDir: true, target: "es2020" } });
