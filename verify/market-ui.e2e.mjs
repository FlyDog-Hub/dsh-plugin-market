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
      name: 'dsh-plugin-market',
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

  console.log('\n[4] 展开可更新列表（逐个确认）')
  await evaluate(client, `document.querySelector('.dshpm-btn--updates').click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel[data-open="true"]') !== null`, 8000, '可更新面板展开')
  // 展开是一次 max-height 过渡（340ms），visibility 这种离散属性在中途才翻转：
  // 刚点完就量高度/读 innerText 会读到过渡中途的值，等它稳定下来再断言。
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel').getBoundingClientRect().height > 120`, 8000, '可更新面板展开到最终高度')
  expect('点「更新插件」展开了可更新列表', true)
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
  expect('展开后的面板有实际高度（max-height 过渡没把它压成 0）', Number(panelOpenHeight) > 120, `高度 ${panelOpenHeight}`)

  await screenshot(client, join(shotDir, 'market-updates-open.png'))
  console.log(`  · 截图：${join(shotDir, 'market-updates-open.png')}`)
  // 头部工具条 2 倍放大：文档里要看清三个按钮的样式与角标。
  const zoom = await client.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1560, height: 130, scale: 2 } })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(shotDir, 'market-header-zoom.png'), Buffer.from(zoom.data, 'base64'))
  console.log(`  · 截图：${join(shotDir, 'market-header-zoom.png')}`)

  console.log('\n[5] 收起与自更新按钮的状态文案')
  await evaluate(client, `document.querySelector('.dshpm-drawerClose').click(); true`)
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel[data-open="false"]') !== null`, 8000, '可更新面板收起')
  await waitFor(client, `document.querySelector('.dshpm-updatesPanel').getBoundingClientRect().height < 8`, 8000, '面板高度收回 0')
  const closedHeight = await evaluate(client, `document.querySelector('.dshpm-updatesPanel').getBoundingClientRect().height`)
  expect('收起后面板高度归零（内容不再占位）', Number(closedHeight) < 8, `高度 ${closedHeight}`)
  await screenshot(client, join(shotDir, 'market-header-closed.png'))
  console.log(`  · 截图：${join(shotDir, 'market-header-closed.png')}`)

  console.log('\n[6] prefers-reduced-motion：关掉动效但内容仍在')
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  const reduceActive = await evaluate(client, `matchMedia('(prefers-reduced-motion: reduce)').matches`)
  expect('前置条件：偏好确实被切成 reduce', reduceActive === true, `实际 reduce=${reduceActive}`)
  await evaluate(client, `document.querySelector('.dshpm-btn--updates').click(); true`)
  await new Promise((resolve) => setTimeout(resolve, 400))
  const reduced = await evaluate(
    client,
    `(() => {
       const row = document.querySelector('.dshpm-row');
       const s = row ? getComputedStyle(row) : null;
       const panel = document.querySelector('.dshpm-updatesPanel');
       return { anim: s ? s.animationName : null, transition: s ? s.transitionDuration : null, panelVisible: panel ? getComputedStyle(panel).visibility : null, rows: document.querySelectorAll('.dshpm-updatesPanel .dshpm-updateRow:not(.dshpm-updateRow--ghost)').length, installedRows: document.querySelectorAll('.dshpm-row').length };
     })()`,
  )
  expect('reduced-motion 下动画被关掉（animation-name: none）', reduced?.anim === 'none', JSON.stringify(reduced))
  expect('reduced-motion 下内容仍然可见（列表行还在，面板不是隐藏的）', reduced?.rows === 2 && reduced?.panelVisible === 'visible' && Number(reduced?.installedRows) >= 3, JSON.stringify(reduced))
  await screenshot(client, join(shotDir, 'market-reduced-motion.png'))

  console.log('\n[7] 控制台错误')
  const pluginErrors = consoleErrors.filter((line) => !/favicon|net::ERR_|DevTools/i.test(line))
  expect('插件在页面里没有产生控制台错误', pluginErrors.length === 0, pluginErrors.slice(0, 5).join(' | '))
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
