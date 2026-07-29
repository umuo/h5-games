import { defineConfig } from "vite";
export default defineConfig({ base: "/games/catch-the-cat/", build: { outDir: "../../public/games/catch-the-cat", emptyOutDir: true, target: "es2020" } });
