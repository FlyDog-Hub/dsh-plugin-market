/**
 * 写操作来源判定（isSameOrigin）的判定矩阵测试。
 * 关键用例是「桌面壳形状」：Origin 与 Sec-Fetch-Site 都被 dsh-desktop-host 的
 * forwardWebRequest 剥掉，只剩回环来源——这正是线上 403 的根因，必须回归覆盖。
 */
import assert from 'node:assert/strict'
import { isSameOrigin, isLoopbackRequest, createRouteTable } from '../plugin-market/lib/http.js'

const LOOPBACK = '127.0.0.1'
const REMOTE = '192.168.1.20'
const HOST = '127.0.0.1:19387'

function req({ headers = {}, remoteAddress = LOOPBACK, method = 'POST', url = '/plugin-market/install' } = {}) {
  return { method, url, headers, socket: { remoteAddress } }
}

const cases = [
  // [名称, 请求, 期望]
  ['桌面壳：无 Origin、无 Sec-Fetch-Site、回环 → 放行', req({ headers: { host: HOST } }), true],
  ['桌面壳：无 Origin、无 Sec-Fetch-Site、非回环 → 拒绝', req({ headers: { host: HOST }, remoteAddress: REMOTE }), false],
  ['桌面壳 origin（dsh-app://app）→ 放行', req({ headers: { origin: 'dsh-app://app', host: HOST } }), true],
  ['桌面壳 origin（dsh-app://shell）→ 放行', req({ headers: { origin: 'dsh-app://shell', host: HOST } }), true],
  ['浏览器同源（Origin 与 Host 一致）→ 放行', req({ headers: { origin: `http://${HOST}`, host: HOST } }), true],
  ['浏览器跨站（Origin 外站 + Sec-Fetch-Site: cross-site）→ 拒绝', req({ headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', host: HOST } }), false],
  ['浏览器跨站（只有外站 Origin）→ 拒绝', req({ headers: { origin: 'https://evil.example', host: HOST } }), false],
  ['同站不同端口（Origin 端口不同）→ 拒绝', req({ headers: { origin: 'http://127.0.0.1:3000', host: HOST } }), false],
  ['Sec-Fetch-Site: same-site（无 Origin）→ 拒绝', req({ headers: { 'sec-fetch-site': 'same-site', host: HOST } }), false],
  ['Sec-Fetch-Site: none（无 Origin）→ 拒绝', req({ headers: { 'sec-fetch-site': 'none', host: HOST } }), false],
  ['Sec-Fetch-Site: same-origin（无 Origin，回环）→ 放行', req({ headers: { 'sec-fetch-site': 'same-origin', host: HOST } }), true],
  ['跨站 + 伪装桌面 origin 之外的一切仍拒绝', req({ headers: { origin: 'dsh-app://evil', host: HOST } }), false],
  ['Origin 非法字符串 → 拒绝', req({ headers: { origin: 'not a url', host: HOST } }), false],
  ['无 Origin 无 host、回环 → 放行（本地脚本）', req({}), true],
  ['::ffff:127.0.0.1 回环 → 放行', req({ headers: { host: HOST }, remoteAddress: '::ffff:127.0.0.1' }), true],
  ['::1 回环 → 放行', req({ headers: { host: HOST }, remoteAddress: '::1' }), true],
  ['无 socket 信息（没有 remoteAddress）→ 拒绝', { method: 'POST', url: '/plugin-market/install', headers: { host: HOST } }, false],
]

let pass = 0
const failures = []
for (const [name, request, expected] of cases) {
  const actual = isSameOrigin(request)
  if (actual === expected) pass += 1
  else failures.push(`${name}: 期望 ${expected}，实际 ${actual}`)
}

// 路由层的 405/404 行为不应被本次改动影响。
const table = createRouteTable().on('/plugin-market/install', ['POST'], () => {})
assert.equal(table.paths().length, 1)

console.log(`isSameOrigin 判定矩阵：${pass}/${cases.length} 通过`)
if (failures.length > 0) {
  for (const line of failures) console.log('  FAIL ' + line)
  process.exit(1)
}
assert.equal(isLoopbackRequest(req()), true)
assert.equal(isLoopbackRequest(req({ remoteAddress: REMOTE })), false)
console.log('全部通过')
