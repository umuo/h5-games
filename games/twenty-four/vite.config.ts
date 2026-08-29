import { defineConfig } from "vite";
export default defineConfig({ base: "/games/twenty-four/", build: { outDir: "../../public/games/twenty-four", emptyOutDir: true, target: "es2020" } });
