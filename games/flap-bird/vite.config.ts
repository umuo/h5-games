import { defineConfig } from "vite";
export default defineConfig({ base: "/games/flap-bird/", build: { outDir: "../../public/games/flap-bird", emptyOutDir: true, target: "es2020" } });
