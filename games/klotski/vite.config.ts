import { defineConfig } from "vite";
export default defineConfig({ base: "/games/klotski/", build: { outDir: "../../public/games/klotski", emptyOutDir: true, target: "es2020" } });
