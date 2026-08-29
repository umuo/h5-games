import { defineConfig } from "vite";
export default defineConfig({ base: "/games/six-guess/", build: { outDir: "../../public/games/six-guess", emptyOutDir: true, target: "es2020" } });
