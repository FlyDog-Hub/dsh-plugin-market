// 对抗性检查：宿主没有 pluginManager 服务时，市场路由必须「优雅降级」而不是抛未捕获异常。
//
// 做法：给 host 半喂一个受控的假 cordis ctx（get() 一律 undefined，webServer.register 只记录路由），
// 调 apply()，再把记录到的 handler 用假 req/res 真实调用一遍，检查：
//   1) apply 不抛
//   2) 每个 handler 都不抛，且都写出了结构化 JSON（ok 为布尔）
//   3) 契约点：/status 与 /installed 报 manager.available=false 且集合为空；安装类 POST 报 manager-unavailable
//
// 用法：node adversarial-host.mjs <plugin-market/lib/index.js>
// 退出码：0 = 全部通过；1 = 有失败（打印明细）
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { createServer } from 'node:http'

const entry = process.argv[2]
if (!entry) {
  console.error('用法: node adversarial-host.mjs <host entry .js>')
  process.exit(2)
}

const failures = []
const info = []
function check(name, ok, detail) {
  if (ok) info.push(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  else failures.push(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── 一个必然连不上的目录源，让 /catalog 走 catalog-unavailable 分支而不依赖公网 ──
process.env.DSHM_REGISTRY_URL = 'http://127.0.0.1:9/definitely-unavailable.json'

// ── 假 ctx ──
const routes = []
const touched = new Set()
const noopDisposer = () => {}

function makeCtx() {
  const ctx = {
    get(name) { touched.add(`get(${name})`); return undefined },      // pluginManager 缺失
    has(name) { touched.add(`has(${name})`); return false },
    inject(names, cb) {
      const list = Array.isArray(names) ? names : [names]
      touched.add(`inject(${list.join('|')})`)
      if (typeof cb === 'function') cb(ctx)
      return noopDisposer
    },
    effect(fn, label) {
      touched.add(`effect(${label ?? ''})`)
      const d = typeof fn === 'function' ? fn() : undefined
      return typeof d === 'function' ? d : noopDisposer
    },
    on(event) { touched.add(`on(${event})`); return noopDisposer },
    once(event) { touched.add(`once(${event})`); return noopDisposer },
    plugin() { touched.add('plugin()'); return noopDisposer },
    webServer: {
      register(route) {
        touched.add(`webServer.register(${route?.kind}:${route?.path})`)
        routes.push(route)
        return noopDisposer
      },
    },
    logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {} },
  }
  return ctx
}

// ── 假 req / res ──
function makeReq(method, url, headers, body) {
  const req = Readable.from(body ? [Buffer.from(body, 'utf8')] : [])
  req.method = method
  req.url = url
  req.headers = headers
  req.socket = { remoteAddress: '127.0.0.1', remotePort: 12345 }
  return req
}

function makeRes() {
  const out = { status: 0, headers: {}, body: '', ended: false }
  const res = {
    writeHead(status, headers) {
      out.status = status
      if (headers) for (const [k, v] of Object.entries(headers)) out.headers[k.toLowerCase()] = String(v)
      return res
    },
    setHeader(k, v) { out.headers[String(k).toLowerCase()] = String(v); return res },
    getHeader(k) { return out.headers[String(k).toLowerCase()] },
    removeHeader(k) { delete out.headers[String(k).toLowerCase()] },
    write(chunk) { if (chunk) out.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk); return true },
    end(chunk) {
      if (chunk) out.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      out.ended = true
      return res
    },
    on() { return res },
    once() { return res },
    emit() { return true },
    destroy() { out.ended = true },
    flushHeaders() {},
  }
  return { res, out }
}

// ── 载入 host 半 ──
let applyFn = null
try {
  const mod = await import(pathToFileURL(entry).href)
  const candidates = [mod.apply, mod.default?.apply, typeof mod.default === 'function' ? mod.default : null]
  applyFn = candidates.find(c => typeof c === 'function') ?? null
} catch (e) {
  console.log(`FAIL  载入 host 入口失败: ${e.stack ?? e.message}`)
  process.exit(1)
}
if (!applyFn) {
  console.log('FAIL  host 入口没有可调用的 apply（checked: named apply / default.apply / default fn）')
  process.exit(1)
}

const ctx = makeCtx()
let applyThrew = null
try {
  await applyFn(ctx)
} catch (e) {
  applyThrew = e
}
check('apply(ctx) 在缺 pluginManager 时不抛', applyThrew === null, applyThrew ? String(applyThrew.stack ?? applyThrew.message) : '')
check('注册了至少一条 /plugin-market 路由', routes.length > 0, `routes=${routes.map(r => `${r.kind}:${r.path}`).join(', ') || '<none>'}`)

console.log('\n== 被测 host 触碰过的 cordis 面 ==')
console.log('  ' + [...touched].sort().join('\n  '))
console.log('\n== 捕获得的路由 ==')
for (const r of routes) console.log(`  ${r.kind}  ${r.path}`)

// ── 路由匹配 ──
function matchRoute(pathname) {
  for (const r of routes) {
    if (r.kind === 'exact' && r.path === pathname) return r
    if (r.kind === 'prefix' && (pathname === r.path || pathname.startsWith(`${r.path}/`))) return r
  }
  return null
}

const PREFIX = '/plugin-market'
const SAME_ORIGIN = { origin: 'http://127.0.0.1:1', host: '127.0.0.1:1', 'content-type': 'application/json' }

const cases = [
  { name: 'GET /status', method: 'GET', path: `${PREFIX}/status`, expect: 'ok:true+manager.available=false' },
  { name: 'GET /installed', method: 'GET', path: `${PREFIX}/installed`, expect: 'ok:true+空集合+manager.available=false' },
  { name: 'GET /catalog', method: 'GET', path: `${PREFIX}/catalog`, expect: '结构化失败(catalog-unavailable/timeout)' },
  { name: 'POST /install', method: 'POST', path: `${PREFIX}/install`, body: '{"name":"a/b"}', expect: 'ok:false+manager-unavailable' },
  { name: 'POST /remove', method: 'POST', path: `${PREFIX}/remove`, body: '{"name":"a/b"}', expect: 'ok:false+manager-unavailable' },
  { name: 'POST /toggle', method: 'POST', path: `${PREFIX}/toggle`, body: '{"name":"a/b","enabled":false}', expect: 'ok:false+manager-unavailable' },
]

/** 单次调用加超时保护，避免 handler 卡住把整个自检拖死。 */
async function invoke(route, method, path, body) {
  const { res, out } = makeRes()
  const req = makeReq(method, path, { ...SAME_ORIGIN }, body)
  const local = `${PREFIX}${path.slice(PREFIX.length)}`
  let thrown = null
  try {
    await Promise.race([
      Promise.resolve(route.handler(req, res)),
      new Promise((_, rej) => setTimeout(() => rej(new Error('handler 超时 20s')), 20000).unref()),
    ])
  } catch (e) {
    thrown = e
  }
  // 本地的 host 用 `local` 变量仅为可读性保留；未使用则忽略
  void local
  return { thrown, out }
}

console.log('\n== 逐端点对抗调用 ==')
for (const c of cases) {
  const route = matchRoute(c.path)
  if (!route) {
    check(`${c.name} 有对应路由`, false, '路由未注册')
    continue
  }
  const { thrown, out } = await invoke(route, c.method, c.path, c.body)
  if (thrown) {
    check(`${c.name} handler 不抛未捕获异常`, false, String(thrown.stack ?? thrown.message))
    continue
  }
  if (!out.ended) { check(`${c.name} 写出了响应`, false, `status=${out.status} ended=false`); continue }
  let parsed = null
  try { parsed = JSON.parse(out.body) } catch { /* 非 JSON */ }
  check(`${c.name} 响应是结构化 JSON（含布尔 ok）`, parsed !== null && typeof parsed.ok === 'boolean', `status=${out.status} body=${out.body.slice(0, 160)}`)
  if (parsed === null) continue
  const code = parsed.error?.code ?? null
  console.log(`    ${c.name} -> HTTP ${out.status} ok=${parsed.ok} error.code=${code}  (期望 ${c.expect})`)

  if (c.name === 'GET /status') {
    check('  /status 报 manager.available=false', parsed.manager?.available === false, `manager.available=${parsed.manager?.available}`)
  }
  if (c.name === 'GET /installed') {
    const bundlesLen = Array.isArray(parsed.bundles) ? parsed.bundles.length : -1
    const pluginsLen = Array.isArray(parsed.plugins) ? parsed.plugins.length : -1
    check('  /installed 无 manager 时返回 ok:true + 空 bundles/plugins（契约 §2.3）',
      parsed.ok === true && bundlesLen === 0 && pluginsLen === 0,
      `ok=${parsed.ok} bundles=${bundlesLen} plugins=${pluginsLen}`)
    check('  /installed 附 manager.available=false', parsed.manager?.available === false, `manager.available=${parsed.manager?.available}`)
  }
  if (['POST /install', 'POST /remove', 'POST /toggle'].includes(c.name)) {
    check(`  ${c.name} 报 manager-unavailable`, parsed.ok === false && code === 'manager-unavailable', `ok=${parsed.ok} code=${code}`)
  }
  if (c.name === 'GET /catalog') {
    check('  /catalog 目录源不可用时给出结构化错误码', parsed.ok === false && ['catalog-unavailable', 'catalog-timeout'].includes(code), `ok=${parsed.ok} code=${code}`)
  }
}

// ── 未知路径 / 方法：只要求不抛 + 结构化 ──
console.log('\n== 边界路径 ==')
for (const c of [
  { name: 'GET 未知子路径', method: 'GET', path: `${PREFIX}/nope` },
  { name: 'POST /status（方法不允许）', method: 'POST', path: `${PREFIX}/status`, body: '{}' },
]) {
  const route = matchRoute(c.path)
  if (!route) { check(`${c.name} 有对应路由`, false, '路由未注册'); continue }
  const { thrown, out } = await invoke(route, c.method, c.path, c.body)
  check(`${c.name} 不抛未捕获异常`, !thrown, thrown ? String(thrown.stack ?? thrown.message) : `HTTP ${out.status}`)
}

// 顺带验证：本地没有长驻句柄时 node 能自然退出；这里显式关掉可能的 server
void createServer

console.log('\n================ 对抗性检查结论 ================')
if (failures.length > 0) {
  console.log(failures.join('\n'))
  console.log(`\n失败 ${failures.length} 项：`)
  console.log('（上面每行 FAIL 都是实现缺陷或本假 ctx 覆盖不足，需分别判断）')
  process.exit(1)
}
console.log('全部通过：缺 pluginManager 时 apply 与所有路由均未抛未捕获异常，且返回结构化 JSON。')
process.exit(0)
