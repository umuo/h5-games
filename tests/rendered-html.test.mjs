import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the game portal", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>游点意思 · 移动游戏实验场<\/title>/i);
  assert.match(html, /<main class="portal-page">/i);
  assert.match(html, /小屏幕/);
  assert.match(html, /光脉：节拍反应/);
  assert.match(html, /见缝插针/);
  assert.match(html, /围住小猫/);
  assert.match(html, /记忆翻牌/);
  assert.match(html, /扫雷/);
  assert.match(html, /雷电射击/);
  assert.match(html, /水排序/);
  assert.match(html, /推箱子/);
  assert.match(html, /连线不交叉/);
  assert.match(html, /2048/);
  assert.match(html, /贪吃蛇/);
  assert.match(html, /打砖块/);
  assert.match(html, /合成果实/);
  assert.match(html, /霓虹深空/);
  assert.match(html, /律动光轨/);
  assert.match(html, /\/games\/pulse\//);
  assert.match(html, /\/games\/catch-the-cat\//);
  assert.match(html, /\/games\/merge-2048\//);
  assert.match(html, /\/games\/snake\//);
  assert.match(html, /\/games\/breakout\//);
  assert.match(html, /\/games\/fruit-merge\//);
  assert.match(html, /\/games\/neon-raid\//);
  assert.match(html, /\/games\/beat-line\//);
  assert.match(html, /\/play\/cloud-match/);
  assert.match(html, /game-icon-cat/);
  assert.match(html, /game-icon-memory/);
  assert.match(html, /game-icon-mine/);
  assert.match(html, /game-icon-connect/);
  assert.match(html, /game-icon-arcade/);
  assert.match(html, /游戏分类/);
  assert.match(html, /全部/);
  assert.match(html, /上滑加载更多|已经看到全部游戏/);
  assert.doesNotMatch(html, /GAME STUDIO|一个命令，|玩本周新作/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders a sandboxed external game player", async () => {
  const response = await render("/play/cloud-match");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>云朵消消乐 · 游点意思<\/title>/i);
  assert.match(html, /src="https:\/\/xiaoxiaole\.lacknb\.com\/"/);
  assert.match(html, /sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"/);
  assert.match(html, /返回游戏列表/);
  assert.match(html, /新窗口/);
  assert.match(html, /重新加载云朵消消乐/);
  assert.match(html, /xiaoxiaole\.lacknb\.com(?:<!-- -->)? · 安全嵌入/);
});

test("server-renders the undercover game in the external player", async () => {
  const response = await render("/play/undercover");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>谁是卧底 · 游点意思<\/title>/i);
  assert.match(html, /src="https:\/\/undercover\.lacknb\.com\/"/);
  assert.match(html, /sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"/);
  assert.match(html, /重新加载谁是卧底/);
  assert.match(html, /卧<!-- --> · LOADING|卧 · LOADING/);
  assert.doesNotMatch(html, /CLOUD MATCH · LOADING/);
  assert.match(html, /undercover\.lacknb\.com(?:<!-- -->)? · 安全嵌入/);
});
