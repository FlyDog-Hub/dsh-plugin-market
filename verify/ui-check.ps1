# ui-check.ps1 —— 用真实浏览器（headless Edge）验客户端半：起一个 scratch 宿主，打开 GUI，
# 驱动真引擎断言「两个按钮、可更新列表、动效、reduced-motion」，并把截图落到 verify/logs/ui。
#
# 全程不碰用户的 desktop / web profile：DSH_HOME 指向 _verify\dshhome，profile 固定 marketcheck。
# 该宿主是**新进程**，所以它加载的是仓库里当前的宿主半代码（不需要重启用户的 DSH）。
[CmdletBinding()]
param(
  [string]$ProfileName = 'marketcheck',
  [int]$Port = 0,
  [switch]$KeepHost
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$node = Get-NodeExe
if (-not $node) { throw '找不到 node.exe' }

Ensure-Dirs
if ($Port -le 0) { $Port = Get-FreePort }
$shotDir = Join-Path $script:LogDir 'ui'
$h = $null
try {
  Write-Host "起 scratch 宿主：profile=$ProfileName port=$Port（DSH_HOME=$script:DshHome）"
  $h = Start-DshHost -Profile $ProfileName -Port $Port -Tag "ui-$ProfileName-$Port"
  if (-not $h.Ready) { throw "宿主端口没通：$Port" }

  $authUrl = Get-AuthUrlFromLog -Host_ $h -TimeoutSec 40
  if (-not $authUrl) { throw '没能从启动日志里取到带 token 的首页 URL' }
  Write-Host '已取到鉴权 URL（不打印 token）'

  & $node (Join-Path $script:VerifyRoot 'market-ui.e2e.mjs') $authUrl $shotDir
  $code = $LASTEXITCODE
  Write-Host ''
  Write-Host "截图目录：$shotDir"
  if ($code -ne 0) { throw "真实浏览器验收失败（exit=$code）" }
} finally {
  if ($null -ne $h -and -not $KeepHost) { Stop-DshHost $h | Out-Null }
  if ($null -ne $h -and $KeepHost) { Write-Host "宿主保留在 $Port（pid=$($h.Pid)）" }
}
