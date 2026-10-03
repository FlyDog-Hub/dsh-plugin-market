// 量一次「Node 直连目录源」的真实耗时。
//
// 为什么需要它：契约 §3 规定每次抓取 AbortSignal.timeout(15000)、失败重试 1 次
// （合计 30 秒预算）。宿主跑在 Node 上，所以「宿主能不能在 15 秒内拿到 4.8 MB」
// 是一个可测量的环境事实，而不是猜测。
// 打印一行 JSON：{ ok, status?, bytes?, ms, error? }
const url = process.argv[2]
const timeoutMs = Number(process.argv[3] ?? 120000)
const started = Date.now()
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  const buf = await res.arrayBuffer()
  console.log(JSON.stringify({ ok: true, status: res.status, bytes: buf.byteLength, ms: Date.now() - started }))
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: `${error.name}: ${error.message}`, ms: Date.now() - started }))
}
