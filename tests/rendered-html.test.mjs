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
  assert.match(html, /小屏幕/);
  assert.match(html, /光脉：节拍反应/);
  assert.match(html, /见缝插针/);
  assert.match(html, /围住小猫/);
  assert.match(html, /云朵消消乐/);
  assert.match(html, /\/games\/pulse\//);
  assert.match(html, /\/games\/catch-the-cat\//);
  assert.match(html, /\/play\/cloud-match/);
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
});
