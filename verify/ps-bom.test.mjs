/**
 * 断言：仓库里带非 ASCII 字符的 PowerShell 脚本必须带 UTF-8 BOM。
 *
 * 为什么值得一条测试：Windows PowerShell 5.1 对**无 BOM** 的 UTF-8 脚本按 ANSI 解码，
 * 中文注释会被解成乱码并直接把脚本解析坏（本仓库真的发生过：edit 工具重写 .ps1 会去掉 BOM，
 * 结果 release.ps1 在发布时以「意外的标记」失败，版本没发出去）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const roots = ['scripts', 'verify']
const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const problems = []
let checked = 0

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) { walk(path); continue }
    if (!name.endsWith('.ps1')) continue
    checked += 1
    const bytes = readFileSync(path)
    const hasBom = bytes.subarray(0, 3).equals(BOM)
    // 纯 ASCII 脚本不需要 BOM；含非 ASCII（中文注释/文案）就必须有。
    const hasNonAscii = bytes.some((byte) => byte > 0x7f)
    if (hasNonAscii && !hasBom) problems.push(path)
  }
}
for (const root of roots) walk(root)

if (problems.length > 0) {
  for (const path of problems) console.log(`FAIL ${path} 含非 ASCII 但没有 UTF-8 BOM（PS 5.1 会按 ANSI 解析）`)
  process.exit(1)
}
console.log(`PowerShell BOM 检查：${checked} 个 .ps1 全部合规`)
