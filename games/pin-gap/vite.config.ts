import { defineConfig } from "vite";
export default defineConfig({ base: "/games/pin-gap/", build: { outDir: "../../public/games/pin-gap", emptyOutDir: true, target: "es2020" } });
