import { defineConfig } from "vite";
export default defineConfig({ base: "/games/pipe-connect/", build: { outDir: "../../public/games/pipe-connect", emptyOutDir: true, target: "es2020" } });
