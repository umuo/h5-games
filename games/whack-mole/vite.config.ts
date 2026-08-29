import { defineConfig } from "vite";
export default defineConfig({ base: "/games/whack-mole/", build: { outDir: "../../public/games/whack-mole", emptyOutDir: true, target: "es2020" } });
