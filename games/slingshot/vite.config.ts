import { defineConfig } from "vite";
export default defineConfig({ base: "/games/slingshot/", build: { outDir: "../../public/games/slingshot", emptyOutDir: true, target: "es2020" } });
