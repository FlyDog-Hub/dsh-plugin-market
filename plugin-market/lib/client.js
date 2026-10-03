/**
 * dsh-plugin-market — 客户端半（浏览器 bundle）
 *
 * 为什么是这个形状：宿主把本文件当脚本直接从 /plugins/??dsh-plugin-market/client.js&rev=… 加载，
 * 只给一个 window.__ModuleLoader__ 装载器和平台种子模块 react。没有相对的模块解析、没有第三方组件库，
 * 所以组件、请求封装、i18n 与样式全部放在这个 factory 闭包里，不引任何其它模块。
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-market",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var el = React.createElement;

    var PANEL_KEY = "plugin-market";
    var ENTRY_ID = "plugin-market";
    var API_PREFIX = "/plugin-market";
    var SELF_NAME = "dsh-plugin-market";
    var STYLE_ID = "dsh-plugin-market-style";
    var SEARCH_DEBOUNCE_MS = 300;
    var PAGE_SIZE = 24;
    var MAX_QUERY_LENGTH = 128;

    // ───────────────────────────── 文案（zh / en 同一套 key） ─────────────────────────────
    var STRINGS = {
      zh: {
        "market.title": "插件市场",
        "market.subtitle": "浏览、安装并管理 DSH 插件",
        "market.version": "版本 {version}",
        "market.catalogMeta": "{count} 个插件 · 目录更新于 {updated}",
        "market.catalogMetaUnknown": "目录共 {count} 个插件",
        "market.entry.aria": "打开插件市场",
        "market.entry.disabled": "布局服务不可用，暂时无法打开市场",
        "tab.discover": "发现",
        "tab.installed": "已安装",
        "action.refresh": "刷新目录",
        "action.refreshing": "刷新中…",
        "action.retry": "重试",
        "action.install": "安装",
        "action.installing": "安装中…",
        "action.installed": "已安装",
        "action.update": "更新到 {version}",
        "action.updating": "更新中…",
        "action.uninstall": "卸载",
        "action.uninstalling": "卸载中…",
        "action.confirmUninstall": "确认卸载",
        "action.cancel": "取消",
        "action.details": "详情",
        "action.hideDetails": "收起",
        "action.enable": "启用",
        "action.disable": "停用",
        "action.working": "处理中…",
        "action.copy": "复制",
        "action.copied": "已复制",
        "action.copyFailed": "复制失败，请手动选中命令",
        "action.firstPage": "第一页",
        "action.clear": "清空",
        "action.goDiscover": "去发现页",
        "search.placeholder": "搜索插件名、作者或描述…",
        "search.label": "搜索插件",
        "filter.category": "分类",
        "filter.all": "全部",
        "filter.sort": "排序",
        "sort.top": "热门",
        "sort.new": "最新",
        "sort.downloads": "下载最多",
        "sort.name": "名称",
        "list.summary": "共 {total} 个结果 · 第 {page}/{pages} 页",
        "list.summaryEmpty": "没有结果",
        "list.updating": "正在更新…",
        "list.empty.title": "没有匹配的插件",
        "list.empty.body": "换个关键词、清空分类筛选，或刷新目录后重试。",
        "list.empty.action": "清空搜索与筛选",
        "list.notInstallable": "目录没有给出安装来源，无法安装",
        "pager.label": "分页",
        "pager.prev": "上一页",
        "pager.next": "下一页",
        "pager.indicator": "第 {page}/{pages} 页",
        "state.loadingCatalog": "正在加载插件目录…",
        "state.loadingInstalled": "正在读取已安装插件…",
        "state.loadingHint": "首次加载要从目录源抓取数据，通常需要一两秒。",
        "catalog.stale.title": "目录数据可能已过期",
        "catalog.stale.body": "目录源上次抓取失败（{reason}），下面显示的是 {updated} 的缓存。安装前建议先刷新目录。",
        "catalog.stale.noReason": "原因未知",
        "catalog.stale.refresh": "刷新目录",
        "readonly.title": "只读模式",
        "readonly.body": "宿主没有提供插件管理服务（pluginManager），因此只能浏览。请在桌面版 DSH 中使用本页，或在终端执行 dsh plugin 命令。",
        "status.error.title": "无法读取宿主状态",
        "status.error.body": "市场仍可浏览目录，但无法确认宿主是否支持安装。",
        "installed.empty.title": "没有可管理的插件",
        "installed.empty.body": "这个 profile 还没有装过市场目录里的插件。去发现页看看，或先在终端安装一个。",
        "installed.count": "{count} 个已安装包",
        "installed.rows": "{count} 个装载行",
        "installed.plugins": "运行中的插件条目",
        "installed.noPlugins": "没有运行中的插件条目",
        "installed.fiber": "状态：{phase}",
        "installed.rowError": "宿主报告：{message}",
        "installed.notRemovable": "这个包不允许卸载",
        "installed.self": "市场不能卸载自己；请在终端执行 dsh plugin remove dsh-plugin-market",
        "installed.detail": "展开详情",
        "installed.more": "收起详情",
        "badge.official": "官方",
        "badge.market": "本插件",
        "badge.disabled": "已停用",
        "badge.update": "有更新",
        "badge.error": "装载失败",
        "fiber.pending": "等待装载",
        "fiber.loading": "装载中",
        "fiber.active": "运行中",
        "fiber.failed": "装载失败",
        "fiber.unloading": "卸载中",
        "fiber.unknown": "未知",
        "readonlyReason.management-required": "由宿主基础设施管理，市场不能开关或卸载",
        "readonlyReason.unaddressable": "宿主无法定位这个包，市场不能操作它",
        "pending.title": "该插件需要执行构建脚本",
        "pending.body": "安装 {name} 前，包管理器要执行这些构建脚本：{builds}。它们会在你的机器上运行。确认后市场会带着你的批准重新提交安装。",
        "pending.approve": "允许并安装",
        "pending.cancel": "取消安装",
        "notice.installApplied": "已安装 {name}",
        "notice.installRestart": "已安装 {name}，重启 DSH 后生效",
        "notice.installOverridden": "已安装 {name}，但 profile 配置的覆盖层优先",
        "notice.installCancelled": "{name} 的安装已取消",
        "notice.installWarnings": "安装完成，但有提示：{warnings}",
        "notice.removeApplied": "已卸载 {name}",
        "notice.removeRestart": "已卸载 {name}，重启 DSH 后生效",
        "notice.removeCancelled": "{name} 的卸载已取消",
        "notice.toggleEnabled": "已启用 {name}",
        "notice.toggleDisabled": "已停用 {name}",
        "notice.refreshOk": "目录已刷新，共 {count} 个插件",
        "notice.noChange": "本次操作没有产生变更（宿主可能正在执行同一操作）",
        "notice.buildsPending": "{name} 需要先执行构建脚本，请在下方确认条里批准",
        "notice.buildsStillPending": "构建脚本仍未获批准：{builds}。请重试，或在终端安装。",
        "notice.buildsApproved": "已批准构建脚本，正在继续安装 {name}",
        "error.label.what": "发生了什么",
        "error.label.why": "为什么",
        "error.label.next": "现在怎么办",
        "error.label.detail": "服务端说明",
        "error.label.hint": "建议",
        "err.unknown.title": "请求没有完成",
        "err.unknown.why": "市场接口返回了没有预期的结果。",
        "err.unknown.next": "点「重试」；若持续失败，请查看宿主日志。",
        "err.network.title": "无法连接宿主的市场接口",
        "err.network.why": "浏览器到本地宿主的请求失败，宿主可能已退出或连接被拦截。",
        "err.network.next": "确认 DSH 窗口仍在运行，然后点「重试」。",
        "err.no-fetch.title": "当前环境不支持 fetch",
        "err.no-fetch.why": "浏览器没有提供请求接口，市场无法读取目录。",
        "err.no-fetch.next": "请在 DSH 桌面版或新版浏览器中打开本页。",
        "err.badResponse.title": "宿主返回了无法识别的响应",
        "err.badResponse.why": "接口返回的不是市场约定的 JSON（HTTP {status}），可能被代理或旧版本宿主拦截。",
        "err.badResponse.next": "点「重试」；若持续失败，重启 DSH 或检查是否有反向代理。",
        "err.catalog-unavailable.title": "插件目录暂时不可用",
        "err.catalog-unavailable.why": "目录源没有可用缓存，本次抓取也失败了。",
        "err.catalog-unavailable.next": "稍后点「刷新目录」重试，并确认这台机器能访问 awesome-dsh-plugin.com。",
        "err.catalog-timeout.title": "目录源响应超时",
        "err.catalog-timeout.why": "15 秒内没有收到目录源的完整响应。",
        "err.catalog-timeout.next": "稍后点「刷新目录」重试；其它功能不受影响。",
        "err.manager-unavailable.title": "宿主没有插件管理服务",
        "err.manager-unavailable.why": "当前 DSH 运行环境没有提供 pluginManager，市场不能安装或卸载插件。",
        "err.manager-unavailable.next": "在桌面版 DSH 里使用本页，或在终端执行 dsh plugin --profile <profile> add <包名>。",
        "err.not-in-catalog.title": "这个插件不在目录内",
        "err.not-in-catalog.why": "出于安全考虑，市场只允许安装目录里列出的插件。",
        "err.not-in-catalog.next": "选择目录内的插件，或在终端手动安装该包。",
        "err.install-failed.title": "安装没有完成",
        "err.install-failed.why": "宿主在执行安装时失败，通常是包名不存在、网络不可达或版本不兼容。",
        "err.install-failed.next": "看下面的服务端说明，修正后点「重试」，也可以在终端手动安装。",
        "err.remove-failed.title": "卸载没有完成",
        "err.remove-failed.why": "宿主在移除这个包时失败，可能有进程正在使用它。",
        "err.remove-failed.next": "关闭正在使用它的会话或窗口后重试，或在终端执行 dsh plugin remove。",
        "err.toggle-failed.title": "启用状态没有改变",
        "err.toggle-failed.why": "宿主没有完成这次开关操作。",
        "err.toggle-failed.next": "点「重试」；如果这一条由宿主管理，请在设置页操作。",
        "err.not-allowed.title": "这个操作被宿主拒绝",
        "err.not-allowed.why": "该插件由宿主基础设施管理，不能在市场里开关或卸载。",
        "err.not-allowed.next": "按下面的服务端说明，在终端或设置页处理。",
        "err.cross-origin.title": "请求被跨站保护拒绝",
        "err.cross-origin.why": "市场接口只接受来自本页面的请求。",
        "err.cross-origin.next": "在本页内重试；不要用其它站点或脚本调用这个接口。",
        "err.bad-request.title": "请求参数不被接受",
        "err.bad-request.why": "市场发出的参数和宿主预期不一致。",
        "err.bad-request.next": "重试一次；如果仍然失败，可能是插件与宿主版本不匹配，请更新 dsh-plugin-market。",
        "err.method-not-allowed.title": "请求方法不被允许",
        "err.method-not-allowed.why": "这个地址不接受当前的请求方式，通常说明宿主的市场路由版本较旧。",
        "err.method-not-allowed.next": "重启 DSH，让插件与宿主一起加载，然后重试。",
        "err.not-found.title": "市场接口不存在",
        "err.not-found.why": "宿主没有注册 /plugin-market 路由，插件可能没有装载成功。",
        "err.not-found.next": "检查插件是否已启用，然后重启 DSH。",
        "err.internal.title": "宿主内部出错",
        "err.internal.why": "市场路由在服务端抛出了异常。",
        "err.internal.next": "点「重试」；持续失败请查看宿主日志。",
        "err.aborted.title": "请求已取消",
        "err.aborted.why": "你切换了页签或开始了新的搜索，之前的请求不再需要。",
        "err.aborted.next": "无需处理，重新操作即可。",
        "capability.fs-read": "读取文件",
        "capability.fs-write": "写入文件",
        "capability.network": "网络访问",
        "capability.env": "环境变量",
        "capability.shell": "执行命令",
        "capability.credentials": "访问凭据",
        "capability.llm": "调用模型",
        "capability.host-runtime": "宿主运行时",
        "capability.dynamic-code": "动态代码",
        "capability.subagent": "子代理",
        "capability.other": "其它能力",
        "detail.description": "说明",
        "detail.capabilities": "能力",
        "detail.links": "链接",
        "detail.repo": "代码仓库",
        "detail.page": "目录页",
        "detail.command": "安装命令",
        "detail.version": "版本",
        "detail.added": "收录时间",
        "meta.stars": "★ {count}",
        "meta.downloads": "↓ {count}"
      },
      en: {
        "market.title": "Plugin Market",
        "market.subtitle": "Browse, install, and manage DSH plugins",
        "market.version": "Version {version}",
        "market.catalogMeta": "{count} plugins · catalog updated {updated}",
        "market.catalogMetaUnknown": "{count} plugins in the catalog",
        "market.entry.aria": "Open the plugin market",
        "market.entry.disabled": "The layout service is unavailable, so the market cannot open",
        "tab.discover": "Discover",
        "tab.installed": "Installed",
        "action.refresh": "Refresh catalog",
        "action.refreshing": "Refreshing…",
        "action.retry": "Retry",
        "action.install": "Install",
        "action.installing": "Installing…",
        "action.installed": "Installed",
        "action.update": "Update to {version}",
        "action.updating": "Updating…",
        "action.uninstall": "Uninstall",
        "action.uninstalling": "Uninstalling…",
        "action.confirmUninstall": "Confirm uninstall",
        "action.cancel": "Cancel",
        "action.details": "Details",
        "action.hideDetails": "Hide details",
        "action.enable": "Enable",
        "action.disable": "Disable",
        "action.working": "Working…",
        "action.copy": "Copy",
        "action.copied": "Copied",
        "action.copyFailed": "Copy failed; select the command manually",
        "action.firstPage": "First page",
        "action.clear": "Clear",
        "action.goDiscover": "Go to Discover",
        "search.placeholder": "Search name, author, or description…",
        "search.label": "Search plugins",
        "filter.category": "Category",
        "filter.all": "All",
        "filter.sort": "Sort",
        "sort.top": "Popular",
        "sort.new": "Newest",
        "sort.downloads": "Most downloaded",
        "sort.name": "Name",
        "list.summary": "{total} results · page {page}/{pages}",
        "list.summaryEmpty": "No results",
        "list.updating": "Updating…",
        "list.empty.title": "No matching plugins",
        "list.empty.body": "Try another keyword, clear the category filter, or refresh the catalog.",
        "list.empty.action": "Clear search and filters",
        "list.notInstallable": "The catalog lists no install source for it",
        "pager.label": "Pagination",
        "pager.prev": "Previous",
        "pager.next": "Next",
        "pager.indicator": "Page {page}/{pages}",
        "state.loadingCatalog": "Loading the plugin catalog…",
        "state.loadingInstalled": "Reading installed plugins…",
        "state.loadingHint": "The first load fetches the catalog; it usually takes a second or two.",
        "catalog.stale.title": "Catalog data may be out of date",
        "catalog.stale.body": "The last catalog fetch failed ({reason}), so this is the cache from {updated}. Refresh the catalog before installing.",
        "catalog.stale.noReason": "reason unknown",
        "catalog.stale.refresh": "Refresh catalog",
        "readonly.title": "Read-only mode",
        "readonly.body": "The host provides no pluginManager service, so browsing is all the market can do. Use this page in the DSH desktop app, or run dsh plugin in a terminal.",
        "status.error.title": "Cannot read host status",
        "status.error.body": "The market can still browse the catalog, but cannot tell whether installing is supported.",
        "installed.empty.title": "No manageable plugins",
        "installed.empty.body": "This profile has no plugins from the market catalog yet. Check Discover, or install one in a terminal first.",
        "installed.count": "{count} installed packages",
        "installed.rows": "{count} load rows",
        "installed.plugins": "Running plugin entries",
        "installed.noPlugins": "No running plugin entries",
        "installed.fiber": "Status: {phase}",
        "installed.rowError": "Host reports: {message}",
        "installed.notRemovable": "This package cannot be removed",
        "installed.self": "The market cannot remove itself; run dsh plugin remove dsh-plugin-market in a terminal",
        "installed.detail": "Show details",
        "installed.more": "Hide details",
        "badge.official": "Official",
        "badge.market": "This plugin",
        "badge.disabled": "Disabled",
        "badge.update": "Update available",
        "badge.error": "Load failed",
        "fiber.pending": "Pending",
        "fiber.loading": "Loading",
        "fiber.active": "Active",
        "fiber.failed": "Failed",
        "fiber.unloading": "Unloading",
        "fiber.unknown": "Unknown",
        "readonlyReason.management-required": "Managed by host infrastructure; the market cannot toggle or remove it",
        "readonlyReason.unaddressable": "The host cannot address this package, so the market cannot change it",
        "pending.title": "This plugin needs install scripts",
        "pending.body": "Before installing {name}, the package manager wants to run these install scripts: {builds}. They run on your machine. Approve to resubmit the install with your approval.",
        "pending.approve": "Allow and install",
        "pending.cancel": "Cancel install",
        "notice.installApplied": "Installed {name}",
        "notice.installRestart": "Installed {name}; restart DSH to apply",
        "notice.installOverridden": "Installed {name}, but a profile override takes precedence",
        "notice.installCancelled": "The install of {name} was cancelled",
        "notice.installWarnings": "Installed, with warnings: {warnings}",
        "notice.removeApplied": "Removed {name}",
        "notice.removeRestart": "Removed {name}; restart DSH to apply",
        "notice.removeCancelled": "The removal of {name} was cancelled",
        "notice.toggleEnabled": "Enabled {name}",
        "notice.toggleDisabled": "Disabled {name}",
        "notice.refreshOk": "Catalog refreshed: {count} plugins",
        "notice.noChange": "This operation made no change (the host may already be running it)",
        "notice.buildsPending": "{name} needs install scripts first; approve them in the banner below",
        "notice.buildsStillPending": "Install scripts remain unapproved: {builds}. Retry, or install in a terminal.",
        "notice.buildsApproved": "Build scripts approved; continuing the install of {name}",
        "error.label.what": "What happened",
        "error.label.why": "Why",
        "error.label.next": "What to do now",
        "error.label.detail": "Server message",
        "error.label.hint": "Suggestion",
        "err.unknown.title": "The request did not complete",
        "err.unknown.why": "The market endpoint returned an unexpected result.",
        "err.unknown.next": "Retry; if it keeps failing, check the host log.",
        "err.network.title": "Cannot reach the host market endpoint",
        "err.network.why": "The request from the browser to the local host failed; the host may have exited or the connection is blocked.",
        "err.network.next": "Make sure the DSH window is still running, then retry.",
        "err.no-fetch.title": "This environment has no fetch",
        "err.no-fetch.why": "The browser exposes no request API, so the market cannot read the catalog.",
        "err.no-fetch.next": "Open this page in the DSH desktop app or a current browser.",
        "err.badResponse.title": "The host returned an unrecognized response",
        "err.badResponse.why": "The endpoint did not return the market's JSON (HTTP {status}); a proxy or an older host may be intercepting it.",
        "err.badResponse.next": "Retry; if it keeps failing, restart DSH or check for a reverse proxy.",
        "err.catalog-unavailable.title": "The plugin catalog is temporarily unavailable",
        "err.catalog-unavailable.why": "No cached catalog exists and this fetch failed too.",
        "err.catalog-unavailable.next": "Retry with Refresh catalog in a moment, and check that this machine can reach awesome-dsh-plugin.com.",
        "err.catalog-timeout.title": "The catalog source timed out",
        "err.catalog-timeout.why": "No complete response arrived within 15 seconds.",
        "err.catalog-timeout.next": "Retry with Refresh catalog later; nothing else is affected.",
        "err.manager-unavailable.title": "The host has no plugin management service",
        "err.manager-unavailable.why": "This DSH runtime provides no pluginManager, so the market cannot install or remove plugins.",
        "err.manager-unavailable.next": "Use this page in the DSH desktop app, or run dsh plugin --profile <profile> add <package> in a terminal.",
        "err.not-in-catalog.title": "This plugin is not in the catalog",
        "err.not-in-catalog.why": "For safety the market only installs plugins listed in the catalog.",
        "err.not-in-catalog.next": "Pick a catalog plugin, or install this package manually in a terminal.",
        "err.install-failed.title": "The install did not finish",
        "err.install-failed.why": "The host failed while installing, usually because the package is missing, the network is unreachable, or the version is incompatible.",
        "err.install-failed.next": "Read the server message below, fix it, then retry, or install manually in a terminal.",
        "err.remove-failed.title": "The removal did not finish",
        "err.remove-failed.why": "The host failed to remove the package; something may still be using it.",
        "err.remove-failed.next": "Close the session or window using it and retry, or run dsh plugin remove in a terminal.",
        "err.toggle-failed.title": "The enabled state did not change",
        "err.toggle-failed.why": "The host did not complete this switch operation.",
        "err.toggle-failed.next": "Retry; if the host manages this row, change it on the settings page.",
        "err.not-allowed.title": "The host rejected this operation",
        "err.not-allowed.why": "Host infrastructure manages this plugin, so the market cannot toggle or remove it.",
        "err.not-allowed.next": "Follow the server message below and use a terminal or the settings page.",
        "err.cross-origin.title": "The cross-site guard rejected the request",
        "err.cross-origin.why": "The market endpoint only accepts requests from this page.",
        "err.cross-origin.next": "Retry from this page; do not call the endpoint from another site or script.",
        "err.bad-request.title": "The request parameters were rejected",
        "err.bad-request.why": "The parameters the market sent do not match what the host expects.",
        "err.bad-request.next": "Retry once; if it still fails, the plugin and host versions may not match, so update dsh-plugin-market.",
        "err.method-not-allowed.title": "The request method is not allowed",
        "err.method-not-allowed.why": "This address does not accept the current method, which usually means the host routes are older.",
        "err.method-not-allowed.next": "Restart DSH so plugin and host load together, then retry.",
        "err.not-found.title": "The market endpoint does not exist",
        "err.not-found.why": "The host registered no /plugin-market route, so the plugin may not have loaded.",
        "err.not-found.next": "Check that the plugin is enabled, then restart DSH.",
        "err.internal.title": "The host failed internally",
        "err.internal.why": "The market route threw on the server side.",
        "err.internal.next": "Retry; if it keeps failing, check the host log.",
        "err.aborted.title": "The request was cancelled",
        "err.aborted.why": "You switched tabs or started a new search, so the earlier request is no longer needed.",
        "err.aborted.next": "Nothing to do; just continue.",
        "capability.fs-read": "File read",
        "capability.fs-write": "File write",
        "capability.network": "Network access",
        "capability.env": "Environment variables",
        "capability.shell": "Shell execution",
        "capability.credentials": "Credential access",
        "capability.llm": "Model calls",
        "capability.host-runtime": "Host runtime",
        "capability.dynamic-code": "Dynamic code",
        "capability.subagent": "Subagents",
        "capability.other": "Other capability",
        "detail.description": "Description",
        "detail.capabilities": "Capabilities",
        "detail.links": "Links",
        "detail.repo": "Repository",
        "detail.page": "Catalog page",
        "detail.command": "Install command",
        "detail.version": "Version",
        "detail.added": "Added",
        "meta.stars": "★ {count}",
        "meta.downloads": "↓ {count}"
      }
    };

    // ───────────────────────────── 语言与全局订阅 ─────────────────────────────
    // 组件要跟随宿主语言即时切换，但组件拿不到 ctx，所以语言放在模块级，
    // apply 里把 locale 服务的变化广播给已挂载的组件。
    var ACTIVE_LOCALE = "zh";
    var changeListeners = [];

    function normalizeLocale(value) {
      return String(value || "").toLowerCase().indexOf("en") === 0 ? "en" : "zh";
    }

    function publishChange() {
      var listeners = changeListeners.slice();
      for (var i = 0; i < listeners.length; i++) {
        try {
          listeners[i]();
        } catch (listenerError) {
          // 命名单个订阅者失败：一个组件的问题不能让其余订阅者停在旧语言或旧选中态。
        }
      }
    }

    function subscribeChange(listener) {
      changeListeners.push(listener);
      return function () {
        var at = changeListeners.indexOf(listener);
        if (at >= 0) changeListeners.splice(at, 1);
      };
    }

    function setActiveLocale(value) {
      var next = normalizeLocale(value);
      if (next === ACTIVE_LOCALE) return;
      ACTIVE_LOCALE = next;
      publishChange();
    }

    function detectLocale() {
      try {
        var language = typeof navigator !== "undefined" && navigator.language ? navigator.language : "";
        return String(language).toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
      } catch (detectError) {
        return "zh";
      }
    }

    function t(key, vars) {
      var table = STRINGS[ACTIVE_LOCALE] || STRINGS.zh;
      var value = table[key];
      if (value === undefined) value = STRINGS.zh[key];
      if (value === undefined) return key;
      if (!vars) return value;
      return String(value).replace(/\{(\w+)\}/g, function (match, name) {
        var replacement = vars[name];
        return replacement === undefined || replacement === null ? match : String(replacement);
      });
    }

    // 组件用这个 hook 在语言或入口可用性变化时重渲染。
    function useChangeTick() {
      var state = React.useState(0);
      var bump = state[1];
      React.useEffect(function () {
        return subscribeChange(function () {
          bump(function (n) { return n + 1; });
        });
      }, []);
      return ACTIVE_LOCALE;
    }

    // ───────────────────────────── 格式化 ─────────────────────────────
    function formatCount(value) {
      var number = Number(value);
      if (!isFinite(number)) return value === undefined || value === null ? "" : String(value);
      if (number >= 10000) return (Math.round(number / 100) / 10) + "k";
      return String(number);
    }

    function formatDate(value) {
      return typeof value === "string" && value ? value : "";
    }

    function categoryLabel(categoriesById, id) {
      var entry = categoriesById && categoriesById[id];
      if (!entry) return id || "";
      return (ACTIVE_LOCALE === "en" ? entry.en : entry.zh) || entry.zh || entry.en || id;
    }

    function capabilityLabel(token) {
      var key = "capability." + String(token);
      var label = t(key);
      return label === key ? String(token) : label;
    }

    function descriptionText(description) {
      if (!description) return "";
      if (typeof description === "string") return description;
      if (ACTIVE_LOCALE === "en") return description.en || description.zh || "";
      return description.zh || description.en || "";
    }

    function formatPhaseLabel(phase) {
      if (!phase) return t("fiber.unknown");
      var key = "fiber." + String(phase);
      var label = t(key);
      return label === key ? String(phase) : label;
    }

    // ───────────────────────────── 请求与错误 ─────────────────────────────
    // 错误对象带 code / message / hint：组件按 §1 的三段文案渲染，而不是只显示一句“失败了”。
    function marketError(code, message, hint, extra) {
      var error = new Error(message || t("err.unknown.title"));
      error.name = "MarketError";
      error.code = code || "unknown";
      error.hint = hint || "";
      if (extra) {
        if (extra.diagnostic) error.diagnostic = extra.diagnostic;
        if (extra.status !== undefined) error.status = extra.status;
        if (extra.incompatible !== undefined) error.incompatible = extra.incompatible;
      }
      return error;
    }

    function codeForStatus(status) {
      if (status === 403) return "cross-origin";
      if (status === 404) return "not-found";
      if (status === 405) return "method-not-allowed";
      if (status === 502) return "catalog-unavailable";
      if (status === 504) return "catalog-timeout";
      if (status >= 400 && status < 500) return "bad-request";
      return "internal";
    }

    function appendParam(parts, key, value) {
      if (value === undefined || value === null || value === "") return;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
    }

    function requestJSON(path, options) {
      var opts = options || {};
      if (typeof fetch !== "function") {
        return Promise.reject(marketError("no-fetch", t("err.no-fetch.title"), t("err.no-fetch.next")));
      }
      var init = {
        method: opts.method || "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store"
      };
      if (opts.signal) init.signal = opts.signal;
      if (opts.body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(opts.body);
      }
      return fetch(API_PREFIX + path, init).then(function (response) {
        return response.text().then(function (raw) {
          var payload = null;
          if (raw) {
            try {
              payload = JSON.parse(raw);
            } catch (parseError) {
              payload = null;
            }
          }
          if (!payload || typeof payload !== "object") {
            var shapeCode = codeForStatus(response.status);
            throw marketError(
              shapeCode,
              t("err.badResponse.title"),
              t("err." + shapeCode + ".next"),
              { status: response.status }
            );
          }
          if (payload.ok !== true) {
            var info = payload.error && typeof payload.error === "object" ? payload.error : {};
            var code = info.code || codeForStatus(response.status);
            throw marketError(
              code,
              info.message || t("err.unknown.title"),
              info.hint || "",
              { diagnostic: info.diagnostic, status: response.status, incompatible: info.incompatible }
            );
          }
          return payload;
        });
      }, function (cause) {
        if (cause && (cause.name === "AbortError" || cause.code === 20)) {
          var aborted = marketError("aborted", t("err.aborted.title"), t("err.aborted.next"));
          aborted.aborted = true;
          throw aborted;
        }
        throw marketError("network", t("err.network.title"), t("err.network.next"));
      });
    }

    var api = {
      status: function (signal) {
        return requestJSON("/status", { signal: signal });
      },
      catalog: function (params, signal) {
        var parts = [];
        appendParam(parts, "query", params.query);
        appendParam(parts, "category", params.category);
        appendParam(parts, "sort", params.sort);
        appendParam(parts, "page", params.page);
        appendParam(parts, "pageSize", params.pageSize);
        if (params.installed) appendParam(parts, "installed", 1);
        if (params.updates) appendParam(parts, "updates", 1);
        return requestJSON("/catalog" + (parts.length ? "?" + parts.join("&") : ""), { signal: signal });
      },
      installed: function (signal) {
        return requestJSON("/installed", { signal: signal });
      },
      // 写操作不接 signal：中断一个已经发出去的安装只会让宿主状态不明，
      // 组件改为在卸载后忽略结果（mountedRef）。
      install: function (body) {
        return requestJSON("/install", { method: "POST", body: body });
      },
      remove: function (name) {
        return requestJSON("/remove", { method: "POST", body: { name: name } });
      },
      toggle: function (body) {
        return requestJSON("/toggle", { method: "POST", body: body });
      },
      refresh: function (signal) {
        return requestJSON("/refresh", { method: "POST", body: {}, signal: signal });
      }
    };

    function newRequestId() {
      return "pm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }

    var ERROR_PREFIXES = {
      "network": true,
      "no-fetch": true,
      "badResponse": true,
      "catalog-unavailable": true,
      "catalog-timeout": true,
      "manager-unavailable": true,
      "not-in-catalog": true,
      "install-failed": true,
      "remove-failed": true,
      "toggle-failed": true,
      "not-allowed": true,
      "cross-origin": true,
      "bad-request": true,
      "method-not-allowed": true,
      "not-found": true,
      "internal": true,
      "aborted": true
    };

    function errorCopy(error) {
      var code = error && error.code ? String(error.code) : "unknown";
      var known = !!ERROR_PREFIXES[code];
      var prefix = known ? "err." + code : "err.unknown";
      var status = error && error.status !== undefined ? error.status : "";
      var message = error && error.message ? String(error.message) : "";
      var copy = {
        code: code,
        title: t(prefix + ".title", { status: status }),
        why: t(prefix + ".why"),
        next: t(prefix + ".next"),
        message: message,
        hint: error && error.hint ? String(error.hint) : ""
      };
      if (!known && message) copy.why = message;
      return copy;
    }

    // ───────────────────────────── 图标（内联 SVG，宿主没有共享组件库） ─────────────────────────────
    function svgRoot(size, children) {
      return el("svg", {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.4,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        focusable: "false",
        "aria-hidden": "true"
      }, children);
    }

    function IconMarket(props) {
      var size = (props && props.size) || 16;
      return svgRoot(size, [
        el("path", { key: "a", d: "M2 6.6 3.3 3h9.4L14 6.6" }),
        el("path", { key: "b", d: "M2.9 6.6v6.1c0 .5.4.8.8.8h8.6c.4 0 .8-.3.8-.8V6.6" }),
        el("path", { key: "c", d: "M6.3 13.5V9.6h3.4v3.9" })
      ]);
    }

    function IconSearch(props) {
      var size = (props && props.size) || 15;
      return svgRoot(size, [
        el("circle", { key: "a", cx: 7, cy: 7, r: 4.1 }),
        el("path", { key: "b", d: "M10.2 10.2 13.6 13.6" })
      ]);
    }

    function IconRefresh(props) {
      var size = (props && props.size) || 14;
      return svgRoot(size, [
        el("path", { key: "a", d: "M2.8 8a5.2 5.2 0 0 1 8.9-3.7" }),
        el("path", { key: "b", d: "M13.2 8a5.2 5.2 0 0 1-8.9 3.7" }),
        el("path", { key: "c", d: "M11.7 1.6v2.7H9" }),
        el("path", { key: "d", d: "M4.3 14.4v-2.7H7" })
      ]);
    }

    function IconSpinner(props) {
      var size = (props && props.size) || 15;
      return el("svg", {
        className: "dshpm-spinner",
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.6,
        strokeLinecap: "round",
        focusable: "false",
        "aria-hidden": "true"
      }, el("path", { d: "M8 1.6a6.4 6.4 0 1 0 6.4 6.4" }));
    }

    function IconClose(props) {
      var size = (props && props.size) || 13;
      return svgRoot(size, [
        el("path", { key: "a", d: "M4 4l8 8" }),
        el("path", { key: "b", d: "M12 4l-8 8" })
      ]);
    }

    function IconChevron(props) {
      var size = (props && props.size) || 13;
      var d = props && props.direction === "up" ? "M4.5 10 8 6.5l3.5 3.5" : "M4.5 6.5 8 10l3.5-3.5";
      return svgRoot(size, el("path", { d: d }));
    }

    function IconExternal(props) {
      var size = (props && props.size) || 12;
      return svgRoot(size, [
        el("path", { key: "a", d: "M6.6 3.6H3.9c-.5 0-.9.4-.9.9v7c0 .5.4.9.9.9h7c.5 0 .9-.4.9-.9V8.8" }),
        el("path", { key: "b", d: "M9.6 2.7h3.7v3.7" }),
        el("path", { key: "c", d: "M13.3 2.7 7.9 8.1" })
      ]);
    }

    function IconCheck(props) {
      var size = (props && props.size) || 13;
      return svgRoot(size, el("path", { d: "M3 8.6 6.2 11.8 13 4.8" }));
    }

    function IconCopy(props) {
      var size = (props && props.size) || 13;
      return svgRoot(size, [
        el("path", { key: "a", d: "M6 5.4h5.7c.5 0 .9.4.9.9v5.8c0 .5-.4.9-.9.9H6c-.5 0-.9-.4-.9-.9V6.3c0-.5.4-.9.9-.9z" }),
        el("path", { key: "b", d: "M3.9 10.4h-.6c-.5 0-.9-.4-.9-.9V3.8c0-.5.4-.9.9-.9h5.4c.5 0 .9.4.9.9v.6" })
      ]);
    }

    function IconTrash(props) {
      var size = (props && props.size) || 13;
      return svgRoot(size, [
        el("path", { key: "a", d: "M2.9 4.4h10.2" }),
        el("path", { key: "b", d: "M6.4 2.6h3.2" }),
        el("path", { key: "c", d: "M4.4 4.4l.6 8.1c0 .5.4.9.9.9h4.2c.5 0 .9-.4.9-.9l.6-8.1" })
      ]);
    }

    function IconInfo(props) {
      var size = (props && props.size) || 14;
      return svgRoot(size, [
        el("circle", { key: "a", cx: 8, cy: 8, r: 6 }),
        el("path", { key: "b", d: "M8 7.4v3.4" }),
        el("path", { key: "c", d: "M8 5.1h.01" })
      ]);
    }

    function IconAlert(props) {
      var size = (props && props.size) || 14;
      return svgRoot(size, [
        el("path", { key: "a", d: "M8 2.4 14.2 13.4H1.8z" }),
        el("path", { key: "b", d: "M8 6.4v3" }),
        el("path", { key: "c", d: "M8 11.5h.01" })
      ]);
    }

    // ───────────────────────────── 样式 ─────────────────────────────
    var STYLES = `
.dshpm-entry { display:flex; align-items:center; gap:8px; margin:0 2px; min-height:36px; padding:7px 8px; box-sizing:border-box; border:none; border-radius:var(--dsw-radius-md,8px); background:transparent; color:var(--dsw-alias-label-primary,#1a1a1a); font:inherit; line-height:22px; text-align:left; cursor:pointer; flex:1 1 100%; min-width:0; }
.dshpm-entry:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dshpm-entry[data-active="true"] { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dshpm-entry:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe)); outline-offset:-2px; }
.dshpm-entry:disabled { opacity:.55; cursor:not-allowed; }
.dshpm-entry[data-wide="false"] { flex:none; width:36px; height:36px; min-height:36px; padding:0; justify-content:center; }
.dshpm-entryIcon { flex:none; display:inline-flex; align-items:center; justify-content:center; }
.dshpm-entryLabel { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dshpm-root { display:flex; flex-direction:column; gap:12px; box-sizing:border-box; width:100%; height:100%; min-height:0; overflow:auto; padding:16px clamp(16px,3vw,32px) 32px; color:var(--dsw-alias-label-primary,#1a1a1a); background:var(--dsw-alias-bg-base,transparent); }
.dshpm-header { display:flex; align-items:flex-start; gap:12px; flex-wrap:wrap; }
.dshpm-headerMain { flex:1 1 240px; min-width:0; }
.dshpm-title { margin:0; font-size:1.1em; font-weight:600; }
.dshpm-subtitle { margin-top:2px; color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.85em; }
.dshpm-headerActions { display:flex; align-items:center; gap:8px; flex:none; }
.dshpm-tabs { display:flex; gap:4px; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08)); }
.dshpm-tab { border:none; background:transparent; color:var(--dsw-alias-label-secondary,#6b6b6b); font:inherit; font-size:.92em; padding:6px 10px; cursor:pointer; border-bottom:2px solid transparent; }
.dshpm-tab[data-active="true"] { color:var(--dsw-alias-label-primary,#1a1a1a); border-bottom-color:var(--dsw-alias-brand-primary,#4d6bfe); }
.dshpm-tab:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe)); outline-offset:2px; }
.dshpm-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dshpm-search { display:flex; align-items:center; gap:6px; flex:1 1 220px; min-width:180px; padding:5px 8px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12)); border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); }
.dshpm-search:focus-within { border-color:var(--dsw-alias-brand-primary,#4d6bfe); }
.dshpm-searchIcon { flex:none; display:inline-flex; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-input { flex:1 1 auto; min-width:0; border:none; outline:none; background:transparent; color:inherit; font:inherit; font-size:.9em; }
.dshpm-select { border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12)); border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); color:inherit; font:inherit; font-size:.85em; padding:5px 6px; }
.dshpm-iconBtn { flex:none; display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; padding:0; border:none; border-radius:var(--dsw-radius-md,8px); background:transparent; color:var(--dsw-alias-label-secondary,#6b6b6b); cursor:pointer; }
.dshpm-iconBtn:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dshpm-iconBtn:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe)); outline-offset:1px; }
.dshpm-chips { display:flex; gap:6px; flex-wrap:wrap; }
.dshpm-chip { border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12)); border-radius:999px; background:transparent; color:var(--dsw-alias-label-secondary,#6b6b6b); font:inherit; font-size:.8em; padding:3px 10px; cursor:pointer; }
.dshpm-chip:hover { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dshpm-chip[data-active="true"] { border-color:var(--dsw-alias-brand-primary,#4d6bfe); color:var(--dsw-alias-brand-primary,#4d6bfe); }
.dshpm-chip:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe)); outline-offset:1px; }
.dshpm-summary { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.82em; }
.dshpm-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(232px,1fr)); gap:10px; }
.dshpm-card { display:flex; flex-direction:column; gap:8px; box-sizing:border-box; padding:12px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-radius:var(--dsw-radius-md,10px); background:var(--dsw-alias-bg-layer-1,transparent); }
.dshpm-cardHead { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
.dshpm-cardName { margin:0; font-size:.95em; font-weight:600; overflow-wrap:anywhere; }
.dshpm-cardOwner { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.78em; }
.dshpm-cardDesc { margin:0; color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.82em; line-height:1.5; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.dshpm-cardMeta { display:flex; align-items:center; gap:10px; flex-wrap:wrap; color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.78em; }
.dshpm-cardActions { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:auto; }
.dshpm-detail { display:flex; flex-direction:column; gap:8px; padding-top:8px; border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08)); font-size:.82em; }
.dshpm-detailRow { display:flex; gap:8px; align-items:flex-start; }
.dshpm-detailKey { flex:none; width:5.5em; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-detailValue { flex:1 1 auto; min-width:0; overflow-wrap:anywhere; }
.dshpm-tags { display:flex; gap:4px; flex-wrap:wrap; }
.dshpm-tag { border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12)); border-radius:999px; padding:1px 8px; font-size:.95em; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-code { display:block; box-sizing:border-box; width:100%; padding:6px 8px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-radius:var(--dsw-radius-md,6px); background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08)); color:var(--dsw-alias-label-primary,#1a1a1a); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.95em; overflow-wrap:anywhere; }
.dshpm-link { color:var(--dsw-alias-brand-primary,#4d6bfe); text-decoration:none; display:inline-flex; align-items:center; gap:3px; }
.dshpm-link:hover { text-decoration:underline; }
.dshpm-btn { display:inline-flex; align-items:center; gap:5px; box-sizing:border-box; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16)); border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); color:var(--dsw-alias-label-primary,#1a1a1a); font:inherit; font-size:.82em; padding:4px 10px; cursor:pointer; }
.dshpm-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)); }
.dshpm-btn:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe)); outline-offset:1px; }
.dshpm-btn:disabled { opacity:.5; cursor:not-allowed; }
.dshpm-btn--primary { border-color:transparent; background:var(--dsw-alias-brand-primary,#4d6bfe); color:#fff; }
.dshpm-btn--primary:hover:not(:disabled) { background:var(--dsw-alias-brand-primary,#4d6bfe); filter:brightness(1.08); }
.dshpm-btn--danger { border-color:var(--dsw-alias-state-error-primary,#d93025); color:var(--dsw-alias-state-error-primary,#d93025); background:transparent; }
.dshpm-btn--quiet { border-color:transparent; background:transparent; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-badge { border-radius:999px; padding:1px 7px; font-size:.72em; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12)); color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-badge--success { color:var(--dsw-alias-state-success-primary,#1f9d55); border-color:var(--dsw-alias-state-success-primary,#1f9d55); }
.dshpm-badge--warn { color:var(--dsw-alias-state-warn-primary,#b7791f); border-color:var(--dsw-alias-state-warn-primary,#b7791f); }
.dshpm-badge--error { color:var(--dsw-alias-state-error-primary,#d93025); border-color:var(--dsw-alias-state-error-primary,#d93025); }
.dshpm-notice { display:flex; align-items:flex-start; gap:8px; box-sizing:border-box; padding:8px 10px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-left-width:3px; border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); font-size:.84em; }
.dshpm-notice[data-kind="success"] { border-left-color:var(--dsw-alias-state-success-primary,#1f9d55); }
.dshpm-notice[data-kind="warn"] { border-left-color:var(--dsw-alias-state-warn-primary,#b7791f); }
.dshpm-notice[data-kind="error"] { border-left-color:var(--dsw-alias-state-error-primary,#d93025); }
.dshpm-notice[data-kind="info"] { border-left-color:var(--dsw-alias-state-idle-primary,#8a8a8a); }
.dshpm-noticeIcon { flex:none; display:inline-flex; margin-top:1px; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-notice[data-kind="success"] .dshpm-noticeIcon { color:var(--dsw-alias-state-success-primary,#1f9d55); }
.dshpm-notice[data-kind="warn"] .dshpm-noticeIcon { color:var(--dsw-alias-state-warn-primary,#b7791f); }
.dshpm-notice[data-kind="error"] .dshpm-noticeIcon { color:var(--dsw-alias-state-error-primary,#d93025); }
.dshpm-noticeBody { flex:1 1 auto; min-width:0; }
.dshpm-noticeTitle { font-weight:600; }
.dshpm-banner { display:flex; flex-direction:column; gap:6px; box-sizing:border-box; padding:10px 12px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-left-width:3px; border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); font-size:.85em; }
.dshpm-banner[data-kind="warn"] { border-left-color:var(--dsw-alias-state-warn-primary,#b7791f); }
.dshpm-banner[data-kind="error"] { border-left-color:var(--dsw-alias-state-error-primary,#d93025); }
.dshpm-banner[data-kind="info"] { border-left-color:var(--dsw-alias-state-idle-primary,#8a8a8a); }
.dshpm-bannerActions { display:flex; gap:6px; flex-wrap:wrap; }
.dshpm-error { display:flex; flex-direction:column; gap:6px; box-sizing:border-box; padding:12px; border:1px solid var(--dsw-alias-state-error-primary,#d93025); border-radius:var(--dsw-radius-md,8px); background:var(--dsw-alias-bg-layer-1,transparent); }
.dshpm-errorTitle { font-weight:600; color:var(--dsw-alias-state-error-primary,#d93025); }
.dshpm-errorBody { display:flex; flex-direction:column; gap:4px; font-size:.85em; }
.dshpm-errorLine { display:flex; gap:8px; align-items:flex-start; }
.dshpm-errorKey { flex:none; width:5.5em; color:var(--dsw-alias-label-secondary,#6b6b6b); }
.dshpm-errorCode { flex:1 1 auto; min-width:0; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; overflow-wrap:anywhere; }
.dshpm-empty { display:flex; flex-direction:column; align-items:flex-start; gap:6px; padding:20px 16px; border:1px dashed var(--dsw-alias-border-l1,rgba(0,0,0,.16)); border-radius:var(--dsw-radius-md,10px); }
.dshpm-emptyTitle { font-weight:600; }
.dshpm-emptyBody { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.85em; max-width:52em; }
.dshpm-loading { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.85em; }
.dshpm-skeletonGrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(232px,1fr)); gap:10px; }
.dshpm-skeleton { height:104px; border-radius:var(--dsw-radius-md,10px); background:linear-gradient(90deg,var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06)),var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16)),var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))); background-size:200% 100%; animation:dshpm-shimmer 1.3s linear infinite; }
.dshpm-pager { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding-top:4px; }
.dshpm-pagerInfo { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.82em; }
.dshpm-installed { display:flex; flex-direction:column; gap:8px; }
.dshpm-row { display:flex; flex-direction:column; gap:8px; box-sizing:border-box; padding:10px 12px; border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1)); border-radius:var(--dsw-radius-md,10px); background:var(--dsw-alias-bg-layer-1,transparent); }
.dshpm-rowHead { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dshpm-rowMain { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1 1 220px; }
.dshpm-rowName { font-weight:600; overflow-wrap:anywhere; }
.dshpm-rowVersion { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.82em; }
.dshpm-rowDesc { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.82em; overflow-wrap:anywhere; }
.dshpm-rowMeta { color:var(--dsw-alias-label-secondary,#6b6b6b); font-size:.78em; }
.dshpm-rowError { color:var(--dsw-alias-state-error-primary,#d93025); font-size:.8em; }
.dshpm-rowActions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dshpm-rowLayout { display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap; }
.dshpm-switch { position:relative; flex:none; width:34px; height:18px; padding:0; border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16)); border-radius:999px; background:var(--dsw-alias-state-idle-primary,#c4c4c4); cursor:pointer; }
.dshpm-switch::after { content:""; position:absolute; top:1px; left:1px; width:14px; height:14px; border-radius:50%; background:#fff; transition:transform .15s ease; }
.dshpm-switch[aria-checked="true"] { background:var(--dsw-alias-state-success-primary,#1f9d55); }
.dshpm-switch[aria-checked="true"]::after { transform:translateX(16px); }
.dshpm-switch:disabled { opacity:.5; cursor:not-allowed; }
.dshpm-switch:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe)); outline-offset:2px; }
.dshpm-sr { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
@keyframes dshpm-shimmer { 0% { background-position:200% 0; } 100% { background-position:-200% 0; } }
@keyframes dshpm-spin { 0% { transform:rotate(0deg); } 100% { transform:rotate(360deg); } }
.dshpm-spinner { animation:dshpm-spin .9s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .dshpm-skeleton, .dshpm-spinner { animation:none; }
  .dshpm-switch::after { transition:none; }
}
`;

    // ───────────────────────────── 样式节点的所有权 ─────────────────────────────
    // DSH 的客户端模块系统只回收「物化窗口内出现」的 <style>：物化时快照未带 data-plugin 的新节点
    // 会被打上 data-plugin 记账（claimStyles），这一代死掉时由 removeOwnedStyles(id) 摘掉。
    // 据此，样式注入必须放在 factory 体内（物化窗口内），而且每代要挂**自己的新节点**：
    //   · 放在 apply() 里注入 → 不被记账 → 节点没人回收，但会被下一次「同 id 已存在就跳过」挡住；
    //   · 沿用同一节点 → 新旧两代共用一个，旧代被回收时新代一起失去样式，页面就成了「有功能无样式」。
    // 另外补两道兜底：渲染时 ensureStyles()，以及 head 被摘掉时的观察器。
    var styleObserver = null;

    function makeStyleNode() {
      var node = document.createElement("style");
      node.id = STYLE_ID;
      node.textContent = STYLES;
      return node;
    }

    /** 这一代自己的样式：先摘掉上一代的同 id 节点，再挂一个全新的（DSH 会记账并负责回收）。 */
    function mountStyles() {
      if (typeof document === "undefined" || !document.head) return;
      var stale = document.getElementById(STYLE_ID);
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
      document.head.appendChild(makeStyleNode());
    }

    /** 渲染路径上的兜底：只在缺失时补一个，避免每次渲染都换节点导致样式重算。 */
    function ensureStyles() {
      if (typeof document === "undefined" || !document.head) return;
      if (document.getElementById(STYLE_ID)) return;
      document.head.appendChild(makeStyleNode());
    }

    /** 样式被别的东西摘掉就补回来；由插件 fiber 的生命周期负责断开，避免卸载后复活。 */
    function watchStyles(ctx) {
      if (typeof MutationObserver !== "function" || typeof document === "undefined" || !document.head) return;
      var stop = function () {
        if (styleObserver) { styleObserver.disconnect(); styleObserver = null; }
      };
      if (styleObserver) styleObserver.disconnect();
      styleObserver = new MutationObserver(function () { ensureStyles(); });
      styleObserver.observe(document.head, { childList: true });
      try {
        if (ctx && typeof ctx.effect === "function") ctx.effect(function () { return stop; }, "dsh-plugin-market: style watchdog");
        else if (ctx && typeof ctx.on === "function") ctx.on("dispose", stop);
      } catch (watchError) {
        // 拿不到 fiber 生命周期时让观察器留在本页：它只在样式缺失时补一次，不会碰到别人的节点。
      }
    }

    // ───────────────────────────── 运行期接线（apply 填，组件读） ─────────────────────────────
    var RUNTIME = {
      panelAvailable: false,
      selectPanel: null,
      timer: null,
      search: null,
      panelRetryUsed: false
    };

    function openMarketPanel() {
      if (!RUNTIME.selectPanel) return;
      try {
        RUNTIME.selectPanel(PANEL_KEY);
        RUNTIME.panelRetryUsed = false;
      } catch (panelError) {
        // main 槽位的注册可能比入口晚一帧；先重试一次，仍失败才把入口降级为禁用，
        // 而不是让这个异常冒到 React 的事件处理里。
        if (!RUNTIME.panelRetryUsed) {
          RUNTIME.panelRetryUsed = true;
          setTimeout(openMarketPanel, 150);
          return;
        }
        RUNTIME.selectPanel = null;
        RUNTIME.panelAvailable = false;
        publishChange();
      }
    }

    // 搜索防抖优先用宿主的 timer 服务（不过它在插件 fiber 上注册，必须在 apply 里建一次），
    // 拿不到服务时退化为自写实现。cancel 只丢弃待提交的回调，不做无意义的空请求。
    function createSearchScheduler(timerService) {
      if (timerService && typeof timerService.debounce === "function") {
        try {
          var pending = null;
          var fire = timerService.debounce(function () {
            var next = pending;
            pending = null;
            if (next) next();
          }, SEARCH_DEBOUNCE_MS);
          return {
            schedule: function (fn) { pending = fn; fire(); },
            cancel: function () { pending = null; }
          };
        } catch (debounceError) {
          // 命名此处空 catch 的原因：宿主 timer 不可用时必须退化为自写防抖，不能让搜索失效。
        }
      }
      var handle = null;
      return {
        schedule: function (fn) {
          if (handle !== null) clearTimeout(handle);
          handle = setTimeout(function () {
            handle = null;
            fn();
          }, SEARCH_DEBOUNCE_MS);
        },
        cancel: function () {
          if (handle !== null) {
            clearTimeout(handle);
            handle = null;
          }
        }
      };
    }

    function ensureSearchScheduler() {
      if (!RUNTIME.search) RUNTIME.search = createSearchScheduler(RUNTIME.timer);
      return RUNTIME.search;
    }

    // ───────────────────────────── 侧边栏底部入口 ─────────────────────────────
    function useActivePanel(props) {
      var readPanelInfo = props && props.usePanelInfo;
      if (typeof readPanelInfo !== "function") return false;
      return !!readPanelInfo(function (info) {
        return !!info && info.activePanelId === PANEL_KEY;
      });
    }

    function MarketEntry(props) {
      useChangeTick();
      ensureStyles();
      var wide = !props || props.wide !== false;
      var active = useActivePanel(props);
      var available = RUNTIME.panelAvailable;
      return el("button", {
        type: "button",
        className: "dshpm-entry",
        "data-wide": wide ? "true" : "false",
        "data-active": active ? "true" : "false",
        "aria-label": t("market.title"),
        "aria-current": active ? "page" : undefined,
        disabled: !available,
        title: available ? t("market.entry.aria") : t("market.entry.disabled"),
        onClick: openMarketPanel
      },
        el("span", { className: "dshpm-entryIcon" }, el(IconMarket, { size: wide ? 16 : 18 })),
        wide ? el("span", { className: "dshpm-entryLabel" }, t("market.title")) : null
      );
    }

    // ───────────────────────────── 通用小组件 ─────────────────────────────
    function Badge(props) {
      var tone = props.tone ? " dshpm-badge--" + props.tone : "";
      return el("span", { className: "dshpm-badge" + tone }, props.children);
    }

    function ErrorLines(props) {
      var copy = errorCopy(props.error);
      var lines = [
        el("div", { className: "dshpm-errorLine", key: "what" },
          el("span", { className: "dshpm-errorKey" }, t("error.label.what")),
          el("span", null, copy.title)),
        el("div", { className: "dshpm-errorLine", key: "why" },
          el("span", { className: "dshpm-errorKey" }, t("error.label.why")),
          el("span", null, copy.why)),
        el("div", { className: "dshpm-errorLine", key: "next" },
          el("span", { className: "dshpm-errorKey" }, t("error.label.next")),
          el("span", null, copy.next))
      ];
      if (copy.message && copy.message !== copy.title) {
        lines.push(el("div", { className: "dshpm-errorLine", key: "detail" },
          el("span", { className: "dshpm-errorKey" }, t("error.label.detail")),
          el("code", { className: "dshpm-errorCode" }, copy.message)));
      }
      if (copy.hint) {
        lines.push(el("div", { className: "dshpm-errorLine", key: "hint" },
          el("span", { className: "dshpm-errorKey" }, t("error.label.hint")),
          el("span", null, copy.hint)));
      }
      return el("div", { className: "dshpm-errorBody" }, lines);
    }

    function ErrorState(props) {
      return el("div", { className: "dshpm-error", role: "alert" },
        el("div", { className: "dshpm-errorTitle" }, t("error.label.what") + "：" + errorCopy(props.error).title),
        el(ErrorLines, { error: props.error }),
        props.onRetry ? el("div", { className: "dshpm-bannerActions" },
          el("button", { type: "button", className: "dshpm-btn dshpm-btn--primary", onClick: props.onRetry },
            props.retrying ? el(IconSpinner, { size: 12 }) : null,
            props.retrying ? t("action.working") : t("action.retry"))
        ) : null
      );
    }

    function LoadingState(props) {
      return el("div", { className: "dshpm-loading", role: "status", "aria-busy": "true" },
        el(IconSpinner, { size: 15 }),
        el("span", null, props.text || t("state.loadingCatalog")),
        props.hint ? el("span", null, props.hint) : null
      );
    }

    function SkeletonGrid() {
      var cells = [];
      for (var i = 0; i < 6; i++) cells.push(el("div", { className: "dshpm-skeleton", key: "s" + i }));
      return el("div", { className: "dshpm-skeletonGrid", "aria-hidden": "true" }, cells);
    }

    function EmptyState(props) {
      return el("div", { className: "dshpm-empty" },
        el("div", { className: "dshpm-emptyTitle" }, props.title),
        props.body ? el("div", { className: "dshpm-emptyBody" }, props.body) : null,
        props.actionLabel && props.onAction
          ? el("button", { type: "button", className: "dshpm-btn", onClick: props.onAction }, props.actionLabel)
          : null
      );
    }

    function NoticeBar(props) {
      var notice = props.notice;
      var kind = notice.kind || "info";
      var icon = kind === "error" ? el(IconAlert, { size: 14 })
        : kind === "warn" ? el(IconAlert, { size: 14 })
          : kind === "success" ? el(IconCheck, { size: 14 })
            : el(IconInfo, { size: 14 });
      return el("div", {
        className: "dshpm-notice",
        "data-kind": kind,
        role: kind === "error" ? "alert" : "status",
        "aria-live": kind === "error" ? "assertive" : "polite"
      },
        el("span", { className: "dshpm-noticeIcon" }, icon),
        el("div", { className: "dshpm-noticeBody" },
          notice.text ? el("div", { className: "dshpm-noticeTitle" }, notice.text) : null,
          notice.error ? el(ErrorLines, { error: notice.error }) : null
        ),
        props.onDismiss
          ? el("button", { type: "button", className: "dshpm-iconBtn", onClick: props.onDismiss, "aria-label": t("action.clear"), title: t("action.clear") },
            el(IconClose, { size: 12 }))
          : null
      );
    }

    function Banner(props) {
      return el("div", { className: "dshpm-banner", "data-kind": props.kind || "info", role: props.kind === "error" ? "alert" : "status" },
        el("div", { className: "dshpm-noticeTitle" }, props.title),
        props.body ? el("div", null, props.body) : null,
        props.children || null
      );
    }

    function Pager(props) {
      var page = props.page || 1;
      var pages = props.pages || 1;
      return el("nav", { className: "dshpm-pager", "aria-label": t("pager.label") },
        el("button", {
          type: "button",
          className: "dshpm-btn",
          disabled: props.busy || page <= 1,
          onClick: props.onPrev
        }, t("pager.prev")),
        el("span", { className: "dshpm-pagerInfo" }, t("pager.indicator", { page: page, pages: pages })),
        el("button", {
          type: "button",
          className: "dshpm-btn",
          disabled: props.busy || page >= pages,
          onClick: props.onNext
        }, t("pager.next")),
        page > 1
          ? el("button", { type: "button", className: "dshpm-btn dshpm-btn--quiet", disabled: props.busy, onClick: props.onFirst }, t("action.firstPage"))
          : null
      );
    }

    function Switch(props) {
      return el("button", {
        type: "button",
        className: "dshpm-switch",
        role: "switch",
        "aria-checked": props.checked ? "true" : "false",
        "aria-label": props.label,
        title: props.title || props.label,
        disabled: !!props.disabled,
        onClick: props.onToggle
      });
    }

    // ───────────────────────────── 发现页 ─────────────────────────────
    function PluginCard(props) {
      var item = props.item;
      var busy = props.busy;
      var readOnly = props.readOnly;
      var canInstall = item.installable !== false && !!item.spec;
      var installed = !!item.installed;
      var updateAvailable = !!item.updateAvailable;
      var installDisabled = readOnly || busy || !canInstall;
      var installLabel = busy && props.busyKind === "update"
        ? t("action.updating")
        : busy ? t("action.installing")
          : updateAvailable ? t("action.update", { version: item.version || "" })
            : installed ? t("action.installed") : t("action.install");
      var installTitle = !canInstall ? t("list.notInstallable") : readOnly ? t("readonly.body") : "";
      return el("article", { className: "dshpm-card" },
        el("div", { className: "dshpm-cardHead" },
          el("h3", { className: "dshpm-cardName" }, item.name || item.id),
          el("span", { className: "dshpm-cardOwner" }, "@" + (item.owner || "")),
          installed ? el(Badge, null, t("action.installed")) : null,
          updateAvailable ? el(Badge, { tone: "warn" }, t("badge.update")) : null
        ),
        el("p", { className: "dshpm-cardDesc" }, descriptionText(item.description)),
        el("div", { className: "dshpm-cardMeta" },
          el("span", null, t("meta.stars", { count: formatCount(item.stars || 0) })),
          el("span", null, t("meta.downloads", { count: formatCount(item.downloads || 0) })),
          item.version ? el("span", null, "v" + item.version) : null,
          item.category ? el("span", null, categoryLabel(props.categories, item.category)) : null
        ),
        el("div", { className: "dshpm-cardActions" },
          el("button", {
            type: "button",
            className: "dshpm-btn" + (installed ? "" : " dshpm-btn--primary"),
            disabled: installDisabled,
            title: installTitle,
            "aria-busy": busy ? "true" : "false",
            onClick: function () { props.onInstall(item); }
          }, busy ? el(IconSpinner, { size: 12 }) : null, installLabel),
          el("button", {
            type: "button",
            className: "dshpm-btn dshpm-btn--quiet",
            "aria-expanded": props.expanded ? "true" : "false",
            onClick: function () { props.onToggleDetails(item.id); }
          }, props.expanded ? t("action.hideDetails") : t("action.details"))
        ),
        props.expanded ? el(PluginDetails, { item: item, onCopy: props.onCopy, copied: props.copied }) : null
      );
    }

    function PluginDetails(props) {
      var item = props.item;
      var capabilities = item.capabilities || [];
      var command = item.install || (item.spec ? "dsh plugin add " + item.spec : "");
      return el("div", { className: "dshpm-detail" },
        el("div", { className: "dshpm-detailRow" },
          el("span", { className: "dshpm-detailKey" }, t("detail.description")),
          el("span", { className: "dshpm-detailValue" }, descriptionText(item.description) || "—")),
        capabilities.length
          ? el("div", { className: "dshpm-detailRow" },
            el("span", { className: "dshpm-detailKey" }, t("detail.capabilities")),
            el("span", { className: "dshpm-tags" }, capabilities.map(function (token) {
              return el("span", { className: "dshpm-tag", key: token }, capabilityLabel(token));
            })))
          : null,
        el("div", { className: "dshpm-detailRow" },
          el("span", { className: "dshpm-detailKey" }, t("detail.links")),
          el("span", { className: "dshpm-detailValue" },
            el("span", { className: "dshpm-tags" },
              item.url ? el("a", { className: "dshpm-link", href: item.url, target: "_blank", rel: "noreferrer", key: "repo" }, t("detail.repo"), el(IconExternal, { size: 11 })) : null,
              item.page ? el("a", { className: "dshpm-link", href: item.page, target: "_blank", rel: "noreferrer", key: "page" }, t("detail.page"), el(IconExternal, { size: 11 })) : null,
              !item.url && !item.page ? el("span", null, "—") : null))),
        item.added
          ? el("div", { className: "dshpm-detailRow" },
            el("span", { className: "dshpm-detailKey" }, t("detail.added")),
            el("span", { className: "dshpm-detailValue" }, formatDate(item.added)))
          : null,
        command
          ? el("div", { className: "dshpm-detailRow" },
            el("span", { className: "dshpm-detailKey" }, t("detail.command")),
            el("span", { className: "dshpm-detailValue" },
              el("code", { className: "dshpm-code" }, command),
              el("button", {
                type: "button",
                className: "dshpm-btn dshpm-btn--quiet",
                onClick: function () { props.onCopy(command); }
              }, el(IconCopy, { size: 11 }), props.copied ? t("action.copied") : t("action.copy"))))
          : null
      );
    }

    function DiscoverPane(props) {
      var state = props.state;
      if (state.phase === "loading" && !state.data) {
        return el("div", { className: "dshpm-installed" },
          el(LoadingState, { text: t("state.loadingCatalog"), hint: t("state.loadingHint") }),
          el(SkeletonGrid, null));
      }
      if (state.phase === "error" && !state.data) {
        return el(ErrorState, { error: state.error, onRetry: props.onRetry, retrying: state.phase === "loading" });
      }
      var payload = state.data || {};
      var items = payload.items || [];
      var page = payload.page || { page: 1, pages: 1, total: items.length };
      var categories = payload.categories || [];
      var summary = page.total === 0
        ? t("list.summaryEmpty")
        : t("list.summary", { total: page.total, page: page.page || 1, pages: page.pages || 1 });
      return el("div", { className: "dshpm-installed" },
        el("div", { className: "dshpm-toolbar" },
          el("div", { className: "dshpm-search" },
            el("span", { className: "dshpm-searchIcon" }, el(IconSearch, { size: 15 })),
            el("input", {
              className: "dshpm-input",
              type: "search",
              value: props.queryInput,
              maxLength: MAX_QUERY_LENGTH,
              placeholder: t("search.placeholder"),
              "aria-label": t("search.label"),
              onChange: function (event) { props.onQueryInput(event.target.value); },
              onKeyDown: function (event) {
                if (event.key === "Enter") {
                  event.preventDefault();
                  props.onQuerySubmit();
                }
              }
            }),
            props.queryInput
              ? el("button", { type: "button", className: "dshpm-iconBtn", title: t("action.clear"), "aria-label": t("action.clear"), onClick: props.onQueryClear },
                el(IconClose, { size: 12 }))
              : null),
          el("label", { className: "dshpm-sr", htmlFor: "dshpm-sort" }, t("filter.sort")),
          el("select", {
            className: "dshpm-select",
            id: "dshpm-sort",
            value: props.sort,
            "aria-label": t("filter.sort"),
            onChange: function (event) { props.onSort(event.target.value); }
          }, SORTS.map(function (option) {
            return el("option", { key: option.id, value: option.id }, t(option.key));
          }))
        ),
        categories.length
          ? el("div", { className: "dshpm-chips", role: "group", "aria-label": t("filter.category") },
            el("button", {
              type: "button",
              className: "dshpm-chip",
              "data-active": props.category === "all" ? "true" : "false",
              onClick: function () { props.onCategory("all"); }
            }, t("filter.all")),
            categories.map(function (category) {
              return el("button", {
                type: "button",
                key: category.id,
                className: "dshpm-chip",
                "data-active": props.category === category.id ? "true" : "false",
                onClick: function () { props.onCategory(category.id); }
              }, categoryLabel(props.categories, category.id) + " " + formatCount(category.count || 0));
            }))
          : null,
        el("div", { className: "dshpm-summary" },
          el("span", null, summary),
          state.phase === "loading" ? el("span", null, t("list.updating")) : null),
        state.phase === "error" && state.data
          ? el(ErrorState, { error: state.error, onRetry: props.onRetry })
          : null,
        items.length
          ? el("div", { className: "dshpm-grid" }, items.map(function (item) {
            var key = item.id || item.name;
            return el(PluginCard, {
              key: key,
              item: item,
              categories: props.categories,
              expanded: !!props.expanded[key],
              busy: props.busyKey === "install:" + key,
              busyKind: props.busyKind,
              copied: props.copied === key,
              readOnly: props.readOnly,
              onInstall: props.onInstall,
              onToggleDetails: props.onToggleDetails,
              onCopy: function (command) { props.onCopy(command, key); }
            });
          }))
          : el(EmptyState, {
            title: t("list.empty.title"),
            body: t("list.empty.body"),
            actionLabel: t("list.empty.action"),
            onAction: props.onResetFilters
          }),
        (page.pages || 1) > 1
          ? el(Pager, {
            page: page.page || 1,
            pages: page.pages || 1,
            busy: state.phase === "loading",
            onPrev: function () { props.onPage((page.page || 1) - 1); },
            onNext: function () { props.onPage((page.page || 1) + 1); },
            onFirst: function () { props.onPage(1); }
          })
          : null
      );
    }

    // ───────────────────────────── 已安装页 ─────────────────────────────
    function entriesForBundle(plugins, bundle) {
      var matched = [];
      for (var i = 0; i < plugins.length; i++) {
        var entry = plugins[i];
        if (!entry) continue;
        if (entry.bundle === bundle.name || (!entry.bundle && entry.moduleName === bundle.name)) matched.push(entry);
      }
      return matched;
    }

    function BundleRow(props) {
      var bundle = props.bundle;
      var entries = props.entries || [];
      var rows = bundle.rows || [];
      // BundleInfo 可能带 readOnlyReason（宿主基础设施托管或无法定位）：这类包只能看，不能开关或卸载。
      var hostReasonKey = bundle.readOnlyReason ? "readonlyReason." + String(bundle.readOnlyReason) : "";
      var hostReason = hostReasonKey ? t(hostReasonKey) : "";
      if (hostReason === hostReasonKey) hostReason = "";
      var locked = props.readOnly || !!hostReason;
      var removeDisabled = locked || bundle.removable === false || bundle.market;
      var removeTitle = bundle.market
        ? t("installed.self")
        : bundle.removable === false
          ? t("installed.notRemovable")
          : hostReason || (props.readOnly ? t("readonly.body") : "");
      var confirm = props.confirming;
      return el("div", { className: "dshpm-row" },
        el("div", { className: "dshpm-rowLayout" },
          el("div", { className: "dshpm-rowMain" },
            el("div", { className: "dshpm-rowHead" },
              el("span", { className: "dshpm-rowName" }, bundle.name),
              bundle.version ? el("span", { className: "dshpm-rowVersion" }, "v" + bundle.version) : null,
              bundle.official ? el(Badge, null, t("badge.official")) : null,
              bundle.market ? el(Badge, null, t("badge.market")) : null,
              bundle.updateAvailable ? el(Badge, { tone: "warn" }, t("badge.update")) : null,
              bundle.enabled === false ? el(Badge, { tone: "warn" }, t("badge.disabled")) : null,
              bundle.error ? el(Badge, { tone: "error" }, t("badge.error")) : null),
            bundle.description ? el("div", { className: "dshpm-rowDesc" }, bundle.description) : null,
            el("div", { className: "dshpm-rowMeta" },
              t("installed.rows", { count: rows.length }),
              entries.length ? " · " + t("installed.plugins") + " " + entries.length : "",
              hostReason ? " · " + hostReason : ""),
            bundle.error
              ? el("div", { className: "dshpm-rowError" }, t("installed.rowError", { message: bundle.error.message || bundle.error.code || "" }))
              : null),
          el("div", { className: "dshpm-rowActions" },
            el(Switch, {
              checked: bundle.enabled !== false,
              disabled: locked || props.busy,
              title: hostReason || (props.readOnly ? t("readonly.body") : ""),
              label: bundle.enabled === false ? t("action.enable") + " " + bundle.name : t("action.disable") + " " + bundle.name,
              onToggle: props.onToggle
            }),
            bundle.updateAvailable && bundle.latest
              ? el("button", {
                type: "button",
                className: "dshpm-btn",
                disabled: locked || props.busy,
                title: hostReason || (props.readOnly ? t("readonly.body") : ""),
                onClick: props.onUpdate
              }, props.busyKind === "update" ? el(IconSpinner, { size: 12 }) : null,
                props.busyKind === "update" ? t("action.updating") : t("action.update", { version: bundle.latest }))
              : null,
            confirm
              ? el("span", { className: "dshpm-rowActions" },
                el("button", { type: "button", className: "dshpm-btn dshpm-btn--danger", disabled: props.busy, onClick: props.onRemove },
                  props.busyKind === "remove" ? el(IconSpinner, { size: 12 }) : el(IconTrash, { size: 12 }),
                  props.busyKind === "remove" ? t("action.uninstalling") : t("action.confirmUninstall")),
                el("button", { type: "button", className: "dshpm-btn dshpm-btn--quiet", disabled: props.busy, onClick: props.onCancelRemove }, t("action.cancel")))
              : el("button", {
                type: "button",
                className: "dshpm-btn",
                disabled: removeDisabled || props.busy,
                title: removeTitle,
                onClick: props.onAskRemove
              }, el(IconTrash, { size: 12 }), t("action.uninstall")),
            el("button", {
              type: "button",
              className: "dshpm-btn dshpm-btn--quiet",
              "aria-expanded": props.expanded ? "true" : "false",
              onClick: props.onToggleDetails
            }, props.expanded ? t("installed.more") : t("installed.detail"))
          )),
        props.expanded
          ? el("div", { className: "dshpm-detail" },
            el("div", { className: "dshpm-detailRow" },
              el("span", { className: "dshpm-detailKey" }, t("detail.version")),
              el("span", { className: "dshpm-detailValue" },
                (bundle.version || "—") + (bundle.latest && bundle.updateAvailable ? " → " + bundle.latest : ""))),
            el("div", { className: "dshpm-detailRow" },
              el("span", { className: "dshpm-detailKey" }, t("installed.rows", { count: rows.length })),
              el("span", { className: "dshpm-detailValue" }, rows.length
                ? el("span", { className: "dshpm-tags" }, rows.map(function (row) {
                  return el("span", { className: "dshpm-tag", key: row.rowId || row.moduleName },
                    (row.rowId || row.moduleName || "") + (row.entryId ? " · " + row.entryId : ""));
                }))
                : "—")),
            el("div", { className: "dshpm-detailRow" },
              el("span", { className: "dshpm-detailKey" }, t("installed.plugins")),
              el("span", { className: "dshpm-detailValue" }, entries.length
                ? el("div", { className: "dshpm-installed" }, entries.map(function (entry) {
                  return el("div", { className: "dshpm-rowHead", key: entry.entryId || entry.moduleName },
                    el("span", null, entry.entryId || entry.moduleName || ""),
                    el("span", { className: "dshpm-rowMeta" }, t("installed.fiber", { phase: formatPhaseLabel(entry.fiberPhase) })),
                    entry.enabled === undefined ? null : el(Switch, {
                      checked: entry.enabled !== false,
                      disabled: locked || props.entryBusyKey === "toggle:" + entry.entryId,
                      label: entry.enabled === false
                        ? t("action.enable") + " " + (entry.entryId || entry.moduleName || "")
                        : t("action.disable") + " " + (entry.entryId || entry.moduleName || ""),
                      onToggle: function () { props.onToggleEntry(entry); }
                    }));
                }))
                : el("span", null, t("installed.noPlugins"))))
          )
          : null
      );
    }

    function InstalledPane(props) {
      var state = props.state;
      if (state.phase === "loading" && !state.data) {
        return el(LoadingState, { text: t("state.loadingInstalled") });
      }
      if (state.phase === "error" && !state.data) {
        return el(ErrorState, { error: state.error, onRetry: props.onRetry });
      }
      var payload = state.data || {};
      var bundles = payload.bundles || [];
      var plugins = payload.plugins || [];
      if (!bundles.length) {
        return el(EmptyState, {
          title: t("installed.empty.title"),
          body: t("installed.empty.body"),
          actionLabel: t("action.goDiscover"),
          onAction: props.onDiscover
        });
      }
      return el("div", { className: "dshpm-installed" },
        el("div", { className: "dshpm-summary" },
          el("span", null, t("installed.count", { count: bundles.length })),
          state.phase === "loading" ? el("span", null, t("list.updating")) : null),
        state.phase === "error" && state.data
          ? el(ErrorState, { error: state.error, onRetry: props.onRetry })
          : null,
        bundles.map(function (bundle) {
          var key = bundle.name;
          return el(BundleRow, {
            key: key,
            bundle: bundle,
            entries: entriesForBundle(plugins, bundle),
            expanded: !!props.expanded[key],
            confirming: props.confirming === key,
            readOnly: props.readOnly,
            busy: props.busyKey === "remove:" + key || props.busyKey === "toggle:" + key || props.busyKey === "install:" + key,
            busyKind: props.busyKey === "remove:" + key ? "remove" : props.busyKey === "install:" + key ? "update" : null,
            entryBusyKey: props.busyKey,
            onToggle: function () { props.onToggleBundle(bundle); },
            onUpdate: function () { props.onUpdateBundle(bundle); },
            onAskRemove: function () { props.onAskRemove(key); },
            onCancelRemove: function () { props.onAskRemove(null); },
            onRemove: function () { props.onRemoveBundle(bundle); },
            onToggleDetails: function () { props.onToggleDetails(key); },
            onToggleEntry: props.onToggleEntry
          });
        })
      );
    }

    // ───────────────────────────── 结果提示 ─────────────────────────────
    function noticeFromResult(payload, kind, name) {
      var application = payload && payload.application ? String(payload.application) : "applied";
      var changed = !payload || payload.changed !== false;
      var warnings = payload && payload.warnings && payload.warnings.length ? payload.warnings.join("；") : "";
      var base;
      if (!changed && application !== "restart-required" && application !== "overridden" && application !== "cancelled") {
        base = { kind: "info", text: t("notice.noChange") };
      } else if (application === "restart-required") {
        base = { kind: "warn", text: kind === "remove" ? t("notice.removeRestart", { name: name }) : t("notice.installRestart", { name: name }) };
      } else if (application === "cancelled") {
        base = { kind: "info", text: kind === "remove" ? t("notice.removeCancelled", { name: name }) : t("notice.installCancelled", { name: name }) };
      } else if (application === "overridden") {
        base = { kind: "warn", text: t("notice.installOverridden", { name: name }) };
      } else {
        base = { kind: "success", text: kind === "remove" ? t("notice.removeApplied", { name: name }) : t("notice.installApplied", { name: name }) };
      }
      if (warnings) base.text = base.text + " · " + t("notice.installWarnings", { warnings: warnings });
      return base;
    }

    var SORTS = [
      { id: "top", key: "sort.top" },
      { id: "new", key: "sort.new" },
      { id: "downloads", key: "sort.downloads" },
      { id: "name", key: "sort.name" }
    ];

    // ───────────────────────────── 市场主面板 ─────────────────────────────
    function MarketPage() {
      useChangeTick();
      ensureStyles();

      var tabState = React.useState("discover");
      var tab = tabState[0];
      var setTab = tabState[1];

      var statusState = React.useState({ phase: "loading", data: null, error: null });
      var status = statusState[0];
      var setStatus = statusState[1];

      var discoverState = React.useState({ phase: "loading", data: null, error: null });
      var discover = discoverState[0];
      var setDiscover = discoverState[1];

      var installedState = React.useState({ phase: "loading", data: null, error: null });
      var installed = installedState[0];
      var setInstalled = installedState[1];

      var queryInputState = React.useState("");
      var queryInput = queryInputState[0];
      var setQueryInput = queryInputState[1];
      var queryInputRef = React.useRef("");

      var queryState = React.useState("");
      var query = queryState[0];
      var setQuery = queryState[1];

      var categoryState = React.useState("all");
      var category = categoryState[0];
      var setCategory = categoryState[1];

      var sortState = React.useState("top");
      var sort = sortState[0];
      var setSort = sortState[1];

      var pageState = React.useState(1);
      var page = pageState[0];
      var setPage = pageState[1];

      var tickState = React.useState(0);
      var tick = tickState[0];
      var setTick = tickState[1];

      var jobState = React.useState(null);
      var job = jobState[0];
      var setJob = jobState[1];

      var pendingState = React.useState(null);
      var pending = pendingState[0];
      var setPending = pendingState[1];

      var noticeState = React.useState(null);
      var notice = noticeState[0];
      var setNotice = noticeState[1];

      var expandedState = React.useState({});
      var expanded = expandedState[0];
      var setExpanded = expandedState[1];

      var confirmState = React.useState(null);
      var confirming = confirmState[0];
      var setConfirming = confirmState[1];

      var copiedState = React.useState(null);
      var copied = copiedState[0];
      var setCopied = copiedState[1];

      var mountedRef = React.useRef(true);
      var registryRef = React.useRef({});
      var tokenRef = React.useRef(0);

      function startRequest(key) {
        var previous = registryRef.current[key];
        if (previous && previous.controller) {
          try {
            previous.controller.abort();
          } catch (abortError) {
            // 命名单个 abort 失败：旧请求已结束或控制器已失效，继续发新请求即可。
          }
        }
        var controller = typeof AbortController === "function" ? new AbortController() : null;
        var token = ++tokenRef.current;
        registryRef.current[key] = { controller: controller, token: token };
        return { token: token, signal: controller ? controller.signal : undefined };
      }

      function isCurrent(key, token) {
        if (!mountedRef.current) return false;
        var bag = registryRef.current[key];
        return !!bag && bag.token === token;
      }

      function abortKey(key) {
        var bag = registryRef.current[key];
        if (!bag || !bag.controller) return;
        try {
          bag.controller.abort();
        } catch (abortError) {
          // 单个请求的控制器已失效时无需上报，下一批请求会自己拿到新 token。
        }
        // 抬高 token：即使宿主忽略 abort，旧响应也会被 isCurrent 丢掉。
        bag.token = ++tokenRef.current;
      }

      function abortAll() {
        var keys = Object.keys(registryRef.current);
        for (var i = 0; i < keys.length; i++) {
          var bag = registryRef.current[keys[i]];
          if (bag && bag.controller) {
            try {
              bag.controller.abort();
            } catch (abortError) {
              // 卸载路径：尽力取消在途请求，失败不需要上报。
            }
          }
        }
        registryRef.current = {};
      }

      React.useEffect(function () {
        mountedRef.current = true;
        return function () {
          mountedRef.current = false;
          abortAll();
          if (RUNTIME.search) RUNTIME.search.cancel();
        };
      }, []);

      function loadStatus() {
        var bag = startRequest("status");
        setStatus(function (previous) {
          return { phase: "loading", data: previous.data, error: null };
        });
        api.status(bag.signal).then(function (payload) {
          if (!isCurrent("status", bag.token)) return;
          setStatus({ phase: "ready", data: payload, error: null });
        }).catch(function (error) {
          if (error && error.aborted) return;
          if (!isCurrent("status", bag.token)) return;
          setStatus(function (previous) {
            return { phase: "error", data: previous.data, error: error };
          });
        });
      }

      function loadCatalog() {
        var bag = startRequest("catalog");
        setDiscover(function (previous) {
          return { phase: "loading", data: previous.data, error: null };
        });
        api.catalog({ query: query, category: category, sort: sort, page: page, pageSize: PAGE_SIZE }, bag.signal)
          .then(function (payload) {
            if (!isCurrent("catalog", bag.token)) return;
            setDiscover({ phase: "ready", data: payload, error: null });
          })
          .catch(function (error) {
            if (error && error.aborted) return;
            if (!isCurrent("catalog", bag.token)) return;
            setDiscover(function (previous) {
              // 保留上一份数据：分页或搜索失败时页面不该变成空白。
              return { phase: "error", data: previous.data, error: error };
            });
          });
      }

      function loadInstalled() {
        var bag = startRequest("installed");
        setInstalled(function (previous) {
          return { phase: "loading", data: previous.data, error: null };
        });
        api.installed(bag.signal).then(function (payload) {
          if (!isCurrent("installed", bag.token)) return;
          setInstalled({ phase: "ready", data: payload, error: null });
        }).catch(function (error) {
          if (error && error.aborted) return;
          if (!isCurrent("installed", bag.token)) return;
          setInstalled(function (previous) {
            return { phase: "error", data: previous.data, error: error };
          });
        });
      }

      React.useEffect(function () {
        loadStatus();
      }, [tick]);

      React.useEffect(function () {
        if (tab !== "discover") return undefined;
        loadCatalog();
        return function () {
          // 换页签或改搜索条件时立刻放弃上一批结果，避免旧响应盖住新查询。
          abortKey("catalog");
        };
      }, [tab, query, category, sort, page, tick]);

      React.useEffect(function () {
        if (tab !== "installed") return undefined;
        loadInstalled();
        return function () {
          abortKey("installed");
        };
      }, [tab, tick]);

      function bumpTick() {
        setTick(function (n) { return n + 1; });
      }

      function startJob(next) {
        setJob(next);
      }

      function clearJob() {
        setJob(null);
      }

      // 搜索：输入即时入 state，300ms 防抖后提交；回车立即可提交。
      function commitQueryInput(immediate) {
        var scheduler = ensureSearchScheduler();
        var submit = function () {
          var next = queryInputRef.current;
          setQuery(function (previous) { return previous === next ? previous : next; });
          setPage(function (previous) { return previous === 1 ? previous : 1; });
        };
        if (immediate) {
          scheduler.cancel();
          submit();
          return;
        }
        scheduler.schedule(submit);
      }

      function handleQueryInput(value) {
        queryInputRef.current = value;
        setQueryInput(value);
        commitQueryInput(false);
      }

      function resetFilters() {
        queryInputRef.current = "";
        setQueryInput("");
        setQuery("");
        setCategory("all");
        setPage(1);
      }

      function submitInstall(target, approvedBuilds) {
        var requestName = target.name;
        var label = target.label || target.name;
        var key = target.key || requestName;
        // 安装与更新走同一个接口，作业键统一用 install: 前缀，卡片与已安装行才能共享“进行中”状态。
        var jobKey = "install:" + key;
        startJob({ key: jobKey, kind: target.kind || "install" });
        var body = { name: requestName, requestId: newRequestId() };
        if (target.spec) body.spec = target.spec;
        if (approvedBuilds && approvedBuilds.length) body.approvedBuilds = approvedBuilds;
        api.install(body).then(function (payload) {
          if (!mountedRef.current) return;
          clearJob();
          if (payload.pendingBuilds && payload.pendingBuilds.length) {
            if (approvedBuilds && approvedBuilds.length) {
              setPending(null);
              setNotice({ kind: "warn", text: t("notice.buildsStillPending", { builds: payload.pendingBuilds.join(", ") }) });
            } else {
              setPending({ name: requestName, label: label, spec: target.spec, kind: target.kind || "install", key: key, builds: payload.pendingBuilds });
              setNotice({ kind: "warn", text: t("notice.buildsPending", { name: label }) });
            }
            return;
          }
          setPending(null);
          setNotice(noticeFromResult(payload, "install", label));
          bumpTick();
        }).catch(function (error) {
          if (!mountedRef.current) return;
          clearJob();
          setNotice({ kind: "error", error: error });
        });
      }

      function installItem(item) {
        submitInstall({
          name: item.id,
          label: item.name || item.id,
          spec: item.spec,
          kind: item.installed ? "update" : "install",
          key: item.id
        }, null);
      }

      function updateBundle(bundle) {
        submitInstall({ name: bundle.name, label: bundle.name, spec: bundle.name, kind: "update", key: bundle.name }, null);
      }

      function approvePending() {
        if (!pending) return;
        var target = pending;
        setPending(null);
        setNotice({ kind: "info", text: t("notice.buildsApproved", { name: target.label }) });
        submitInstall({ name: target.name, label: target.label, spec: target.spec, kind: target.kind, key: target.key }, target.builds);
      }

      function removeBundle(bundle) {
        var key = "remove:" + bundle.name;
        startJob({ key: key, kind: "remove" });
        api.remove(bundle.name).then(function (payload) {
          if (!mountedRef.current) return;
          clearJob();
          setConfirming(null);
          setNotice(noticeFromResult(payload, "remove", bundle.name));
          bumpTick();
        }).catch(function (error) {
          if (!mountedRef.current) return;
          clearJob();
          setNotice({ kind: "error", error: error });
        });
      }

      function toggleBundle(bundle) {
        var key = "toggle:" + bundle.name;
        var next = bundle.enabled === false;
        startJob({ key: key, kind: "toggle" });
        api.toggle({ name: bundle.name, enabled: next }).then(function (payload) {
          if (!mountedRef.current) return;
          clearJob();
          setNotice({
            kind: payload && payload.error ? "error" : "success",
            text: next ? t("notice.toggleEnabled", { name: bundle.name }) : t("notice.toggleDisabled", { name: bundle.name })
          });
          bumpTick();
        }).catch(function (error) {
          if (!mountedRef.current) return;
          clearJob();
          setNotice({ kind: "error", error: error });
        });
      }

      function toggleEntry(entry) {
        var id = entry.entryId;
        if (!id) return;
        var key = "toggle:" + id;
        var next = entry.enabled === false;
        startJob({ key: key, kind: "toggle" });
        api.toggle({ id: id, enabled: next }).then(function () {
          if (!mountedRef.current) return;
          clearJob();
          setNotice({ kind: "success", text: next ? t("notice.toggleEnabled", { name: id }) : t("notice.toggleDisabled", { name: id }) });
          bumpTick();
        }).catch(function (error) {
          if (!mountedRef.current) return;
          clearJob();
          setNotice({ kind: "error", error: error });
        });
      }

      function refreshCatalog() {
        var bag = startRequest("refresh");
        startJob({ key: "refresh", kind: "refresh" });
        api.refresh(bag.signal).then(function (payload) {
          if (!isCurrent("refresh", bag.token)) return;
          clearJob();
          setNotice({ kind: "success", text: t("notice.refreshOk", { count: formatCount(payload.count || 0) }) });
          bumpTick();
        }).catch(function (error) {
          if (error && error.aborted) return;
          if (!isCurrent("refresh", bag.token)) return;
          clearJob();
          setNotice({ kind: "error", error: error });
          // 刷新失败也要重读，这样目录的 stale 提示会立刻反映当前缓存状态。
          bumpTick();
        });
      }

      function toggleDetails(key) {
        setExpanded(function (previous) {
          var next = {};
          var keys = Object.keys(previous);
          for (var i = 0; i < keys.length; i++) next[keys[i]] = previous[keys[i]];
          next[key] = !next[key];
          return next;
        });
      }

      function copyCommand(command, key) {
        function done() {
          setCopied(key);
          setNotice({ kind: "success", text: t("action.copied") });
          setTimeout(function () {
            if (!mountedRef.current) return;
            setCopied(function (previous) { return previous === key ? null : previous; });
          }, 2000);
        }
        try {
          if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(command).then(done, function () {
              setNotice({ kind: "warn", text: t("action.copyFailed") });
            });
            return;
          }
        } catch (copyError) {
          // 剪贴板被策略禁用时降级为提示用户手动选中命令。
        }
        setNotice({ kind: "warn", text: t("action.copyFailed") });
      }

      var statusData = status.data || null;
      var readOnly = !!(statusData && statusData.manager && statusData.manager.available === false);
      var catalogData = discover.data || null;
      var categoriesList = catalogData && catalogData.categories ? catalogData.categories : [];
      var categoriesById = {};
      for (var i = 0; i < categoriesList.length; i++) {
        if (categoriesList[i] && categoriesList[i].id) categoriesById[categoriesList[i].id] = categoriesList[i];
      }
      var catalogMeta = catalogData && catalogData.catalog ? catalogData.catalog : statusData && statusData.catalog ? statusData.catalog : null;
      var metaText = "";
      if (catalogMeta && typeof catalogMeta.count === "number") {
        metaText = catalogMeta.updated
          ? t("market.catalogMeta", { count: formatCount(catalogMeta.count), updated: catalogMeta.updated })
          : t("market.catalogMetaUnknown", { count: formatCount(catalogMeta.count) });
      }
      var version = statusData && statusData.plugin && statusData.plugin.version ? statusData.plugin.version : "";
      var staleSource = catalogData && catalogData.catalog ? catalogData.catalog : catalogMeta;
      var staleInfo = staleSource && staleSource.stale === true
        ? {
          updated: staleSource.updated || "?",
          reason: staleSource.error && (staleSource.error.message || staleSource.error.code)
            ? (staleSource.error.message || staleSource.error.code)
            : t("catalog.stale.noReason")
        }
        : null;
      var refreshing = !!job && job.kind === "refresh";
      var busyKey = job ? job.key : null;

      return el("div", { className: "dshpm-root" },
        el("div", { className: "dshpm-header" },
          el("div", { className: "dshpm-headerMain" },
            el("h2", { className: "dshpm-title" }, t("market.title")),
            el("div", { className: "dshpm-subtitle" },
              t("market.subtitle"),
              version ? " · " + t("market.version", { version: version }) : "",
              metaText ? " · " + metaText : "")),
          el("div", { className: "dshpm-headerActions" },
            el("button", {
              type: "button",
              className: "dshpm-btn",
              disabled: refreshing,
              "aria-busy": refreshing ? "true" : "false",
              onClick: refreshCatalog
            }, refreshing ? el(IconSpinner, { size: 12 }) : el(IconRefresh, { size: 12 }),
              refreshing ? t("action.refreshing") : t("action.refresh")))
        ),
        notice ? el(NoticeBar, { notice: notice, onDismiss: function () { setNotice(null); } }) : null,
        pending
          ? el(Banner, {
            kind: "warn",
            title: t("pending.title"),
            body: t("pending.body", { name: pending.label, builds: pending.builds.join(", ") })
          }, el("div", { className: "dshpm-bannerActions" },
            el("button", { type: "button", className: "dshpm-btn dshpm-btn--primary", disabled: !!job, onClick: approvePending },
              t("pending.approve")),
            el("button", { type: "button", className: "dshpm-btn dshpm-btn--quiet", onClick: function () { setPending(null); } },
              t("pending.cancel"))))
          : null,
        readOnly ? el(Banner, { kind: "warn", title: t("readonly.title"), body: t("readonly.body") }) : null,
        status.phase === "error"
          ? el(Banner, { kind: "info", title: t("status.error.title"), body: t("status.error.body") })
          : null,
        staleInfo
          ? el(Banner, { kind: "warn", title: t("catalog.stale.title"), body: t("catalog.stale.body", { reason: staleInfo.reason, updated: staleInfo.updated }) },
            el("div", { className: "dshpm-bannerActions" },
              el("button", { type: "button", className: "dshpm-btn", disabled: refreshing, onClick: refreshCatalog }, t("catalog.stale.refresh"))))
          : null,
        el("div", { className: "dshpm-tabs", role: "tablist" },
          el("button", {
            type: "button",
            role: "tab",
            className: "dshpm-tab",
            "data-active": tab === "discover" ? "true" : "false",
            "aria-selected": tab === "discover" ? "true" : "false",
            onClick: function () { setTab("discover"); }
          }, t("tab.discover")),
          el("button", {
            type: "button",
            role: "tab",
            className: "dshpm-tab",
            "data-active": tab === "installed" ? "true" : "false",
            "aria-selected": tab === "installed" ? "true" : "false",
            onClick: function () { setTab("installed"); }
          }, t("tab.installed"))),
        tab === "discover"
          ? el(DiscoverPane, {
            state: discover,
            categories: categoriesById,
            queryInput: queryInput,
            sort: sort,
            category: category,
            expanded: expanded,
            copied: copied,
            readOnly: readOnly,
            busyKey: busyKey,
            busyKind: job ? job.kind : null,
            onQueryInput: handleQueryInput,
            onQuerySubmit: function () { commitQueryInput(true); },
            onQueryClear: function () { resetFilters(); },
            onSort: function (value) { setSort(value); setPage(1); },
            onCategory: function (value) { setCategory(value); setPage(1); },
            onPage: function (value) { setPage(value < 1 ? 1 : value); },
            onResetFilters: resetFilters,
            onInstall: installItem,
            onToggleDetails: toggleDetails,
            onCopy: copyCommand,
            onRetry: function () { bumpTick(); }
          })
          : el(InstalledPane, {
            state: installed,
            expanded: expanded,
            confirming: confirming,
            readOnly: readOnly,
            busyKey: busyKey,
            onDiscover: function () { setTab("discover"); },
            onToggleBundle: toggleBundle,
            onUpdateBundle: updateBundle,
            onAskRemove: setConfirming,
            onRemoveBundle: removeBundle,
            onToggleDetails: toggleDetails,
            onToggleEntry: toggleEntry,
            onRetry: function () { bumpTick(); }
          })
      );
    }

    // ───────────────────────────── 装载 ─────────────────────────────
    function readService(ctx, name) {
      try {
        if (typeof ctx.get === "function") {
          var service = ctx.get(name);
          return service === undefined ? null : service;
        }
        return ctx[name] || null;
      } catch (serviceError) {
        // 命名单个服务读取失败：宿主没有该服务时市场要能降级，而不是让 apply 抛错。
        return null;
      }
    }

    function wireLocale(locale) {
      var initial = null;
      if (locale && typeof locale.getLocale === "function") {
        try {
          var snapshot = locale.getLocale();
          if (snapshot && snapshot.active) initial = snapshot.active;
        } catch (readError) {
          initial = null;
        }
      }
      if (!initial) initial = detectLocale();
      setActiveLocale(initial);
      if (locale && typeof locale.subscribe === "function") {
        try {
          locale.subscribe(function () {
            try {
              var next = locale.getLocale();
              if (next && next.active) setActiveLocale(next.active);
            } catch (readError) {
              // 读不到新语言就保持当前语言，等下一次通知。
            }
          });
        } catch (subscribeError) {
          // 语言订阅失败不应阻塞注册：文案退化为初次读取的语言。
        }
      }
    }

    // 物化窗口内注入：这一代样式由此归这一代所有（见上方「样式节点的所有权」）。
    mountStyles();

    exports.inject = ["slots", "layout", "locale"];
    exports.apply = function (ctx) {
      ensureStyles();
      watchStyles(ctx);

      var layout = readService(ctx, "layout");
      RUNTIME.selectPanel = layout && typeof layout.selectPanel === "function"
        ? function (id) { layout.selectPanel(id); }
        : null;
      RUNTIME.panelAvailable = !!RUNTIME.selectPanel;

      var locale = readService(ctx, "locale");
      wireLocale(locale);

      RUNTIME.timer = readService(ctx, "timer");
      RUNTIME.search = createSearchScheduler(RUNTIME.timer);

      var slots = readService(ctx, "slots");
      if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function") return;

      ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "plugin-market" }, MarketPage));
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "plugin-market", order: 15, label: () => t("market.title") }, MarketEntry));
    };

    return module.exports;
  }
});
