// 更新必须带版本：pinnedNpmSpec 的源码不变量 + 真实路由行为。
//
// 背景（2026-10-05 用户报的「点更新没反应」）：
//   目录条目的 spec 是**裸 npm 名**（如 `dsh-context`）。pnpm 11 对**已存在的依赖**执行
//   `pnpm add <裸名>` 是幂等的——打印 Already up to date，package.json 一个字节都不动，
//   于是「更新到 0.63.0」永远停在 0.62.3；宿主随后还按「本来就装着」回一个 restart-required，
//   界面就成了「已安装，重启后生效 → 可更新角标一直是 2」的死循环。
//   实测（DSH 自带 pnpm 11.7.0）：裸名 no-op，`dsh-context@0.63.0` 才真的换版本。
//
// 这个文件证明两层：
//   1) 源码不变量：装之前调用了 pinnedNpmSpec，且它只在「spec === 裸 npm 名 + 目录版本像 semver」时钉版本；
//   2) 行为：本地目录 fixture + 假 pluginManager，POST /plugin-market/install，
//      installBundle 实际收到的必须是 `dsh-context@0.63.0`，而 GitHub 类条目保持 URL 原样。
//
// 用法：node verify/install-spec.test.mjs [plugin-market/lib/index.js]
// 退出码：0 = 全部通过；1 = 有失败
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { createServer } from 'node:http'

const entry = process.argv[2] ?? 'plugin-market/lib/index.js'
const failures = []
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail ? `\n      ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

// ── 1) 源码不变量 ──
const source = readFileSync(entry, 'utf8')
console.log('\n[1] 源码不变量')
check('装之前用 pinnedNpmSpec 钉版本', /spec = pinnedNpmSpec\(hit, spec\)/.test(source), 'install 路由里找不到调用')
check('钉版本只认「spec === 目录里的裸 npm 名」', /if \(npm === null \|\| versionRaw === null \|\| spec !== npm\) return spec/.test(source))
check('版本要像 semver（允许前缀 v），否则原样放行',
  source.includes('const SEMVER_LIKE = /^\\d+\\.\\d+\\.\\d+') && source.includes("versionRaw.replace(/^v/, '')"),
  'SEMVER_LIKE 或 v 前缀剥离缺失')
check('钉出来的是 name@version', source.includes('`${npm}@${version}`'), '找不到模板字符串')

// ── 2) 行为：本地目录 + 假 pluginManager ──
console.log('\n[2] 路由行为（本地目录 fixture + 假 pluginManager）')

const FIXTURE = {
  count: 2,
  updated: '2026-10-01',
  plugins: [
    { name: 'dsh-context', owner: 'bowenliang123', npm: 'dsh-context', version: '0.63.0', description: 'fixture npm 条目' },
    { name: 'some-repo', owner: 'someone', url: 'https://github.com/someone/some-repo', version: '9.9.9', description: 'fixture 纯 GitHub 条目' },
  ],
}

const catalogServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(FIXTURE))
})
await new Promise((resolve) => catalogServer.listen(0, '127.0.0.1', resolve))
const catalogUrl = `http://127.0.0.1:${catalogServer.address().port}/plugins.json`
process.env.DSHM_REGISTRY_URL = catalogUrl

// 假 ctx：pluginManager 装着一个只记录 spec 的假实现。
const routes = []
const installCalls = []
const noopDisposer = () => {}
const fakeManager = {
  async listBundles() { return [] },
  async installBundle(spec) {
    installCalls.push(String(spec))
    return { changed: true, application: 'applied', stage: 'install', target: String(spec) }
  },
  async removeBundle() { return { changed: false, application: 'cancelled', stage: 'remove', target: 'x' } },
  async registries() { return [] },
}
const ctx = {
  get(name) { return name === 'pluginManager' ? fakeManager : undefined },
  has(name) { return name === 'pluginManager' },
  inject(names, cb) {
    if (typeof cb === 'function') cb(ctx)
    return noopDisposer
  },
  effect(fn) { const d = typeof fn === 'function' ? fn() : undefined; return typeof d === 'function' ? d : noopDisposer },
  on() { return noopDisposer },
  once() { return noopDisposer },
  plugin() { return noopDisposer },
  webServer: { register(route) { routes.push(route); return noopDisposer } },
  logger: { info() {}, warn() {}, error() {}, debug() {}, trace() {} },
}

let applyFn = null
try {
  const mod = await import(pathToFileURL(entry).href)
  applyFn = [mod.apply, mod.default?.apply, typeof mod.default === 'function' ? mod.default : null].find((c) => typeof c === 'function') ?? null
} catch (error) {
  check('载入 host 入口', false, String(error.stack ?? error.message))
}
if (applyFn) {
  try {
    await applyFn(ctx)
    check('apply(ctx) 不抛', true)
  } catch (error) {
    check('apply(ctx) 不抛', false, String(error.stack ?? error.message))
  }
}

function makeReq(method, url, body) {
  const req = Readable.from(body ? [Buffer.from(body, 'utf8')] : [])
  req.method = method
  req.url = url
  req.headers = { origin: 'http://127.0.0.1:1', host: '127.0.0.1:1', 'content-type': 'application/json' }
  req.socket = { remoteAddress: '127.0.0.1', remotePort: 12345 }
  return req
}
function makeRes() {
  const out = { status: 0, body: '', ended: false }
  const res = {
    writeHead(status) { out.status = status; return res },
    setHeader() { return res },
    getHeader() { return undefined },
    removeHeader() { return res },
    write(chunk) { if (chunk) out.body += String(chunk); return true },
    end(chunk) { if (chunk) out.body += String(chunk); out.ended = true; return res },
    on() { return res },
    once() { return res },
    emit() { return true },
    destroy() { out.ended = true },
    flushHeaders() {},
  }
  return { res, out }
}

async function postInstall(body) {
  // 路由表以**单条 prefix 路由**注册（kind:'prefix', path:'/plugin-market'），
  // 内部再按 path+method 分发——和对抗性检查一样调它的 handler。
  const route = routes.find((r) => r.kind === 'prefix' && r.path === '/plugin-market')
  if (!route) return { thrown: new Error('插件路由未注册'), out: { status: 0, body: '', ended: false } }
  const { res, out } = makeRes()
  try {
    await route.handler(makeReq('POST', '/plugin-market/install', JSON.stringify(body)), res)
  } catch (error) {
    return { thrown: error, out }
  }
  return { thrown: null, out }
}

if (applyFn) {
  // npm 条目 + 按名字安装（可更新页的「更新到 x.y.z」走的就是这条路）
  const byName = await postInstall({ name: 'dsh-context' })
  check('POST /install {name} 不抛', byName.thrown === null, String(byName.thrown?.message))
  check(
    '按名字安装 npm 条目 → installBundle 收到 dsh-context@0.63.0（带目录版本）',
    installCalls[0] === 'dsh-context@0.63.0',
    `实际收到：${JSON.stringify(installCalls)}`,
  )
  let parsed = null
  try { parsed = JSON.parse(byName.out.body) } catch { /* 非 JSON */ }
  check('响应结构化且 ok=true', parsed?.ok === true, byName.out.body.slice(0, 160))

  // 显式 spec（发现页「安装」传 item.spec，也是裸名）→ 同样钉版本
  const bySpec = await postInstall({ spec: 'dsh-context' })
  check('POST /install {spec:裸名} 不抛', bySpec.thrown === null, String(bySpec.thrown?.message))
  check(
    '显式裸名 spec 也钉成 dsh-context@0.63.0',
    installCalls[1] === 'dsh-context@0.63.0',
    `实际收到：${JSON.stringify(installCalls)}`,
  )

  // 纯 GitHub 条目（npm 为空）→ spec 是 URL，绝不能拼 @版本
  const byRepo = await postInstall({ name: 'someone/some-repo' })
  check('POST /install GitHub 条目不抛', byRepo.thrown === null, String(byRepo.thrown?.message))
  check(
    'GitHub 条目的 spec 保持 URL 原样（不拼 @version）',
    installCalls[2] === 'https://github.com/someone/some-repo',
    `实际收到：${JSON.stringify(installCalls)}`,
  )
}

await new Promise((resolve) => catalogServer.close(resolve))

console.log('')
if (failures.length > 0) {
  console.log(`安装 spec 钉版本：有 ${failures.length} 项失败`)
  for (const name of failures) console.log(`  失败：${name}`)
  process.exit(1)
}
console.log('安装 spec 钉版本检查全部通过：更新真的会带上目录版本，GitHub 条目不受影响。')
