/**
 * 目录数据层：抓取 → 校验 → 内存缓存 → 纯函数查询。
 *
 * 这里刻意把「网络」和「计算」分开：createCatalogCache 承载唯一的副作用，
 * 其余导出都是纯函数。verifier 可以拿本地 fixture 直接断言，不用起宿主、不用联网。
 * fetch 可注入（默认全局 fetch），注入后整个抓取策略也能离线测。
 *
 * 源顺序的理由见 resolveSources：目录官方地址挂在 GitHub Pages 上，宿主进程走直连
 *（DSH 只认 HTTP(S)_PROXY，不读系统代理）常常 25s 超时，而 npm 镜像 100ms 级就能返回同一份数据。
 */

import {
  CATALOG_PACKAGE,
  DEFAULT_NPM_REGISTRIES,
  NPM_METADATA_TIMEOUT_MS,
  NPM_TARBALL_TIMEOUT_MS,
  readCatalogFromNpm,
  registryHost,
  timeoutSignal
} from './catalog-npm.js'

/** 官方快照地址：npm 路线全部失败时的最后兜底。 */
export const DEFAULT_SOURCE = 'https://awesome-dsh-plugin.com/plugins.json'
export const SOURCE_ENV = 'DSHM_REGISTRY_URL'
export const NPM_MIRROR_ENV = 'DSHM_NPM_MIRROR'

/** 契约 §3.4：内存缓存 TTL 10 分钟。 */
export const CACHE_TTL_MS = 10 * 60 * 1000

/**
 * 超时预算：npm 元数据短、tarball 要下 1MB+；官方地址已知慢，给它 30s。
 * 用户自己指定的 URL 按原来的 15s 契约走——那是他对自己的网络下的判断。
 */
export const CUSTOM_URL_TIMEOUT_MS = 15_000
export const OFFICIAL_URL_TIMEOUT_MS = 30_000

/**
 * 抓取失败后的冷却窗口：所有源都挂掉时，界面上的每次点击都不该重新走一遍完整源列表。
 * 这只影响自动抓取的速度，不会把失败说成成功——错误码原样返回。
 * 显式刷新（/refresh）绕过它，仍然会真的去请求一次。
 */
export const FAILURE_COOLDOWN_MS = 30_000

function text(value) {
  return value === null || value === undefined ? '' : String(value)
}

function optionalText(value) {
  if (value === null || value === undefined) return null
  const result = String(value).trim()
  return result === '' ? null : result
}

function numberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function stripTrailingSlashes(value) {
  return String(value).replace(/\/+$/, '')
}

function hostOf(url) {
  try {
    return new URL(String(url)).host
  } catch {
    return String(url)
  }
}

/**
 * 按顺序给出要尝试的目录源（每个源只试一次，源列表本身就是重试）。
 *
 * - `DSHM_REGISTRY_URL` 非空 → 只用它：用户指名了自己的目录，就不该在他那边不通时
 *   悄悄换回我们的源（那样会让基于 fixture 的测试打到真实网络）。写错了也照样报错，
 *   错误里带上他填的值。
 * - `DSHM_NPM_MIRROR` 非空 → 只用它；否则国内镜像优先、npm 官方兜底。
 * - 最后永远留一个官方 URL 源，保证镜像全挂时市场还有救。
 */
export function resolveSources(env = process.env) {
  const custom = optionalText(env?.[SOURCE_ENV])
  if (custom !== null) {
    return [{ kind: 'url', url: custom, timeoutMs: CUSTOM_URL_TIMEOUT_MS, label: custom, short: hostOf(custom) }]
  }

  const mirror = optionalText(env?.[NPM_MIRROR_ENV])
  const registries = (mirror !== null ? [mirror] : DEFAULT_NPM_REGISTRIES).map(stripTrailingSlashes)
  const sources = registries.map((registry) => ({
    kind: 'npm',
    registry,
    pkg: CATALOG_PACKAGE,
    metadataTimeoutMs: NPM_METADATA_TIMEOUT_MS,
    tarballTimeoutMs: NPM_TARBALL_TIMEOUT_MS,
    label: `npm:${CATALOG_PACKAGE} (${registryHost(registry)})`,
    short: `npm ${registryHost(registry)}`
  }))
  sources.push({
    kind: 'url',
    url: DEFAULT_SOURCE,
    timeoutMs: OFFICIAL_URL_TIMEOUT_MS,
    label: DEFAULT_SOURCE,
    short: hostOf(DEFAULT_SOURCE)
  })
  return sources
}

/** 契约 §3.3：正文以 `<` 开头（HTML/DOCTYPE）就不是 JSON 契约里的数据。 */
export function looksLikeHtml(body) {
  if (typeof body !== 'string') return false
  const head = body.trimStart().slice(0, 64).toLowerCase()
  if (head === '') return false
  return head.startsWith('<')
}

/** 契约 §3.3：JSON 对象 + plugins 数组 + count 数字，缺一不可。 */
export function validateCatalogPayload(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: '返回的不是 JSON 对象。' }
  }
  if (!Array.isArray(raw.plugins)) {
    return { ok: false, message: '缺少 plugins 数组。' }
  }
  if (!Number.isFinite(raw.count)) {
    return { ok: false, message: '缺少数字类型的 count。' }
  }
  return { ok: true }
}

/** 分类标签表：源里是 { id: { zh, en } }，也容忍纯字符串。 */
export function normalizeLabels(raw) {
  const labels = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return labels
  for (const [id, value] of Object.entries(raw)) {
    if (id === '') continue
    if (typeof value === 'string') {
      labels[id] = { zh: value, en: value }
      continue
    }
    if (value !== null && typeof value === 'object') {
      labels[id] = { zh: text(value.zh), en: text(value.en) }
    }
  }
  return labels
}

/** 单条目录项 → 契约 §2.2 的 item 形状；不做过滤，源里有多少条就产出多少条。 */
export function normalizeItem(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const name = optionalText(source.name) ?? ''
  const owner = optionalText(source.owner) ?? ''
  const npm = optionalText(source.npm)
  const url = optionalText(source.url)
  // 契约 §2.2：spec 优先级 npm → 仓库地址 → null；spec 为空即不可安装。
  const spec = npm ?? url ?? null

  const rawDescription = source.description
  const description =
    typeof rawDescription === 'string'
      ? { zh: rawDescription, en: rawDescription }
      : {
          zh: text(rawDescription?.zh),
          en: text(rawDescription?.en)
        }

  const capabilities = Array.isArray(source.capabilities)
    ? source.capabilities.filter((entry) => typeof entry === 'string' && entry !== '')
    : []

  return {
    id: owner === '' ? name : `${owner}/${name}`,
    name,
    owner,
    npm,
    spec,
    installable: spec !== null,
    version: optionalText(source.version),
    category: optionalText(source.category) ?? 'other',
    description,
    url,
    page: optionalText(source.page),
    stars: numberOrNull(source.stars) ?? 0,
    downloads: numberOrNull(source.downloads),
    added: optionalText(source.added),
    capabilities,
    install: optionalText(source.install),
    // 以下四项是 join 结果的位置；先给默认值，保证 item 形状恒定。
    installed: false,
    installedVersion: null,
    enabled: null,
    updateAvailable: false
  }
}

/**
 * 分类计数（契约 §2.2）：只保留目录里真实存在且 count>0 的分类，按 count 降序。
 * 用全量目录算，不受当前筛选影响，否则 chips 会随搜索跳动。
 */
export function categoryCounts(plugins, labels = {}) {
  const counts = new Map()
  for (const item of Array.isArray(plugins) ? plugins : []) {
    const id = typeof item?.category === 'string' && item.category !== '' ? item.category : 'other'
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([id, count]) => {
      const label = labels[id] ?? {}
      return {
        id,
        zh: typeof label.zh === 'string' && label.zh !== '' ? label.zh : id,
        en: typeof label.en === 'string' && label.en !== '' ? label.en : id,
        count
      }
    })
    .sort((a, b) => b.count - a.count || compareText(a.id, b.id))
}

/**
 * 原始目录 → 缓存快照（不含 fetchedAt/stale，那两项由缓存层填）。
 * source 用抓取时实际请求的地址，而不是源文件里自称的仓库地址。
 */
export function normalizeCatalog(raw, options = {}) {
  const plugins = (Array.isArray(raw?.plugins) ? raw.plugins : []).map(normalizeItem)
  const categoryLabels = normalizeLabels(raw?.categories)
  const source =
    optionalText(options.source) ?? optionalText(raw?.url) ?? optionalText(raw?.source) ?? DEFAULT_SOURCE
  return {
    source,
    updated: optionalText(raw?.updated),
    // count 用实际规范化出来的条数：契约示例里两者相等，以实际数据为准更不容易骗客户端。
    count: plugins.length,
    categoryLabels,
    categories: categoryCounts(plugins, categoryLabels),
    plugins
  }
}

function compareText(a, b) {
  const left = text(a).toLowerCase()
  const right = text(b).toLowerCase()
  if (left === right) return 0
  return left < right ? -1 : 1
}

function matchesQuery(item, query) {
  const haystack = [
    item.id,
    item.name,
    item.owner,
    item.npm,
    item.url,
    item.description?.zh,
    item.description?.en,
    Array.isArray(item.capabilities) ? item.capabilities.join(' ') : ''
  ]
    .filter((value) => typeof value === 'string' && value !== '')
    .join('\n')
    .toLowerCase()
  return haystack.includes(query)
}

/** 契约 §2.2 的 query/category/installed/updates 过滤。 */
export function filterPlugins(plugins, options = {}) {
  const list = Array.isArray(plugins) ? plugins : []
  const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : ''
  const category =
    typeof options.category === 'string' && options.category !== '' && options.category !== 'all'
      ? options.category
      : null

  return list.filter((item) => {
    if (category !== null && item.category !== category) return false
    if (options.installedOnly === true && item.installed !== true) return false
    if (options.updatesOnly === true && item.updateAvailable !== true) return false
    if (query !== '' && !matchesQuery(item, query)) return false
    return true
  })
}

function numberDesc(a, b) {
  const left = typeof a === 'number' && Number.isFinite(a) ? a : null
  const right = typeof b === 'number' && Number.isFinite(b) ? b : null
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}

/** added 是 ISO 日期串，字典序降序等价于时间降序；缺失排最后。 */
function dateDesc(a, b) {
  const left = typeof a === 'string' && a !== '' ? a : null
  const right = typeof b === 'string' && b !== '' ? b : null
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  if (left === right) return 0
  return left < right ? 1 : -1
}

/** 契约 §2.2 的四种排序；未知值直接抛错，因为调用方应该先校验过（避免悄悄回默认）。 */
export function sortPlugins(plugins, sort = 'top') {
  const list = Array.isArray(plugins) ? plugins.slice() : []
  const byName = (a, b) => compareText(a.name, b.name)
  const comparators = {
    top: (a, b) => numberDesc(a.stars, b.stars) || numberDesc(a.downloads, b.downloads) || byName(a, b),
    new: (a, b) => dateDesc(a.added, b.added) || numberDesc(a.stars, b.stars) || byName(a, b),
    downloads: (a, b) => numberDesc(a.downloads, b.downloads) || numberDesc(a.stars, b.stars) || byName(a, b),
    name: (a, b) => byName(a, b) || compareText(a.owner, b.owner)
  }
  const comparator = comparators[sort]
  if (comparator === undefined) {
    throw new Error(`未知排序：${sort}（只能是 top / new / downloads / name）`)
  }
  list.sort(comparator)
  return list
}

/** 契约 §2.2 的 page/pageSize；page 超出范围时返回空页，但 total/pages 仍是真实的。 */
export function paginate(items, page = 1, pageSize = 24) {
  const list = Array.isArray(items) ? items : []
  const total = list.length
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 24
  const current = Number.isSafeInteger(page) && page > 0 ? page : 1
  const pages = Math.max(1, Math.ceil(total / size))
  const start = (current - 1) * size
  return {
    page: current,
    pageSize: size,
    total,
    pages,
    items: list.slice(start, start + size)
  }
}

function parseVersion(value) {
  const raw = optionalText(value)
  if (raw === null) return null
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw)
  if (match === null) return null
  return {
    parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    pre: match[4] ?? null
  }
}

function comparePrerelease(a, b) {
  const left = a.split('.')
  const right = b.split('.')
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const l = left[index]
    const r = right[index]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const lNumber = /^\d+$/.test(l) ? Number(l) : null
    const rNumber = /^\d+$/.test(r) ? Number(r) : null
    if (lNumber !== null && rNumber !== null) {
      if (lNumber !== rNumber) return lNumber < rNumber ? -1 : 1
      continue
    }
    // 数字标识符小于字母标识符（semver §11）。
    if (lNumber !== null) return -1
    if (rNumber !== null) return 1
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

/**
 * 版本比较（semver 子集）：返回 -1/0/1，无法比较时返回 null。
 * 支持可选 v 前缀、缺省 minor/patch、预发布号；忽略 build metadata。
 */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return null
  for (let index = 0; index < 3; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] < right.parts[index] ? -1 : 1
  }
  if (left.pre !== null && right.pre === null) return -1
  if (left.pre === null && right.pre !== null) return 1
  if (left.pre !== null && right.pre !== null) return comparePrerelease(left.pre, right.pre)
  return 0
}

/**
 * 是否有更新：只认目录版本严格高于已安装版本（契约 §2.2）。
 * 版本相同、目录更低、任一侧缺失或不可比较 → false。
 * `latest` 仍然展示目录里的当前版本（可能低于已装版本），但那种情况不该渲染成「更新」。
 */
export function isUpdateAvailable(installedVersion, catalogVersion) {
  if (optionalText(installedVersion) === null || optionalText(catalogVersion) === null) return false
  const compared = compareVersions(catalogVersion, installedVersion)
  return compared !== null && compared > 0
}

/** 仓库地址尾段，用于 npm 为空时的 bundle 匹配；剥掉 .git 与 /tree/... 的尾巴。 */
export function repoTail(url) {
  const value = optionalText(url)
  if (value === null) return null
  const cleaned = value.replace(/[?#].*$/, '').replace(/\/+$/, '')
  const parts = cleaned.split('/').filter((part) => part !== '')
  if (parts.length === 0) return null
  return parts[parts.length - 1].replace(/\.git$/i, '')
}

function normalizedKey(value) {
  const text = optionalText(value)
  return text === null ? null : text.toLowerCase()
}

/**
 * 匹配索引：npm 名是第一身份，仓库尾段只做兜底，不能覆盖已有 npm 键。
 * 契约 §2.3：大小写不敏感；npm 为空时用仓库地址尾段匹配。
 */
function buildMatchIndex(plugins) {
  const index = new Map()
  const add = (key, item) => {
    const normalized = normalizedKey(key)
    if (normalized === null || index.has(normalized)) return
    index.set(normalized, item)
  }
  for (const item of plugins) add(item.npm, item)
  for (const item of plugins) {
    if (item.npm !== null && item.npm !== undefined) continue
    add(repoTail(item.url), item)
  }
  return index
}

function matchBundle(index, bundle) {
  if (bundle === null || typeof bundle !== 'object') return null
  const name = normalizedKey(bundle.name)
  if (name === null) return null
  const direct = index.get(name)
  if (direct !== undefined) return direct
  // 带 scope 的包名再去掉 scope 试一次，覆盖「从仓库装、npm 字段为空」的条目。
  const slash = name.lastIndexOf('/')
  if (slash === -1) return null
  const base = name.slice(slash + 1)
  if (base === '') return null
  return index.get(base) ?? null
}

/**
 * 契约 §2.2：已安装信息 join。返回新数组，不改动缓存里的原对象
 * （缓存被复用，任何原地写入都会污染后续请求）。
 */
export function joinInstalled(plugins, bundles) {
  const list = Array.isArray(plugins) ? plugins : []
  const index = buildMatchIndex(list)
  const matched = new Map()
  for (const bundle of Array.isArray(bundles) ? bundles : []) {
    const item = matchBundle(index, bundle)
    if (item !== null && !matched.has(item)) matched.set(item, bundle)
  }
  return list.map((item) => {
    const bundle = matched.get(item)
    if (bundle === undefined) {
      return { ...item, installed: false, installedVersion: null, enabled: null, updateAvailable: false }
    }
    const installedVersion = optionalText(bundle.version)
    return {
      ...item,
      installed: true,
      installedVersion,
      enabled: bundle.enabled === true,
      updateAvailable: isUpdateAvailable(installedVersion, item.version)
    }
  })
}

/** 契约 §2.3：bundle 视角的 join，补 latest / updateAvailable。 */
export function joinBundles(bundles, plugins) {
  const list = Array.isArray(bundles) ? bundles : []
  const index = buildMatchIndex(Array.isArray(plugins) ? plugins : [])
  return list.map((bundle) => {
    const item = matchBundle(index, bundle)
    const latest = item === null ? null : item.version
    return {
      ...bundle,
      latest,
      updateAvailable: isUpdateAvailable(bundle?.version, latest)
    }
  })
}

function classifyFetchError(error, timeoutMs) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const timedOut =
    error?.name === 'TimeoutError' ||
    error?.name === 'AbortError' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  return timedOut
    ? { ok: false, kind: 'timeout', reason: `超时（${Math.round(timeoutMs / 1000)}s）` }
    : { ok: false, kind: 'network', reason: `请求失败：${describeError(error)}` }
}

function describeError(error) {
  if (error === null || error === undefined) return '未知错误'
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
  return message.length > 200 ? `${message.slice(0, 200)}…` : message
}

/**
 * 目录缓存：TTL 10 分钟；并发抓取共用同一个 in-flight Promise；
 * 失败时保留旧缓存并置 stale；完全无缓存时返回错误码而不是空目录。
 * 每个源只试一次——源列表（镜像 → npm 官方 → 官方 URL）本身就是重试。
 */
export function createCatalogCache(options = {}) {
  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : globalThis.fetch
  const env = options.env ?? process.env
  const now = typeof options.now === 'function' ? options.now : Date.now
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : CACHE_TTL_MS
  const cooldownMs = Number.isFinite(options.failureCooldownMs) ? options.failureCooldownMs : FAILURE_COOLDOWN_MS
  const explicitSources = Array.isArray(options.sources) ? options.sources : null
  const explicitSource = optionalText(options.source)
  const singleTimeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : CUSTOM_URL_TIMEOUT_MS

  let current = null
  let inflight = null
  let lastFailure = null

  const sourcesOf = () => {
    if (explicitSources !== null) return explicitSources
    if (explicitSource !== null) {
      return [
        {
          kind: 'url',
          url: explicitSource,
          timeoutMs: singleTimeoutMs,
          label: explicitSource,
          short: hostOf(explicitSource)
        }
      ]
    }
    return resolveSources(env)
  }

  /** 首个源的展示名，仅供诊断日志使用（/status 已不再报「当前源」）。 */
  const sourceLabel = () => {
    const list = sourcesOf()
    return list.length > 0 ? list[0].label : DEFAULT_SOURCE
  }

  async function readUrlSource(source) {
    if (typeof fetchImpl !== 'function') {
      return { ok: false, kind: 'network', reason: '当前运行环境没有 fetch' }
    }
    let response
    try {
      // 只发 GET、不带凭据、不落盘。
      response = await fetchImpl(source.url, {
        method: 'GET',
        redirect: 'follow',
        credentials: 'omit',
        headers: { accept: 'application/json' },
        signal: timeoutSignal(source.timeoutMs)
      })
    } catch (error) {
      return classifyFetchError(error, source.timeoutMs)
    }
    if (response === null || response === undefined || typeof response.ok !== 'boolean') {
      return { ok: false, kind: 'network', reason: '响应无法识别' }
    }
    if (response.ok !== true) {
      return { ok: false, kind: response.status >= 500 ? 'http' : 'http-4xx', reason: `HTTP ${response.status}` }
    }
    let body
    try {
      body = await response.text()
    } catch (error) {
      return classifyFetchError(error, source.timeoutMs)
    }
    if (looksLikeHtml(body)) {
      return { ok: false, kind: 'not-json', reason: '返回的是网页（HTML）而不是 JSON' }
    }
    let raw
    try {
      raw = JSON.parse(body)
    } catch {
      return { ok: false, kind: 'not-json', reason: '正文不是合法 JSON' }
    }
    return { ok: true, raw, label: source.url }
  }

  /** 所有源都失败时，把「试过哪些源、各自为什么失败」写进文案，并给出两条出路。 */
  function toFailure(attempts) {
    const tried = attempts.map((attempt) => `${attempt.short ?? attempt.label}：${attempt.reason}`).join('；')
    const fix = '可以设 DSHM_REGISTRY_URL 指向你自己的 plugins.json，或设 DSHM_NPM_MIRROR 换一个 npm 镜像。'
    if (attempts.length === 0) {
      return { ok: false, code: 'catalog-unavailable', status: 502, message: '没有可用的目录源。', hint: fix, attempts }
    }
    const allTimeout = attempts.every((attempt) => attempt.kind === 'timeout')
    if (allTimeout) {
      return {
        ok: false,
        code: 'catalog-timeout',
        status: 504,
        message: '所有目录源都超时了。',
        hint: `依次试过 ${tried}。网络可能不通或源站很慢；稍后点「刷新目录」重试，上次的目录结果仍会展示。${fix}`,
        attempts
      }
    }
    return {
      ok: false,
      code: 'catalog-unavailable',
      status: 502,
      message: '所有目录源都取不到数据。',
      hint: `依次试过 ${tried}。检查网络后点「刷新目录」重试。${fix}`,
      attempts
    }
  }

  async function fetchCatalog() {
    const attempts = []
    for (const source of sourcesOf()) {
      const result =
        source.kind === 'npm' ? await readCatalogFromNpm(source, { fetch: fetchImpl }) : await readUrlSource(source)
      if (result.ok === true) {
        const validation = validateCatalogPayload(result.raw)
        if (validation.ok === true) return { ok: true, raw: result.raw, source: result.label ?? source.label }
        attempts.push({ label: source.label, short: source.short, kind: 'invalid', reason: `结构不符：${validation.message}` })
        continue
      }
      attempts.push({ label: result.label ?? source.label, short: source.short, kind: result.kind, reason: result.reason })
    }
    return toFailure(attempts)
  }

  async function load(force) {
    if (force !== true) {
      const fresh = current !== null && current.stale !== true && now() - current.fetchedAtMs < ttlMs
      if (fresh) return { ok: true, cache: current, cached: true }
      if (lastFailure !== null && now() - lastFailure.at < cooldownMs) {
        if (current !== null) {
          return { ok: true, cache: current, staleFallback: true, error: lastFailure.code, attempts: lastFailure.attempts }
        }
        return {
          ok: false,
          code: lastFailure.code,
          status: lastFailure.status,
          message: lastFailure.message,
          hint: lastFailure.hint,
          attempts: lastFailure.attempts
        }
      }
    }

    if (inflight === null) {
      // 并发抓取共用同一个 Promise：契约 §3.4 明确要求，也避免同一瞬间把整份源列表打一遍。
      inflight = fetchCatalog().finally(() => {
        inflight = null
      })
    }
    const result = await inflight

    if (result.ok === true) {
      const fetchedAtMs = now()
      current = {
        ...normalizeCatalog(result.raw, { source: result.source }),
        fetchedAt: new Date(fetchedAtMs).toISOString(),
        fetchedAtMs,
        stale: false,
        error: null
      }
      lastFailure = null
      return { ok: true, cache: current }
    }

    lastFailure = {
      at: now(),
      code: result.code,
      status: result.status,
      message: result.message,
      hint: result.hint,
      attempts: result.attempts
    }
    if (current !== null) {
      // 契约 §2.2 / §2.7：失败保留旧缓存并置 stale，但显式刷新要如实报错。
      current = { ...current, stale: true, error: result.code }
      if (force === true) {
        return {
          ok: false,
          code: result.code,
          status: result.status,
          message: result.message,
          hint: result.hint,
          attempts: result.attempts
        }
      }
      return { ok: true, cache: current, staleFallback: true, error: result.code, attempts: result.attempts }
    }
    return {
      ok: false,
      code: result.code,
      status: result.status,
      message: result.message,
      hint: result.hint,
      attempts: result.attempts
    }
  }

  return {
    /** 首个源的展示名，仅供日志诊断。 */
    source: sourceLabel,
    /** 当前生效的完整源列表，按尝试顺序。 */
    sources: sourcesOf,
    /** 同步读取缓存；没有缓存时返回 null。 */
    peek: () => current,
    ensure: () => load(false),
    refresh: () => load(true),
    invalidate: () => {
      current = null
      lastFailure = null
    },
    config: { ttlMs, cooldownMs }
  }
}
