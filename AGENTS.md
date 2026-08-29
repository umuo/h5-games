# AGENTS.md — 游点意思 · H5 游戏平台

面向手机浏览器的网页游戏 monorepo：Next.js(vinext)游戏大厅 + 每款游戏独立的 Vite + Phaser 应用，部署到 Cloudflare Pages。

## 常用命令

```bash
npm run dev                    # 开发大厅（自动先执行 catalog:generate）
npm run game:dev -- <id>       # 单独开发某款游戏
npm run game:build -- <id>     # 单独构建某款游戏（输出到 public/games/<id>）
npm test                       # typecheck + 全量构建 + node --test（架构/SSR 测试）
npm run lint                   # ESLint（0 error 是硬性要求）
npm run pages:deploy           # 完整构建 + 打包 + 部署到 Cloudflare Pages（项目 web-games-57u）
```

要求：Node ≥ 22.13。改动游戏代码后跑 `npm test` 即覆盖 typecheck、构建与全部测试。

## 目录与架构边界

- `app/` — 游戏大厅（Next App Router，经 vinext 构建部署）
- `games/<id>/` — 每款游戏独立工程；`public/game.json` 是注册清单
- `packages/game-sdk/` — 平台公共能力（postMessage bridge、本地存档、生命周期恢复、HiDPI 渲染、createAudioKit 音频合成）
- `packages/game-catalog/` — `src/generated.ts` 为自动生成，禁止手改（`npm run catalog:generate`）
- `catalog/iframe/` — 外部 iframe 游戏清单（强制 HTTPS embedUrl，路径 `/play/<id>`）
- `tests/` — `architecture.test.mjs`（约定强制）与 `rendered-html.test.mjs`（大厅 SSR 断言）

依赖只允许单向：`app`、`games/*` → `packages/*`。游戏之间禁止互相引用，公共包不得引用具体游戏。

## 新增游戏的硬性约定

1. 用 `npm run game:new -- <id> --title "中文名"` 脚手架创建（id 必须 `^[a-z][a-z0-9-]*$` 且与目录同名）。
2. `game.json` 的 `icon` 只能取固定集合（见 `tooling/generate-catalog/index.mjs`），未收录图标需同步更新该集合、`packages/game-catalog/src/index.ts` 类型与 `app/globals.css` 的 `.game-icon-<name>` 样式。
3. 游戏源码必须满足 `tests/architecture.test.mjs` 的正则断言：使用 `bindGameLifecycle(this, …)`（禁止监听 BLUR 自行暂停）、`getGameRenderDpr` / `configureHiDpiCamera` / `sharpenSceneText`、画布尺寸 `WIDTH * RENDER_DPR`。
4. 输入一律用 `pointerdown/pointerup` + `pointer.positionToCamera(this.cameras.main)`；场景销毁用 `Phaser.Scenes.Events.SHUTDOWN` 清理监听与计时器。
5. 首次交互调用 `bridge.started()`，分数变化调 `bridge.score()`，结束调 `bridge.gameOver()`；存档用 `createGameStorage`。
6. `tests/rendered-html.test.mjs` 断言大厅 SSR 内容：大厅首屏（懒加载）只渲染目录前 8 款游戏的图标类名，全部标题经 RSC payload 可见。新增游戏后需同步该文件的首屏图标与标题/路径断言。

## 已知陷阱

- **单游戏构建不会进入部署包**：`game:build` 只写 `public/games/<id>`；部署包来自完整 `npm run build` 时 Vite 对 `public/` 的拷贝（进入 `dist/client`）。改完游戏要让 8788 线上预览生效必须跑完整 `npm run build`（或 `npm test`）+ `pages:prepare`。
- **本地 `vinext start` 预览有缺陷**：`/games/<id>/` 会被尾斜杠 308 重定向到 404。本地跑构建产物请用 `npx wrangler pages dev .wrangler/pages --bundle --inspector-port 9230`（8788 端口；`--bundle` 与独立 inspector 端口是必需的）。线上 Cloudflare Pages 由 `pages:prepare` 生成的自定义 `_worker.js` 重写游戏路径，不受影响。
- `vinext dev` 与 `wrangler pages dev` 都默认占用调试端口 9229，同时运行需给 wrangler 指定 `--inspector-port`。
- 游戏全局逻辑不要依赖浏览器焦点：锁屏/切后台由 `game-sdk` 的 `bindGameLifecycle` 统一恢复，游戏代码不得自行监听 blur 暂停场景（架构测试会拦截）。
- 物理游戏（Matter）禁止在碰撞回调内直接销毁/创建物体——先入队，下一帧处理（见 `games/fruit-merge` 的写法）。
- 音频必须在用户手势内 `audio.unlock()`；切后台用 `audio.suspend()` / 场景 RESUME 事件 `resume()`。
