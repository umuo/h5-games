import { access, cp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const id = args[0];
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error("用法：npm run game:new -- <game-id> [--title 游戏名] [--orientation portrait|landscape]");
  process.exit(1);
}

const title = option("--title", id.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "));
const orientation = option("--orientation", "portrait");
if (!["portrait", "landscape", "any"].includes(orientation)) {
  console.error("orientation 只能是 portrait、landscape 或 any");
  process.exit(1);
}

const source = path.join(root, "templates/phaser-game");
const target = path.join(root, "games", id);
try {
  await access(target);
  console.error(`游戏 ${id} 已存在。`);
  process.exit(1);
} catch { /* Target is available. */ }

await cp(source, target, { recursive: true });
await rename(path.join(target, "package.json.template"), path.join(target, "package.json"));

async function replaceInTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await replaceInTree(file);
    else {
      const original = await readFile(file, "utf8");
      const next = original
        .replaceAll("__GAME_ID_UPPER__", id.replaceAll("-", " ").toUpperCase())
        .replaceAll("__GAME_ID__", id)
        .replaceAll("__GAME_TITLE__", title)
        .replaceAll("__GAME_WIDTH__", orientation === "landscape" ? "844" : "390")
        .replaceAll("__GAME_HEIGHT__", orientation === "landscape" ? "390" : "844")
        .replaceAll("__ORIENTATION__", orientation);
      await writeFile(file, next);
    }
  }
}

await replaceInTree(target);
spawnSync(process.execPath, [path.join(root, "tooling/generate-catalog/index.mjs")], { stdio: "inherit" });
console.log(`\n✓ 已创建 games/${id}`);
console.log(`  npm install`);
console.log(`  npm run game:dev -- ${id}`);
