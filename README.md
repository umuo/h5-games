# 游点意思 · Web Games Monorepo

面向手机浏览器的多游戏工作区。大厅和每个游戏独立构建，公共能力通过 workspace 包复用；新增游戏不会把其他游戏打进同一个首屏包。

## 快速开始

```bash
npm install
npm run dev
```

大厅默认运行在开发服务器给出的本地地址。当前内置“光脉”“见缝插针”“围住小猫”三款独立游戏，并支持通过 iframe 清单接入外部游戏。

“围住小猫”的棋盘规则与寻路思路改编自
[ganlvtech/phaser-catch-the-cat](https://github.com/ganlvtech/phaser-catch-the-cat)，
并在对应游戏目录保留原项目的 MIT 许可与署名。

## 新建游戏

```bash
npm run game:new -- sky-jump --title "天空跳跃"
npm run game:dev -- sky-jump
```

横屏游戏：

```bash
npm run game:new -- road-rush --title "公路狂飙" --orientation landscape
```

脚手架会从 `templates/phaser-game` 创建独立 Vite + Phaser 应用，并根据 `public/game.json` 自动更新大厅清单。

## 接入外部游戏

在 `catalog/iframe` 新增一个 JSON 清单即可，无需创建游戏工程：

```json
{
  "id": "cloud-match",
  "title": "云朵消消乐",
  "shortTitle": "云",
  "description": "轻点相邻云朵，享受一局轻松的消除游戏。",
  "category": "休闲",
  "engine": "iframe",
  "orientation": "portrait",
  "version": "external",
  "path": "/play/cloud-match",
  "launchMode": "iframe",
  "embedUrl": "https://xiaoxiaole.lacknb.com/",
  "enabled": true
}
```

外部地址必须使用 HTTPS，并允许被 iframe 嵌入。平台会统一提供加载状态、返回入口、新窗口入口和沙箱权限限制。

## 常用命令

```bash
npm run dev                 # 开发游戏大厅
npm run game:dev -- pulse   # 单独开发某个游戏
npm run game:build -- pulse # 单独构建某个游戏
npm run build               # 构建全部游戏和大厅
npm test                    # 类型、构建和架构测试
npm run lint                # 代码规范检查
```

## 目录约定

```text
app/                         游戏大厅
games/<id>/                  独立游戏应用
packages/game-sdk/           平台通信、本地存档等公共能力
packages/game-catalog/       自动生成的游戏目录
templates/phaser-game/       新游戏模板
tooling/create-game/         游戏生成与运行命令
tooling/generate-catalog/    清单生成器
catalog/iframe/              外部 iframe 游戏清单
```

依赖只能从具体产品指向公共能力：`app` 和 `games/*` 可以依赖 `packages/*`，游戏之间不能互相引用，公共包也不能引用具体游戏。

## 游戏清单

每款游戏提供 `games/<id>/public/game.json`：

```json
{
  "id": "pulse",
  "title": "光脉：节拍反应",
  "shortTitle": "PULSE",
  "description": "在光环重合的一刻按下屏幕。",
  "category": "反应力",
  "engine": "phaser",
  "orientation": "portrait",
  "version": "1.0.0",
  "path": "/games/pulse/",
  "enabled": true
}
```

修改清单后执行 `npm run catalog:generate`。正常的 `dev` 和 `build` 命令会自动执行这一步。

## 移动端基线

- 游戏模板默认使用 `viewport-fit=cover` 和安全区变量。
- 画布采用 Phaser `FIT` 和居中缩放。
- 页面使用动态视口高度并禁止游戏区域的滚动回弹。
- 平台 SDK 支持 READY、START、SCORE、GAME_OVER 等事件。
- 每个游戏独立输出到 `public/games/<id>/`，可进一步拆分到 CDN。

## 部署

`npm run build` 会先构建所有游戏，再构建大厅。游戏静态资源带内容哈希，大厅和游戏可作为同一个站点发布。

发布到 Cloudflare Pages：

```bash
npm run pages:deploy
```

部署脚本会把 Vinext 的服务器渲染产物转换为 Pages `_worker.js` 高级模式，并同时上传游戏静态资源。
