import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const gameIcons = new Set(["cat", "pin", "pulse", "cloud", "memory", "mine", "shooter", "water", "sokoban", "connect", "undercover", "arcade"]);

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
    assert.equal(gameIcons.has(manifest.icon), true, `invalid game icon: ${manifest.icon}`);
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
    assert.equal(gameIcons.has(manifest.icon), true, `invalid game icon: ${manifest.icon}`);
    assert.equal(new URL(manifest.embedUrl).protocol, "https:");
    assert.match(manifest.path, /^\/play\/[a-z][a-z0-9-]*$/);
    ids.add(manifest.id);
  }
});

test("undercover is registered as a distinct embeddable party game", async () => {
  const manifest = JSON.parse(await readFile(new URL("../catalog/iframe/undercover.json", import.meta.url), "utf8"));
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.equal(manifest.title, "谁是卧底");
  assert.equal(manifest.category, "休闲");
  assert.equal(manifest.icon, "undercover");
  assert.equal(manifest.embedUrl, "https://undercover.lacknb.com/");
  assert.match(styles, /\.game-icon-undercover/);
});

test("catch-the-cat preserves its upstream MIT attribution", async () => {
  const license = await readFile(new URL("../games/catch-the-cat/LICENSE.upstream", import.meta.url), "utf8");
  const notice = await readFile(new URL("../games/catch-the-cat/NOTICE.md", import.meta.url), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2021 Ganlv/);
  assert.match(notice, /ganlvtech\/phaser-catch-the-cat/);
});

test("catch-the-cat always starts from a playable layout and uses its mascot sprite", async () => {
  const source = await readFile(new URL("../games/catch-the-cat/src/main.ts", import.meta.url), "utf8");
  assert.match(source, /this\.load\.image\("cat-mascot",\s*"assets\/cat-mascot\.png"\)/);
  assert.match(source, /foundPlayableLayout/);
  assert.match(source, /if\s*\(!foundPlayableLayout\)/);
  assert.match(source, /getByName\("mascot"\)/);
});

test("the portal prevents trailing mobile overscroll", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.portal-page\s*\{[^}]*min-height:\s*100dvh/s);
  assert.match(styles, /overscroll-behavior-y:\s*none/);
  assert.doesNotMatch(styles, /\.games-section\s*\{[^}]*min-height:\s*calc\(100dvh/s);
});

test("minesweeper ships mobile difficulty levels and first-tap protection", async () => {
  const source = await readFile(new URL("../games/minesweeper/src/main.ts", import.meta.url), "utf8");
  assert.match(source, /easy:\s*\{[^}]*rows:\s*8,[^}]*columns:\s*8,[^}]*mines:\s*10/s);
  assert.match(source, /normal:\s*\{[^}]*rows:\s*12,[^}]*columns:\s*12,[^}]*mines:\s*24/s);
  assert.match(source, /hard:\s*\{[^}]*rows:\s*16,[^}]*columns:\s*16,[^}]*mines:\s*48/s);
  assert.match(source, /this\.placeMines\(cell\)/);
  assert.match(source, /this\.neighbors\(firstCell,\s*true\)/);
  assert.match(source, /delayedCall\(430/);
  assert.match(source, /private chordCell\(cell:\s*MineCell\)/);
  assert.match(source, /flagged !== cell\.adjacent/);
  assert.match(source, /已连开周围安全区域/);
});

test("local puzzle games clean up global lifecycle listeners on restart", async () => {
  for (const gameId of ["pin-gap", "pulse", "memory-match", "minesweeper"]) {
    const source = await readFile(new URL(`../games/${gameId}/src/main.ts`, import.meta.url), "utf8");
    assert.match(source, /Phaser\.Scenes\.Events\.SHUTDOWN/, `${gameId} must handle scene shutdown`);
    assert.match(source, /game\.events\.off\(Phaser\.Core\.Events\.BLUR/, `${gameId} must remove blur listener`);
    assert.match(source, /game\.events\.off\(Phaser\.Core\.Events\.FOCUS/, `${gameId} must remove focus listener`);
  }
});

test("memory match loads eight generated card-face assets", async () => {
  const source = await readFile(new URL("../games/memory-match/src/main.ts", import.meta.url), "utf8");
  assert.match(source, /memory-rocket/);
  assert.match(source, /memory-note/);
  assert.match(source, /SYMBOLS\.forEach/);
  assert.match(source, /this\.load\.image\(symbol\.key/);
  assert.match(source, /this\.add\.image\(0,\s*-6,\s*symbol\.key\)/);
});

test("memory match uses an explicit mobile-safe card hit area", async () => {
  const source = await readFile(new URL("../games/memory-match/src/main.ts", import.meta.url), "utf8");
  assert.match(source, /new Phaser\.Geom\.Rectangle\(-CARD_WIDTH \/ 2,\s*-CARD_HEIGHT \/ 2/);
  assert.match(source, /this\.input\.on\("pointerup",\s*handleBoardPointer\)/);
  assert.match(source, /private handleBoardTap\(pointer:\s*Phaser\.Input\.Pointer\)/);
  assert.match(source, /pointer\.positionToCamera\(this\.cameras\.main\)/);
  assert.match(source, /Math\.abs\(position\.x - candidate\.container\.x\) <= CARD_WIDTH \/ 2/);
  assert.match(source, /this\.input\.off\("pointerup",\s*handleBoardPointer\)/);
  assert.doesNotMatch(source, /container\.on\("pointerout"/);
  assert.doesNotMatch(source, /container\.on\("pointerover"/);
});

test("all local Phaser games use the shared high-DPI rendering pipeline", async () => {
  const gameIds = [
    "catch-the-cat",
    "pin-gap",
    "pulse",
    "memory-match",
    "minesweeper",
    "thunder-strike",
    "water-sort",
    "sokoban",
    "line-connect",
  ];
  for (const gameId of gameIds) {
    const source = await readFile(new URL(`../games/${gameId}/src/main.ts`, import.meta.url), "utf8");
    assert.match(source, /const RENDER_DPR = getGameRenderDpr\(\)/, `${gameId} must resolve the render DPR`);
    assert.match(source, /configureHiDpiCamera\(this\.cameras\.main,\s*WIDTH,\s*HEIGHT,\s*RENDER_DPR\)/, `${gameId} must configure its camera`);
    assert.match(source, /sharpenSceneText\(this\.children,\s*RENDER_DPR\)/, `${gameId} must render crisp text`);
    assert.match(source, /width:\s*WIDTH \* RENDER_DPR/, `${gameId} must use a high-resolution canvas width`);
    assert.match(source, /height:\s*HEIGHT \* RENDER_DPR/, `${gameId} must use a high-resolution canvas height`);
  }

  const sdk = await readFile(new URL("../packages/game-sdk/src/index.ts", import.meta.url), "utf8");
  assert.match(sdk, /export function getGameRenderDpr/);
  assert.match(sdk, /\.setZoom\(renderDpr\)[\s\S]*\.setScroll\(/);
  assert.match(sdk, /resolutionAware\.setResolution\?\.\(renderDpr\)/);
});

test("pin gap and pulse reset run state before every replay", async () => {
  const pin = await readFile(new URL("../games/pin-gap/src/main.ts", import.meta.url), "utf8");
  const pulse = await readFile(new URL("../games/pulse/src/main.ts", import.meta.url), "utf8");
  assert.match(pin, /create\(\)\s*\{\s*this\.resetRun\(\)/);
  assert.match(pin, /if\s*\(!this\.started\)[\s\S]*this\.bridge\.started\(\)/);
  assert.match(pin, /private showResult\(highScore:\s*number\)/);
  assert.match(pulse, /create\(\)\s*\{\s*this\.resetState\(\)/);
  assert.match(pulse, /if\s*\(this\.ended \|\| this\.resolving\)\s*return/);
  assert.match(pulse, /this\.resolving = true;\s*this\.activeRound = false/);
  assert.match(pulse, /private startRound\(\)\s*\{\s*this\.resolving = false/);
  assert.match(pulse, /TAP TO SYNC/);
  assert.match(pulse, /private showResult\(highScore:\s*number\)/);
});

test("thunder strike ships drag controls, auto fire, and progressive waves", async () => {
  const source = await readFile(new URL("../games/thunder-strike/src/main.ts", import.meta.url), "utf8");
  assert.match(source, /pointermove/);
  assert.match(source, /fireInterval\s*=\s*time\s*<\s*this\.rapidUntil/);
  assert.match(source, /this\.spawnEnemy\(time\)/);
  assert.match(source, /private lives\s*=\s*3/);
  assert.match(source, /this\.rapidUntil[\s\S]*7000/);
  assert.match(source, /resolveManualCollisions/);
  assert.match(source, /this\.lives\s*<=\s*0/);
  assert.match(source, /this\.load\.image\("thunder-player",\s*"player-ship\.png"\)/);
  assert.match(source, /powerUps\.remove\(powerUp,\s*true,\s*true\)/);
  assert.match(source, /powerUp\.getData\("collected"\)/);
  assert.match(source, /overlap\(this\.powerUps,\s*this\.player,\s*\(_player,\s*powerUp\)/);
  assert.match(source, /overlap\(this\.enemyBullets,\s*this\.player,\s*\(_player,\s*bullet\)/);
  assert.match(source, /sprite\s*===\s*this\.player/);
});

test("water sort ships guaranteed-solvable difficulty levels and safe input gates", async () => {
  const source = await readFile(new URL("../games/water-sort/src/main.ts", import.meta.url), "utf8");
  assert.match(source, /easy:\s*\{[^}]*colors:\s*4,[^}]*columns:\s*3,[^}]*scrambleMoves:\s*28/s);
  assert.match(source, /normal:\s*\{[^}]*colors:\s*6,[^}]*columns:\s*4,[^}]*scrambleMoves:\s*48/s);
  assert.match(source, /hard:\s*\{[^}]*colors:\s*8,[^}]*columns:\s*5,[^}]*scrambleMoves:\s*72/s);
  assert.match(source, /private createPuzzle\(\)/);
  assert.match(source, /const maxRemovable = groupSize === source\.length \? groupSize : groupSize - 1/);
  assert.match(source, /tube\.length === 0 \|\| tube\[tube\.length - 1\] !== color/);
  assert.match(source, /bestCandidate \?\? this\.createFallbackPuzzle\(\)/);
  assert.match(source, /private createFallbackPuzzle\(\)/);
  assert.doesNotMatch(source, /Unable to generate a solvable water-sort puzzle/);
  assert.match(source, /if\s*\(this\.busy \|\| this\.ended\)\s*return/);
  assert.match(source, /this\.history\.push\(\{ tubes: cloneTubes\(this\.tubes\), moves: this\.moves \}\)/);
  assert.match(source, /private undoMove\(\)/);
  assert.match(source, /const RENDER_DPR = getGameRenderDpr\(\)/);
  assert.match(source, /configureHiDpiCamera\(this\.cameras\.main,\s*WIDTH,\s*HEIGHT,\s*RENDER_DPR\)/);
  assert.match(source, /width:\s*WIDTH \* RENDER_DPR/);
  assert.match(source, /height:\s*HEIGHT \* RENDER_DPR/);
  assert.match(source, /sharpenSceneText\(this\.children,\s*RENDER_DPR\)/);
  assert.match(source, /pointer\.positionToCamera\(this\.cameras\.main\)/);
  assert.match(source, /angle:\s*direction \* 68/);
  assert.match(source, /private animateLiquidFlow\(/);
  assert.match(source, /private createSplash\(/);
  assert.doesNotMatch(source, /cameras\.main\.flash/);
  assert.match(source, /scaleY:\s*1/);
  assert.match(source, /Phaser\.Scenes\.Events\.SHUTDOWN/);
});

test("sokoban ships 24 classic Microban levels, stable crate animation, and mobile controls", async () => {
  const source = await readFile(new URL("../games/sokoban/src/main.ts", import.meta.url), "utf8");
  const levels = JSON.parse(await readFile(new URL("../games/sokoban/src/levels.json", import.meta.url), "utf8"));
  const notice = await readFile(new URL("../games/sokoban/NOTICE.md", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.equal(levels.length, 24);
  assert.equal(levels.every((level, index) => level.name === `Microban ${String(index + 1).padStart(2, "0")}`), true);
  assert.match(notice, /Microban/);
  assert.match(notice, /David W\. Skinner/);
  assert.match(source, /pointer\.positionToCamera\(this\.cameras\.main\)/);
  assert.match(source, /private tryMove\(direction:\s*Direction\)/);
  assert.match(source, /private undo\(\)/);
  assert.match(source, /private showLevelPicker\(\)/);
  assert.match(source, /this\.queuedDirection = direction/);
  assert.match(source, /private floors = new Set<string>\(\)/);
  assert.match(source, /this\.tweens\.killTweensOf\(boxSprite\)/);
  assert.match(source, /this\.boxBaseScale\.x \* 1\.08/);
  assert.match(source, /sprite\.setScale\(this\.boxBaseScale\.x,\s*this\.boxBaseScale\.y\)/);
  assert.match(source, /this\.add\.rectangle\(x,\s*y,\s*64,\s*58,\s*0x17323b\)/);
  assert.match(source, /this\.makeDirectionButton\(126,\s*796,\s*"◀"/);
  assert.match(source, /this\.makeDirectionButton\(264,\s*796,\s*"▶"/);
  assert.match(source, /Cubic\.Out/);
  assert.match(source, /sokoban-worker\.png/);
  assert.match(source, /sokoban-crate\.png/);
  assert.match(styles, /\.game-icon-sokoban/);
});

test("line connect ships 24 fully covered solvable boards and safe drag controls", async () => {
  const source = await readFile(new URL("../games/line-connect/src/main.ts", import.meta.url), "utf8");
  const levels = JSON.parse(await readFile(new URL("../games/line-connect/src/levels.json", import.meta.url), "utf8"));
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.equal(levels.length, 24);
  assert.deepEqual([...new Set(levels.map((level) => level.size))], [4, 5, 6, 7]);
  for (const level of levels) {
    const occupied = new Set();
    assert.equal(level.pairs.length, level.solution.length);
    level.solution.forEach((path, color) => {
      assert.equal(path.length >= 2, true);
      assert.deepEqual(path[0], level.pairs[color].start);
      assert.deepEqual(path[path.length - 1], level.pairs[color].end);
      path.forEach((point, index) => {
        assert.equal(point.x >= 0 && point.x < level.size, true);
        assert.equal(point.y >= 0 && point.y < level.size, true);
        assert.equal(occupied.has(`${point.x},${point.y}`), false);
        occupied.add(`${point.x},${point.y}`);
        if (index > 0) {
          const previous = path[index - 1];
          assert.equal(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y), 1);
        }
      });
    });
    assert.equal(occupied.size, level.size * level.size);
  }
  assert.match(source, /pointer\.positionToCamera\(this\.cameras\.main\)/);
  assert.match(source, /private extendToward\(target:\s*Point\)/);
  assert.match(source, /路线不能交叉或重叠/);
  assert.match(source, /private undo\(\)/);
  assert.match(source, /private showHint\(\)/);
  assert.match(source, /Phaser\.Scenes\.Events\.SHUTDOWN/);
  assert.match(styles, /\.game-icon-connect/);
});
