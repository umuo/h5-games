import { defineConfig } from "vite";
export default defineConfig({ base: "/games/basket-catch/", build: { outDir: "../../public/games/basket-catch", emptyOutDir: true, target: "es2020" } });
