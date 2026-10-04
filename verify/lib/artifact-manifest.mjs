/**
 * 打印一个 tarball 自报的 `name@version`，供 PowerShell 侧做「产物自证」断言。
 * 逻辑本身在包里（plugin-market/lib/self-update.js 的 readArtifactManifest），这里只做命令行封装，
 * 避免验收脚本复制一份解析实现——两份实现就意味着一份会先漂移。
 *
 * 用法：node verify/lib/artifact-manifest.mjs <tarball 路径>
 */
import { readFileSync } from 'node:fs'

import { readArtifactManifest } from '../../plugin-market/lib/self-update.js'

const target = process.argv[2]
if (!target) {
  console.error('用法：node verify/lib/artifact-manifest.mjs <tarball>')
  process.exit(2)
}
const verdict = readArtifactManifest(readFileSync(target))
if (verdict.ok !== true) {
  console.error(`不可读：${verdict.reason}`)
  process.exit(1)
}
console.log(`${verdict.name}@${verdict.version}`)
