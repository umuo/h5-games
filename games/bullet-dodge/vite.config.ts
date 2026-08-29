import { defineConfig } from "vite";
export default defineConfig({ base: "/games/bullet-dodge/", build: { outDir: "../../public/games/bullet-dodge", emptyOutDir: true, target: "es2020" } });
