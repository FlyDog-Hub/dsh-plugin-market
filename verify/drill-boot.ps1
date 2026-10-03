# 演练：证明「起宿主 -> 取鉴权 URL -> 抓首页 __DSH_BOOT__ -> 干净杀进程」这条测量链路本身可信。
# 用 web 模板空 profile（不含被测插件），所以这一步与 plugin-market 的实现完全无关。
# 负向对照：不带 token 直接 GET 首页应当被拒 —— 若也能 200，说明鉴权没生效，我的
# 「取鉴权 URL」就是假动作，测量工具不可信。
param(
  [string]$ProfileName = 'drill'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$host_ = $null
$port = 0
Ensure-Dirs
$evidence = Join-Path (Get-LogDir) 'drill-evidence.log'
if (Test-Path $evidence) { Remove-Item $evidence -Force }

Write-Host "===== 演练开始 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ====="
Write-Host "DSH_HOME(独立)      = $(Get-DshHome)"
Write-Host "真实 .dsh 不应被写 = C:\Users\28062\.dsh"

try {
  # [1] 建临时 profile
  $dir = New-VerifyProfile -Name $ProfileName -Force
  Write-Host "`n[1] 临时 profile 目录 = $dir"
  $files = Get-ChildItem -Force $dir | Select-Object Name, Length
  $files | Format-Table -AutoSize | Out-String | Write-Host
  Add-Evidence -File $evidence -Title '[1] profile 产物清单' -Text (($files | ForEach-Object { "$($_.Name) $($_.Length)" }) -join "`n")
  Write-Host "[1] package.json 内容："
  $pkg = Read-FileShared (Join-Path $dir 'package.json')
  Write-Host $pkg
  Add-Evidence -File $evidence -Title '[1] package.json' -Text $pkg

  # [2] 起宿主
  $port = Get-FreePort
  Write-Host "[2] 选定空闲端口 = $port"
  $host_ = Start-DshHost -Profile $ProfileName -Port $port -Tag "drill-$port"
  Write-Host "[2] 宿主 pid=$($host_.Pid) ready=$($host_.Ready)"
  Write-Host "[2] 复现命令行 = $($host_.CmdLine)"
  Add-Evidence -File $evidence -Title '[2] 启动命令行' -Text $host_.CmdLine
  if (-not $host_.Ready) {
    Write-Host "[2] 宿主未就绪，日志："
    (Get-HostLog -Host_ $host_).All | Write-Host
    throw '演练失败：宿主未在超时内监听端口'
  }

  # [3] 从启动日志取鉴权 URL
  $authUrl = Get-AuthUrlFromLog -Host_ $host_ -TimeoutSec 30
  Write-Host "`n[3] 从启动日志取到鉴权 URL = $authUrl"
  Add-Evidence -File $evidence -Title '[3] 启动日志全文' -Text (Get-HostLog -Host_ $host_).All
  if (-not $authUrl) { throw '演练失败：启动日志里没找到 URL' }

  # [4] 负向对照：无 token 直连首页
  $plain = Invoke-HttpProbe -Uri "http://127.0.0.1:$port/"
  Write-Host "[4] 负向对照 无 token GET / -> status=$($plain.Status)（期望 401/403）"
  Add-Evidence -File $evidence -Title "[4] 无 token GET / -> $($plain.Status)" -Text $plain.Body

  # [5] 带鉴权抓首页 + __DSH_BOOT__
  $bg = Get-BootGraph -Url $authUrl
  Write-Host "[5] 带 token GET 首页 -> status=$($bg.Status) htmlLen=$($bg.Html.Length) bootFound=$($null -ne $bg.Boot)"
  $entryList = ''
  if ($null -ne $bg.Boot) {
    $props = ($bg.Boot.PSObject.Properties | ForEach-Object { $_.Name }) -join ', '
    Write-Host "[5] __DSH_BOOT__ 顶层字段: $props"
    $entries = @(Get-PropOrNull $bg.Boot 'entries')
    Write-Host "[5] entries 数量 = $($entries.Count)"
    $entryList = ($entries | ForEach-Object { "id=$(Get-PropOrNull $_ 'id')  url=$(Get-PropOrNull $_ 'url')" }) -join "`n"
    Write-Host $entryList
  } else {
    Write-Host "[5] 未解析到 __DSH_BOOT__，HTML 前 1500 字："
    $head = $bg.Html
    if ($head.Length -gt 1500) { $head = $head.Substring(0, 1500) }
    Write-Host $head
    Add-Evidence -File $evidence -Title '[5] 首页 HTML 前 1500 字' -Text $head
  }
  Add-Evidence -File $evidence -Title '[5] boot entries' -Text $entryList

  # [6] 日志里没有 FAILED fiber
  $log = (Get-HostLog -Host_ $host_).All
  $failedLines = @($log -split "`n" | Where-Object { $_ -match 'FAILED|\[failed\]' })
  Write-Host "`n[6] 日志里 FAILED 相关行数 = $($failedLines.Count)"
  $failedLines | ForEach-Object { Write-Host "    $_" }
  Add-Evidence -File $evidence -Title '[6] FAILED 匹配行' -Text (($failedLines -join "`n"))
} catch {
  # 不能把异常吞掉：finally 里的清理报错会掩盖真正的失败点，所以这里显式打印并落证据
  Write-Host "`n!!! 演练捕获到异常: $($_.Exception.GetType().FullName)"
  Write-Host $_.Exception.Message
  Write-Host $_.ScriptStackTrace
  Add-Evidence -File $evidence -Title '[ERR] 演练异常' -Text ($_.Exception.ToString() + "`n" + $_.ScriptStackTrace)
} finally {
  # [7] 必须无条件清理：脚本中途抛错也不能留下占用端口的进程
  if ($null -ne $host_) {
    $released = Stop-DshHost -Host_ $host_
    Start-Sleep -Seconds 1
    $owners = @(Get-PortOwners $port)
    Write-Host "`n[7] 端口 $port 已释放 = $released ; 残留占用进程数 = $($owners.Count)"
    Add-Evidence -File $evidence -Title '[7] 清理结果' -Text "released=$released owners=$($owners -join ',')"
  }
}
Write-Host "===== 演练结束，证据文件 = $evidence ====="
