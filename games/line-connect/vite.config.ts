import { defineConfig } from "vite";

export default defineConfig({
  base: "/games/line-connect/",
  plugins: [
    {
      name: "line-connect-versioned-entry-assets",
      transformIndexHtml(html) {
        return html.replace(
          /(\/games\/line-connect\/assets\/index-[^"']+\.(?:js|css))(["'])/g,
          "$1?v=1.0.0$2",
        );
      },
    },
  ],
  build: {
    outDir: "../../public/games/line-connect",
    emptyOutDir: true,
    target: "es2020",
  },
});
