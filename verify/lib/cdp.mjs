/**
 * 最小 CDP 客户端：用系统自带的 Edge（headless）驱动真实浏览器，不引入任何依赖。
 *
 * 为什么要真浏览器：客户端半的"有没有渲染出来、动效有没有生效、动效关掉后内容还在不在"
 * 只有真实引擎能回答。假 DOM 桩能证明代码不抛异常，证明不了这几件事。
 * Node 22+ 自带全局 WebSocket，所以 CDP 只靠内置能力就能用。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
]

export function findEdge() {
  for (const candidate of EDGE_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`${label} 在 ${timeoutMs}ms 内没就绪：${lastError?.message ?? '未知'}`)
}

/** 连一个 target 的 WebSocket，返回 send/on/close。 */
export async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true })
  })
  let nextId = 0
  const pending = new Map()
  const handlers = new Map()
  socket.addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (message.id !== undefined && pending.has(message.id)) {
      const entry = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(`${message.error.message} (${entry.method})`))
      else entry.resolve(message.result)
      return
    }
    const handler = handlers.get(message.method)
    if (handler) handler(message.params)
  })
  return {
    send(method, params) {
      const id = ++nextId
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method })
        socket.send(JSON.stringify({ id, method, params: params ?? {} }))
      })
    },
    on(method, handler) {
      handlers.set(method, handler)
    },
    close() {
      try {
        socket.close()
      } catch {
        // 关一个已经断开的 socket 不值得上报
      }
    },
  }
}

/** 起一个 headless Edge，返回 { client, userDataDir, close }。 */
export async function launchBrowser(options = {}) {
  const executable = options.executable ?? findEdge()
  if (executable === null) throw new Error('找不到 Edge/Chrome 可执行文件')
  const port = options.port ?? 9333
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'dshpm-cdp-'))
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--hide-scrollbars',
    `--window-size=${options.width ?? 1560},${options.height ?? 980}`,
    'about:blank',
  ]
  // stdio:'ignore' 是必须的：沙箱下用管道捕获子进程输出会直接 EPERM。
  const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true })
  await waitForHttp(`http://127.0.0.1:${port}/json/version`, 30000, 'Edge 调试端口')
  const targets = await waitForHttp(`http://127.0.0.1:${port}/json/list`, 10000, 'Edge target 列表')
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('没有找到 page target')
  const client = await connect(page.webSocketDebuggerUrl)

  return {
    client,
    userDataDir,
    async close() {
      client.close()
      try {
        child.kill()
      } catch {
        // 已经退出
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
      try {
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        // 浏览器偶尔还占着文件，残留临时目录不影响结论
      }
    },
  }
}

/** 求值并取回可序列化结果；表达式抛错时返回 undefined 而不是让测试崩掉。 */
export async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    if (process.env.DSHPM_CDP_DEBUG === '1') {
      console.log('  [cdp] 求值异常：', result.exceptionDetails.text, result.exceptionDetails.exception?.description ?? '')
    }
    return undefined
  }
  return result.result?.value
}

/** 轮询一个返回布尔值的表达式直到为真。 */
export async function waitFor(client, expression, timeoutMs = 20000, label = expression) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await evaluate(client, expression)
    if (last === true) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`等待超时：${label}（最后取值 ${JSON.stringify(last)}）`)
}

export async function screenshot(client, path) {
  const result = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(path, Buffer.from(result.data, 'base64'))
  return path
}
