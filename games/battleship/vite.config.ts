import { defineConfig } from "vite";
export default defineConfig({ base: "/games/battleship/", build: { outDir: "../../public/games/battleship", emptyOutDir: true, target: "es2020" } });
