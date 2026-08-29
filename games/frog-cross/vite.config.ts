import { defineConfig } from "vite";
export default defineConfig({ base: "/games/frog-cross/", build: { outDir: "../../public/games/frog-cross", emptyOutDir: true, target: "es2020" } });
