import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("every game has a unique valid manifest and workspace package", async () => {
  const root = new URL("../games/", import.meta.url);
  const entries = await readdir(root, { withFileTypes: true });
  const ids = new Set();
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const manifest = JSON.parse(await readFile(new URL(`${entry.name}/public/game.json`, root), "utf8"));
    const packageJson = JSON.parse(await readFile(new URL(`${entry.name}/package.json`, root), "utf8"));
    assert.match(manifest.id, /^[a-z][a-z0-9-]*$/);
    assert.equal(manifest.id, entry.name);
    assert.equal(packageJson.name, `@web-games/game-${entry.name}`);
    assert.equal(ids.has(manifest.id), false, `duplicate game id: ${manifest.id}`);
    ids.add(manifest.id);
  }
  assert.ok(ids.size > 0, "at least one playable game is required");

  const iframeRoot = new URL("../catalog/iframe/", import.meta.url);
  const iframeEntries = await readdir(iframeRoot, { withFileTypes: true });
  for (const entry of iframeEntries.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
    const manifest = JSON.parse(await readFile(new URL(entry.name, iframeRoot), "utf8"));
    assert.match(manifest.id, /^[a-z][a-z0-9-]*$/);
    assert.equal(ids.has(manifest.id), false, `duplicate game id: ${manifest.id}`);
    assert.equal(manifest.launchMode, "iframe");
    assert.equal(new URL(manifest.embedUrl).protocol, "https:");
    assert.match(manifest.path, /^\/play\/[a-z][a-z0-9-]*$/);
    ids.add(manifest.id);
  }
});

test("catch-the-cat preserves its upstream MIT attribution", async () => {
  const license = await readFile(new URL("../games/catch-the-cat/LICENSE.upstream", import.meta.url), "utf8");
  const notice = await readFile(new URL("../games/catch-the-cat/NOTICE.md", import.meta.url), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2021 Ganlv/);
  assert.match(notice, /ganlvtech\/phaser-catch-the-cat/);
});
