import { defineConfig } from "vite";
export default defineConfig({ base: "/games/chain-reaction/", build: { outDir: "../../public/games/chain-reaction", emptyOutDir: true, target: "es2020" } });
