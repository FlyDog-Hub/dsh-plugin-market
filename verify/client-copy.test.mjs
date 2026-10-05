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
    'action.updates', 'action.checkingUpdates', 'action.recheckSelf',
    'updates.title', 'updates.entryBadge', 'updates.hint', 'updates.empty.title', 'updates.empty.body',
    'notice.selfFound', 'notice.selfCurrent', 'notice.selfUpdated', 'notice.updatesFound', 'notice.updatesNone',
    'err.self-update-unavailable.title', 'err.self-update-integrity.title', 'err.self-update-download.title',
  ]) {
    assert.ok(zhKeys.has(key), `缺少文案键 ${key}`)
  }
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
check('样式表定义了新增组件：面板、进度条、角标、倒计时线', () => {
  for (const selector of ['.dshpm-updatesPanel', '.dshpm-progress', '.dshpm-entryBadge', '.dshpm-count', '.dshpm-noticeTimer', '.dshpm-updateRow', '.dshpm-selfNote']) {
    assert.ok(css.includes(selector), `样式表缺少 ${selector}`)
  }
})
check('两个按钮在源码里都渲染了，且排在「刷新目录」之前（蓝圈位置）', () => {
  const updatesBtn = source.indexOf('dshpm-btn--updates')
  const selfBtn = source.indexOf('selfAvailable ? applySelfUpdate : checkSelfUpdate')
  const refreshBtn = source.indexOf('refreshing ? el(IconSpinner, { size: 12 }) : el(IconRefresh, { size: 12 })')
  assert.ok(updatesBtn > 0 && selfBtn > 0 && refreshBtn > 0, '三个按钮都应当存在')
  assert.ok(updatesBtn < refreshBtn, '「更新插件」应排在刷新目录之前')
  assert.ok(selfBtn < refreshBtn, '「检查市场更新」应排在刷新目录之前')
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
check('「更新插件」与「检查市场更新」同款反馈：忙碌态 + 结果回执 + 展开后滚进视区', () => {
  // 用户报过「点更新插件没有任何反馈」：面板排在卡片网格之后，展开在视区外，
  // 且不重读就没有提示条——这三条断言把「点了必须有反应」钉在源码层。
  assert.match(source, /updatesBusy \? el\(IconSpinner/, '按钮在检查中要转圈')
  assert.match(source, /updatesBusy \? t\("action\.checkingUpdates"\)/, '按钮在检查中要换文案')
  assert.match(source, /"aria-busy": updatesBusy \? "true" : "false"/, '按钮要暴露 aria-busy')
  assert.match(source, /loadInstalled\(\{ announce: true \}\)/, '点按钮要触发带回执的重读')
  assert.match(source, /t\("notice\.updatesFound"/, '有更新要给回执')
  assert.match(source, /t\("notice\.updatesNone"/, '没有更新也要给回执')
  assert.match(source, /scrollIntoView/, '展开后要把面板滚进可视区')
})

console.log('')
if (failures.length > 0) {
  console.log(`客户端文案与动效不变量：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exit(1)
}
console.log(`客户端文案与动效不变量：${passed}/${passed} 全通过`)
