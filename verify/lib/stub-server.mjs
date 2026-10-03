// 验收自检用的故意错误 stub 服务器。
//
// 用途：证明 verify 的断言「真的会红」。如果这些断言在明显错误的响应上仍然 PASS，
// 那么正式验收的 PASS 就毫无意义。所以这个 stub 的每个端点都刻意违反契约。
//
// 用法：node stub-server.mjs <wrong-market|boot> [port]
// 启动后向 stdout 打印 `PORT=<n>`，然后保持服务直到收到 SIGTERM。
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

const mode = process.argv[2] ?? 'wrong-market'
const port = Number(process.argv[3] ?? 0)
// argv[4] 为可选端口文件：PowerShell 侧只需轮询这个文件，不必去读进程 stdout
// （读 stdout 需要管道/重定向，在 5.1 上更容易把进程拖死）。
const portFile = process.argv[4]

/** 读掉请求体，避免连接挂起。 */
function drain(req) {
  return new Promise((resolve) => {
    req.on('data', () => {})
    req.on('end', resolve)
    req.on('error', resolve)
  })
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

let catalogCalls = 0
let lastCatalogFetchedAt = null

async function wrongMarket(req, res) {
  const url = new URL(req.url ?? '/', 'http://x')
  const path = url.pathname.replace(/^\/plugin-market/, '') || '/'
  const origin = req.headers.origin
  const sfs = req.headers['sec-fetch-site']
  await drain(req)

  // 每个分支都刻意给出违反契约的答案，确保对应断言必然失败
  if (path === '/status') return json(res, 200, { ok: true })                     // 缺 plugin/host/manager/catalog
  if (path === '/catalog') {                                                      // fetchedAt 每次都变 → A8a 必红
    catalogCalls += 1
    lastCatalogFetchedAt = `c${catalogCalls}`
    return json(res, 200, { ok: true, catalog: { fetchedAt: lastCatalogFetchedAt } }) // 缺 page/categories/items
  }
  if (path === '/installed') return json(res, 200, { ok: false })                 // 无 bundles/plugins
  // refresh 回吐紧邻上一次 catalog 的 fetchedAt → 「没有真正重新抓取」→ A8b 必红
  if (path === '/refresh') return json(res, 200, { ok: true, fetchedAt: lastCatalogFetchedAt })
  if (path === '/install' && req.method === 'GET') return json(res, 200, { ok: true })  // 应 405，却 200
  if (path === '/remove') return json(res, 200, { ok: true })                     // 应 400 not-allowed
  if (path === '/toggle') return json(res, 200, { ok: true })                     // 应 400 bad-request
  if (path === '/install' && req.method === 'POST') {
    if (origin === 'http://evil.example') return json(res, 200, { ok: false, error: { code: 'internal' } }) // A14c 必红
    if (origin || sfs) return json(res, 403, { ok: false, error: { code: 'cross-origin' } })               // A14a/A14b 必红
    return json(res, 200, { ok: true })                                                                     // A5a 必红
  }
  return json(res, 200, { ok: true })                                            // 未知路径应 404，却 200 → A12 必红
}

const GOOD_BOOT = `<!doctype html><html><head><script>globalThis["__DSH_BOOT__"] = ${JSON.stringify({
  rev: 'abc',
  entries: [{ id: 'dsh-plugin-market', url: 'plugins/??dsh-plugin-market/client.js&rev=abc', rev: 'abc', inject: [] }],
  batches: [{ phase: 'boot', url: 'plugins/??dsh-plugin-market/client.js&rev=abc', rev: 'abc', entries: ['dsh-plugin-market'] }],
})}</script></head><body>good</body></html>`

const BAD_BOOT = `<!doctype html><html><head><script>globalThis["__DSH_BOOT__"] = ${JSON.stringify({
  rev: 'abc',
  entries: [{ id: '@deepseek-ai/dsh-client-ui-sidebar', url: 'plugins/??@deepseek-ai/dsh-client-ui-sidebar/client.js&rev=abc', rev: 'abc' }],
  batches: [],
})}</script></head><body>bad</body></html>`

// 故意带上中文，让 A3b 的「UTF-8 解码后含『插件市场』」在 good 图上能真的通过，
// 而不是靠 selfcheck 里被当成"方向错误"。
const BUNDLE = `window.__ModuleLoader__.load({\n\tid: "dsh-plugin-market",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} }; var exports = module.exports;\n\t\tvar React = require("react");\n\t\texports.inject = ["slots"];\n\t\texports.apply = function () {\n\t\t\tvar title = "插件市场";\n\t\t\tvoid title;\n\t\t};\n\t\treturn module.exports;\n\t}\n});`

async function boot(req, res) {
  const url = new URL(req.url ?? '/', 'http://x')
  await drain(req)
  if (url.pathname === '/good') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(GOOD_BOOT)
  }
  if (url.pathname === '/bad') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(BAD_BOOT)
  }
  if (url.pathname.startsWith('/plugins/')) {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    return res.end(BUNDLE)
  }
  res.writeHead(404).end('nope')
}

const handler = mode === 'boot' ? boot : wrongMarket
const server = createServer((req, res) => {
  handler(req, res).catch(() => {
    try { res.writeHead(500).end('stub error') } catch {}
  })
})

server.listen(port, '127.0.0.1', () => {
  const actual = server.address().port
  process.stdout.write(`PORT=${actual}\n`)
  if (portFile) {
    try { writeFileSync(portFile, String(actual), 'utf8') } catch (e) { process.stderr.write(`端口文件写入失败: ${e}\n`) }
  }
})

process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref() })
process.on('SIGINT', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref() })
