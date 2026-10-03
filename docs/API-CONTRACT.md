# 插件市场接口契约（冻结版 v1.0.0）

本文件是 host 半与 client 半之间唯一的接口来源。两侧都按本文件实现，**不要单方面修改**；需要变更时先通知 Lead。

## 0. 标识

| 项 | 值 |
|---|---|
| npm 包名 | `dsh-plugin-market` |
| 客户端 bundle id | `dsh-plugin-market`（必须与包名一致） |
| Loader 行 id（cordis.patch.yml） | `plugin-market` |
| main 面板 key | `plugin-market` |
| 侧边栏底部入口 id | `plugin-market`（`sidebar.footer.action`） |
| 版本 | `1.0.0` |
| 路由前缀 | `/plugin-market` |

## 1. 通用约定

- 所有响应 `Content-Type: application/json; charset=utf-8`，`Cache-Control: no-store`。
- 成功：`{ "ok": true, ... }`。失败：`{ "ok": false, "error": { "code": string, "message": string, "hint"?: string } }`。
- 失败同时使用语义化 HTTP 状态码：`400` 参数错误 / `403` 跨站请求 / `404` 未知路径 / `405` 方法不允许 / `502` 目录源不可用 / `504` 目录源超时 / `500` 内部错误。
- POST 只接受同源请求：要求 `Sec-Fetch-Site: same-origin`，或 `Origin` 的 host 与 `Host` 头一致；否则 `403 cross-origin`。同时 `Content-Type` 必须是 `application/json`，请求体上限 64 KiB。
- 错误码清单：`bad-request`、`cross-origin`、`method-not-allowed`、`not-found`、`catalog-unavailable`、`catalog-timeout`、`manager-unavailable`、`not-in-catalog`、`install-failed`、`remove-failed`、`toggle-failed`、`not-allowed`、`internal`。
- 面向用户的 `message`/`hint` 用中文短句，遵守「发生了什么 / 为什么 / 现在怎么办」。

## 2. host 路由

### 2.1 `GET /plugin-market/status`

```json
{
  "ok": true,
  "plugin": { "name": "dsh-plugin-market", "version": "1.0.0" },
  "host": { "dsh": "0.2.0-rc.2", "node": "v22.19.0", "platform": "win32", "profile": "desktop" },
  "manager": { "available": true, "registries": { "registry": null, "fallbackRegistries": [], "resolved": null } },
  "catalog": { "source": "https://awesome-dsh-plugin.com/plugins.json", "count": 4412, "updated": "2026-10-01", "fetchedAt": "2026-10-03T12:00:00.000Z", "stale": false, "error": null }
}
```

- `manager.available=false` 表示宿主没有 `pluginManager` 服务，市场只读（浏览/搜索可用，安装类按钮禁用）。
- **本端点绝不发起网络请求**：`catalog` 只反映当前内存缓存，无缓存时为 `null`（UI 用它判断「还没抓过」而不是「抓失败」）。目录的首次抓取只由 `/catalog`、`/installed`、`/refresh` 触发。
- `host.dsh` 取值顺序：`ctx.get('profileContext')`（若存在）→ `process.env.DSH_VERSION` → `null`。

### 2.2 `GET /plugin-market/catalog`

Query 参数（全部可选，未知参数忽略）：

| 参数 | 取值 | 默认 |
|---|---|---|
| `query` | 字符串，≤128 字符 | 空 |
| `category` | 分类 id 或 `all` | `all` |
| `sort` | `top`（star 降序）/ `new`（added 降序）/ `downloads`（下载降序）/ `name`（名称升序） | `top` |
| `page` | ≥1 整数 | `1` |
| `pageSize` | 1..100 整数 | `24` |
| `installed` | `0`/`1`，仅返回已安装项 | `0` |
| `updates` | `0`/`1`，仅返回有更新的项 | `0` |

响应：

```json
{
  "ok": true,
  "catalog": { "count": 4412, "filtered": 312, "updated": "2026-10-01",
               "fetchedAt": "2026-10-03T12:00:00.000Z",
               "source": "https://awesome-dsh-plugin.com/plugins.json", "stale": false },
  "page": { "page": 1, "pageSize": 24, "total": 312, "pages": 13 },
  "categories": [ { "id": "ui", "zh": "UI 增强", "en": "UI Enhancements", "count": 420 } ],
  "items": [
    {
      "id": "AnonyJcy/dsh-j-space",
      "name": "dsh-j-space",
      "owner": "AnonyJcy",
      "npm": "@anonyjcy/dsh-j-space",
      "spec": "@anonyjcy/dsh-j-space",
      "installable": true,
      "version": "1.2.2",
      "category": "agi",
      "description": { "zh": "…", "en": "…" },
      "url": "https://github.com/AnonyJcy/dsh-j-space",
      "page": "https://awesome-dsh-plugin.com/p/AnonyJcy/dsh-j-space/",
      "stars": 4,
      "downloads": 1156,
      "added": "2026-09-20",
      "capabilities": ["fs-read"],
      "install": "dsh plugin --profile web add @anonyjcy/dsh-j-space",
      "installed": false,
      "installedVersion": null,
      "enabled": null,
      "updateAvailable": false
    }
  ]
}
```

- `id` = `owner/name`（目录内唯一）。`spec` 优先级：`npm` → `url`（git 仓库地址）→ `null`；`spec` 为 `null` 时 `installable=false`。
- `installed` 依据宿主 `pluginManager.listBundles()` 的 `name` 与 `npm` 字段匹配（大小写不敏感；npm 为空时用仓库地址尾段匹配）。
- `updateAvailable`：**仅当目录版本严格高于已安装版本**时为 `true`（`compareVersions(catalogVersion, installedVersion) > 0`）；版本相同、目录版本更低、任一侧缺失或不可比较 → `false`。`latest` 始终是目录里的当前版本（可低于已装版本），UI 不得据此渲染「更新」按钮。
- `categories` 只包含目录里存在且计数 >0 的分类，按 `count` 降序。
- 目录缓存 10 分钟；过期后刷新失败时返回上次缓存并置 `stale: true`；完全无缓存时 `502 catalog-unavailable`。

### 2.3 `GET /plugin-market/installed`

```json
{
  "ok": true,
  "bundles": [
    { "name": "@feiyang666/dsh-usage-plugin", "version": "1.18.0", "description": "…",
      "enabled": true, "installed": true, "removable": true, "official": false, "market": false,
      "error": null,
      "rows": [ { "rowId": "usage-plugin", "moduleName": "@feiyang666/dsh-usage-plugin", "entryId": "usage-plugin" } ],
      "latest": "1.18.0", "updateAvailable": false }
  ],
  "plugins": [
    { "entryId": "usage-plugin", "moduleName": "@feiyang666/dsh-usage-plugin",
      "enabled": true, "fiberPhase": "active", "title": null, "bundle": "@feiyang666/dsh-usage-plugin" }
  ]
}
```

- `bundles` 直接投影 `pluginManager.listBundles()`：`name`、`version`、`description`、`enabled`、`installed`、`removable`、`rows`；`official` = 名称以 `@deepseek-ai/` 开头；`market` = 名称为 `dsh-plugin-market`。
- `error` 为 `null` 或 `{ "code": string, "diagnostic"?: string }`。
- `latest` / `updateAvailable` 通过与目录缓存 join 得到；目录不可用时为 `null` / `false`。`latest` = 目录当前版本（可能低于已装版本）；`updateAvailable` 仅当目录版本 **严格更高** 时为 `true`。
- `plugins` 投影 `pluginManager.listPlugins()`，额外字段：`title`（本地化标题，取不到为 `null`）、`bundle`（该 entry 所属 bundle 名，取不到为 `null`）。
- `manager.available=false` 时：`bundles: []`、`plugins: []`，并额外返回 `"manager": { "available": false }`。

### 2.4 `POST /plugin-market/install`

请求：

```json
{ "name": "AnonyJcy/dsh-j-space", "spec": "@anonyjcy/dsh-j-space",
  "requestId": "uuid-可选", "approvedBuilds": ["sharp"] }
```

- `spec` 可省略：服务端按 `name`（目录 id 或 npm 名，大小写不敏感）在目录里查 `spec`。
- `spec` 显式给出时必须在目录里存在（等于某个条目的 `spec`、`npm` 或 `url`），否则 `400 not-in-catalog`（安全约束：只允许装目录内的插件）。
- 调用 `pluginManager.installBundle(spec, { requestId, approvedBuilds })`；`requestId` 为空时不传。`approvedBuilds` 为空数组时不传。

响应：

```json
{ "ok": true, "changed": true, "application": "applied", "stage": "install",
  "target": "@anonyjcy/dsh-j-space", "enabled": true,
  "error": null, "warnings": [],
  "pendingBuilds": ["sharp"], "output": "…最近 2000 字符 pnpm 输出…" }
```

- `application` ∈ `applied | restart-required | overridden | failed | cancelled`（原样透传）。
- `error` 非空时为 `{ "code": string, "message": string, "diagnostic"?: string, "incompatible"?: unknown }`；`ok` 与 `error` 一致：`error != null` ⇒ `ok=false`。
- `pendingBuilds`：来自 `ChangeResult.pendingBuilds`；非空表示需要用户批准构建脚本后带着 `approvedBuilds` 重新提交。
- `output`：`packageResult.output` 截断到末尾 2000 字符（可选）。
- 宿主缺 `pluginManager` ⇒ `502 manager-unavailable`。
- 安装进行中重复提交同名 spec：透传宿主的 `changed:false` 与 `error.code='operation-error'`。

### 2.5 `POST /plugin-market/remove`

请求 `{ "name": "@feiyang666/dsh-usage-plugin" }` → `pluginManager.removeBundle(name)`。

- `name === "dsh-plugin-market"` ⇒ `400 not-allowed`，`message`：市场不能卸载自己，请在终端执行 `dsh plugin --profile <profile> remove dsh-plugin-market`。
- 其余响应同 §2.4 的字段（`stage: "remove"`）。

### 2.6 `POST /plugin-market/toggle`

请求 `{ "name": "<bundle 名>", "enabled": true }` 或 `{ "id": "<entryId>", "enabled": true }`。

- 有 `name` 调 `pluginManager.setBundleEnabled(name, enabled)`；否则有 `id` 调 `setPluginEnabled(id, enabled)`；都没有 ⇒ `400 bad-request`。
- 响应 `{ "ok": true, "changed": true, "application": "applied", "enabled": true, "error": null, "warnings": [] }`。
- 宿主返回 `readOnlyReason` 时 ⇒ `400 not-allowed`，`message` 说明这条由宿主基础设施管理，不能在市场里开关。

### 2.7 `POST /plugin-market/refresh`

强制丢弃目录缓存并重新抓取。

响应 `{ "ok": true, "count": 4412, "fetchedAt": "…", "source": "…" }`，失败时 `502 catalog-unavailable` / `504 catalog-timeout`（保留旧缓存并置 `stale: true`）。

## 3. 目录抓取策略（host）

源的选择顺序（每个源只尝试一次，源列表本身就是重试）：

1. `DSHM_REGISTRY_URL` 非空 → **只**用该 URL 一个源（用户指定自己的目录时不允许悄悄回退到我们的源）。
2. 否则按顺序：`https://registry.npmmirror.com` 上的 npm 包 `dsh-plugin-catalog` → `https://registry.npmjs.org` 上的同一包 → `https://awesome-dsh-plugin.com/plugins.json`。
   - npm 候选注册表在 `DSHM_NPM_MIRROR` 非空时只取该值。
   - 理由（实测）：本机直连时官方源 25s 超时或 35s 才通；npmmirror 的包元数据 97ms、tarball（1.21MB gzip）下载 + 解压 291ms。这与 dsh-market 自己的区域路由一致。

单个源的做法：

- **URL 源**：`GET <url>`，超时 30s，校验响应必须是 JSON 对象、`plugins` 为数组、`count` 为数字；拒绝 HTML（含 `<html`）或非 JSON 正文。
- **npm 源**：`GET <registry>/dsh-plugin-catalog/latest`（15s）→ 读 `version` / `dist.tarball` / `dist.integrity`；`GET dist.tarball`（30s）→ gzip 字节；`dist.integrity` 存在时用 `node:crypto` 校验（`sha512-`/`sha256-` + base64），不匹配即该源失败；`node:zlib` 解压后用最小 USTAR 解析取出包内 `package/plugins.json`，再做同样的 JSON 结构校验。
- 全部源都失败：无缓存 → `502 catalog-unavailable`（超时导致时 `504 catalog-timeout`），文案说明尝试过哪些源，以及可以设 `DSHM_REGISTRY_URL` / `DSHM_NPM_MIRROR`；有缓存 → 200 + `stale: true`。

其它：

- 内存缓存：`{ source, updated, count, categories, plugins, fetchedAt, stale }`，TTL 10 分钟；并发抓取共用同一个 in-flight Promise。
- 失败后的短冷却只影响自动抓取节奏，不改变错误结果；`/refresh` 绕过冷却。
- `source` 是实际命中的源字符串：npm 源形如 `npm:dsh-plugin-catalog@<version> (registry.npmmirror.com)`，URL 源就是该 URL。
- 只向源发送 GET，不带任何凭据；不写磁盘。

## 4. client 半契约

文件 `plugin-market/lib/client.js`，单文件、自包含：

```js
window.__ModuleLoader__.load({
  id: "dsh-plugin-market",
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports;
    var React = require("react"); var el = React.createElement;
    // …组件…
    exports.inject = ["slots", "layout", "locale"];
    exports.apply = function (ctx) { /* … */ };
    return module.exports;
  }
});
```

- 只用 `require("react")`（平台种子模块）与 `window.fetch`；不引第三方包，不引相对文件。
- 通过 `ctx.get(name)` 取服务，取不到要有降级：
  - `slots`（必需）：`slots.inject(key, () => slots.register(options, Component))`。
  - `layout`：`layout.selectPanel("plugin-market")`。
  - `locale`：`locale.getLocale().active`（`zh`/`en`）+ `locale.subscribe`。
- 注册两处：
  1. `ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'plugin-market' }, MarketPage))`
  2. `ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'plugin-market', order: 15, label: () => t('market.title') }, MarketEntry))`
- `MarketEntry` 收到框架 props（`wide`、`usePanelInfo` 等）：
  - 整行按钮：图标 + 文案「插件市场」；`wide === false` 时只留图标（56px 轨道）。
  - 点击调用 `layout.selectPanel('plugin-market')`；`layout` 不可用时按钮禁用并给出 tooltip。
  - 用 `props.usePanelInfo(info => info.activePanelId === 'plugin-market')` 做选中态；该 hook 不存在时按未选中渲染。
- `MarketPage` 只读 `plugin-market` 路由，不直接访问宿主服务：
  - 顶部：标题「插件市场」+ 版本号 + 「刷新目录」按钮 + 状态提示。
  - 页签：`发现`（目录）/ `已安装`。
  - 发现页：搜索框（回车或 300ms 防抖）、分类 chips、排序下拉、卡片网格、分页（上一页/下一页 + 第 x/y 页）。
  - 卡片：名称 + 作者 + 描述（按界面语言）+ star/下载 + 版本 + 分类 + 「安装」/「已安装」/「更新」按钮 + 「详情」。
  - 详情：可展开区域，显示完整描述、能力标签、仓库/目录页外链（`target="_blank" rel="noreferrer"`）。
  - 已安装页：bundle 行（名称、版本、启用开关、卸载按钮、有更新时「更新到 x.y.z」）。
  - 状态：加载中（骨架/转圈）、空结果（说明 + 建议）、失败（原因 + 重试 + 现在怎么办）、目录过期提示。
  - 安装/卸载/开关：按钮进入进行中态（禁用 + 文案变化），完成后刷新列表并给出结果提示；失败显示 `error.message` 与 `hint`。
  - `pendingBuilds` 非空时展示「这个插件要执行构建脚本」确认条，用户确认后带 `approvedBuilds` 重新提交。
- 文案 zh/en 双语，跟随宿主语言，不写死中文。
- 颜色一律用 CSS 变量并带兜底，例如 `var(--dsw-alias-label-primary, #1a1a1a)`；可用 token：`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1`、`--dsw-alias-bg-layer-2`、`--dsw-alias-bg-overlay`、`--dsw-alias-border-l1`、`--dsw-alias-border-l2`、`--dsw-alias-brand-primary`、`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-state-error-primary`、`--dsw-alias-state-success-primary`、`--dsw-alias-state-warn-primary`、`--dsw-alias-state-idle-primary`、`--dsw-specific-sidebar-fill`。
- 请求封装：`fetch(url, {signal})`；组件卸载/离开面板时 abort；所有响应按 §1 解析，`ok !== true` 时抛带 `code/message/hint` 的错误对象。

## 5. 验收断言（verifier 用）

1. 临时 profile 启动 `dsh web` 成功，日志无 FAILED fiber。
2. 首页 HTML 的 `window.__DSH_BOOT__` 里存在 `id === 'dsh-plugin-market'` 的 entry，URL 形如 `/plugins/??dsh-plugin-market/client.js&rev=…`。
3. 该 URL 返回 JS 且包含 `__ModuleLoader__.load` 与 `id:"dsh-plugin-market"`。
4. `GET /plugin-market/status`、`/catalog?query=dsh&pageSize=5`、`/installed` 返回 `ok:true`，字段齐全。
5. `POST /plugin-market/install` 无 `Origin`/`Sec-Fetch-Site` 时返回 403（跨站保护）；`GET` 到 POST 路由返回 405。
6. `POST /plugin-market/install` 用目录外 spec 返回 400 `not-in-catalog`。
7. 卸载自身返回 400 `not-allowed`。
8. 目录缓存：连续两次 `GET /catalog` 第二次 `fetchedAt` 不变；`POST /refresh` 后变化。
