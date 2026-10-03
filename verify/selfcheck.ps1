# 自检：证明验收断言「真的会红」，并且在正确输入上「真的会绿」。
#
# 为什么必须做这一步：如果断言在明显错误的响应上也能 PASS，那么正式验收的 PASS 毫无信息量。
# 做法是把同一套断言函数指向两个受控 stub：
#   1) wrong-market stub：每个端点都刻意违反契约 → 所有市场断言必须 FAIL
#   2) boot stub 的 /good 与 /bad：分别构造「有 / 没有 dsh-plugin-market entry」的 boot 图
#      → A2/A3 必须一绿一红
# 自检本身只有一条判据：实测结果与预期方向完全一致。
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\Common.ps1')
. (Join-Path $PSScriptRoot 'lib\BootChecks.ps1')
. (Join-Path $PSScriptRoot 'lib\MarketChecks.ps1')

Ensure-Dirs
$node = Get-NodeExe
if (-not $node) { throw '找不到 node 可执行文件' }
$stub = Join-Path $PSScriptRoot 'lib\stub-server.mjs'
$logDir = Get-LogDir
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidence = Join-Path $logDir "selfcheck-$stamp.evidence.log"
$procs = New-Object System.Collections.ArrayList

function Start-StubServer {
  param([Parameter(Mandatory)][string]$Mode)
  $portFile = Join-Path $logDir "stub-$Mode-$stamp.port"
  if (Test-Path $portFile) { Remove-Item $portFile -Force }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node
  $psi.Arguments = '"' + $stub + '" ' + $Mode + ' 0 "' + $portFile + '"'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $null = $procs.Add($p)
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $portFile) {
      $txt = (Read-FileShared $portFile).Trim()
      if ($txt -match '^\d+$') {
        $pn = [int]$txt
        if (Wait-PortListening -Port $pn -TimeoutSec 10) { return [pscustomobject]@{ Process = $p; Port = $pn } }
      }
    }
    if ($p.HasExited) { throw "stub($Mode) 启动即退出，exit=$($p.ExitCode)" }
    Start-Sleep -Milliseconds 200
  }
  throw "stub($Mode) 未在超时内上报端口"
}

function Stop-StubServer($S) {
  if ($null -eq $S) { return }
  try { & taskkill.exe /PID $S.Process.Id /T /F 2>&1 | Out-Null } catch { }
  foreach ($op in @(Get-PortOwners $S.Port)) { try { & taskkill.exe /PID $op /T /F 2>&1 | Out-Null } catch { } }
}

$selfCheckFailures = New-Object System.Collections.ArrayList

Write-Host "################ 自检开始 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ################"
Write-Host "node = $node"
Write-Host "证据 = $evidence"

try {
  # =============== 1) 市场路由断言：全部必须 FAIL ===============
  Write-Host "`n===== [1] wrong-market stub：15 条市场断言必须全部 FAIL ====="
  $stubSrv = $null
  $collected = New-Object System.Collections.ArrayList
  $collector = {
    param($r)
    $null = $collected.Add([pscustomobject]@{ Id = $r.Id; Title = $r.Title; Pass = [bool]$r.Pass; Actual = $r.Actual; Expected = $r.Expected; Command = $r.Command; Evidence = $r.Evidence })
  }
  try {
    $stubSrv = Start-StubServer -Mode 'wrong-market'
    Write-Host "stub 端口 = $($stubSrv.Port)"
    Invoke-MarketRouteChecks -BaseUrl "http://127.0.0.1:$($stubSrv.Port)/plugin-market" -Port $stubSrv.Port -Collect $collector -IncludeExtras
  } finally {
    Stop-StubServer $stubSrv
  }

  $passedUnexpectedly = @($collected | Where-Object { $_.Pass })
  foreach ($c in $collected) {
    $mark = 'FAIL(预期)'
    if ($c.Pass) { $mark = 'PASS(意外!)' }
    Write-Host ("  [{0}] {1,-5} {2}" -f $mark, $c.Id, $c.Title)
  }
  Write-Host "  共 $($collected.Count) 条，意外 PASS 的 = $($passedUnexpectedly.Count)"
  Add-Evidence -File $evidence -Title '[1] wrong-market stub 的断言结果' -Text (($collected | ForEach-Object { "$($_.Id) pass=$($_.Pass) :: $($_.Actual)" }) -join "`n")

  if ($collected.Count -lt 15) {
    $null = $selfCheckFailures.Add("市场断言只跑了 $($collected.Count) 条，少于预期 15 条（可能有断言没被执行）")
  }
  foreach ($p in $passedUnexpectedly) {
    $null = $selfCheckFailures.Add("断言 $($p.Id) 在明显错误的响应上仍然 PASS —— 该断言无效：$($p.Actual)")
  }

  # 关键补强：不仅要求「会红」，还要求「红得有道理」。
  # 如果探针根本读不到 4xx/错误正文，这 15 条 FAIL 只证明「工具没读到」，不证明「实现没给」——
  # 第一轮验收就是这样把 9 条正确的实现误判成缺陷。
  #
  # wrong-market stub 里只有两条响应带 JSON error.code：
  #   A6  （带 Origin 的 POST /install）→ 403 {"error":{"code":"cross-origin"}}
  #   A14c（Origin: evil.example）      → 200 {"error":{"code":"internal"}}
  # 所以用这两条证明「异常路径正文可读」，并额外要求 curl.exe 独立复核也读到同样的码。
  foreach ($expect in @(
      [pscustomobject]@{ Id = 'A6'; Status = 403; Needle = 'cross-origin' },
      [pscustomobject]@{ Id = 'A14c'; Status = 200; Needle = 'internal' }
    )) {
    $a = $collected | Where-Object { $_.Id -eq $expect.Id } | Select-Object -First 1
    if ($null -eq $a) {
      $null = $selfCheckFailures.Add("缺少断言 $($expect.Id)，无法验证探针能读错误正文")
      continue
    }
    if ($a.Actual -notmatch ("error\.code=" + [regex]::Escape($expect.Needle))) {
      $null = $selfCheckFailures.Add("断言 $($expect.Id) 的 actual 读不到 error.code=$($expect.Needle)（actual='$($a.Actual)'）—— 探针异常路径读正文失效，这批 FAIL 不具证明力")
    }
    if ($a.Evidence -notmatch 'curl\.exe 交叉复核') {
      $null = $selfCheckFailures.Add("断言 $($expect.Id) 的证据里没有 curl.exe 交叉复核 —— 缺少第二个 HTTP 客户端的独立确认")
    } elseif ($a.Evidence -notmatch [regex]::Escape($expect.Needle)) {
      $null = $selfCheckFailures.Add("断言 $($expect.Id) 的 curl 交叉复核正文里读不到 $($expect.Needle) —— 两个客户端不一致")
    }
  }

  # =============== 2) boot 断言：好图必须 PASS，坏图必须 FAIL ===============
  Write-Host "`n===== [2] boot stub：好图 A2/A3 必须 PASS，坏图 A2/A3 必须 FAIL ====="
  $bootSrv = $null
  try {
    $bootSrv = Start-StubServer -Mode 'boot'
    Write-Host "stub 端口 = $($bootSrv.Port)"
    $origin = "http://127.0.0.1:$($bootSrv.Port)"

    foreach ($variant in @(
        [pscustomobject]@{ Name = 'good'; Path = '/good'; ExpectPass = $true },
        [pscustomobject]@{ Name = 'bad'; Path = '/bad'; ExpectPass = $false }
      )) {
      $graph = Get-BootGraph -Url "$origin$($variant.Path)"
      $sub = New-Object System.Collections.ArrayList
      $subCollector = {
        param($r)
        $null = $sub.Add([pscustomobject]@{ Id = $r.Id; Pass = [bool]$r.Pass; Actual = $r.Actual })
      }
      Invoke-BootGraphChecks -BootGraph $graph -Origin $origin -AssertId 'dsh-plugin-market' -Collect $subCollector
      Write-Host "  --- $($variant.Name) 图 (shape=$($graph.Shape)) ---"
      foreach ($s in $sub) {
        $want = 'FAIL'
        if ($variant.ExpectPass) { $want = 'PASS' }
        $got = 'FAIL'
        if ($s.Pass) { $got = 'PASS' }
        $agree = ($want -eq $got)
        Write-Host ("    [{0}] {1} 期望={2} 实际={3} :: {4}" -f $(if ($agree) { '一致' } else { '不一致!' }), $s.Id, $want, $got, $s.Actual)
        if (-not $agree) {
          $null = $selfCheckFailures.Add("boot 图 '$($variant.Name)' 的断言 $($s.Id) 期望 $want 实际 $got —— 断言方向错误")
        }
      }
      Add-Evidence -File $evidence -Title "[2] $($variant.Name) 图断言结果" -Text (($sub | ForEach-Object { "$($_.Id) pass=$($_.Pass) :: $($_.Actual)" }) -join "`n")
    }
  } finally {
    Stop-StubServer $bootSrv
  }
} finally {
  foreach ($p in $procs) { try { if (-not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null } } catch { } }
}

Write-Host "`n################ 自检结论 ################"
if ($selfCheckFailures.Count -gt 0) {
  Write-Host "自检失败 $($selfCheckFailures.Count) 项："
  $selfCheckFailures | ForEach-Object { Write-Host "  - $_" }
  Write-Host "`n结论：断言集合本身不可信，必须先修断言再谈验收。"
  Add-Evidence -File $evidence -Title '[结论] 自检失败' -Text ($selfCheckFailures -join "`n")
  exit 1
}
Write-Host "自检通过：错误响应上 15/15 条市场断言全部 FAIL；boot 图好/坏两个方向的 A2/A3 均符合预期。"
Write-Host "证据文件 = $evidence"
exit 0
