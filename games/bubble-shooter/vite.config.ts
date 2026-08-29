import { defineConfig } from "vite";
export default defineConfig({ base: "/games/bubble-shooter/", build: { outDir: "../../public/games/bubble-shooter", emptyOutDir: true, target: "es2020" } });
