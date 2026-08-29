import { defineConfig } from "vite";
export default defineConfig({ base: "/games/nim-stones/", build: { outDir: "../../public/games/nim-stones", emptyOutDir: true, target: "es2020" } });
