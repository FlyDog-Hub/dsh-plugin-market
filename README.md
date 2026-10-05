# deepseek-harness-market — DeepSeek Harness 插件市场

一个装进 DeepSeek Harness（以下简称 DSH）的插件市场：**侧边栏底部一个入口**，点开就能浏览、
搜索社区插件目录，并一键安装、更新、启用/停用、卸载，全程不用离开 GUI。

本仓库是按 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
的插件规范**重新实现**的一份市场，参考了 [dsh-market](https://github.com/dsh-market/dsh-market)
的目录来源与产品取舍，但不是它的拷贝：功能面收敛到「在侧边栏装/管插件」这一个闭环。

![侧边栏底部入口](docs/assets/market-entry-sidebar.png)

![市场页](docs/assets/market-page-live.png)

## 安装

```sh
# 已发布到 npm，直接按包名装（推荐）
dsh plugin --profile web add deepseek-harness-market

# 或从本地仓库目录装（开发用；仓库位于 E:\Code\dsh-plugin-market）
dsh plugin --profile web add "E:/Code/dsh-plugin-market/plugin-market"
```

Windows 上一键安装（含 profile 备份）与回滚：

```powershell
pwsh -File scripts\install-into-profile.ps1 -Profile desktop
pwsh -File scripts\install-into-profile.ps1 -Profile desktop -Rollback -BackupDir _verify\backup-desktop-<时间戳>
```

装完由 HMR 自动生效（无需重启）；入口出现在侧边栏**底部、账号行上方**。

### 从 GitHub Release 安装（v1.0.0）

```powershell
dsh plugin --profile web add https://github.com/Winnie-0721/dsh-plugin-market/releases/download/v1.0.0/deepseek-harness-market-1.0.0.tgz
```

本包已更名为 `deepseek-harness-market`（改名经过见 [docs/RELEASING.md](docs/RELEASING.md) §4.2）。
发布到 npm 后即可直接 `dsh plugin add deepseek-harness-market` 安装。

## 仓库结构

| 路径 | 内容 |
|---|---|
| [plugin-market/](plugin-market/README.zh.md) | 插件包本体：host 半（`lib/index.js` / `lib/catalog.js` / `lib/catalog-npm.js` / `lib/http.js`）+ web client 半（`lib/client.js` 单文件 bundle）+ `cordis.patch.yml` |
| [docs/API-CONTRACT.md](docs/API-CONTRACT.md) | host ↔ client 的冻结接口契约（端点、响应约定、目录抓取策略） |
| [docs/PLUGIN-MARKET.md](docs/PLUGIN-MARKET.md) | 设计与官方规范逐条对照、数据源决策、安全决定、限制、验收结论 |
| [docs/TEAM-BRIEF.md](docs/TEAM-BRIEF.md) | 实现期的环境事实与 API 签名（供协作/复现） |
| [scripts/](scripts/install-into-profile.ps1) | 安装/回滚脚本 |
| [verify/REPORT.md](verify/REPORT.md) | 独立验收报告：47 条断言全绿、工具缺陷与修正、真实 profile 指纹、复现命令 |

## 它怎么符合 DSH 插件规范

- `package.json` 声明 `dsh.bundle.patch`（bundle 补丁层）与 `dsh.client`（`platform: web` + `./client` 导出）；
- host 半是只 named-export `name` / `inject` / `apply` 的 Cordis function plugin，用 `ctx.webServer` 注册一条 prefix 路由，用 `ctx.get('pluginManager')` 可选地桥接安装能力；
- 浏览器半走 `window.__ModuleLoader__.load({ id, factory })`，除 `require("react")` 外零依赖；
- 入口注册在官方席位 `sidebar.footer.action`，主面板注册 `main` 的 `plugin-market` 键，导航走 `ctx.layout.selectPanel`；
- 颜色只用宿主 `--dsw-*` 主题 token 并带兜底值，文案 zh/en 跟随宿主语言。

## 数据来源

目录来自社区精选目录 [awesome-dsh-plugin](https://awesome-dsh-plugin.com/plugins.json)（4400+ 条）。
读取顺序是 **npm 镜像优先、官方源兜底**：npm 包 `dsh-plugin-catalog`（本机实测 289ms）→ 官方 URL
（本机直连 25–93s 超时）。原因是 DSH 只认 `HTTP(S)_PROXY` 环境变量、不读 Windows 系统代理，
而官方源挂在 GitHub Pages 上。可用 `DSHM_REGISTRY_URL` / `DSHM_NPM_MIRROR` 覆盖。

## 安全边界

只允许安装目录内的插件；安装/卸载/开关只走宿主 `pluginManager`；写操作只收同源 POST（64 KiB 上限）；
目录包若带 `dist.integrity` 必须校验通过才使用；市场拒绝卸载自己。详情见
[docs/PLUGIN-MARKET.md](docs/PLUGIN-MARKET.md) §5。

## 许可

MIT。目录数据与其来源仓库的许可归 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
所有；本仓库不包含第三方源码。
