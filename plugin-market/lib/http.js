/**
 * host 半共用的 HTTP 小工具。
 *
 * 七个端点共享同一套响应约定（状态码、Content-Type、Cache-Control、错误码 → 中文文案）。
 * 集中在这里，是为了避免每个 handler 各写一份、然后慢慢漂移。
 * 这里只做传输层判断，不吞业务错误：任何失败都由调用方决定用哪个错误码。
 */

import { Buffer } from 'node:buffer'

/** 契约 §1：请求体上限 64 KiB。 */
export const MAX_BODY_BYTES = 64 * 1024

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

/** 允许 POST 的同源信号；两个都没有时按跨站处理（契约 §1 的验收断言 5）。 */
export const SAME_ORIGIN_FETCH_SITES = new Set(['same-origin'])

/**
 * 错误码 → 默认中文文案。每条都回答「发生了什么 / 为什么 / 现在怎么办」。
 * 端点需要更精确的说法时用 sendError 的 overrides 覆盖，而不是另起一套措辞。
 */
export const ERROR_TEXT = {
  'bad-request': {
    message: '请求参数不对。',
    hint: '按响应里的说明改好参数再试一次。'
  },
  'cross-origin': {
    message: '这个请求不是从本机页面发出的。',
    hint: '在市场界面里操作；用脚本时带上 Origin，或 Sec-Fetch-Site: same-origin。'
  },
  'method-not-allowed': {
    message: '这个地址不支持这种请求方式。',
    hint: '按响应 Allow 头里允许的方法重试。'
  },
  'not-found': {
    message: '没有这个接口。',
    hint: '可用接口见响应里的说明。'
  },
  'catalog-unavailable': {
    message: '插件目录取不到数据。',
    hint: '检查网络或 DSHM_REGISTRY_URL，然后点「刷新目录」重试。'
  },
  'catalog-timeout': {
    message: '插件目录源没有按时响应。',
    hint: '网络可能不通；稍后点「刷新目录」重试，上次的目录结果仍会展示。'
  },
  'manager-unavailable': {
    message: '宿主没有提供插件管理服务。',
    hint: '现在只能浏览和搜索；安装、卸载、开关请在终端用 dsh plugin 完成。'
  },
  'not-in-catalog': {
    message: '这个插件不在目录里，已拒绝安装。',
    hint: '市场只允许安装目录内的插件；先刷新目录再试。'
  },
  'install-failed': {
    message: '安装调用失败。',
    hint: '看宿主日志里的 dsh-plugin-market 记录，确认网络与 pnpm 可用后重试。'
  },
  'remove-failed': {
    message: '卸载调用失败。',
    hint: '看宿主日志里的 dsh-plugin-market 记录，然后重试。'
  },
  'toggle-failed': {
    message: '开关调用失败。',
    hint: '看宿主日志里的 dsh-plugin-market 记录，然后重试。'
  },
  'not-allowed': {
    message: '这个操作被宿主拒绝。',
    hint: '这类条目由宿主基础设施管理，请在终端里操作。'
  },
  internal: {
    message: '插件市场内部出错了。',
    hint: '看宿主日志里的 dsh-plugin-market 记录，然后重试。'
  }
}

/** 取请求头；Node 会把名字转小写，数组值取第一个。 */
export function headerOf(req, name) {
  const value = req?.headers?.[name]
  if (Array.isArray(value)) return value[0]
  return typeof value === 'string' ? value : undefined
}

export function normalizePath(pathname) {
  const value = typeof pathname === 'string' && pathname !== '' ? pathname : '/'
  if (value === '/') return '/'
  const trimmed = value.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/** 按契约 §1 写 JSON：固定 Content-Type 与 no-store，并自己算 Content-Length。 */
export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': JSON_CONTENT_TYPE,
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
    ...extraHeaders
  })
  res.end(body)
}

/**
 * 统一的失败响应：`{ ok:false, error:{ code, message, hint } }`。
 * code 必须在契约 §1 的清单里；message/hint 允许端点覆盖。
 */
export function sendError(res, status, code, overrides = {}) {
  const fallback = ERROR_TEXT[code] ?? { message: code, hint: undefined }
  const message = typeof overrides.message === 'string' && overrides.message !== '' ? overrides.message : fallback.message
  const hint = typeof overrides.hint === 'string' && overrides.hint !== '' ? overrides.hint : fallback.hint
  const error = { code, message }
  if (typeof hint === 'string' && hint !== '') error.hint = hint
  sendJson(res, status, { ok: false, error }, overrides.headers ?? {})
}

export function sendMethodNotAllowed(res, methods) {
  const allow = methods.map((method) => method.toUpperCase()).join(', ')
  sendError(res, 405, 'method-not-allowed', {
    message: `这个地址只接受 ${allow}。`,
    hint: `用 ${allow} 重新请求；GET 与 POST 的端点不通用。`,
    headers: { allow }
  })
}

/** 请求体是否真的存在；只有非空体才要求 JSON Content-Type。 */
export function hasBody(req) {
  const transferEncoding = headerOf(req, 'transfer-encoding')
  if (typeof transferEncoding === 'string' && transferEncoding !== '') return true
  const length = Number(headerOf(req, 'content-length'))
  return Number.isFinite(length) && length > 0
}

export function isJsonContentType(req) {
  const value = headerOf(req, 'content-type')
  if (typeof value !== 'string') return false
  return value.split(';')[0].trim().toLowerCase() === 'application/json'
}

/**
 * 同源判定（契约 §1）：
 *  - 有 Sec-Fetch-Site 时只认 same-origin，其余（含 cross-site、same-site、none）一律拒绝；
 *  - 没有该头时退回 Origin 与 Host 的 host 比较；
 *  - 两个都没有（例如 curl、或第三方页面的表单）→ 拒绝。
 */
export function isSameOrigin(req) {
  const fetchSite = headerOf(req, 'sec-fetch-site')
  if (typeof fetchSite === 'string' && fetchSite.trim() !== '') {
    return SAME_ORIGIN_FETCH_SITES.has(fetchSite.trim().toLowerCase())
  }
  const origin = headerOf(req, 'origin')
  const host = headerOf(req, 'host')
  if (typeof origin !== 'string' || origin.trim() === '') return false
  if (typeof host !== 'string' || host.trim() === '') return false
  let originHost
  try {
    originHost = new URL(origin.trim()).host
  } catch {
    return false
  }
  return originHost.toLowerCase() === host.trim().toLowerCase()
}

/** 同源不过就自己写 403；返回 false 表示调用方应立刻收工。 */
export function requireSameOrigin(req, res) {
  if (isSameOrigin(req)) return true
  sendError(res, 403, 'cross-origin')
  return false
}

/**
 * 读请求体：上限 64 KiB，超过就停下不再累积（把响应交给调用方写）。
 * 返回 `{ ok:true, value }` 或 `{ ok:false, status, code, message, hint }`。
 */
export function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        finish({
          ok: false,
          status: 400,
          code: 'bad-request',
          message: `请求体超过 ${Math.round(limit / 1024)} KiB 上限。`,
          hint: '这个接口只收很小的 JSON；去掉多余内容后重试。'
        })
        // 继续把剩下的字节读掉，否则客户端可能收到 ECONNRESET 而不是上面的说明。
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (settled) return
      if (size === 0) {
        finish({ ok: true, value: null })
        return
      }
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        finish({ ok: true, value: JSON.parse(text) })
      } catch {
        finish({
          ok: false,
          status: 400,
          code: 'bad-request',
          message: '请求体不是合法的 JSON。',
          hint: '检查 JSON 语法（引号、逗号）后重试。'
        })
      }
    })

    req.on('error', () => {
      finish({
        ok: false,
        status: 400,
        code: 'bad-request',
        message: '请求体读到一半就断了。',
        hint: '重新提交一次。'
      })
    })
  })
}

/** 把「Content-Type 校验 + 读体 + 必须是对象」三步合成一步，失败时顺手写响应。 */
export async function readJsonObject(req, res) {
  if (hasBody(req) && !isJsonContentType(req)) {
    sendError(res, 400, 'bad-request', {
      message: '请求体必须是 application/json。',
      hint: '把 Content-Type 设为 application/json 后重试。'
    })
    return { ok: false }
  }
  const read = await readJsonBody(req)
  if (read.ok !== true) {
    sendError(res, read.status, read.code, { message: read.message, hint: read.hint })
    return { ok: false }
  }
  // 空体交给字段校验报「缺哪个字段」，比在这里硬说一句「没有 body」更有用。
  if (read.value === null) return { ok: true, value: {} }
  if (typeof read.value !== 'object' || Array.isArray(read.value)) {
    sendError(res, 400, 'bad-request', {
      message: '请求体必须是一个 JSON 对象。',
      hint: '用 { "字段": 值 } 的形式提交。'
    })
    return { ok: false }
  }
  return { ok: true, value: read.value }
}

/** 查询参数：字符串，缺省空串；超长直接报错而不是截断（截断会让人搜到错的结果）。 */
export function pickQueryText(params, name, options = {}) {
  const raw = params.get(name)
  if (raw === null) return { ok: true, value: '' }
  const value = raw.trim()
  const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : undefined
  if (maxLength !== undefined && value.length > maxLength) {
    return {
      ok: false,
      message: `参数 ${name} 超过 ${maxLength} 个字符。`,
      hint: `缩短 ${name} 后重试。`
    }
  }
  return { ok: true, value }
}

/** 查询参数：整数，带范围与缺省值。 */
export function pickQueryInt(params, name, options = {}) {
  const min = Number.isFinite(options.min) ? options.min : 1
  const max = Number.isFinite(options.max) ? options.max : Number.MAX_SAFE_INTEGER
  const raw = params.get(name)
  if (raw === null || raw.trim() === '') return { ok: true, value: options.fallback }
  const text = raw.trim()
  if (!/^\d+$/.test(text)) {
    return { ok: false, message: `参数 ${name} 必须是整数。`, hint: `${name} 用 ${min} 到 ${max} 之间的整数。` }
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return { ok: false, message: `参数 ${name} 超出取值范围。`, hint: `${name} 用 ${min} 到 ${max} 之间的整数。` }
  }
  return { ok: true, value }
}

/** 查询参数：枚举值，缺省 fallback；不认识的值报错而不是悄悄回默认。 */
export function pickQueryEnum(params, name, allowed, fallback) {
  const raw = params.get(name)
  if (raw === null || raw.trim() === '') return { ok: true, value: fallback }
  const value = raw.trim()
  if (!allowed.includes(value)) {
    return { ok: false, message: `参数 ${name} 的取值不认识。`, hint: `${name} 只能是 ${allowed.join(' / ')}。` }
  }
  return { ok: true, value }
}

/** 查询参数：0/1 开关。 */
export function pickQueryFlag(params, name) {
  const raw = params.get(name)
  if (raw === null || raw === '') return { ok: true, value: false }
  if (raw === '0') return { ok: true, value: false }
  if (raw === '1') return { ok: true, value: true }
  return { ok: false, message: `参数 ${name} 只能是 0 或 1。`, hint: `去掉 ${name}，或填 0 / 1。` }
}

/**
 * 方法分发：契约要求一条 prefix 路由内部分发（重复注册 (kind,path) 会 throw）。
 * 这里把「路径不存在 → 404」「方法不匹配 → 405」挡在业务代码之外，
 * 业务 handler 只需假设自己拿到了正确的路径与方法。
 */
export function createRouteTable() {
  const routes = new Map()

  const table = {
    on(path, methods, handler) {
      const key = normalizePath(path)
      routes.set(key, { methods: methods.map((method) => method.toUpperCase()), handler })
      return table
    },
    paths() {
      return [...routes.keys()]
    },
    async dispatch(req, res) {
      let url
      try {
        url = new URL(typeof req.url === 'string' && req.url !== '' ? req.url : '/', 'http://localhost')
      } catch {
        sendError(res, 400, 'bad-request', { message: '请求地址无法解析。', hint: '检查请求的 URL。' })
        return
      }
      const pathname = normalizePath(url.pathname)
      const route = routes.get(pathname)
      if (route === undefined) {
        sendError(res, 404, 'not-found', {
          message: `没有 ${pathname} 这个接口。`,
          hint: `可用接口：${[...routes.keys()].join('、')}。`
        })
        return
      }
      const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
      if (!route.methods.includes(method)) {
        sendMethodNotAllowed(res, route.methods)
        return
      }
      await route.handler(req, res, url)
    }
  }

  return table
}
