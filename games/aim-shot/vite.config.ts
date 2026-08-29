import { defineConfig } from "vite";
export default defineConfig({ base: "/games/aim-shot/", build: { outDir: "../../public/games/aim-shot", emptyOutDir: true, target: "es2020" } });
