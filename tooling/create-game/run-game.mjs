import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [command, id] = process.argv.slice(2);
if (!command || !id) {
  console.error("用法：npm run game:dev -- <game-id>");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageJson = JSON.parse(await readFile(path.join(root, "games", id, "package.json"), "utf8"));
const result = spawnSync("npm", ["run", command, "--workspace", packageJson.name], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
