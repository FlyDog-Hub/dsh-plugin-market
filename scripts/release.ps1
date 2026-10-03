# release.ps1 —— 按固定顺序打一个正式版本：门禁 → 递增 → 打包 → 打标签 → 发布。
#
# 版本号规则见 docs/RELEASING.md：
#   versionName = MAJOR.MINOR.PATCH（严格 SemVer，包/Git 标签/Release 都用它）
#   versionCode = MAJOR*10000 + MINOR*100 + PATCH（单调递增整数）
#   构建标识   = +提交数.短哈希（只写进发布说明与 dist/version.json）
#
# 用法：
#   pwsh -File scripts\release.ps1                     # 首个版本 1.0.0（不递增）
#   pwsh -File scripts\release.ps1 -Bump patch|minor|major
#   pwsh -File scripts\release.ps1 -LocalOnly          # 只打包，不改版本/不提交/不发布
#   pwsh -File scripts\release.ps1 -SkipPush           # 打包 + 提交 + 打标签，但不推送不建 Release

[CmdletBinding()]
param(
  [ValidateSet('none', 'patch', 'minor', 'major')]
  [string]$Bump = 'none',
  [string]$NotesFile,
  [switch]$LocalOnly,
  [switch]$SkipPush
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pkgDir = Join-Path $root 'plugin-market'
$manifestPath = Join-Path $pkgDir 'package.json'
$distDir = Join-Path $root 'dist'
$node = Join-Path $env:DSH_HOME 'dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) { throw '找不到 node.exe' }
$pnpm = Join-Path $env:DSH_HOME 'dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
if (-not (Test-Path $pnpm)) { throw "找不到 pnpm：$pnpm" }

function Step([string]$text) { Write-Host ''; Write-Host "==== $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "  ✓ $text" -ForegroundColor Green }

# ── 1. 读并校验当前版本 ─────────────────────────────────────────────
Step '1/5 读取并校验版本'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$current = [string]$manifest.version
if ($current -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
  throw "package.json 的 version 不是 MAJOR.MINOR.PATCH：$current"
}
$major = [int]$Matches[1]; $minor = [int]$Matches[2]; $patch = [int]$Matches[3]
Ok "当前 versionName=$current versionCode=$($major*10000 + $minor*100 + $patch)"

switch ($Bump) {
  'major' { $major += 1; $minor = 0; $patch = 0 }
  'minor' { $minor += 1; $patch = 0 }
  'patch' { $patch += 1 }
  'none' { }
}
$version = "$major.$minor.$patch"
$versionCode = $major * 10000 + $minor * 100 + $patch
if ($version -ne $current) { Ok "递增后 versionName=$version versionCode=$versionCode" }
else { Ok '不递增（首个版本或 -Bump none）' }

# ── 2. 门禁 ─────────────────────────────────────────────────────────
Step '2/5 门禁（任一失败即中止）'
$libFiles = Get-ChildItem (Join-Path $pkgDir 'lib') -Filter '*.js' | Sort-Object Name
foreach ($file in $libFiles) {
  & $node --check $file.FullName
  if ($LASTEXITCODE -ne 0) { throw "node --check 失败：$($file.Name)" }
}
Ok ("node --check 通过：" + (($libFiles | ForEach-Object { $_.Name }) -join '、'))

if ($manifest.dsh.bundle.patch -ne './cordis.patch.yml') { throw 'package.json 缺 dsh.bundle.patch' }
if ($manifest.dsh.client.platform -ne 'web') { throw 'package.json 的 dsh.client.platform 必须是 web' }
if ($manifest.exports.'./client' -ne './lib/client.js') { throw 'package.json 缺 exports["./client"]' }
Ok 'dsh.bundle.patch / dsh.client.platform / exports["./client"] 齐全'

$patchFile = Join-Path $pkgDir 'cordis.patch.yml'
if (-not (Test-Path $patchFile)) { throw '缺 cordis.patch.yml' }
$patchText = Get-Content $patchFile -Raw
if ($patchText -notmatch [regex]::Escape("name: $($manifest.name)")) {
  throw "cordis.patch.yml 里的 name 与包名不一致（应为 $($manifest.name)）"
}
Ok "cordis.patch.yml 行 name 与包名一致（$($manifest.name)）"

$clientText = Get-Content (Join-Path $pkgDir 'lib\client.js') -Raw
if ($clientText -notmatch '__ModuleLoader__\s*\.\s*load') { throw 'client bundle 缺 __ModuleLoader__.load' }
if ($clientText -notmatch ('id\s*:\s*"' + [regex]::Escape($manifest.name) + '"')) { throw 'client bundle 的 id 与包名不一致' }
if ($clientText -match 'eval\s*\(' -or $clientText -match 'new\s+Function\s*\(') { throw 'client bundle 含 eval/new Function' }
Ok 'client bundle：有 loader 注册、id 与包名一致、无 eval/new Function'

$guardTest = Join-Path $root 'verify\origin-guard.test.mjs'
if (Test-Path $guardTest) {
  & $node $guardTest | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '来源判定矩阵测试未通过（verify/origin-guard.test.mjs）' }
  Ok '来源判定矩阵测试通过'
}

Push-Location $root
try {
  if (-not $LocalOnly) {
    # 只要求「发布面」干净：plugin-market / docs / scripts / 根文件。
    # 并行进行的验收脚本改动（verify/**）既不进发布物、也不进本次提交，只警告不阻塞——
    # 否则一场正在跑的验收会把发布卡死。
    $dirty = @(& git status --porcelain | Where-Object { $_ } | ForEach-Object { $_.Substring(3).Trim() })
    $blocking = @($dirty | Where-Object { $_ -match '^(plugin-market|docs|scripts)/' -or $_ -notmatch '/' })
    if ($blocking.Count -gt 0) {
      throw ("发布面不干净，先提交或收起改动再发布：`n  " + ($blocking -join "`n  "))
    }
    if ($dirty.Count -gt 0) {
      Write-Warning ('以下改动不属于发布面，不阻塞发布、也不进入本次提交：' + ($dirty -join '、'))
    }
    Ok '发布面干净（plugin-market / docs / scripts / 根文件）'
  }
} finally { Pop-Location }

# ── 3. 递增并打包 ───────────────────────────────────────────────────
Step '3/5 写入版本并打包'
if (-not $LocalOnly -and $version -ne $current) {
  $raw = Get-Content $manifestPath -Raw
  $updated = $raw -replace '"version"\s*:\s*"[^"]+"', ('"version": "' + $version + '"')
  [System.IO.File]::WriteAllText($manifestPath, $updated, [System.Text.UTF8Encoding]::new($false))
  Ok "package.json version → $version"
}
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
Get-ChildItem $distDir -Filter '*.tgz' -ErrorAction SilentlyContinue | Remove-Item -Force
Push-Location $pkgDir
try {
  & $node $pnpm pack --pack-destination $distDir | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'pnpm pack 失败' }
} finally { Pop-Location }
$tgz = Join-Path $distDir "$($manifest.name)-$version.tgz"
if (-not (Test-Path $tgz)) { throw "没有生成预期的 tarball：$tgz" }
Ok ("tarball: " + (Split-Path $tgz -Leaf) + "（" + [math]::Round((Get-Item $tgz).Length / 1KB) + " KB）")

Push-Location $root
try {
  $commits = (& git rev-list --count HEAD).Trim()
  $sha = (& git rev-parse --short HEAD).Trim()
} finally { Pop-Location }
$versionJson = [ordered]@{
  name         = $manifest.name
  version      = $version
  versionCode  = $versionCode
  build        = "+$commits.$sha"
  commits      = [int]$commits
  sha          = $sha
  builtAt      = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}
$versionJson | ConvertTo-Json | Set-Content (Join-Path $distDir 'version.json') -Encoding UTF8
Ok ("dist/version.json: version=$version versionCode=$versionCode build=+$commits.$sha")

if ($LocalOnly) {
  Write-Host ''
  Write-Host 'LocalOnly：到此为止（未改版本、未提交、未打标签、未发布）。'
  exit 0
}

# ── 4. 提交 + 标签 ──────────────────────────────────────────────────
Step '4/5 提交并打标签'
Push-Location $root
try {
  & git add plugin-market/package.json
  $staged = @(& git diff --cached --name-only | Where-Object { $_ })
  if ($staged.Count -gt 0) {
    & git commit -q -m "chore(release): v$version"
    if ($LASTEXITCODE -ne 0) { throw 'git commit 失败' }
    Ok "已提交版本改动（$($staged -join '、')）"
  } else {
    # -Bump none 且 package.json 里已经是目标版本（例如首个版本 1.0.0）：没有可提交的改动，
    # 直接给当前提交打标签，而不是在这里失败。
    Ok '版本未变化，跳过提交（直接给当前提交打标签）'
  }
  $tag = "v$version"
  $existing = & git tag --list $tag
  if ($existing) { throw "标签已存在：$tag（版本号不可重用，请递增）" }
  & git tag -a $tag -m "v$version"
  if ($LASTEXITCODE -ne 0) { throw 'git tag 失败' }
  Ok "已打标签 $tag（指向 $((& git rev-parse --short HEAD).Trim())）"
} finally { Pop-Location }

# ── 5. 推送 + GitHub Release ────────────────────────────────────────
Step '5/5 推送并创建 Release'
if ($SkipPush) {
  Write-Host 'SkipPush：未推送、未创建 Release。'
  Write-Host "  手动推送：git push --follow-tags"
  exit 0
}
Push-Location $root
try {
  & git push --follow-tags
  if ($LASTEXITCODE -ne 0) { throw 'git push 失败（本机 github.com 需要 HTTPS_PROXY，见 docs/RELEASING.md）' }
  Ok '已推送提交与标签'
} finally { Pop-Location }

$gh = Join-Path $env:LOCALAPPDATA 'dsh-tools\gh\bin\gh.exe'
if (-not (Test-Path $gh)) { $gh = (Get-Command gh -ErrorAction SilentlyContinue).Source }
if (-not $gh) { throw '找不到 gh CLI，无法创建 Release' }

$notes = ''
if ($NotesFile) { $notes = Get-Content (Join-Path $root $NotesFile) -Raw }
if (-not $notes) {
  $changelog = Get-Content (Join-Path $pkgDir 'CHANGELOG.md') -Raw
  $m = [regex]::Match($changelog, "(?ms)^##\s+$([regex]::Escape($version))\s*$\s*(.*?)(?=^##\s|\z)")
  if ($m.Success) { $notes = $m.Groups[1].Value.Trim() }
}
if (-not $notes) { $notes = "首个正式版本 $version。" }
$notes = $notes + "`n`n---`n`n- versionName ``$version`` / versionCode ``$versionCode`` / build ``+$commits.$sha```n- 安装：``dsh plugin --profile web add <本页附件 dsh-plugin-market-$version.tgz>``（发布到 npm 后可直接 ``add $($manifest.name)``）`n- 目录源以 npm 镜像优先（实测 289ms）对官方源（本机直连 25–93s 超时）`n- 变更与验收细节见仓库 docs/ 与 verify/REPORT.md"
# Release notes 用文件传递：Windows 下把多行字符串直接当命令行参数会被截断/转义。
$notesPath = Join-Path $distDir "release-notes-v$version.md"
[System.IO.File]::WriteAllText($notesPath, $notes, [System.Text.UTF8Encoding]::new($false))

& $gh release create "v$version" $tgz (Join-Path $distDir 'version.json') `
  --title "v$version" --notes-file $notesPath 2>&1 | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE -ne 0) { throw 'gh release create 失败' }
Ok "GitHub Release v$version 已创建"
Write-Host ''
Write-Host "发布完成：v$version（versionCode=$versionCode, build=+$commits.$sha）"
