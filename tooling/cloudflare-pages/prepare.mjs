import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const clientRoot = path.join(root, "dist/client");
const serverRoot = path.join(root, "dist/server");
const outputRoot = path.join(root, ".wrangler/pages");

await readFile(path.join(serverRoot, "index.js"), "utf8");
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(clientRoot, outputRoot, { recursive: true, force: true });
await cp(path.join(serverRoot, "index.js"), path.join(outputRoot, "index.js"), { force: true });
await cp(
  path.join(serverRoot, "__vite_rsc_assets_manifest.js"),
  path.join(outputRoot, "__vite_rsc_assets_manifest.js"),
  { force: true },
);
await cp(path.join(serverRoot, "ssr"), path.join(outputRoot, "ssr"), { recursive: true, force: true });
await cp(path.join(serverRoot, "assets"), path.join(outputRoot, "assets"), { recursive: true, force: true });

for (const file of ["image-config.json", "vinext-externals.json", "vinext-server.json"]) {
  await cp(path.join(serverRoot, file), path.join(outputRoot, file), { force: true });
}

const builtGamesRoot = path.join(outputRoot, "games");
const builtGames = await readdir(builtGamesRoot, { withFileTypes: true });
for (const game of builtGames.filter((entry) => entry.isDirectory())) {
  await cp(
    path.join(builtGamesRoot, game.name, "index.html"),
    path.join(builtGamesRoot, game.name, "__entry.game"),
    { force: true },
  );
}

const pagesWorker = `import app from "./index.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/games/")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const isGameDocument = segments.length === 2;
      if (isGameDocument) url.pathname = \`/games/\${segments[1]}/__entry.game\`;
      const assetResponse = await env.ASSETS.fetch(new Request(url, request));
      if (assetResponse.status !== 404) {
        if (!isGameDocument) return assetResponse;
        const headers = new Headers(assetResponse.headers);
        headers.set("Content-Type", "text/html; charset=utf-8");
        return new Response(request.method === "HEAD" ? null : assetResponse.body, {
          status: assetResponse.status,
          headers,
        });
      }
    }
    return app.fetch(request, env, ctx);
  },
};
`;
await writeFile(path.join(outputRoot, "_worker.js"), pagesWorker);

const existingIgnore = await readFile(path.join(outputRoot, ".assetsignore"), "utf8");
const serverOnlyFiles = [
  "_worker.js",
  "index.js",
  "__vite_rsc_assets_manifest.js",
  "ssr",
  "image-config.json",
  "vinext-externals.json",
  "vinext-server.json",
];
await writeFile(
  path.join(outputRoot, ".assetsignore"),
  `${existingIgnore.trim()}\n${serverOnlyFiles.join("\n")}\n`,
);

console.log(`Cloudflare Pages bundle prepared at ${path.relative(root, outputRoot)}.`);
