import { defineConfig } from "vite";

export default defineConfig({
  base: "/games/sokoban/",
  plugins: [
    {
      name: "sokoban-versioned-entry-assets",
      transformIndexHtml(html) {
        return html.replace(
          /(\/games\/sokoban\/assets\/index-[^"']+\.(?:js|css))(["'])/g,
          "$1?v=1.0.2$2",
        );
      },
    },
  ],
  build: {
    outDir: "../../public/games/sokoban",
    emptyOutDir: true,
    target: "es2020",
  },
});
