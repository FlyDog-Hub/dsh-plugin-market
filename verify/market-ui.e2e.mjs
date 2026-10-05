/**
 * 真实浏览器验收（headless Edge + CDP）。
 *
 * 假 DOM 桩能证明代码不抛异常，证明不了这几件事——所以这里全部在真引擎里测：
 *  1. 侧边栏入口能点开市场面板，页面真的渲染出样式（不是"有功能无样式"）；
 *  2. 蓝圈位置的两个按钮真的存在：检查市场更新 / 更新插件（带计数角标）；
 *  3. 点「更新插件」会展开可更新列表，且每一条都有自己的「更新到 x.y.z」按钮（逐个确认）；
 *  4. 动效真的生效（计算样式里有 animation-name / transition）；
 *  5. prefers-reduced-motion: reduce 下动效被关掉，而内容仍然可见（不能变成空白）。
 *
 * 已安装列表由 CDP 拦截 /plugin-market/installed 注入，构造确定性的"有两个插件可更新"，
 * 因此角标与列表不依赖当时目录里恰好有什么。
 *
 * 用法：node verify/market-ui.e2e.mjs <带 token 的首页 URL> [截图目录]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { evaluate, launchBrowser, screenshot, waitFor } from './lib/cdp.mjs'

const authUrl = process.argv[2]
const shotDir = process.argv[3] ?? join('verify', 'logs', 'ui')
if (!authUrl) {
  console.error('用法：node verify/market-ui.e2e.mjs <带 token 的首页 URL> [截图目录]')
  process.exit(2)
}
mkdirSync(shotDir, { recursive: true })

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || detail === '' ? '' : `\n      ${detail}`}`)
}
function expect(name, condition, detail = '') {
  record(name, condition === true, detail)
  return condition === true
}

// 注入的已安装列表：两个 bundle 有更新，一个没有；其中一条是市场自身（验证它不会被当成普通插件）。
const INJECTED_INSTALLED = {
  ok: true,
  bundles: [
    {
      name: '@fixture/needs-update',
      version: '1.0.0',
      latest: '1.2.0',
      updateAvailable: true,
      description: '外部插件，用于验证「有个新版本」的提示与逐个确认。',
      rows: [{ rowId: 'row-a' }],
      enabled: true,
    },
    {
      name: '@fixture/second-update',
      version: '0.3.1',
      latest: '0.4.0',
      updateAvailable: true,
      description: '第二个可更新插件，用来验证角标数字。',
      rows: [{ rowId: 'row-b' }],
      enabled: true,
    },
    {
      name: 'deepseek-harness-market',
      version: '1.0.2',
      updateAvailable: false,
      description: '市场自身。',
      rows: [{ rowId: 'row-c' }],
      enabled: true,
      market: true,
    },
  ],
  plugins: [],
}

const browser = await launchBrowser({ width: 1560, height: 980 })
const { client } = browser
let consoleErrors = []
try {
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Log.enable')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 980, deviceScaleFactor: 1, mobile: false })
  // headless Chromium 默认就带 prefers-reduced-motion: reduce（实测），所以要显式钉成 no-preference：
  // 否则"动效生效"这一组断言测的是一条永远关着动画的路径，而 [6] 又会因为同样原因平凡通过。
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })

  // 拦截 /installed：确定性数据，同时保证断言不依赖网络。
  await client.send('Fetch.enable', { patterns: [{ urlPattern: '*plugin-market/installed*', requestStage: 'Request' }] })
  client.on('Fetch.requestPaused', (params) => {
    const body = Buffer.from(JSON.stringify(INJECTED_INSTALLED), 'utf8').toString('base64')
    client
      .send('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Cache-Control', value: 'no-store' },
        ],
        body,
      })
      .catch(() => {})
  })
  client.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') {
      consoleErrors.push((params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' '))
    }
  })
  client.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error') consoleErrors.push(params.entry.text ?? '')
  })

  console.log('\n[1] 打开页面与侧边栏入口')
  await client.send('Page.navigate', { url: authUrl })
  await waitFor(client, `!!document.querySelector('.dshpm-entry')`, 45000, '侧边栏里的插件市场入口')
  // 全新的 scratch profile 首次进入时 DSH 会弹自己的「预览版说明」：点掉它，截图里只看市场本身。
  await evaluate(
    client,
    `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /^(继续|Continue)$/.test(x.textContent.trim())); if (b) { b.click(); return true; } return false; })()`,
  )
  await new Promise((resolve) => setTimeout(resolve, 600))
  const entryText = await evaluate(client, `document.querySelector('.dshpm-entry').textContent.trim()`)
  expect('侧边栏入口渲染出「插件市场」文案', /插件市场|Plugin Market/.test(String(entryText)), `实际：${entryText}`)
  const entryStyled = await evaluate(
    client,
    `(() => { const el = document.querySelector('.dshpm-entry'); const s = getComputedStyle(el); return { display: s.display, minHeight: s.minHeight, anim: s.transitionProperty.includes('transform') }; })()`,
  )
  expect(
    '入口用的是插件自己的样式（display:flex + 36px 行高），不是浏览器默认按钮',
    entryStyled?.display === 'flex' && entryStyled?.minHeight === '36px',
    JSON.stringify(entryStyled),
  )

  console.log('\n[2] 点开市场面板')
  await evaluate(client, `document.querySelector('.dshpm-entry').click(); true`)
  await waitFor(client, `!!document.querySelector('.dshpm-root')`, 20000, '市场面板 .dshpm-root')
  expect('面板根节点渲染出来了', true)

  const headerButtons = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-headerActions button')).map(b => b.textContent.trim())`,
  )
  expect(
    '蓝圈位置现在有三个按钮：更新插件 / 检查市场更新 / 刷新目录',
    Array.isArray(headerButtons) && headerButtons.length === 3,
    `实际：${JSON.stringify(headerButtons)}`,
  )
  expect(
    '按钮顺序：更新插件 → 检查市场更新 → 刷新目录',
    JSON.stringify(headerButtons) === JSON.stringify(['更新插件2', '检查市场更新', '刷新目录']) ||
      (headerButtons?.[0]?.startsWith('更新插件') && headerButtons?.[1].includes('检查') && headerButtons?.[2].includes('刷新')),
    `实际：${JSON.stringify(headerButtons)}`,
  )
  const badge = await evaluate(client, `(() => { const b = document.querySelector('.dshpm-count'); return b ? b.textContent.trim() : null; })()`)
  expect('「更新插件」按钮上有可更新数量角标，且数字来自注入的列表', badge === '2', `实际：${badge}`)

  // 用户要求：把「可更新的插件」做成页签——已安装右边再开一个（他圈的就是那个位置）。
  const tabs = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-tab')).map(b => ({ text: b.textContent.trim(), active: b.getAttribute('data-active') === 'true' }))`,
  )
  expect(
    '页签栏三个页签：发现 / 已安装 / 可更新（用户圈的位置就在已安装右边）',
    Array.isArray(tabs) && tabs.length === 3 && /发现|Discover/.test(tabs[0]?.text || '') && /已安装|Installed/.test(tabs[1]?.text || ''),
    JSON.stringify(tabs),
  )
  expect(
    '第三个页签就是「可更新」（带计数角标），默认停在发现页',
    /可更新|Updates/.test(tabs[2]?.text || '') && tabs[0]?.active === true && tabs[2]?.active === false,
    JSON.stringify(tabs),
  )

  // 用户报的「显示不全」：通知条被压成一条、文字只剩半行。
  // 根因是 flex 项的自动最小尺寸规则（非 visible 的 overflow ⇒ 自动最小尺寸 0），
  // 所以这条断言直接量 clientHeight 与 scrollHeight，而不是只看它「在不在」。
  console.log('\n[2b] 提示条不能被压扁（用户报的「显示不全」）')
  await waitFor(client, `document.querySelector('.dshpm-notice') !== null`, 8000, '提示条出现')
  const noticeMetrics = await evaluate(
    client,
    `(() => {
       const n = document.querySelector('.dshpm-notice');
       const cs = getComputedStyle(n);
       return { offset: n.offsetHeight, client: n.clientHeight, scroll: n.scrollHeight, flexShrink: cs.flexShrink, overflow: cs.overflow, text: n.innerText.replace(/\\s+/g, ' ').trim() };
     })()`,
  )
  expect('提示条没有被压扁（clientHeight ≥ scrollHeight）', Number(noticeMetrics?.client) >= Number(noticeMetrics?.scroll), JSON.stringify(noticeMetrics))
  expect('提示条高度足够容纳整行文字（≥ 30px）', Number(noticeMetrics?.offset) >= 30, JSON.stringify(noticeMetrics))
  expect('提示条文案完整可读（不是被裁掉半行）', /发现 2 个插件有新版本/.test(String(noticeMetrics?.text)), String(noticeMetrics?.text))

  // 回执改成了 Android toast 那种悬浮气泡。computed position 一定是 'fixed'，那不算证据；
  // 真正的判据是几何位置——若某个祖先带 transform/filter 把 fixed 的包含块抢走，
  // 气泡会贴到那个祖先的底边而不是视口底边，下面两条就会红。
  const toastBox = await evaluate(
    client,
    `(() => {
       const n = document.querySelector('.dshpm-notice');
       const cs = getComputedStyle(n);
       const r = n.getBoundingClientRect();
       return { position: cs.position, left: Math.round(r.left), width: Math.round(r.width), bottom: Math.round(r.bottom), vh: window.innerHeight, vw: window.innerWidth };
     })()`,
  )
  expect(
    '回执是悬浮气泡：position 固定为 fixed（不占文档流，出现时不推动布局）',
    toastBox?.position === 'fixed',
    JSON.stringify(toastBox),
  )
  expect(
    '气泡贴在视口底部（不再是页内那一行）',
    Number(toastBox?.bottom) <= Number(toastBox?.vh) && Number(toastBox?.vh) - Number(toastBox?.bottom) < 120,
    JSON.stringify(toastBox),
  )
  expect(
    '气泡水平居中',
    Math.abs((Number(toastBox?.left) + Number(toastBox?.width) / 2) - Number(toastBox?.vw) / 2) <= 2,
    JSON.stringify(toastBox),
  )

  console.log('\n[3] 动效（真实计算样式）')
  // 必须先等卡片真的出现：目录是一次网络往返，刚打开面板时还是骨架屏。
  await waitFor(client, `document.querySelector('.dshpm-card') !== null`, 30000, '发现页的第一张卡片')
  const motionPref = await evaluate(client, `matchMedia('(prefers-reduced-motion: reduce)').matches`)
  expect('前置条件：本条断言跑在「不减少动效」的偏好下', motionPref === false, `实际 reduce=${motionPref}`)
  const animations = await evaluate(
    client,
    `(() => {
       const card = document.querySelector('.dshpm-card');
       const pick = (el) => { if (!el) return null; const s = getComputedStyle(el); return { anim: s.animationName, dur: s.animationDuration, fill: s.animationFillMode, transition: s.transitionProperty.includes('transform'), delay: s.animationDelay }; };
       return { card: pick(card), cards: document.querySelectorAll('.dshpm-card').length };
     })()`,
  )
  expect(
    '卡片带入场动画（dshpm-rise）且填充模式是 backwards（不会钉死 hover 位移）',
    animations?.card?.anim?.includes('dshpm-rise') && animations?.card?.fill === 'backwards',
    JSON.stringify(animations?.card),
  )
  expect('卡片有 transform 过渡（hover 抬升能生效）', animations?.card?.transition === true, JSON.stringify(animations?.card))
  const staggered = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-card')).map(c => getComputedStyle(c).animationDelay).filter(d => d !== '0s').length`,
  )
  expect('卡片是错峰入场的（存在非零 animation-delay）', Number(staggered) > 0, `非零延迟的卡片数：${staggered}`)
  const tabUnderline = await evaluate(
    client,
    `(() => { const t = document.querySelector('.dshpm-tab[data-active="true"]'); const after = t ? getComputedStyle(t, '::after') : null; return after ? { transform: after.transform, bg: after.backgroundColor } : null; })()`,
  )
  expect('激活页签的滑动底线是 scaleX(1)（未激活的为 scaleX(0)，视觉上从一个滑到另一个）', String(tabUnderline?.transform).startsWith('matrix(1'), JSON.stringify(tabUnderline))

  console.log('\n[3b] 已安装页的列表动效')
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /已安装|Installed/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-row') !== null`, 15000, '已安装页的第一行')
  const rowAnim = await evaluate(
    client,
    `(() => { const r = document.querySelector('.dshpm-row'); const s = getComputedStyle(r); return { anim: s.animationName, fill: s.animationFillMode, delay: s.animationDelay }; })()`,
  )
  expect('已安装列表行也有入场动画且填充模式为 backwards', rowAnim?.anim?.includes('dshpm-rise') && rowAnim?.fill === 'backwards', JSON.stringify(rowAnim))
  const marketBadge = await evaluate(client, `!!document.querySelector('.dshpm-badge') && document.body.innerText.includes('市场自身') || document.body.innerText.includes('@fixture/needs-update')`)
  expect('已安装页显示注入的三个 bundle', marketBadge === true)

  console.log('\n[4] 点「更新插件」切到「可更新」页签（逐个确认）')
  // 用户报的「点更新插件没有任何反馈」：先把上一条提示条等没（自动收起 4.6s），
  // 这样点击后新出现的那条就必然是**本次**的回执，而不是上一次的残留。
  await waitFor(client, `document.querySelector('.dshpm-notice') === null`, 12000, '上一条提示条已自动收起')
  await evaluate(client, `document.querySelector('.dshpm-btn--updates').click(); true`)
  await waitFor(client, `(() => { const t = document.querySelector('.dshpm-tab[data-active="true"]'); return !!t && /可更新|Updates/.test(t.textContent); })()`, 8000, '切到可更新页签')
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel') !== null`, 8000, '可更新页渲染出来')
  expect('点「更新插件」切到「可更新」页签（已安装右边第三个）', true)
  // 页签取代了抽屉：内容**整页**出现，不是叠在发现页卡片下面。
  const cardsAfter = await evaluate(client, `document.querySelectorAll('.dshpm-card').length`)
  expect('整页切换生效（发现页卡片已卸载，不是叠在下面）', Number(cardsAfter) === 0, `剩余卡片 ${cardsAfter}`)
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel').getBoundingClientRect().height > 120`, 8000, '可更新页展开到最终高度')
  // 反馈二：点完必须回一句话。fixture 注入了两个可更新插件，所以文案是确定的。
  await waitFor(client, `(() => { const n = document.querySelector('.dshpm-notice'); if (!n) return false; return /发现 \\d+ 个插件有新版本|全部都是最新/.test(n.innerText.replace(/\\s+/g, ' ')); })()`, 8000, '点击后提示条给出回执')
  expect('点「更新插件」后提示条给出结果回执（发现 2 个插件有新版本）', true)
  const panelText = await evaluate(client, `document.querySelector('.dshpm-updatesPanel').innerText`)
  expect('列表里列出两个可更新插件与版本走向', /@fixture\/needs-update/.test(String(panelText)) && /1\.2\.0/.test(String(panelText)) && /@fixture\/second-update/.test(String(panelText)), String(panelText).slice(0, 200))
  const rows = await evaluate(client, `document.querySelectorAll('.dshpm-updatesPanel .dshpm-updateRow:not(.dshpm-updateRow--ghost)').length`)
  expect('列表只有两条（第三个没有更新，不进列表）', rows === 2, `实际：${rows}`)
  const perItemButtons = await evaluate(
    client,
    `Array.from(document.querySelectorAll('.dshpm-updatesPanel .dshpm-updateRow .dshpm-btn--primary')).map(b => b.textContent.trim())`,
  )
  expect(
    '每一条都有自己的「更新到 x.y.z」按钮（逐个确认，没有一键全更新）',
    Array.isArray(perItemButtons) && perItemButtons.length === 2 && perItemButtons.every((label) => label.includes('更新到')),
    JSON.stringify(perItemButtons),
  )
  expect(
    '列表里没有「全部更新」这类批量按钮',
    !/全部更新|Update all/.test(String(panelText)),
    '要求是逐个确认，不该出现批量入口',
  )
  const panelOpenHeight = await evaluate(client, `document.querySelector('.dshpm-updatesPanel').getBoundingClientRect().height`)
  expect('可更新页有实际高度（不是空壳）', Number(panelOpenHeight) > 120, `高度 ${panelOpenHeight}`)

  await screenshot(client, join(shotDir, 'market-updates-open.png'))
  console.log(`  · 截图：${join(shotDir, 'market-updates-open.png')}`)
  // 头部工具条 2 倍放大：文档里要看清三个按钮的样式与角标。
  const zoom = await client.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1560, height: 130, scale: 2 } })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(shotDir, 'market-header-zoom.png'), Buffer.from(zoom.data, 'base64'))
  console.log(`  · 截图：${join(shotDir, 'market-header-zoom.png')}`)

  console.log('\n[4b] 用户原场景：发现页（长网格）+ 矮视口下点「更新插件」')
  // 上面那组是在「已安装」页点的，那里内容短——测不出「点了没反应」。这里复现真实场景：
  // 卡片网格把页面撑得很长、视口只有 520px。页签切过去之后内容从页签正下方开始，
  // 不用任何滚动就看得见（旧版抽屉开在几百像素之下，看上去就是「什么都没发生」）。
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /发现|Discover/.test(b.textContent)).click(); true`)
  await waitFor(client, `!!document.querySelector('.dshpm-card')`, 30000, '发现页卡片渲染出来（页面变长）')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 520, deviceScaleFactor: 1, mobile: false })
  await evaluate(client, `document.querySelector('.dshpm-btn--updates').click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel') !== null`, 8000, '矮视口下可更新页渲染')
  await waitFor(client, `(() => { const p = document.querySelector('.dshpm-updatesPanel'); if (!p) return false; const r = p.getBoundingClientRect(); return r.top >= -1 && r.top < window.innerHeight && r.bottom > 0; })()`, 8000, '可更新页在视区内')
  expect('发现页 + 520px 视口：切过去后内容整页出现且在视区内（无需滚动）', true)
  await screenshot(client, join(shotDir, 'market-updates-short-viewport.png'))
  console.log(`  · 截图：${join(shotDir, 'market-updates-short-viewport.png')}`)
  // 还原视口；页签交给 [5] 去切回已安装。
  await client.send('Emulation.clearDeviceMetricsOverride')

  console.log('\n[5] 页签来回切（可更新 → 已安装）')
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /已安装|Installed/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-row') !== null`, 8000, '已安装页切回来')
  const backRows = await evaluate(client, `document.querySelectorAll('.dshpm-row').length`)
  expect('切回「已安装」后列表回来（页签可来回切）', Number(backRows) >= 3, `行数 ${backRows}`)
  const stalePanel = await evaluate(client, `document.querySelectorAll('.dshpm-updatesPanel').length`)
  expect('切走后可更新页已卸载（同一时间只有一个页签的内容在 DOM 里）', Number(stalePanel) === 0, `残留 ${stalePanel}`)
  await screenshot(client, join(shotDir, 'market-tab-installed.png'))
  console.log(`  · 截图：${join(shotDir, 'market-tab-installed.png')}`)

  console.log('\n[6] prefers-reduced-motion：关掉动效但内容仍在')
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  const reduceActive = await evaluate(client, `matchMedia('(prefers-reduced-motion: reduce)').matches`)
  expect('前置条件：偏好确实被切成 reduce', reduceActive === true, `实际 reduce=${reduceActive}`)
  await evaluate(client, `document.querySelector('.dshpm-btn--updates').click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel') !== null`, 8000, '可更新页渲染出来')
  await new Promise((resolve) => setTimeout(resolve, 400))
  const reduced = await evaluate(
    client,
    `(() => {
       const row = document.querySelector('.dshpm-updateRow');
       const s = row ? getComputedStyle(row) : null;
       const panel = document.querySelector('.dshpm-updatesPanel');
       const ps = panel ? getComputedStyle(panel) : null;
       return { rowAnim: s ? s.animationName : null, panelAnim: ps ? ps.animationName : null, panelVisible: panel ? getComputedStyle(panel).visibility : null, rows: document.querySelectorAll('.dshpm-updatesPanel .dshpm-updateRow:not(.dshpm-updateRow--ghost)').length };
     })()`,
  )
  expect('reduced-motion 下动画被关掉（animation-name: none）', reduced?.rowAnim === 'none' && reduced?.panelAnim === 'none', JSON.stringify(reduced))
  expect('reduced-motion 下内容仍然可见（两条更新记录都在、页面不是隐藏的）', reduced?.rows === 2 && reduced?.panelVisible === 'visible', JSON.stringify(reduced))
  await screenshot(client, join(shotDir, 'market-reduced-motion.png'))

  console.log('\n[7] 控制台错误')
  const pluginErrors = consoleErrors.filter((line) => !/favicon|net::ERR_|DevTools/i.test(line))
  expect('插件在页面里没有产生控制台错误', pluginErrors.length === 0, pluginErrors.slice(0, 5).join(' | '))

  // 同一类缺陷的通用回归：视口矮到内容必然溢出时，容器必须自己滚动，
  // 而不是把某个带 overflow 的子项（自动最小尺寸 0）压扁。
  console.log('\n[8] 窄高视口下不得压扁任何区块')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 520, deviceScaleFactor: 1, mobile: false })
  // 用「发现」页测：它内容最长，才是「视口矮到必然溢出」的那个场景。
  await evaluate(client, `Array.from(document.querySelectorAll('.dshpm-tab')).find(b => /发现|Discover/.test(b.textContent)).click(); true`)
  await waitFor(client, `document.querySelectorAll('.dshpm-card').length > 0`, 30000, '发现页卡片渲染出来')
  await waitFor(client, `document.querySelector('.dshpm-grid').getBoundingClientRect().height > 200`, 8000, '目录网格高度稳定')
  const squeezed = await evaluate(
    client,
    `(() => {
       const root = document.querySelector('.dshpm-root');
       const bad = [];
       for (const child of root.children) {
         if (child.clientHeight < child.scrollHeight - 1) bad.push((child.className || '?') + ':' + child.clientHeight + '<' + child.scrollHeight);
       }
       return { bad, rootScrolls: root.scrollHeight > root.clientHeight, rootClient: root.clientHeight, rootScroll: root.scrollHeight, children: root.children.length };
     })()`,
  )
  expect('窄高视口下没有任何直接子项被压扁', Array.isArray(squeezed?.bad) && squeezed.bad.length === 0, JSON.stringify(squeezed))
  expect('面板根自己滚动（不是靠压扁子项来容纳内容）', squeezed?.rootScrolls === true, JSON.stringify(squeezed))
  await screenshot(client, join(shotDir, 'market-short-viewport.png'))
  console.log(`  · 截图：${join(shotDir, 'market-short-viewport.png')}`)
} catch (error) {
  expect('测试执行未抛异常', false, error.message)
} finally {
  await browser.close()
}

const failed = results.filter((result) => !result.ok)
console.log('')
console.log(`真实浏览器验收：${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  for (const result of failed) console.log(`  失败：${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
  process.exit(1)
}
