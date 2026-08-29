import { defineConfig } from "vite";
export default defineConfig({ base: "/games/lights-out/", build: { outDir: "../../public/games/lights-out", emptyOutDir: true, target: "es2020" } });
