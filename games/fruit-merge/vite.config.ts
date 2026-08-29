import { defineConfig } from "vite";
export default defineConfig({ base: "/games/fruit-merge/", build: { outDir: "../../public/games/fruit-merge", emptyOutDir: true, target: "es2020" } });
