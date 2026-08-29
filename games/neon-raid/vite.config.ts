import { defineConfig } from "vite";
export default defineConfig({ base: "/games/neon-raid/", build: { outDir: "../../public/games/neon-raid", emptyOutDir: true, target: "es2020" } });
