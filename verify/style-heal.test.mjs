/**
 * 客户端样式生命周期的回归测试（修复「有功能无样式」）。
 *
 * 覆盖四条：
 *  1. factory 物化时就挂上样式（DSH 只对物化窗口内的 <style> 记账回收）；
 *  2. 挂的是**新节点**，不会沿用上一代的同 id 节点（新旧共用会让旧代回收时带走新代样式）；
 *  3. 节点被摘掉后，head 观察器与渲染路径都能补回来；
 *  4. 插件 dispose 时观察器断开（不在卸载后复活）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bundlePath = process.argv[2] ?? 'plugin-market/lib/client.js'
const source = readFileSync(bundlePath, 'utf8')

// ── 最小 DOM / React / 观察器桩 ─────────────────────────────────────
function createDom() {
  const head = {
    children: [],
    appendChild(node) { node.parentNode = head; head.children.push(node); return node },
    removeChild(node) { const i = head.children.indexOf(node); if (i >= 0) head.children.splice(i, 1); node.parentNode = null; return node },
  }
  const document = {
    head,
    createElement(tag) { return { tagName: tag, id: '', textContent: '', parentNode: null, remove() { if (this.parentNode) this.parentNode.removeChild(this) } } },
    getElementById(id) { return head.children.find((n) => n.id === id) ?? null },
    querySelectorAll() { return [] },
  }
  const observers = []
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this) }
    observe() {}
    disconnect() { this.disconnected = true }
    fire() { if (!this.disconnected) this.callback([]) }
  }
  return { document, head, MutationObserver, observers }
}

function createReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: (fn) => { fn() },
    useRef: (initial) => ({ current: initial }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  }
}

const dom = createDom()
globalThis.window = { __ModuleLoader__: { load(handoff) { globalThis.__handoff = handoff } } }
globalThis.document = dom.document
globalThis.MutationObserver = dom.MutationObserver
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, groups: [], items: [], page: { page: 1, pages: 1 }, catalog: {}, categories: [] }) })

// 仅测试用：以最小桩执行 bundle 的 factory
new Function('window', 'document', 'MutationObserver', 'React', source)(
  globalThis.window, dom.document, dom.MutationObserver, null,
)

// 仅测试用：以最小桩执行 bundle 并真正物化（load 只注册 factory，样式是在 factory 体内挂的，
// 所以必须调用 factory，而不是只执行脚本）。
const react = createReact()
function materialize() {
  globalThis.__handoff = null
  new Function('window', 'document', 'MutationObserver', 'React', source)(
    globalThis.window, dom.document, dom.MutationObserver, null,
  )
  const handoff = globalThis.__handoff
  assert.ok(handoff, 'bundle 必须通过 __ModuleLoader__.load 注册')
  assert.equal(handoff.id, 'deepseek-harness-market', 'bundle id 必须是包名')
  return handoff.factory((spec) => {
    if (spec === 'react') return react
    throw new Error('unexpected require: ' + spec)
  })
}

// 1) 物化即挂样式
const exportsObject = materialize()
const first = dom.head.children.filter((n) => n.id === 'deepseek-harness-market-style')
assert.equal(first.length, 1, 'factory 物化后应当恰好有一个样式节点')

// 2) 再来一次物化：必须是新节点，而不是复用旧的
const snapshot = first[0]
dom.document.head.removeChild(snapshot) // 模拟 DSH 回收上一代
materialize()
const second = dom.head.children.filter((n) => n.id === 'deepseek-harness-market-style')
assert.equal(second.length, 1, '重新物化后仍应恰好有一个样式节点')
assert.notEqual(second[0], snapshot, '重新物化必须挂新节点，不能沿用上一代的节点')

// 3) 激活插件：观察器与生命周期接线就位
const registrations = []
const slots = {
  // 真实宿主会等席位声明出现后再调用 factory；桩里立即调用即可。
  inject(key, factory) { registrations.push({ key, register: factory }); factory() },
  register(options, component) { return ((slots.entries ??= []).push({ options, component }), () => {}) },
}
let disposer = null
const ctx = {
  get: (name) => (name === 'slots' ? slots : undefined),
  effect: (fn) => { disposer = fn(); return () => {} },
  on: () => {},
  slots,
}
exportsObject.apply(ctx)
assert.equal(typeof disposer, 'function', 'apply 应当用 ctx.effect 注册观察器的断开')
const observer = dom.observers[dom.observers.length - 1]
assert.ok(observer, 'apply 应当安装 head 观察器')

// 4) 样式被别的东西摘掉：观察器补回来
dom.document.head.removeChild(second[0])
assert.equal(dom.head.children.length, 0, '前置条件：样式已被摘掉')
observer.fire()
assert.equal(dom.head.children.filter((n) => n.id === 'deepseek-harness-market-style').length, 1, '观察器应把样式补回来')

// 5) 渲染路径也能补，且 dispose 后观察器断开
const mainEntry = (slots.entries ?? []).find((e) => e.options && e.options.name === 'main')
assert.ok(mainEntry, '应注册 main 面板')
dom.document.head.removeChild(dom.head.children[0])
mainEntry.component({}) // 渲染一次：应把样式补回来
assert.equal(dom.head.children.filter((n) => n.id === 'deepseek-harness-market-style').length, 1, '渲染路径应当把样式补回来')
disposer()
assert.equal(observer.disconnected, true, 'dispose 后观察器必须断开')

console.log('样式生命周期回归：5/5 通过')
console.log('  ✓ 物化即挂样式')
console.log('  ✓ 重新物化挂新节点（不沿用上一代）')
console.log('  ✓ apply 安装 head 观察器')
console.log('  ✓ 被摘掉后观察器补回')
console.log('  ✓ 渲染路径补回 + dispose 断开观察器')
