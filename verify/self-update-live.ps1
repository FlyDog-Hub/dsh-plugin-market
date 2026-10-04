# self-update-live.ps1 —— 真的走一遍「有更新 → 下载 → 三道校验 → 安装」这条端到端路径。
#
# 做法：把 plugin-market/package.json 的版本临时改成一个**低于最新标签**的值（1.0.9），
# 于是新起的 scratch 宿主会认为自己旧了 → GET /self-update 报 updateAvailable=true →
# POST /self-update 会真的从 jsDelivr 下载 tarball、校验、写盘、再交给宿主 pluginManager 安装。
#
# 三条隔离保证：
#   * 只碰 _verify/dshhome 下的 marketcheck profile，绝不动用户的 desktop/web profile；
#   * package.json 改前存字节、结束时按字节还原（并核对 sha256），失败路径也还原；
#   * 结束后把 scratch profile 的依赖改回 link:（否则后续验收会去用那个下载下来的 tarball）。
#
# 用法：pwsh -File verify\self-update-live.ps1
[CmdletBinding()]
param([int]$Port = 0)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$node = Get-NodeExe
if (-not $node) { throw '找不到 node.exe' }
Ensure-Dirs

$manifestPath = Join-Path $script:RepoRoot 'plugin-market\package.json'
$profileDir = Get-ProfileDir 'marketcheck'
$profileManifest = Join-Path $profileDir 'package.json'
$downloadDir = Join-Path $env:USERPROFILE '.dsh\plugin-market\downloads'
if ($Port -le 0) { $Port = Get-FreePort }

$originalManifest = [System.IO.File]::ReadAllBytes($manifestPath)
$originalSha = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
$profileBackup = $null
if (Test-Path -LiteralPath $profileManifest) { $profileBackup = [System.IO.File]::ReadAllBytes($profileManifest) }

$results = New-Object System.Collections.ArrayList
function Record([string]$id, [string]$title, [bool]$pass, [string]$actual) {
  $null = $results.Add([pscustomobject]@{ Id = $id; Title = $title; Pass = $pass; Actual = $actual })
  Write-Host ("  [{0}] {1,-9} {2}" -f $(if ($pass) { 'PASS' } else { 'FAIL' }), $id, $title)
  if (-not $pass) { Write-Host "           $actual" }
}

$h = $null
try {
  # 1) 临时把版本降下来，让「有更新」成为真实状态
  $raw = [System.IO.File]::ReadAllText($manifestPath)
  $patched = $raw -replace '"version"\s*:\s*"[^"]+"', '"version": "1.0.9"'
  [System.IO.File]::WriteAllText($manifestPath, $patched, [System.Text.UTF8Encoding]::new($false))
  Write-Host "临时版本：1.0.9（原 $((ConvertFrom-Json $raw).version)）"

  # 2) 起新进程的 scratch 宿主 —— 它读到的就是当前仓库代码与临时版本
  $h = Start-DshHost -Profile 'marketcheck' -Port $Port -Tag 'selfupdate-live'
  if (-not $h.Ready) { throw "宿主端口没通：$Port" }
  $base = "http://127.0.0.1:$Port"

  # 3) 检查：应当报「有更新」，并且拿到可校验的产物
  $check = Invoke-HttpProbe -Uri "$base/plugin-market/self-update?force=1" -TimeoutSec 60
  $cj = ConvertFrom-JsonSafe $check.Body
  $info = Get-PropOrNull $cj 'selfUpdate'
  $latest = Get-PropOrNull $info 'latest'
  $url = Get-PropOrNull $info 'url'
  $sha = Get-PropOrNull $info 'sha256'
  $channel = Get-PropOrNull $info 'channel'
  Record 'L1' 'GET /self-update 报有更新，并带上 tarball 地址与 sha256' `
    (($check.Status -eq 200) -and ((Get-PropOrNull $info 'updateAvailable') -eq $true) -and ((Get-PropOrNull $info 'installable') -eq $true) -and $null -ne $sha) `
    "status=$($check.Status) latest=$latest channel=$channel updateAvailable=$(Get-PropOrNull $info 'updateAvailable') installable=$(Get-PropOrNull $info 'installable') url=$url"

  # 4) 应用：真的下载 + 校验 + 安装（写接口必须走在已鉴权会话上）
  $authUrl = Get-AuthUrlFromLog -Host_ $h -TimeoutSec 40
  $sess = New-AuthSession -AuthUrl $authUrl
  Record 'L2' '前置条件：已建立带 cookie 的鉴权会话' $sess.Ok "status=$($sess.Status) cookies=$($sess.CookieCount)"

  $post = Invoke-HttpProbe -Uri "$base/plugin-market/self-update" -Method 'POST' -Body '{}' -CookieContainer $sess.CookieContainer -TimeoutSec 180
  $pj = ConvertFrom-JsonSafe $post.Body
  $tarballPath = Get-PropOrNull $pj 'tarball'
  Record 'L3' 'POST /self-update 真的装上了：application 由宿主给出、from/to 正确、要求重启' `
    (($post.Status -eq 200) -and ((Get-PropOrNull $pj 'ok') -eq $true) -and ((Get-PropOrNull $pj 'to') -eq $latest) -and ((Get-PropOrNull $pj 'requiresRestart') -eq $true) -and $null -ne $tarballPath) `
    "status=$($post.Status) body=$($post.Body.Substring(0, [Math]::Min(400, $post.Body.Length)))"

  # 5) 落盘的字节必须与清单里的 sha256 一致，且产物自证是这一版
  if ($null -ne $tarballPath -and (Test-Path -LiteralPath $tarballPath)) {
    $actualHash = (Get-FileHash -LiteralPath $tarballPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Record 'L4' '落盘的 tarball sha256 等于清单值（校验不是走过场）' ($actualHash -eq ([string]$sha).ToLowerInvariant()) "file=$actualHash manifest=$sha"
    $verifyArtifact = & $node (Join-Path $script:VerifyRoot 'lib\artifact-manifest.mjs') $tarballPath
    $artifactOk = ($LASTEXITCODE -eq 0) -and ($verifyArtifact -match "deepseek-harness-market@$([regex]::Escape([string]$latest))")
    Record 'L4b' '产物自证：tarball 里的 package.json 声明 name@version' $artifactOk "node 输出=$verifyArtifact"
  } else {
    Record 'L4' '落盘的 tarball sha256 等于清单值' $false "没有拿到落盘路径：$tarballPath"
    Record 'L4b' '产物自证：tarball 里的 package.json 声明 name@version' $false '上一条失败，跳过'
  }

  # 6) profile 真的被改了：依赖从 link: 变成那个本地 tarball
  $pm = ConvertFrom-JsonSafe (Get-Content -LiteralPath $profileManifest -Raw)
  $dep = Get-PropOrNull (Get-PropOrNull $pm 'dependencies') 'deepseek-harness-market'
  # 版本号从 $latest 取，**不写死**——写死会在每次发版后把「pnpm 真的装了新版」判成失败
  # （这条断言自己踩过一次：它写死了 1.1.0，而当时实际装的是 1.1.2）。
  $depOk = ($null -ne $dep) -and ([string]$dep -match '^(file|link):') -and ($null -ne $latest) -and ([string]$dep -match [regex]::Escape([string]$latest))
  Record 'L5' 'scratch profile 的依赖被换成下载下来的本地 tarball（pnpm 真的装了）' $depOk `
    "dependencies.deepseek-harness-market=$dep（期望含 $latest 的 file: 路径）"
} finally {
  if ($null -ne $h) { Stop-DshHost $h | Out-Null }
  # 还原 package.json（按字节）并核对
  [System.IO.File]::WriteAllBytes($manifestPath, $originalManifest)
  $restoredSha = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
  if ($restoredSha -ne $originalSha) { Write-Host "  !! package.json 还原后哈希不一致：$restoredSha vs $originalSha" -ForegroundColor Red }
  else { Write-Host "  ✓ package.json 已按字节还原（sha256 $($originalSha.Substring(0,12))…）" }
  # 还原 scratch profile 的依赖，避免后续验收去用那个下载产物。
  #
  # 顺序和范围都是踩出来的：只还原 manifest 不够——那次安装已经把 node_modules/deepseek-harness-market
  # 从符号链接变成了 tarball 解出来的实体目录，于是下一个宿主继续加载那份 1.1.x 而不是工作树
  # （实测：脚本以为宿主读的是临时改成 1.0.9 的工作树，实际它报 1.1.2，「有更新」的前提根本不成立）。
  # 而只删 pnpm-lock.yaml 也不够：pnpm 还有一份内部锁 node_modules/.pnpm/lock.yaml 记着那个 file: 依赖，
  # 不清掉就会拿「已经被删掉的下载物」去装，报 ENOENT。
  if ($null -ne $profileBackup) {
    [System.IO.File]::WriteAllBytes($profileManifest, $profileBackup)
    Write-Host '  ✓ scratch profile 的 package.json 已还原（依赖回到 link:）'
    Remove-Item (Join-Path $profileDir 'pnpm-lock.yaml') -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $profileDir 'node_modules\.pnpm\lock.yaml') -Force -ErrorAction SilentlyContinue
    try {
      $null = Invoke-DshPlugin -Profile 'marketcheck' -PnpmArgs @('add', (Join-Path $script:RepoRoot 'plugin-market')) -AllowFailure
      $linked = Get-Item (Join-Path $profileDir 'node_modules\deepseek-harness-market') -Force
      if ($linked.LinkType -eq 'Junction' -or $linked.LinkType -eq 'SymbolicLink') {
        Write-Host "  ✓ 依赖已重新链回工作树（$($linked.LinkType)）"
      } else {
        Write-Warning "依赖仍是实体目录（LinkType='$($linked.LinkType)'），后续验收前请手动 dsh plugin --profile marketcheck add <工作树>"
      }
    } catch {
      Write-Warning "重新链回工作树失败：$($_.Exception.Message)"
    }
  }
  # 下载物最后才删：上面重新链接时要先让 profile 摆脱对它的引用。
  if (Test-Path -LiteralPath $downloadDir) {
    Get-ChildItem -LiteralPath $downloadDir -Filter '*.tgz' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ 已清理测试下载物：$downloadDir"
  }
}

$pass = @($results | Where-Object { $_.Pass }).Count
$fail = @($results | Where-Object { -not $_.Pass }).Count
Write-Host ''
Write-Host "自更新端到端（真实 CDN + 真实安装）：PASS=$pass FAIL=$fail"
if ($fail -gt 0) { exit 1 }
