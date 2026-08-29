import { defineConfig } from "vite";
export default defineConfig({ base: "/games/penalty-kick/", build: { outDir: "../../public/games/penalty-kick", emptyOutDir: true, target: "es2020" } });
