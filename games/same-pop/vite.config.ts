import { defineConfig } from "vite";
export default defineConfig({ base: "/games/same-pop/", build: { outDir: "../../public/games/same-pop", emptyOutDir: true, target: "es2020" } });
