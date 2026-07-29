import { defineConfig } from "vite";
export default defineConfig({ base: "/games/thunder-strike/", build: { outDir: "../../public/games/thunder-strike", emptyOutDir: true, target: "es2020" } });
