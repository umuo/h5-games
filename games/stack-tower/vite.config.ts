import { defineConfig } from "vite";
export default defineConfig({ base: "/games/stack-tower/", build: { outDir: "../../public/games/stack-tower", emptyOutDir: true, target: "es2020" } });
