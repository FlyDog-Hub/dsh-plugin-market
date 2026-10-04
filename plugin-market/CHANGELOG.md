# Changelog

## Unreleased

**包名变更**：`dsh-market` → `deepseek-harness-market`（前序：`dsh-plugin-market` → `dsh-market`）。

两次都是被 npm 规则挡回来的，如实记录：

1. `dsh-plugin-market` 已被另一个项目占用（fireguo / veloce-ailab，latest 1.3.0）；
2. 改用的 `dsh-market` 被 **同名规则**拦下——与已存在的 `dshmarket`（v1.66.8）只差一个连字符，
   registry 返回 `403 Package name too similar to existing package dshmarket`，`--access public`
   也绕不过。registry 建议加 scope，但用户名 `winnie_0721` 含下划线、scope 不允许下划线；
3. 最终选定 `deepseek-harness-market`，实测可用且近似名（`deepseekharnessmarket`、
   `deepseek-market` 等）均无冲突。

影响范围：
- `package.json` name、`cordis.patch.yml` patch name、`lib/index.js` PLUGIN_NAME、
  `lib/client.js` bundle id / SELF_NAME / STYLE_ID、`lib/self-update.js` MARKET_PACKAGE
- 所有文档、测试、release 脚本中的包名引用
- GitHub 仓库名不变（仍为 `Winnie-0721/dsh-plugin-market`），self-update 的 MARKET_REPO 不变
- tarball 文件名变为 `deepseek-harness-market-<v>.tgz`

**迁移注意**：已安装旧名的 profile 需手动换装：
```sh
dsh plugin --profile <profile> remove dsh-plugin-market   # 或 dsh-market
dsh plugin --profile <profile> add <新包路径或 npm 名>
```

## 1.1.3

修「顶部提示条显示不全」——提示条被压成一条、文字只剩半行（用户截图就是这样）。

根因不在提示条本身，而在 CSS 的**自动最小尺寸规则**：`.dshpm-root` 是「定高 + 可滚动」的 flex 列，
直接子项默认 `flex-shrink: 1`；而 flex 项只要带**非 `visible` 的 `overflow`**（通知条为了底部那条
倒计时线加了 `overflow: hidden`），它的自动最小尺寸就变成 **0**。于是当内容比容器高时，
**整段溢出量都被压到通知条身上**：自然高度 36px 被压到 16px，自己的文字被裁掉一半。
其余区块没有这个问题，恰恰因为它们的自动最小尺寸等于内容高度、压不动。

- 修法：`.dshpm-root > * { flex: 0 0 auto; }`——溢出由容器自己滚动消化，任何区块都不参与收缩。
  （只给通知条写 `flex-shrink: 0` 也能好，但那样下一个带 `overflow` 的区块会再犯一次。）
- 最小复现 `verify/repro-notice-clip.html` 实测：修复前 `noticeClientHeight=16 < scrollHeight=36`；
  修复后 `36 == 36`，且根仍可滚动（`scrollHeight 1608 > clientHeight 620`）。
- 回归断言进了真实浏览器验收（`verify/ui-check.ps1`，24 → **29 条**）：提示条 `clientHeight ≥ scrollHeight`
  且高度 ≥ 30px、文案完整；并在**窄高视口（1200×520）**下断言「`.dshpm-root` 的任一直接子项都没被压扁、
  且根自己可滚动」——把这类缺陷从"看截图才发现"变成"自动化拦住"。

## 1.1.2

把「刚发布的版本看不见」和一条写错的根因一起修掉。

- **列表源会滞后，于是加了标签探测**。实测（2026-10-04）：发布一小时后，jsDelivr 的版本列表
  仍然只有旧版本，`@main` 的 `releases/index.json` 也被 CDN 缓存 12 小时——两个列表都说
  「没有更新」，而真正的最新媒体早就在标签上了。现在列表都给不出更高版本时，按
  `MAJOR.MINOR.PATCH` 的常规递进探三个候选标签（下一个补丁 / 次版本 / 主版本）；
  **任意标签是按需取的**（刚推完 `@v<tag>/…` 立刻 200），所以这一层能追上滞后。有界：最多 3 次请求。
- **源顺序改为按新鲜度**：GitHub Releases API 提到第一源（权威且最新），jsDelivr 两条居后。
  被匿名限流（403，60 次/小时/IP）时**只是这个源失败**，继续问下一个；10 分钟缓存把点击量封在 ~6 次/小时。
- **下载多了第三条路**：`@<tag>` → `@main` → GitHub Release 附件。前两条覆盖 CDN 的标签索引延迟，
  第三条在 CDN 不可达时顶上。仍然只有传输层失败才换路，拿到字节后哈希不符直接硬失败。
- **更正一条写错的根因**（这条要单独说）。1.1.0 的更新日志里写着「本机直连 `api.github.com` 的真实路径
  一律 403（GFW 拦截）、`github.com` 被重置，需要 Clash 代理」。**这是错的**，两个原因叠在一起：
  当时仓库还是 private（未鉴权取 `releases/latest` 就是 404），而匿名限流返回的 403 被误读成封锁。
  2026-10-04 实测：API 200（`X-RateLimit-Remaining: 47/60`）、`github.com` 200、
  Release 附件直连 200（2.7s；走代理 737ms），下载字节的 sha256 与本地构建一致；
  `git ls-remote`（842ms）与 `gh` 也不需要代理。**代理不是必须的，只是更快/更稳**。
  文档里所有相关表述（`docs/RELEASING.md` §3/§4.4、两份 README）已一并更正。

## 1.1.1

修两处只有**真的发一次版**才会暴露的问题（发布 v1.1.0 后立刻实测到的）。

- **一个源半残不再让整次检查失败**。jsDelivr 刚拿到新标签时，它的版本列表可能还是旧的
  （实测：推完 v1.1.0 后列表里只有 1.0.0–1.0.2），而那些版本没有 `releases/` 目录，
  于是第一个源的清单 404 → 旧实现直接回「找到了最新版本 v1.0.2，但拿不到它的发布清单」，
  尽管 `@main` 上的清单已经是 1.1.0。现在每个源必须**版本与该版本的清单都拿到**才算成功，
  失败就继续问下一个；已经有一个明确更高的答案时早退出（一次点击不必问遍所有源），
  没有更新时问完全部源再取**最高**版本——不同源的缓存新鲜度不一致，取最高才不会漏更新。
- **下载不再只认标签地址**。标签可能还没被 CDN 索引（实测 `@v1.1.0/…` 一度 404），
  现在按「标签地址 → main 分支的同一路径」依次尝试。内容由 `sha256` 负责，从哪条路取都不影响安全性；
  但只有传输层失败才换路——**字节都拿到了却哈希不符是篡改信号，直接硬失败**，不再试别的来源。
- 顺带修掉一个测试卫生问题：「没有 fetch 的运行环境」那条断言在 Node 里其实退回了
  `globalThis.fetch`，于是它会真的去打网络，网络一通就误判为通过。现在真的把全局 `fetch` 摘掉再测。

新增 `verify/self-update-live.ps1`：把 `package.json` 临时降到一个低于最新标签的版本，
在 scratch profile 里真的走一遍「有更新 → 下载 → 三道校验 → pnpm 安装」，结束时按字节还原
（实测 6/6 通过）。

## 1.1.0

两个新按钮、一条自更新通道、一套动效。

**头部工具条（`刷新目录` 左边，就是截图里画圈的位置）**

- 「更新插件」：带可更新数量角标；侧边栏入口上也有同一个数字。点开**就地展开**可更新列表，
  每条自己一个「更新到 x.y.z」。故意**不做**一键全更——一次只改一个依赖，失败不连坐。
  列表数据来自 `/installed`（宿主已把目录 join 进去），所以不依赖发现页的目录请求是否完成
  （这一条是真实浏览器验收撞出来的：最初的实现要求目录先加载好，否则显示「目录还没就绪」，
  而那时其实已经有确定的更新数据了）。
- 「检查市场更新」：四态文案（检查中 / 已是最新 / 更新到 x.y.z / 更新中）。有更新时先显示一行
  说明「安装会把本机的 link: 依赖换成下载校验过的本地包」，然后再让你点。

**自更新通道（`GET`/`POST /plugin-market/self-update`）**

- 源顺序：jsDelivr 标签列表 → jsDelivr main 分支 `releases/index.json` → GitHub Releases API。
  ~~为什么不是 GitHub 优先：本机直连 `api.github.com` 的真实路径一律 403、`github.com` 直接重置连接，
  而宿主进程只认 `HTTP(S)_PROXY`（桌面版通常不带）；jsDelivr 直连可用。~~
  **这段根因写错了，已在 1.1.2 更正**：当时是 private 仓库导致的 404，加上匿名限流的 403 被误读；
  GitHub 直连是可用的（API / 网页 / Release 附件都通），1.1.2 起 GitHub API 反而排到第一源。
  详见 `docs/RELEASING.md` §4.4。
- 三道校验：产物路径必须是 `releases/*.tgz` 且拼在固定 CDN 前缀后 → 字节 `sha256` 必须与清单一致
  → 解开 tarball 读 `package/package.json`，包名与版本必须自证一致。**任何一道不过都不安装**，
  并且有测试证明「拒绝时根本没有调用 `pluginManager.installBundle`」。
- 装完后 `requiresRestart: true`，按钮回到「检查市场更新」——宿主半在进程里被 Loader 缓存，
  不谎称已生效。
- 发布流程多一步：`release.ps1` 把 tarball 复制进 `releases/` 并更新 `releases/index.json`，
  两者随版本提交一起进标签（jsDelivr 读不到 Release 附件）。**仓库必须保持 public**。

**动效（覆盖面板内的操作）**

- 卡片/列表行错峰浮入、hover 抬升、按钮按下回弹、chip 与角标弹入、页签底线滑动、
  提示条滑入 + 倒计时线（成功/信息 4.6s 自动收起，警告/错误保留）、可更新面板就地展开、
  写操作期间顶部不确定性进度条、页签切换淡入、详情展开。
- 三条硬约束（写进 `docs/API-CONTRACT.md` §4）：基础样式不写 `opacity:0`；只动
  transform/opacity/max-height；升入动画用 `animation-fill-mode: backwards`。
  第三条是踩出来的——用 `forwards`/`both` 会把 `transform` 钉在末帧，卡片 hover 抬升与按钮
  按下缩放会**全部静默失效**。
- `prefers-reduced-motion: reduce` 下全部关闭，内容按最终位置完整可见。

**新增验收**

- `verify/self-update.test.mjs`（27 条，离线）：版本比较、路径/哈希/产物自证、源回退与缓存，
  以及全部拒绝路径「不安装」。
- `verify/client-copy.test.mjs`（13 条）：zh/en 键集一致、无缺失键、无僵尸文案、关键帧齐全、
  没有升入动画用 `forwards`/`both`、reduced-motion 分支完整。
- `verify/ui-check.ps1` + `verify/market-ui.e2e.mjs`（24 条，真实浏览器）：起 scratch 宿主
  （新进程 → 加载当前代码）+ 系统自带 headless Edge 走 CDP，断言真渲染、真计算样式，
  并在同一个页面里做 `no-preference` / `reduce` 的 A/B。
- 顺带修掉一个宿主路由缺陷：路由表以 path 为键，同一路径登记两次会互相覆盖，
  `GET /self-update` 因此变成 405。现在 GET/POST 合并成单个 handler。

## 1.0.1

修复：插件被热重载后，市场页可能整页失去样式（表现为「功能都在、排版全没了」：标题变成默认字号、
卡片竖排、按钮变成浏览器默认样式）。

根因是样式节点与 DSH 的回收机制不匹配。DSH 的客户端模块系统只回收「**物化窗口内出现**」的
`<style>`：物化时被打上 `data-plugin` 记账，这一代死掉时由 `removeOwnedStyles(id)` 摘除
（`packages/client/modules/src/client/{system,entry-lifecycle}.ts`）。原实现把注入放在 `apply()` 里
（窗口之外、不被记账），又用 `getElementById` 做幂等去重——新旧两代共用同一节点时，旧代被回收
会把新代的样式一起带走，而新的 `apply` 因为「节点还在」跳过注入，页面就停在没有样式的状态。

- 样式改在 **factory 物化窗口内**注入（符合 `dsh.client` 对第三方 bundle 的要求），并且**每次物化
  挂一个全新节点**，不再与上一代共用；
- 渲染路径增加 `ensureStyles()` 兜底，并对 `document.head` 挂移除观察器：样式被摘掉后无需用户重绘
  或刷新即可自愈；观察器随插件 fiber 的 dispose 断开，不在卸载后复活；
- 新增回归测试 `verify/style-heal.test.mjs`（物化即挂 / 重新物化挂新节点 / 观察器补回 /
  渲染补回 / dispose 断开，共 5 条）。

## 1.0.0

首个版本：DeepSeek Harness 插件市场（host + web client 双半）。

- 侧边栏底部（`sidebar.footer.action`）入口 + 中央市场页面（`main` 的 `plugin-market` 席位）
- 发现页：全文搜索、分类筛选、四种排序、分页、卡片与详情
- 已安装页：启用/停用、卸载（二次确认）、更新到最新版
- 安装/卸载/开关全部走宿主 `pluginManager` 服务；仅允许目录内的来源
- 目录抓取：`DSHM_REGISTRY_URL` 覆盖、15s 超时、重试 1 次、10 分钟缓存、失败回退旧缓存并标记过期
- 写操作同源校验、请求体 64 KiB 上限、市场拒绝卸载自己
- zh/en 双语，跟随宿主语言；颜色只使用宿主主题 token
