import { defineConfig } from "vite";

export default defineConfig({
  base: "/games/pulse/",
  build: {
    outDir: "../../public/games/pulse",
    emptyOutDir: true,
    target: "es2020",
  },
});
