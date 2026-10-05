/**
 * 客户端文案与动效的不变量测试（离线、只读源码）。
 *
 * 这里防的是三类"改了就悄悄坏"的问题：
 *  1. zh / en 键集漂移——只补中文，英文用户看到键名或空白；
 *  2. 代码里 t("x.y") 但词典里没有——界面直接显示原始键；
 *  3. 动效写法退化——最典型的是升入动画用了 forwards/both，把 transform 钉死在末帧，
 *     于是卡片 hover 抬升、按钮按下缩放全部失效（本仓库真的这么错过一次）；
 *     以及在基础样式里写 opacity:0，导致关掉动效（prefers-reduced-motion）后内容不可见。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(process.argv[2] ?? 'plugin-market/lib/client.js', 'utf8')
let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

// ── 取词典：两段语言块按 "      zh: {" / "      en: {" 定位 ───────────
const zhAt = source.indexOf('      zh: {')
const enAt = source.indexOf('      en: {')
assert.ok(zhAt > 0 && enAt > zhAt, '应当能找到 zh / en 两段词典')
const zhBlock = source.slice(zhAt, enAt)
const enBlock = source.slice(enAt, source.indexOf('    };', enAt))

const KEYS = /"([A-Za-z][A-Za-z0-9._-]*)":/g
const keysOf = (block) => new Set([...block.matchAll(KEYS)].map((m) => m[1]))
const zhKeys = keysOf(zhBlock)
const enKeys = keysOf(enBlock)

// 代码里实际用到的键：字面量 + 前缀拼接（t("err." + code)）
// 前缀要用 (?<![A-Za-z0-9_$.]) 锚住 t 本身，否则 inject("x") / get("x") 里末尾那个 t( 会被误当成 t()。
const usedLiteral = new Set(
  [...source.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*"([A-Za-z][A-Za-z0-9._-]*)"/g)]
    .map((m) => m[1])
    // 以点结尾的是前缀（t("err." + code)），由下面的动态前缀规则负责，不是完整键。
    .filter((key) => !key.endsWith('.')),
)
const dynamicPrefixes = [...source.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*"([A-Za-z][A-Za-z0-9._-]*\.)"\s*\+/g)].map((m) => m[1])
// 键名由变量拼出来的命名空间（t() 的实参不是字面量，静态扫描看不到）：
//   err.     ← "err." + error.code
//   fiber.   ← formatPhaseLabel 里按 phase 拼
//   readonlyReason. ← "readonlyReason." + bundle.readOnlyReason
//   capability.     ← capabilityLabel 里按 token 拼
//   sort.    ← SORTS[].key 交给 t(key)
const VARIABLE_NAMESPACES = ['err.', 'fiber.', 'readonlyReason.', 'capability.', 'sort.']
// 词典里本身不是给 t() 用的（纯数据键），显式列出而不是放宽规则
const NON_T_KEYS = new Set([])

console.log('\n[1] 词典完整性')
check('zh 与 en 的键集完全一致（数量与内容都一致）', () => {
  const onlyZh = [...zhKeys].filter((k) => !enKeys.has(k))
  const onlyEn = [...enKeys].filter((k) => !zhKeys.has(k))
  assert.deepEqual(onlyZh, [], `只有中文的键：${onlyZh.join(', ')}`)
  assert.deepEqual(onlyEn, [], `只有英文的键：${onlyEn.join(', ')}`)
  assert.equal(zhKeys.size, enKeys.size)
})
check('代码里出现的每个 t("字面量键") 都在词典里（两种语言都要有）', () => {
  const missing = [...usedLiteral].filter((key) => !zhKeys.has(key) || !enKeys.has(key))
  assert.deepEqual(missing, [], `代码用了但词典缺失：${missing.join(', ')}`)
})
check('词典里除动态前缀外的键都真的被用到（没有僵尸文案）', () => {
  const dynamic = (key) => dynamicPrefixes.some((prefix) => key.startsWith(prefix)) || VARIABLE_NAMESPACES.some((prefix) => key.startsWith(prefix))
  const unused = [...zhKeys].filter((key) => !usedLiteral.has(key) && !dynamic(key) && !NON_T_KEYS.has(key))
  assert.deepEqual(unused, [], `没有引用的文案键：${unused.join(', ')}`)
})
check('新增的两组文案职责齐全（自更新 / 可更新列表 / 三个错误码）', () => {
  for (const key of [
    'action.checkSelf', 'action.checkingSelf', 'action.selfCurrent', 'action.updateSelf', 'action.updatingSelf',
    'action.recheckSelf', 'action.updateAll', 'action.updateAllCount', 'action.updatingAll',
    'updates.title', 'updates.entryBadge', 'updates.hint', 'updates.batchProgress', 'updates.empty.title', 'updates.empty.body',
    'notice.selfFound', 'notice.selfCurrent', 'notice.selfUpdated', 'notice.updatesFound', 'notice.updatesNone',
    'notice.updateAllStart', 'notice.updateAllDone', 'notice.updateAllNone', 'tab.updates',
    'err.self-update-unavailable.title', 'err.self-update-integrity.title', 'err.self-update-download.title',
    'err.file-locked.title', 'err.file-locked.why', 'err.file-locked.next', 'err.file-locked.row',
  ]) {
    assert.ok(zhKeys.has(key), `缺少文案键 ${key}`)
  }
})
check('更新失败的「文件被占用」类错误有可操作回执（照 dsh-market 的 windows-file-locked 分类）', () => {
  // 1) 能识别 EPERM/EACCES/拒绝访问（诊断或消息任一命中）
  assert.match(source, /function fileLockedDetail\(error\)/, '要有占用识别函数')
  assert.match(source, /EPERM\|EACCES\|EBUSY\|operation not permitted\|Access is denied/, '识别模式要覆盖 pnpm 的 EPERM 与 Windows 拒绝访问')
  // 2) 三处渲染都接上：错误气泡三段式、可更新行内短句、已安装行错误
  assert.match(source, /locked \? "err\.file-locked"/, 'errorCopy 命中时要切到 file-locked 文案')
  assert.match(source, /fileLockedDetail\(error\) \? t\("err\.file-locked\.row"\)/, '可更新行内失败要显示占用短句')
  assert.match(source, /fileLockedDetail\(bundle\.error\)/, '已安装行错误也要走占用识别')
  // 3) 详情行要露出 diagnostic 原文（此前 EPERM 从未被渲染）
  assert.match(source, /message: locked \|\| message/, '命中时详情行用诊断原文')
})
check('回执文案精简（用户反馈：toast 尽量短）', () => {
  assert.match(zhBlock, /"notice\.refreshOk": "已刷新 \{count\} 个插件"/, '刷新回执只留计数')
  assert.match(zhBlock, /"notice\.updatesFound": "\{count\} 个插件有新版本。"/, '发现回执一句话')
  assert.match(zhBlock, /"notice\.updatesNone": "全部都是最新版本。"/, '无更新回执一句话')
  assert.match(zhBlock, /"notice\.updateAllDone": "更新完成：成功 \{ok\}、失败 \{fail\}。"/, '批量汇总去后缀')
  // 英文侧同步精简，且不残留旧长句
  assert.equal(enBlock.includes('Catalog refreshed: {count} plugins'), false, 'en 旧刷新长句应已删除')
  assert.equal(enBlock.includes('Update all finished'), false, 'en 旧汇总长句应已删除')
})

// ── 取样式表：模板字面量 var STYLES = `...` ─────────────────────────
const TICK = String.fromCharCode(96)
const stylesAt = source.indexOf(`var STYLES = ${TICK}`)
assert.ok(stylesAt > 0, '应当能找到 STYLES 模板字面量')
const stylesEnd = source.indexOf(TICK + ';', stylesAt)
assert.ok(stylesEnd > stylesAt, 'STYLES 模板字面量应当有结束反引号')
const css = source.slice(stylesAt + (`var STYLES = ${TICK}`).length, stylesEnd)

console.log('\n[2] 动效写法（防"动画把 hover 钉死"与"关掉动画后不可见"）')
check('样式表里有完整的 @keyframes 定义，且被引用的都在', () => {
  const defined = new Set([...css.matchAll(/@keyframes\s+([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]))
  const referenced = new Set([...css.matchAll(/animation:\s*([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]).filter((name) => !name.startsWith('none')))
  const missing = [...referenced].filter((name) => !defined.has(name))
  assert.deepEqual(missing, [], `被引用但没定义的动画：${missing.join(', ')}`)
  for (const required of ['dshpm-rise', 'dshpm-fade', 'dshpm-expand', 'dshpm-slidein', 'dshpm-pop', 'dshpm-breathe', 'dshpm-glow', 'dshpm-slide', 'dshpm-countdown', 'dshpm-shimmer', 'dshpm-spin']) {
    assert.ok(defined.has(required), `缺少关键帧 ${required}`)
  }
})
check('升入类动画一律用 backwards：用 forwards/both 会把 transform 钉在末帧', () => {
  const offenders = [...css.matchAll(/animation:([^;{}]*);/g)]
    .map((m) => m[1])
    .filter((decl) => /\b(forwards|both)\b/.test(decl))
    // 允许的唯一例外：提示条倒计时线（纯装饰，没有 hover 位移）
    .filter((decl) => !/dshpm-countdown/.test(decl))
  assert.deepEqual(offenders, [], `这些动画用了 forwards/both：${offenders.join(' | ')}`)
})
check('带 hover 位移的类没有被 forwards/both 动画占住 transform', () => {
  for (const selector of ['.dshpm-card', '.dshpm-row', '.dshpm-updateRow', '.dshpm-btn', '.dshpm-entry']) {
    const rules = [...css.matchAll(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1])
    for (const body of rules) {
      if (!/animation:/.test(body)) continue
      assert.ok(!/\b(forwards|both)\b/.test(body), `${selector} 的动画用了 forwards/both，会钉死 transform`)
    }
  }
})
check('基础样式里没有给会被动画的元素写 opacity:0', () => {
  // 关掉动效时元素必须直接可见：只允许在 @keyframes 的 from 里出现 opacity:0。
  const withoutKeyframes = css.replace(/@keyframes[^}]*\}[^}]*\}/g, '')
  const offenders = [...withoutKeyframes.matchAll(/([^{}]+)\{([^}]*opacity\s*:\s*0[^}]*)\}/g)]
    .map((m) => m[1].trim())
    .filter((selector) => !/prefers-reduced-motion|data-open="false"|dshpm-skeleton/.test(selector))
  assert.deepEqual(offenders, [], `这些规则在基础态把元素设成不可见：${offenders.join(' | ')}`)
})
check('prefers-reduced-motion 里同时关掉 animation 与 transition', () => {
  const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
  assert.ok(at > 0, '必须有 prefers-reduced-motion 分支')
  const block = css.slice(at, css.indexOf('}', css.indexOf('{', at)) + 1)
  assert.match(block, /animation\s*:\s*none/, 'reduced-motion 下必须关掉动画')
  assert.match(block, /transition\s*:\s*none/, 'reduced-motion 下必须关掉过渡')
  assert.match(block, /dshpm-root/, 'reduced-motion 分支要覆盖面板内所有元素')
})

console.log('\n[3] 新增 UI 的标记与位置')
check('样式表定义了新增组件：面板、角标、倒计时线', () => {
  for (const selector of ['.dshpm-updatesPanel', '.dshpm-entryBadge', '.dshpm-count', '.dshpm-noticeTimer', '.dshpm-updateRow', '.dshpm-selfNote']) {
    assert.ok(css.includes(selector), `样式表缺少 ${selector}`)
  }
  // 顶部黑条进度条已删（截图反馈：标题上方那条黑杠不要了）；进度改由按钮 spinner + aria-busy + toast 承担。
  assert.equal(css.includes('.dshpm-progress'), false, '顶部进度条样式应已删除')
  assert.equal(source.includes('dshpm-progress'), false, '顶部进度条节点应已删除')
})
check('回执是悬浮气泡（Android toast）：fixed + 贴底居中 + 不占文档流', () => {
  const rules = css.match(/\.dshpm-notice\s*\{[^}]*\}/g) || []
  const base = rules.find((rule) => /position:/.test(rule))
  assert.ok(base, '应当有一条带 position 的 .dshpm-notice 基础规则')
  assert.match(base, /position:\s*fixed/, '气泡必须是 fixed 定位（不占文档流，出现时不推挤布局）')
  assert.match(base, /bottom:\s*\d+px/, '气泡要贴视口底部')
  assert.match(base, /margin:\s*0 auto/, '气泡要水平居中')
  assert.match(base, /max-width:/, '气泡要有最大宽度，长文案换行而不是撑满整屏')
  const relative = rules.filter((rule) => /position:\s*relative/.test(rule))
  assert.deepEqual(relative, [], '后面的规则不得写 position:relative 把 fixed 盖回文档流')
  assert.match(css, /@keyframes dshpm-toastin/, '气泡要有自己的入场动画 keyframes')
})
check('头部只留「刷新目录」，两个更新类按钮搬进可更新页（用户要求删掉右上角那两个）', () => {
  // 被删掉的是头部的「更新插件」与「检查市场更新」：前者被第三个页签取代，后者搬进可更新页。
  assert.equal(source.includes('dshpm-btn--updates'), false, '头部的「更新插件」按钮应已删除')
  assert.match(source, /refreshing \? t\("action\.refreshing"\) : t\("action\.refresh"\)/, '「刷新目录」必须还在头部')
  assert.equal(source.includes('t("action.updates")'), false, 'action.updates 文案随按钮一起删除（否则就是僵尸文案）')
  const actionsAt = source.indexOf('className: "dshpm-updatesActions"')
  assert.ok(actionsAt > 0, '可更新页页头要有按钮区')
  assert.ok(actionsAt < source.indexOf('t("action.updateAllCount"'), '一键更新按钮渲染在按钮区里')
  assert.match(source, /onUpdateAll: updateAll/, '一键更新按钮要接到 updateAll')
  assert.match(source, /self\.available \? self\.onApply : self\.onCheck/, '检查市场更新要接到自更新状态机')
})
check('已安装列表两个页签都会加载（角标与列表都依赖它）', () => {
  const at = source.indexOf('React.useEffect(function () {')
  const block = source.slice(source.indexOf('两个页签都要拉') - 200, source.indexOf('两个页签都要拉') + 400)
  assert.ok(block.includes('loadInstalled()'), '应当无条件加载已安装列表')
  assert.ok(!/if \(tab !== "installed"\) return undefined;\s*\n\s*loadInstalled/.test(source), '不应再按页签条件加载')
  assert.ok(at > 0)
})
check('自更新按钮在文案上区分检查中/已是最新/可更新/更新中四种状态', () => {
  assert.match(source, /selfPhase === "checking" \? t\("action\.checkingSelf"\)/)
  assert.match(source, /selfPhase === "installing" \? t\("action\.updatingSelf"\)/)
  assert.match(source, /selfAvailable \? t\("action\.updateSelf"/)
  assert.match(source, /selfPhase === "ready" \? t\("action\.selfCurrent"\)/)
})
check('入口与反馈：页签是入口，两个新按钮各带忙碌态 + 回执；自动检查规则齐全', () => {
  // 入口：头部按钮删掉后，第三个页签是唯一入口，点它仍要给回执。
  assert.match(source, /function goUpdates\(\)/, '打开可更新页签的入口函数')
  assert.match(source, /onClick: goUpdates/, '第三个页签要接到这个入口')
  assert.match(source, /loadInstalled\(\{ announce: true \}\)/, '打开页签要触发带回执的重读')
  assert.match(source, /t\("notice\.updatesFound"/, '有更新要给回执')
  assert.match(source, /t\("notice\.updatesNone"/, '没有更新也要给回执')
  // 新按钮 1：检查市场更新（原头部按钮搬来）
  assert.match(source, /"aria-busy": self\.busy \? "true" : "false"/, '检查市场更新要暴露 aria-busy')
  assert.match(source, /runSelfCheck\(function \(error, info\)/, '检查结果要回到回执气泡')
  // 新按钮 2：一键更新
  assert.match(source, /"aria-busy": batchRunning \? "true" : "false"/, '一键更新要暴露 aria-busy')
  assert.match(source, /t\("notice\.updateAllStart"/, '一键更新开始要有回执')
  assert.match(source, /t\("notice\.updateAllDone"/, '一键更新结束要有汇总回执')
  assert.match(source, /outcome && outcome\.pending/, '卡在「要批准构建脚本」时必须暂停批量')
  // 自动检查规则（用户定的）：启动查一次本体更新，之后每小时查一次插件更新
  assert.match(source, /PLUGIN_CHECK_INTERVAL_MS = 60 \* 60 \* 1000/, '每小时检查一次插件更新')
  assert.match(source, /startUpdateScheduler\(\);/, 'apply 里要启动调度')
  assert.match(source, /if \(schedulerStarted\) return;/, '调度必须有守卫，不能重复建定时器')
  assert.match(source, /runSelfCheck\(\);/, '启动时检查一次本体更新')
})
check('回执气泡有退场：先 data-open=false 沉下去，200ms 后才卸载', () => {
  assert.match(source, /var NOTICE_CLOSE_MS = 200;/, '退场时长常量')
  assert.match(css, /\.dshpm-notice\[data-open="false"\][^}]*opacity:0/, '退场态规则')
  assert.match(source, /dismissNotice\(\)/, '关闭必须走 dismissNotice，而不是直接 setNotice(null)')
  assert.match(source, /open: noticeClosing \? false : true/, '渲染时把退场态传给气泡')
  assert.match(css, /backdrop-filter:blur/, '气泡加了毛玻璃质感')
})
check('第三个页签「可更新」：排在已安装右边、带计数角标、切过去渲染整页内容', () => {
  const discoverAt = source.indexOf('t("tab.discover")')
  const installedAt = source.indexOf('t("tab.installed")')
  const updatesAt = source.indexOf('t("tab.updates")')
  assert.ok(discoverAt > 0 && installedAt > discoverAt, '页签顺序：发现 → 已安装')
  assert.ok(updatesAt > installedAt, '页签顺序：已安装 → 可更新（用户圈的位置）')
  assert.match(source, /el\(UpdatesPane/, '第三个页签要渲染自己的页面组件')
  assert.ok(source.indexOf('el(UpdatesPane') > updatesAt, '页面组件在页签之后渲染（同一份 tab switch）')
  // 抽屉必须退场：页签取代了它，不能两套并存
  assert.equal(source.includes('UpdatesDrawer'), false, '抽屉组件应已移除（由页签取代）')
  assert.equal(source.includes('scrollIntoView'), false, '不再需要滚动定位：内容现在整页出现')
  assert.match(source, /updateCount > 0 \? el\("span", \{ className: "dshpm-count" \}/, '页签要带可更新计数角标')
})

console.log('')
if (failures.length > 0) {
  console.log(`客户端文案与动效不变量：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exit(1)
}
console.log(`客户端文案与动效不变量：${passed}/${passed} 全通过`)
