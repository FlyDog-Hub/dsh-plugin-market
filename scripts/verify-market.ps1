# 市场验收入口（交付物路径：scripts/verify-market.ps1）
#
# 真正的实现与断言都在 verify/ 下：
#   verify/verify-market.ps1          编排（4 次 boot：fixture 双版本 + 真实源）
#   verify/selfcheck.ps1              证明断言「会红，且红得有道理」
#   verify/lib/*.ps1                  工具库与断言集
#   verify/lib/*.mjs                  受控 stub / 目录 fixture / 网络计时 / 对抗性 host 桩
# 本文件只是薄封装，保证从仓库根目录用一条命令就能跑。
#
# 用法：
#   pwsh -File scripts/verify-market.ps1                 # 完整验收（含真实网络段）
#   pwsh -File scripts/verify-market.ps1 -SelfCheck      # 只跑断言自检（快，不联网）
#   pwsh -File scripts/verify-market.ps1 -SkipLive       # 跳过真实源那一段（离线可用）
[CmdletBinding()]
param(
  [switch]$SelfCheck,
  [switch]$SkipLive,
  [switch]$SkipAdversarial,
  [switch]$KeepHosts,
  [string]$PluginDir = ''
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot          # scripts/ -> 仓库根
$verify = Join-Path $root 'verify'

if ($SelfCheck) {
  & (Join-Path $verify 'selfcheck.ps1')
  exit $LASTEXITCODE
}

# 变量名不能用 $args：它是 PowerShell 的自动变量，赋值会被忽略，@args 展开成脚本自身的
# 位置参数（实测把 -SkipLive 当成了 -PluginDir 的值）。用 $forward 明确转发。
$forward = @()
if ($PluginDir) { $forward += @('-PluginDir', $PluginDir) }
if ($SkipLive) { $forward += '-SkipLive' }
if ($SkipAdversarial) { $forward += '-SkipAdversarial' }
if ($KeepHosts) { $forward += '-KeepHosts' }

& (Join-Path $verify 'verify-market.ps1') @forward
exit $LASTEXITCODE
