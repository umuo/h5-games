import { defineConfig } from "vite";
export default defineConfig({ base: "/games/sky-hop/", build: { outDir: "../../public/games/sky-hop", emptyOutDir: true, target: "es2020" } });
