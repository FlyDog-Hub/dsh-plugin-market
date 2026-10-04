/**
 * 市场自更新通道的回归测试（离线、确定性）。
 *
 * 为什么必须覆盖这几条：这条链路上任何一处放宽都会变成「装了一个没验过的东西」——
 * 版本比较错会让「已是最新」骗人，路径/哈希/产物自证三道校验少一道就等于没有校验。
 * 另外 apply() 必须证明自己**在拒绝时根本没有调用 pluginManager**，否则「拒绝」只是文案。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import {
  compareVersions,
  createSelfUpdater,
  isNewer,
  isReleaseTarballPath,
  isSha256Hex,
  pickLatestVersion,
  readArtifactManifest,
  readIndex,
  verifySha256Hex,
} from '../plugin-market/lib/self-update.js'

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}
async function checkAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

// ── 造一个真实的 USTAR tarball（不引 tar 库：读端解析的就是这个格式）──
function tarEntry(name, content) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii')
  header.write('        ', 148, 8, 'ascii')
  header.write('0', 156, 1, 'ascii')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512)
  Buffer.from(content).copy(padded)
  return Buffer.concat([header, padded])
}

function makeTarball(name, version, extraFiles = []) {
  const parts = [tarEntry('package/package.json', JSON.stringify({ name, version, dsh: { bundle: {} } }))]
  for (const [file, body] of extraFiles) parts.push(tarEntry(file, body))
  parts.push(Buffer.alloc(1024)) // 两个空块结尾
  return gzipSync(Buffer.concat(parts))
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// ── 1. 版本比较 ─────────────────────────────────────────────────────
console.log('\n[1] 版本比较（严格 MAJOR.MINOR.PATCH）')
check('1.2.0 < 1.10.0（按数字比，不是字典序）', () => {
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1)
})
check('v 前缀与去前缀等价', () => {
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0)
})
check('2.0.0 > 1.99.99', () => {
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1)
})
check('不可解析的版本一律返回 null：不猜预发布号', () => {
  for (const bad of ['1.2', '1.2.3.4', '1.2.3-rc.1', '', 'x.y.z', null, undefined, 123]) {
    assert.equal(compareVersions(bad, '1.0.0'), null, `应当拒绝 ${String(bad)}`)
  }
})
check('isNewer 只在严格更高时为真', () => {
  assert.equal(isNewer('1.0.1', '1.0.0'), true)
  assert.equal(isNewer('1.0.0', '1.0.0'), false)
  assert.equal(isNewer('0.9.9', '1.0.0'), false)
})
check('pickLatestVersion 取最大且忽略垃圾项', () => {
  assert.equal(pickLatestVersion(['1.0.10', 'v1.0.2', 'bogus', '1.1.0', '1.0.9']), '1.1.0')
  assert.equal(pickLatestVersion(['bogus', '']), null)
})

// ── 2. 清单校验 ─────────────────────────────────────────────────────
console.log('\n[2] index.json 的路径与哈希校验')
check('tarball 路径必须落在 releases/*.tgz', () => {
  assert.equal(isReleaseTarballPath('releases/dsh-plugin-market-1.1.0.tgz'), true)
  for (const bad of ['../evil.tgz', 'releases/../../evil.tgz', '/abs/evil.tgz', 'releases/x.tar', 'https://cdn/x.tgz', null]) {
    assert.equal(isReleaseTarballPath(bad), false, `应当拒绝 ${String(bad)}`)
  }
})
check('sha256 必须是 64 位十六进制', () => {
  assert.equal(isSha256Hex('a'.repeat(64)), true)
  assert.equal(isSha256Hex('A'.repeat(64)), false)
  assert.equal(isSha256Hex('a'.repeat(63)), false)
})
check('verifySha256Hex 认可正确哈希、拒绝被改过的字节', () => {
  const bytes = Buffer.from('hello')
  assert.equal(verifySha256Hex(bytes, sha256(bytes)).ok, true)
  assert.equal(verifySha256Hex(Buffer.from('hellp'), sha256(bytes)).ok, false)
  assert.equal(verifySha256Hex(bytes, 'not-a-hash').ok, false)
})
check('readIndex 丢掉结构不对的条目，并在缺 latest 时自己推', () => {
  const index = readIndex({
    versions: [
      { version: '1.0.0', tag: 'v1.0.0', tarball: 'releases/a-1.0.0.tgz', sha256: 'b'.repeat(64), versionCode: 10000 },
      { version: 'nope', tarball: 'releases/b.tgz' },
      { version: '1.1.0', tag: 'v1.1.0', tarball: '../evil.tgz', sha256: 'c'.repeat(64) },
    ],
  })
  assert.equal(index.versions.length, 2, '只有两个版本结构合法')
  assert.equal(index.latest.version, '1.1.0', 'latest 缺失时按最高版本推')
  const suspicious = index.versions.find((entry) => entry.version === '1.1.0')
  assert.equal(suspicious.tarball, null, '路径不合法的 tarball 必须被置空，而不是原样采信')
})
check('readIndex 对不认识的结构返回 null', () => {
  assert.equal(readIndex(null), null)
  assert.equal(readIndex({}), null)
  assert.equal(readIndex({ versions: [], latest: 42 }), null)
})

// ── 3. 产物自证 ─────────────────────────────────────────────────────
console.log('\n[3] 产物自证（解 tarball 读 package/package.json）')
check('能读出包名与版本', () => {
  const verdict = readArtifactManifest(makeTarball('dsh-plugin-market', '1.1.0'))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.name, 'dsh-plugin-market')
  assert.equal(verdict.version, '1.1.0')
})
check('没有 package/package.json 的 tarball 被拒绝', () => {
  const bytes = gzipSync(Buffer.concat([tarEntry('package/other.json', '{}'), Buffer.alloc(1024)]))
  assert.equal(readArtifactManifest(bytes).ok, false)
})
check('不是 tarball 的字节被拒绝（不抛异常）', () => {
  assert.equal(readArtifactManifest(Buffer.from('not a tarball')).ok, false)
})

// ── 4. check() 的源选择与缓存 ────────────────────────────────────────
console.log('\n[4] check()：源顺序、版本判定、10 分钟缓存')

const REPO_INDEX = (version, tarballVersion = version) => ({
  channel: 'jsdelivr',
  latest: { version, tag: `v${version}`, versionCode: 10100, tarball: `releases/dsh-plugin-market-${tarballVersion}.tgz`, sha256: 'd'.repeat(64), bytes: 1234, build: '+1.abc1234', releasedAt: '2026-10-04T00:00:00Z' },
  versions: [],
})

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

function fakeFetch(routes) {
  const calls = []
  const impl = async (url) => {
    calls.push(String(url))
    for (const [pattern, responder] of routes) {
      if (String(url).includes(pattern)) return typeof responder === 'function' ? responder(url) : responder
    }
    return { ok: false, status: 404, text: async () => 'not found' }
  }
  impl.calls = calls
  return impl
}

await checkAsync('标签列表 → 该标签的 index.json → 判定有更新', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.0.0' }, { version: '1.1.0' }, { version: '1.0.9' }] })],
    ['releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.2', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.latest, '1.1.0')
  assert.equal(result.updateAvailable, true)
  assert.equal(result.installable, true)
  assert.equal(result.channel, 'jsdelivr-tags')
  assert.equal(result.url, 'https://cdn.jsdelivr.net/gh/Winnie-0721/dsh-plugin-market@v1.1.0/releases/dsh-plugin-market-1.1.0.tgz')
  assert.equal(result.sha256, 'd'.repeat(64))
})

await checkAsync('当前版本等于最新：updateAvailable=false（不提示更新）', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.0' }] })],
    ['releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.1.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.updateAvailable, false)
  assert.equal(result.installable, false)
})

await checkAsync('第一个源挂了就用第二个，且如实记下原因', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', { ok: false, status: 503, text: async () => '' }],
    ['cdn.jsdelivr.net/gh/Winnie-0721/dsh-plugin-market@main/releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.channel, 'jsdelivr-index')
  assert.equal(result.attempts[0].ok, false)
  assert.match(result.attempts[0].reason, /HTTP 503/)
})

await checkAsync('三个源都挂了：如实报不可用，并带三条尝试记录', async () => {
  const fetchImpl = fakeFetch([])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self-update-unavailable')
  assert.equal(result.attempts.length, 3)
  assert.ok(result.attempts.every((attempt) => attempt.ok === false))
})

await checkAsync('10 分钟内复用缓存，不再打网络', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.0' }] })],
    ['releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  await updater.check({ force: true })
  const afterFirst = fetchImpl.calls.length
  await updater.check({})
  assert.equal(fetchImpl.calls.length, afterFirst, '第二次应命中缓存')
  await updater.check({ force: true })
  assert.ok(fetchImpl.calls.length > afterFirst, 'force 必须绕过缓存')
})

// ── 5. apply()：拒绝路径绝不安装 ─────────────────────────────────────
console.log('\n[5] apply()：拒绝路径绝不调用 pluginManager')

const TARBALL = makeTarball('dsh-plugin-market', '1.1.0')
const TARBALL_SHA = sha256(TARBALL)

function applyFetch(tarball = TARBALL, indexVersion = '1.1.0', sha = TARBALL_SHA) {
  return fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: indexVersion }] })],
    ['releases/index.json', jsonResponse({
      latest: {
        version: indexVersion, tag: `v${indexVersion}`, versionCode: 10100,
        tarball: `releases/dsh-plugin-market-${indexVersion}.tgz`, sha256: sha, bytes: tarball.length,
      },
      versions: [],
    })],
    ['.tgz', { ok: true, status: 200, arrayBuffer: async () => tarball }],
  ])
}

function fakeManager() {
  const calls = []
  return { calls, installBundle: async (spec, options) => { calls.push({ spec, options }); return { application: 'restart-required', changed: true } } }
}

await checkAsync('已是最新时不做任何下载、不调用安装', async () => {
  const fetchImpl = applyFetch()
  const manager = fakeManager()
  const updater = createSelfUpdater({ fetchImpl, current: '1.1.0', manager, logger: { warn() {} } })
  const result = await updater.apply()
  assert.equal(result.ok, true)
  assert.equal(result.application, 'up-to-date')
  assert.equal(manager.calls.length, 0)
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('.tgz')).length, 0, '不该下载 tarball')
})

await checkAsync('sha256 不符：拒绝安装（这是防篡改的那一道）', async () => {
  const fetchImpl = applyFetch(TARBALL, '1.1.0', 'e'.repeat(64))
  const manager = fakeManager()
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, cacheMs: 0, logger: { warn() {} } })
  const result = await updater.apply()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self-update-integrity')
  assert.equal(manager.calls.length, 0, '校验不过绝不能调用 pluginManager')
})

await checkAsync('哈希自洽但产物根本不是本插件：按自证拒绝', async () => {
  const evil = makeTarball('some-other-plugin', '1.1.0')
  const fetchImpl = applyFetch(evil, '1.1.0', sha256(evil))
  const manager = fakeManager()
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, cacheMs: 0, logger: { warn() {} } })
  const result = await updater.apply()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self-update-integrity')
  assert.match(result.message, /some-other-plugin/)
  assert.equal(manager.calls.length, 0)
})

await checkAsync('字节数与清单不符：拒绝', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.0' }] })],
    ['releases/index.json', jsonResponse({
      latest: { version: '1.1.0', tag: 'v1.1.0', tarball: 'releases/dsh-plugin-market-1.1.0.tgz', sha256: TARBALL_SHA, bytes: TARBALL.length + 1 },
      versions: [],
    })],
    ['.tgz', { ok: true, status: 200, arrayBuffer: async () => TARBALL }],
  ])
  const manager = fakeManager()
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, cacheMs: 0, logger: { warn() {} } })
  const result = await updater.apply()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self-update-integrity')
  assert.equal(manager.calls.length, 0)
})

await checkAsync('index.json 里的 tarball 路径不合法：拒绝，且不下载', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.0' }] })],
    ['releases/index.json', jsonResponse({
      latest: { version: '1.1.0', tag: 'v1.1.0', tarball: 'https://evil.example/x.tgz', sha256: TARBALL_SHA },
      versions: [],
    })],
  ])
  const manager = fakeManager()
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, cacheMs: 0, logger: { warn() {} } })
  const result = await updater.apply()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self-update-unavailable')
  assert.equal(manager.calls.length, 0)
})

await checkAsync('没有 pluginManager：不更新，但不谎报成功', async () => {
  const fetchImpl = applyFetch()
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager: null, cacheMs: 0, logger: { warn() {} } })
  const result = await updater.apply()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'manager-unavailable')
})

await checkAsync('正常路径：下载 → 落盘 → 用本地绝对路径安装，并要求重启', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpm-selfupdate-'))
  try {
    const fetchImpl = applyFetch()
    const manager = fakeManager()
    const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, downloadDir: dir, cacheMs: 0, logger: { warn() {} } })
    const result = await updater.apply()
    assert.equal(result.ok, true)
    // application 由宿主决定：这里如实透传（fake 返回 restart-required，真实宿主通常也是它）。
    assert.equal(result.application, 'restart-required')
    assert.equal(result.from, '1.0.0')
    assert.equal(result.to, '1.1.0')
    assert.equal(result.requiresRestart, true, '宿主半在进程里被缓存，必须要求重启')
    assert.equal(manager.calls.length, 1)
    const spec = manager.calls[0].spec
    assert.ok(spec.endsWith('dsh-plugin-market-1.1.0.tgz'), `安装 spec 应是落盘后的 tarball：${spec}`)
    // 安装用的是绝对路径：pnpm 不认相对路径（install-spec.ts 会直接拒绝）。
    assert.ok(/^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('/'), `必须是绝对路径：${spec}`)
    assert.deepEqual(readFileSync(spec), TARBALL, '落盘的字节必须与下载到的一致')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await checkAsync('没有 fetch 的运行环境：如实报不可用', async () => {
  const updater = createSelfUpdater({ fetchImpl: undefined, current: '1.0.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self-update-unavailable')
})

// ── 汇总 ────────────────────────────────────────────────────────────
console.log('')
if (failures.length > 0) {
  console.log(`自更新通道回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  for (const failure of failures) console.log(`  失败：${failure.name}`)
  process.exit(1)
}
console.log(`自更新通道回归：${passed}/${passed} 全通过`)
