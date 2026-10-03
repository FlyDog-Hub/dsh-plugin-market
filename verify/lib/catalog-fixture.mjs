// 受控目录源 fixture（只读快照 + 请求计数）。
//
// 为什么需要它：
//  1) 「/status 冷启动不触发网络抓取」如果只靠推断就是弱证据。把 DSHM_REGISTRY_URL 指到这里，
//     再用 /__count 读真实请求次数，"没抓取" 就成了可观测事实。
//  2) updateAvailable 的语义要两个方向都能测：注入一个可控版本的 usage 条目，
//     低版本应得 false、高版本应得 true。真实目录里没有 @feiyang666/dsh-usage-plugin，
//     所以只能靠 fixture 注入。
//
// 用法：node catalog-fixture.mjs <port> <usageVersion|-> <portFile>
//   usageVersion 用 '-' 表示不注入该条目。
//   端口文件固定为最后一个参数（与 PowerShell 侧 Start-NodeServer 的约定一致）。
// 端点：
//   GET /plugins.json  → 快照（首次读取时加载）并计数 +1
//   GET /__count       → {"count": n}，不计数
//   GET /__reset       → {"count": 0}
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'

const port = Number(process.argv[2] ?? 0)
const usageRaw = process.argv[3] ?? '-'
const usageVersion = usageRaw === '-' || usageRaw === '' ? null : usageRaw
const portFile = process.argv[4]

const SNAPSHOT = process.env.DSH_VERIFY_SNAPSHOT
  ?? 'E:\\AI\\DeepSeek Harness\\Dsh\\_ref\\data\\plugins.json'

/** 只读快照 + 可选注入条目；注入项用于 updateAvailable 的双向断言。 */
function buildCatalog() {
  const base = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
  if (!usageVersion) return base
  const injected = {
    name: 'dsh-usage-plugin',
    owner: 'feiyang-dev',
    url: 'https://github.com/feiyang-dev/dsh-usage-plugin',
    page: 'https://awesome-dsh-plugin.com/p/feiyang-dev/dsh-usage-plugin/',
    category: 'usage',
    description: {
      en: 'Injected by verify catalog fixture for updateAvailable semantics.',
      zh: '由验收目录 fixture 注入，用于验证 updateAvailable 语义。',
    },
    npm: '@feiyang666/dsh-usage-plugin',
    version: usageVersion,
    stars: 1,
    downloads: 1,
    added: '2026-01-01',
    capabilities: [],
    install: 'dsh plugin --profile web add @feiyang666/dsh-usage-plugin',
  }
  return { ...base, count: base.count + 1, plugins: [...base.plugins, injected] }
}

let catalog = null
let count = 0

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (url.pathname === '/__count') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ count }))
  }
  if (url.pathname === '/__reset') {
    count = 0
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ count }))
  }
  if (url.pathname === '/plugins.json') {
    count += 1
    if (catalog === null) catalog = buildCatalog()
    const body = JSON.stringify(catalog)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(body)
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('fixture: not found')
})

server.listen(port, '127.0.0.1', () => {
  const actual = server.address().port
  process.stdout.write(`PORT=${actual}\n`)
  if (portFile) {
    try { writeFileSync(portFile, String(actual), 'utf8') } catch {}
  }
})

process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref() })
process.on('SIGINT', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref() })
