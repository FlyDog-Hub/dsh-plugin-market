/**
 * dsh-plugin-market — HOST 半（Cordis function plugin）。
 *
 * 职责只有一个：把 https://awesome-dsh-plugin.com/plugins.json 这类目录源
 * 变成宿主 HTTP 上的 9 个只读/操作端点，并把宿主可选的 pluginManager 服务桥接出去。
 * 其中 `/self-update` 的 GET/POST 是市场**自身**的升级通道（见 self-update.js）。
 *
 * 为什么只注册一条 prefix 路由：宿主对 (kind, path) 的重复注册会 throw，
 * 而七个端点又在同一个前缀下——一条 prefix 路由 + 内部分发是唯一不会互相撞的写法。
 */

import { createRequire } from 'node:module'
import {
  createRouteTable,
  pickQueryEnum,
  pickQueryFlag,
  pickQueryInt,
  pickQueryText,
  readJsonObject,
  requireSameOrigin,
  sendError,
  sendJson
} from './http.js'
import {
  createCatalogCache,
  filterPlugins,
  joinBundles,
  joinInstalled,
  paginate,
  sortPlugins
} from './catalog.js'
import { createSelfUpdater } from './self-update.js'

const PLUGIN_NAME = 'dsh-plugin-market'
/**
 * 版本从包清单读，**不写死**：写死会在每次发布后与 package.json 漂移，页面与 /status 会跟着
 * 显示上一个版本（本仓库真的发生过一次，发布门禁为此加了一条检查）。读不到时退回 '0.0.0'，
 * 让漂移在界面上明显可见，而不是显示一个看起来合理的旧版本号。
 */
const PLUGIN_VERSION = (() => {
  try {
    return createRequire(import.meta.url)('../package.json').version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()
const ROUTE_PREFIX = '/plugin-market'
const SORT_VALUES = ['top', 'new', 'downloads', 'name']

/** 宿主把「这条由基础设施管理」表达成 ReadOnlyReason，映射到契约的 not-allowed。 */
const READ_ONLY_CODES = new Set(['management-required', 'unaddressable', 'not-removable'])

/** ManagementError 只有 code，没有面向用户的 message；这里补上「发生了什么」。 */
const MANAGEMENT_MESSAGE = {
  'management-required': '当前进程没有插件管理权限。',
  unaddressable: '当前进程定位不到这个插件。',
  'unknown-plugin': '宿主不认识这个插件。',
  'invalid-spec': '安装地址的格式不对。',
  'ambiguous-install': '这个地址能匹配到多个包。',
  'not-bundle': '这不是一个可管理的 bundle。',
  'not-removable': '这个包不允许卸载。',
  'stop-profile': '需要先停掉当前 profile 才能改。',
  'bundle-in-use': '这个包正在被使用。',
  'stale-approval': '构建脚本的批准已经过期。',
  'incompatible-version': '这个版本与当前 DSH 不兼容。',
  'operation-error': '宿主执行这个操作时报错。'
}

/** 每个宿主错误码对应「现在怎么办」。 */
const MANAGEMENT_HINT = {
  'management-required': '用 dsh plugin 命令行操作，或换一个允许管理的 profile。',
  unaddressable: '在启动了这个 profile 的终端里操作。',
  'unknown-plugin': '先点「刷新目录」，或确认包名拼写。',
  'invalid-spec': '改成目录页给出的 npm 包名或仓库地址。',
  'ambiguous-install': '换成更精确的包名重试。',
  'not-bundle': '只能管理 bundle 包；单插件请用 id 开关。',
  'not-removable': '它是宿主的一部分，只能停用，不能卸载。',
  'stop-profile': '关掉当前 DSH 进程后用 dsh plugin 操作。',
  'bundle-in-use': '关掉占用它的会话或进程，再重试。',
  'stale-approval': '重新点一次安装，按提示批准构建脚本。',
  'incompatible-version': '换一个与当前 DSH 兼容的版本。',
  'operation-error': '看宿主日志里的 pnpm 输出，修好原因后重试。'
}

function optionalText(value) {
  if (value === null || value === undefined) return null
  const result = String(value).trim()
  return result === '' ? null : result
}

function describe(error) {
  if (error === null || error === undefined) return '未知错误'
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
  return message.length > 200 ? `${message.slice(0, 200)}…` : message
}

function sameKey(a, b) {
  const left = optionalText(a)
  const right = optionalText(b)
  if (left === null || right === null) return false
  return left.toLowerCase() === right.toLowerCase()
}

function safeGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

/** inject 保证 webServer 存在；真缺了就抛错让宿主把 fiber 标成 FAILED，而不是静默不工作。 */
function resolveWebServer(ctx) {
  const service = safeGet(ctx, 'webServer') ?? ctx?.webServer
  if (service === null || service === undefined || typeof service.register !== 'function') {
    throw new Error(`${PLUGIN_NAME}: 找不到 webServer 服务，路由无法注册。`)
  }
  return service
}

function argvProfile() {
  const argv = Array.isArray(process.argv) ? process.argv : []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--profile' && index + 1 < argv.length && !argv[index + 1].startsWith('-')) return argv[index + 1]
    if (typeof arg === 'string' && arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length)
      if (value !== '') return value
    }
  }
  return null
}

/** 契约 §2.1：host.dsh 取值顺序 profileContext → DSH_VERSION → null。 */
function hostInfo(ctx) {
  const profileContext = safeGet(ctx, 'profileContext')
  return {
    dsh:
      optionalText(profileContext?.version) ??
      optionalText(profileContext?.dshVersion) ??
      optionalText(process.env.DSH_VERSION),
    node: process.version,
    platform: process.platform,
    profile: optionalText(profileContext?.name) ?? argvProfile() ?? optionalText(process.env.DSH_PROFILE)
  }
}

function profileName(ctx) {
  return hostInfo(ctx).profile ?? 'default'
}

function managerOf(ctx) {
  const service = safeGet(ctx, 'pluginManager')
  return service !== null && service !== undefined && typeof service === 'object' ? service : null
}

function hasMethod(service, method) {
  return service !== null && typeof service[method] === 'function'
}

function projectRegistries(raw) {
  if (raw === null || typeof raw !== 'object') return null
  return {
    registry: raw.registry ?? null,
    fallbackRegistries: Array.isArray(raw.fallbackRegistries)
      ? raw.fallbackRegistries.filter((entry) => typeof entry === 'string')
      : [],
    resolved: raw.resolved ?? null
  }
}

/** 契约 §2.3 的 bundle 投影；readOnlyReason 是附加信息，界面据此禁用开关。 */
function projectBundle(raw) {
  const bundle = raw !== null && typeof raw === 'object' ? raw : {}
  const name = optionalText(bundle.name) ?? ''
  return {
    name,
    version: optionalText(bundle.version),
    description: optionalText(bundle.description),
    enabled: bundle.enabled === true,
    installed: bundle.installed === true,
    removable: bundle.removable === true,
    official: name.startsWith('@deepseek-ai/'),
    market: name === PLUGIN_NAME,
    readOnlyReason: optionalText(bundle.readOnlyReason),
    error:
      bundle.error !== null && typeof bundle.error === 'object'
        ? {
            code: optionalText(bundle.error.code) ?? 'operation-error',
            ...(optionalText(bundle.error.diagnostic) === null
              ? {}
              : { diagnostic: optionalText(bundle.error.diagnostic) })
          }
        : null,
    rows: (Array.isArray(bundle.rows) ? bundle.rows : []).map((row) => ({
      rowId: optionalText(row?.rowId),
      moduleName: optionalText(row?.moduleName),
      entryId: optionalText(row?.entryId)
    }))
  }
}

function pluginTitle(meta) {
  if (meta === null || typeof meta !== 'object') return null
  const title = meta.title
  if (typeof title === 'string' && title.trim() !== '') return title.trim()
  if (title !== null && typeof title === 'object') {
    for (const key of ['zh', 'en']) {
      const value = title[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  }
  return null
}

/** 契约 §2.3：plugin 条目要能反查回它的 bundle，靠 rows 的 entryId/moduleName 对照。 */
function bundleNameFor(plugin, bundles) {
  const moduleName = optionalText(plugin?.moduleName)
  const entryId = optionalText(plugin?.entryId)
  for (const bundle of bundles) {
    const name = optionalText(bundle?.name)
    if (name !== null && moduleName !== null && name === moduleName) return name
    for (const row of Array.isArray(bundle?.rows) ? bundle.rows : []) {
      if (entryId !== null && optionalText(row?.entryId) === entryId) return name
      if (moduleName !== null && optionalText(row?.moduleName) === moduleName) return name
    }
  }
  return null
}

function projectPlugin(raw, bundles) {
  const plugin = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    entryId: optionalText(plugin.entryId),
    moduleName: optionalText(plugin.moduleName),
    enabled: plugin.enabled === true,
    fiberPhase: optionalText(plugin.fiberPhase),
    title: pluginTitle(plugin.meta),
    bundle: bundleNameFor(plugin, bundles)
  }
}

/** ManagementError → 契约的 error 对象；没有 message 就按 code 补一条中文说明。 */
function projectChangeError(error) {
  if (error === null || error === undefined || typeof error !== 'object') return null
  const code = optionalText(error.code) ?? 'operation-error'
  const projected = {
    code,
    message: optionalText(error.message) ?? MANAGEMENT_MESSAGE[code] ?? '宿主拒绝了这个操作。'
  }
  const hint = optionalText(error.hint) ?? MANAGEMENT_HINT[code]
  if (hint !== null) projected.hint = hint
  if (optionalText(error.diagnostic) !== null) projected.diagnostic = optionalText(error.diagnostic)
  if (error.incompatible !== undefined) projected.incompatible = error.incompatible
  return projected
}

function isReadOnlyResult(result) {
  const fromError = optionalText(result?.error?.code)
  const explicit = optionalText(result?.readOnlyReason)
  return (fromError !== null && READ_ONLY_CODES.has(fromError)) || (explicit !== null && READ_ONLY_CODES.has(explicit))
}

function tail(text, limit) {
  return text.length <= limit ? text : text.slice(text.length - limit)
}

function warningsOf(value) {
  return Array.isArray(value.warnings) ? value.warnings.filter((entry) => typeof entry === 'string') : []
}

/** 契约 §2.4 / §2.5 的响应；宿主错误码原样透传（契约要求「透传 error.code」）。 */
function sendChangeResult(res, result, stage) {
  const value = result !== null && typeof result === 'object' ? result : {}
  const error = projectChangeError(value.error)
  const payload = {
    ok: error === null,
    changed: value.changed === true,
    application: optionalText(value.application) ?? 'failed',
    stage: optionalText(value.stage) ?? stage,
    target: value.target ?? null,
    enabled: value.enabled === undefined ? null : value.enabled === true,
    error,
    warnings: warningsOf(value),
    pendingBuilds: Array.isArray(value.pendingBuilds)
      ? value.pendingBuilds.filter((entry) => typeof entry === 'string')
      : []
  }
  const output = value.packageResult?.output
  if (typeof output === 'string' && output !== '') payload.output = tail(output, 2000)
  sendJson(res, 200, payload)
}

function findCatalogItem(items, name) {
  if (name === null) return undefined
  return items.find(
    (item) => sameKey(item.id, name) || sameKey(item.npm, name) || sameKey(item.url, name) || sameKey(item.name, name)
  )
}

function invalidQuery(res, picked) {
  sendError(res, 400, 'bad-request', { message: picked.message, hint: picked.hint })
}

function createHandlers(ctx, catalog, selfUpdate) {
  /** 目录不可用时如实报错，绝不用空列表冒充「没有结果」。 */
  async function requireCatalog(res) {
    const loaded = await catalog.ensure()
    if (loaded.ok !== true) {
      // 把尝试序列写进宿主日志：界面只看到一句 hint，排查时要知道每个源各自的失败原因。
      const tried = (loaded.attempts ?? []).map((attempt) => `${attempt.label}：${attempt.reason}`).join('；')
      console.warn(`[${PLUGIN_NAME}] 目录抓取失败（${loaded.code}）：${tried === '' ? '没有可用源' : tried}`)
      sendError(res, loaded.status ?? 502, loaded.code, { message: loaded.message, hint: loaded.hint })
      return null
    }
    return loaded.cache
  }

  /** 目录页顺带展示安装状态；pluginManager 出错不该让浏览整个失败，但要留下日志。 */
  async function listBundlesSafe() {
    const manager = managerOf(ctx)
    if (!hasMethod(manager, 'listBundles')) return { available: false, bundles: [] }
    try {
      const bundles = await manager.listBundles()
      return { available: true, bundles: Array.isArray(bundles) ? bundles : [] }
    } catch (error) {
      console.warn(`[${PLUGIN_NAME}] 读取已安装列表失败，本次目录结果不带安装标记：${describe(error)}`)
      return { available: true, bundles: [] }
    }
  }

  return {
    /** 契约 §2.1 */
    async status(req, res) {
      const manager = managerOf(ctx)
      const available = hasMethod(manager, 'listBundles')
      let registries = null
      if (available && hasMethod(manager, 'registries')) {
        try {
          registries = projectRegistries(await manager.registries())
        } catch (error) {
          console.warn(`[${PLUGIN_NAME}] 读取 registries 失败：${describe(error)}`)
          registries = null
        }
      }
      // 契约 §2.1：本端点绝不发起网络请求，只读内存快照。
      // /status 是 UI 首屏第一跳，回答「有没有 pluginManager」不该付出一次抓取的等待。
      const cache = catalog.peek()
      sendJson(res, 200, {
        ok: true,
        plugin: { name: PLUGIN_NAME, version: PLUGIN_VERSION },
        host: hostInfo(ctx),
        manager: { available, registries },
        catalog:
          cache === null
            ? null
            : {
                source: cache.source,
                count: cache.count,
                updated: cache.updated,
                fetchedAt: cache.fetchedAt,
                stale: cache.stale === true,
                error: cache.error ?? null
              }
      })
    },

    /** 契约 §2.2 */
    async catalog(req, res, url) {
      const params = url.searchParams
      const query = pickQueryText(params, 'query', { maxLength: 128 })
      if (query.ok !== true) return invalidQuery(res, query)
      const category = pickQueryText(params, 'category', { maxLength: 64 })
      if (category.ok !== true) return invalidQuery(res, category)
      const sort = pickQueryEnum(params, 'sort', SORT_VALUES, 'top')
      if (sort.ok !== true) return invalidQuery(res, sort)
      const page = pickQueryInt(params, 'page', { min: 1, fallback: 1 })
      if (page.ok !== true) return invalidQuery(res, page)
      const pageSize = pickQueryInt(params, 'pageSize', { min: 1, max: 100, fallback: 24 })
      if (pageSize.ok !== true) return invalidQuery(res, pageSize)
      const installed = pickQueryFlag(params, 'installed')
      if (installed.ok !== true) return invalidQuery(res, installed)
      const updates = pickQueryFlag(params, 'updates')
      if (updates.ok !== true) return invalidQuery(res, updates)

      // 参数全部校验完再抓取：参数写错时不该先等一次网络。
      const cache = await requireCatalog(res)
      if (cache === null) return

      const { bundles } = await listBundlesSafe()
      const joined = joinInstalled(cache.plugins, bundles)
      const filtered = filterPlugins(joined, {
        query: query.value,
        category: category.value,
        installedOnly: installed.value,
        updatesOnly: updates.value
      })
      const sorted = sortPlugins(filtered, sort.value)
      const pageInfo = paginate(sorted, page.value, pageSize.value)

      sendJson(res, 200, {
        ok: true,
        catalog: {
          count: cache.count,
          filtered: filtered.length,
          updated: cache.updated,
          fetchedAt: cache.fetchedAt,
          source: cache.source,
          stale: cache.stale === true
        },
        page: {
          page: pageInfo.page,
          pageSize: pageInfo.pageSize,
          total: pageInfo.total,
          pages: pageInfo.pages
        },
        categories: cache.categories,
        items: pageInfo.items
      })
    },

    /** 契约 §2.3 */
    async installed(req, res) {
      const manager = managerOf(ctx)
      if (!hasMethod(manager, 'listBundles')) {
        sendJson(res, 200, { ok: true, bundles: [], plugins: [], manager: { available: false } })
        return
      }
      let rawBundles
      let rawPlugins
      try {
        const [bundles, plugins] = await Promise.all([
          manager.listBundles(),
          hasMethod(manager, 'listPlugins') ? manager.listPlugins() : Promise.resolve([])
        ])
        rawBundles = Array.isArray(bundles) ? bundles : []
        rawPlugins = Array.isArray(plugins) ? plugins : []
      } catch (error) {
        sendError(res, 500, 'internal', {
          message: '读取已安装列表失败。',
          hint: `宿主 pluginManager 报错：${describe(error)}；稍后重试，或看宿主日志。`
        })
        return
      }

      const loaded = await catalog.ensure()
      const catalogItems = loaded.ok === true ? loaded.cache.plugins : []
      sendJson(res, 200, {
        ok: true,
        bundles: joinBundles(rawBundles.map(projectBundle), catalogItems),
        plugins: rawPlugins.map((plugin) => projectPlugin(plugin, rawBundles))
      })
    },

    /** 契约 §2.4 */
    async install(req, res) {
      if (!requireSameOrigin(req, res)) return
      const manager = managerOf(ctx)
      if (!hasMethod(manager, 'installBundle')) {
        sendError(res, 502, 'manager-unavailable')
        return
      }
      const body = await readJsonObject(req, res)
      if (body.ok !== true) return
      const payload = body.value
      const requestedName = optionalText(payload.name)
      const requestedSpec = optionalText(payload.spec)
      if (requestedName === null && requestedSpec === null) {
        sendError(res, 400, 'bad-request', {
          message: '缺少 name 或 spec。',
          hint: '至少给出目录 id，或直接给出安装 spec。'
        })
        return
      }

      const cache = await requireCatalog(res)
      if (cache === null) return
      const items = cache.plugins

      let spec = requestedSpec
      if (spec !== null) {
        // 安全约束：显式 spec 也必须落在目录里，不能变成任意包安装器。
        const hit = items.find(
          (item) => sameKey(item.spec, spec) || sameKey(item.npm, spec) || sameKey(item.url, spec)
        )
        if (hit === undefined) {
          sendError(res, 400, 'not-in-catalog')
          return
        }
        spec = hit.spec ?? spec
      } else {
        const hit = findCatalogItem(items, requestedName)
        if (hit === undefined) {
          sendError(res, 400, 'not-in-catalog', {
            message: '目录里没有这个插件，已拒绝安装。',
            hint: '先点「刷新目录」；市场只安装目录里列出的插件。'
          })
          return
        }
        if (hit.spec === null) {
          sendError(res, 400, 'not-in-catalog', {
            message: '这个条目没有可安装的 npm 包或仓库地址。',
            hint: '打开它的目录页，按作者给出的方式安装。'
          })
          return
        }
        spec = hit.spec
      }

      const options = {}
      const requestId = optionalText(payload.requestId)
      if (requestId !== null) options.requestId = requestId
      if (Array.isArray(payload.approvedBuilds)) {
        const approved = payload.approvedBuilds.filter((entry) => typeof entry === 'string' && entry !== '')
        // 契约 §2.4：空数组不传，避免让宿主以为用户批准过什么。
        if (approved.length > 0) options.approvedBuilds = approved
      }

      let result
      try {
        result = await manager.installBundle(spec, Object.keys(options).length > 0 ? options : undefined)
      } catch (error) {
        sendError(res, 502, 'install-failed', {
          message: '安装调用失败。',
          hint: `宿主 installBundle 抛错：${describe(error)}；看宿主日志，确认网络与 pnpm 可用后重试。`
        })
        return
      }
      if (isReadOnlyResult(result)) {
        sendError(res, 400, 'not-allowed', {
          message: '当前 profile 不允许安装插件。',
          hint: '用 dsh plugin 命令行安装，或换一个可管理的 profile。'
        })
        return
      }
      sendChangeResult(res, result, 'install')
    },

    /** 契约 §2.5 */
    async remove(req, res) {
      if (!requireSameOrigin(req, res)) return
      const manager = managerOf(ctx)
      if (!hasMethod(manager, 'removeBundle')) {
        sendError(res, 502, 'manager-unavailable')
        return
      }
      const body = await readJsonObject(req, res)
      if (body.ok !== true) return
      const name = optionalText(body.value.name)
      if (name === null) {
        sendError(res, 400, 'bad-request', { message: '缺少 name。', hint: '给出要卸载的 bundle 名。' })
        return
      }
      if (name.toLowerCase() === PLUGIN_NAME) {
        sendError(res, 400, 'not-allowed', {
          message: `市场不能卸载自己，请在终端执行 dsh plugin --profile ${profileName(ctx)} remove ${PLUGIN_NAME}`,
          hint: '卸载后这个市场页面也会一起消失；在终端里做才能看到完整输出。'
        })
        return
      }

      let result
      try {
        result = await manager.removeBundle(name)
      } catch (error) {
        sendError(res, 502, 'remove-failed', {
          message: '卸载调用失败。',
          hint: `宿主 removeBundle 抛错：${describe(error)}；看宿主日志后重试。`
        })
        return
      }
      if (isReadOnlyResult(result)) {
        sendError(res, 400, 'not-allowed', {
          message: '这个包由宿主基础设施管理，不能在这里卸载。',
          hint: '它是当前 profile 的组成部分；用 dsh plugin 命令行处理。'
        })
        return
      }
      sendChangeResult(res, result, 'remove')
    },

    /** 契约 §2.6 */
    async toggle(req, res) {
      if (!requireSameOrigin(req, res)) return
      const manager = managerOf(ctx)
      const body = await readJsonObject(req, res)
      if (body.ok !== true) return
      const payload = body.value
      const name = optionalText(payload.name)
      const id = optionalText(payload.id)
      if (typeof payload.enabled !== 'boolean') {
        sendError(res, 400, 'bad-request', {
          message: 'enabled 必须是 true 或 false。',
          hint: '带上 enabled: true / false 再提交一次。'
        })
        return
      }
      if (name === null && id === null) {
        sendError(res, 400, 'bad-request', {
          message: '缺少 name 或 id。',
          hint: '按 bundle 开关用 name，按插件条目开关用 id。'
        })
        return
      }

      let result
      try {
        if (name !== null) {
          if (!hasMethod(manager, 'setBundleEnabled')) {
            sendError(res, 502, 'manager-unavailable')
            return
          }
          result = await manager.setBundleEnabled(name, payload.enabled)
        } else {
          if (!hasMethod(manager, 'setPluginEnabled')) {
            sendError(res, 502, 'manager-unavailable')
            return
          }
          result = await manager.setPluginEnabled(id, payload.enabled)
        }
      } catch (error) {
        sendError(res, 502, 'toggle-failed', {
          message: '开关调用失败。',
          hint: `宿主报错：${describe(error)}；看宿主日志后重试。`
        })
        return
      }

      if (isReadOnlyResult(result)) {
        sendError(res, 400, 'not-allowed', {
          message: '这个条目由宿主基础设施管理，不能在市场里开关。',
          hint: '用 dsh plugin 命令行，或改 profile 的 bundle 配置。'
        })
        return
      }

      const value = result !== null && typeof result === 'object' ? result : {}
      const error = projectChangeError(value.error)
      sendJson(res, 200, {
        ok: error === null,
        changed: value.changed === true,
        application: optionalText(value.application) ?? 'failed',
        enabled: value.enabled === undefined ? payload.enabled : value.enabled === true,
        error,
        warnings: warningsOf(value)
      })
    },

    /** 契约 §2.7 */
    async refresh(req, res) {
      if (!requireSameOrigin(req, res)) return
      const result = await catalog.refresh()
      if (result.ok !== true) {
        sendError(res, result.status ?? 502, result.code, { message: result.message, hint: result.hint })
        return
      }
      sendJson(res, 200, {
        ok: true,
        count: result.cache.count,
        fetchedAt: result.cache.fetchedAt,
        source: result.cache.source
      })
    },

    /**
     * 契约 §2.8/§2.9：市场自身的更新通道。
     *
     * GET 与 POST 必须合并成**一个** handler：路由表以 path 为键（见 http.js createRouteTable），
     * 同一路径注册两次会让后一次覆盖前一次，GET 就永远拿到 405——这条是实测撞出来的，别拆回去。
     */
    async selfUpdate(req, res, url) {
      if (String(req.method ?? 'GET').toUpperCase() === 'POST') return applySelfUpdate(req, res)
      return checkSelfUpdate(req, res, url)
    }
  }

  /** 契约 §2.8：只读检查（会打一次网络，但有 10 分钟缓存）。 */
  async function checkSelfUpdate(req, res, url) {
    const force = pickQueryFlag(url.searchParams, 'force')
    if (force.ok !== true) return invalidQuery(res, force)
    const result = await selfUpdate.check({ force: force.value === true })
    if (result.ok !== true) {
      sendError(res, 502, result.code ?? 'self-update-unavailable', {
        message: result.message,
        hint: result.hint ?? '',
        diagnostic: summarizeAttempts(result.attempts)
      })
      return
    }
    sendJson(res, 200, {
      ok: true,
      selfUpdate: {
        current: result.current,
        latest: result.latest,
        latestTag: result.latestTag,
        versionCode: result.versionCode,
        build: result.build,
        releasedAt: result.releasedAt,
        updateAvailable: result.updateAvailable === true,
        installable: result.installable === true,
        channel: result.channel,
        url: result.url,
        sha256: result.sha256,
        bytes: result.bytes,
        checkedAt: result.checkedAt
      }
    })
  }

  /** 契约 §2.9：应用自更新（下载 → 三道校验 → 交给 pluginManager 安装，需重启 DSH 生效）。 */
  async function applySelfUpdate(req, res) {
    if (!requireSameOrigin(req, res)) return
    const result = await selfUpdate.apply()
    if (result.ok !== true) {
      // 完整性/自证不过与「宿主装不上」要分开说：前者是拒绝安装，后者可以重试。
      const code = result.code ?? 'internal'
      sendError(res, 502, code, {
        message: result.message,
        hint: code === 'self-update-integrity'
          ? '产物校验没通过，已拒绝安装。稍后重试；仍失败说明发布产物与清单不一致，请提 issue。'
          : code === 'manager-unavailable'
            ? '当前运行环境没有 pluginManager，更新只能走终端 dsh plugin。'
            : '稍后重试；也可在终端按 Release 页面的命令升级。'
      })
      return
    }
    sendJson(res, 200, {
      ok: true,
      application: result.application,
      from: result.from ?? null,
      to: result.to ?? null,
      requiresRestart: result.requiresRestart === true,
      tarball: result.tarball ?? null,
      bytes: result.bytes ?? null,
      warnings: result.warnings ?? []
    })
  }
}

/** 把每个源的失败原因压成一行诊断串，附在 502 的 diagnostic 里。 */
function summarizeAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return ''
  return attempts
    .map((attempt) => `${attempt.label ?? attempt.id ?? '源'}：${attempt.reason ?? '失败'}`)
    .join('；')
}

function buildRoutes(ctx, catalog, selfUpdate) {
  const handlers = createHandlers(ctx, catalog, selfUpdate)
  return createRouteTable()
    .on(`${ROUTE_PREFIX}/status`, ['GET'], handlers.status)
    .on(`${ROUTE_PREFIX}/catalog`, ['GET'], handlers.catalog)
    .on(`${ROUTE_PREFIX}/installed`, ['GET'], handlers.installed)
    .on(`${ROUTE_PREFIX}/install`, ['POST'], handlers.install)
    .on(`${ROUTE_PREFIX}/remove`, ['POST'], handlers.remove)
    .on(`${ROUTE_PREFIX}/toggle`, ['POST'], handlers.toggle)
    .on(`${ROUTE_PREFIX}/refresh`, ['POST'], handlers.refresh)
    .on(`${ROUTE_PREFIX}/self-update`, ['GET', 'POST'], handlers.selfUpdate)
}

export const name = PLUGIN_NAME
export const inject = ['webServer']

export function apply(ctx) {
  const webServer = resolveWebServer(ctx)
  const catalog = createCatalogCache()
  // managerOf 每次调用时再读：宿主服务可能比本插件晚注册（apply 时可能还拿不到）。
  const selfUpdate = createSelfUpdater({ managerOf: () => managerOf(ctx), current: PLUGIN_VERSION })
  const routes = buildRoutes(ctx, catalog, selfUpdate)

  const disposeRoute = webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      try {
        await routes.dispatch(req, res)
      } catch (error) {
        // 这里只负责让客户端拿到一个能读的 500；细节进日志与 hint，不假装成功。
        console.error(`[${PLUGIN_NAME}] 请求处理失败：`, error)
        if (res.headersSent === true) {
          if (res.writableEnded !== true) res.end()
          return
        }
        sendError(res, 500, 'internal', {
          hint: `这次请求在插件里抛错了：${describe(error)}；重试一次，仍失败就看宿主日志。`
        })
      }
    }
  })

  // 卸载时必须撤掉路由：同一条 prefix 在下一次 apply 时重复注册会直接 throw。
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => disposeRoute(), `${PLUGIN_NAME}: prefix route`)
  } else if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => disposeRoute())
  }
}
