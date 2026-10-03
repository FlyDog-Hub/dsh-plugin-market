/**
 * 断言：/status 报的版本等于 package.json 的版本（防止版本号在代码里写死后漂移）。
 * 用假 ctx 注入 webServer.register，抓一条本机 http 请求即可。
 */
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const pluginDir = process.argv[2] ?? 'plugin-market'
const expected = JSON.parse(readFileSync(`${pluginDir}/package.json`, 'utf8')).version

const mod = await import(pathToFileURL(`${pluginDir}/lib/index.js`).href)
let route = null
const ctx = {
  get(name) {
    if (name === 'webServer') return { register(r) { route = r; return () => { route = null } } }
    return undefined
  },
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  on() { return () => {} },
}
mod.apply(ctx)
if (route === null) throw new Error('apply 没有注册路由')

const server = http.createServer((req, res) => { void route.handler(req, res) })
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const body = await new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: '/plugin-market/status' }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  }).on('error', reject)
})
server.close()

const reported = JSON.parse(body).plugin.version
if (reported !== expected) {
  console.error(`FAIL /status 报的版本是 ${reported}，package.json 是 ${expected}（版本号必须从清单读）`)
  process.exit(1)
}
console.log(`版本一致性：/status=${reported} == package.json=${expected}`)
