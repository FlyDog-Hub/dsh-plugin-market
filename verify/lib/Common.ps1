# 验收工具库（market-verifier 专用）—— 目标运行时：Windows PowerShell 5.1
#
# 为什么单独抽成库：主脚本与对抗性脚本必须共用同一套「找端口 / 起宿主 / 取鉴权 / 杀进程」，
# 否则两边对「就绪」和「清理」的定义会漂移，验收结论就不可信。
#
# 5.1 约束（踩过的坑，别改回去）：
#  * 不能用 ProcessStartInfo.ArgumentList / .Environment（.NET Framework 没有）→ 用 Arguments
#    字符串 + EnvironmentVariables。
#  * .cmd 不能被 CreateProcess 直接执行 → 统一经 `cmd.exe /c call "<x.cmd>" ... 1>out 2>err`。
#    这里 `call` 必须紧跟 /c，外层不能再套引号，否则 cmd 的引号剥离规则会吃掉路径。
#  * 本文件必须带 UTF-8 BOM，否则 5.1 按 ANSI 解码中文注释会直接解析失败。
#  * 不用 `??` / `?.` / `-Parallel` / 三元运算符。
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- 常量
$script:DshCli = 'D:\Software\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
$script:VerifyRoot = Join-Path (Split-Path -Parent $PSScriptRoot) ''   # verify/lib -> verify
$script:VerifyRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:RepoRoot = (Resolve-Path (Join-Path $script:VerifyRoot '..')).Path
# 独立 DSH_HOME：真实用户目录 C:\Users\<u>\.dsh 全程零写入
$script:DshHome = Join-Path (Join-Path $script:RepoRoot '_verify') 'dshhome'
$script:LogDir = Join-Path $script:VerifyRoot 'logs'

function Get-DshCliPath { return $script:DshCli }
function Get-VerifyRoot { return $script:VerifyRoot }
function Get-RepoRoot { return $script:RepoRoot }
function Get-DshHome { return $script:DshHome }
function Get-LogDir { return $script:LogDir }
function Get-ProfileDir([string]$Name) { return (Join-Path (Join-Path $script:DshHome 'profiles') $Name) }

function Ensure-Dirs {
  New-Item -ItemType Directory -Force -Path $script:DshHome | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $script:DshHome 'profiles') | Out-Null
  New-Item -ItemType Directory -Force -Path $script:LogDir | Out-Null
}

# ---------------------------------------------------------------- 空闲端口
# TcpListener 绑 0 让 OS 分配，比随机试端口可靠；释放后到宿主真正 bind 之间仍有理论竞态，
# 所以 Start-DshHost 会把「端口没通」当成失败并让调用方重试。
# cmd.exe 的重定向目标被独占打开，File.ReadAllText 会 IOException。
# 必须以 FileShare.ReadWrite 打开才能边跑边读日志。
function Read-FileShared([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  $fs = $null
  $sr = $null
  try {
    $fs = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
    return $sr.ReadToEnd()
  } catch {
    return ''
  } finally {
    if ($sr) { try { $sr.Dispose() } catch { } }
    if ($fs) { try { $fs.Dispose() } catch { } }
  }
}

function Get-FreePort {
  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  return $port
}

function Test-PortListening([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.ConnectAsync('127.0.0.1', $Port)
    $ok = $async.Wait(400)
    if ($ok -and $client.Connected) { return $true }
    return $false
  } catch {
    return $false
  } finally {
    try { $client.Close() } catch { }
  }
}

function Wait-PortListening([int]$Port, [int]$TimeoutSec = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortListening -Port $Port) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

# 谁在占这个端口（清理用，避免留下占用进程）
function Get-PortOwners([int]$Port) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { return @() }
    return @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
  } catch { return @() }
}

# ---------------------------------------------------------------- profile
# 从 shipped web 模板建临时 profile。--dump-config 让 CLI 建完即退，不会真把宿主拉起来。
function New-VerifyProfile {
  param(
    [Parameter(Mandatory)][string]$Name,
    [switch]$Force
  )
  Ensure-Dirs
  $dir = Get-ProfileDir $Name
  if (Test-Path $dir) {
    if (-not $Force) { return $dir }
    Remove-Item -LiteralPath $dir -Recurse -Force
  }
  $env:DSH_HOME = $script:DshHome
  $args = @('--from-default-profile', 'web', '--profile', $Name, '--dump-config')
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $script:DshCli
  $psi.Arguments = ($args | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['DSH_HOME'] = $script:DshHome
  $psi.WorkingDirectory = $script:RepoRoot
  $proc = [System.Diagnostics.Process]::Start($psi)
  # --dump-config 的树可能很大，异步读防止管道写满卡死
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  if (-not $proc.WaitForExit(180000)) { try { $proc.Kill() } catch { } ; throw "profile 初始化超时: $Name" }
  $null = $outTask.Result; $null = $errTask.Result
  if (-not (Test-Path (Join-Path $dir 'package.json'))) { throw "profile 初始化失败，未见 $dir\package.json" }
  return $dir
}

# 跑 `dsh plugin --profile <p> <pnpm-args>`。**只允许对临时 profile 调用**。
function Invoke-DshPlugin {
  param(
    [Parameter(Mandatory)][string]$Profile,
    [Parameter(Mandatory)][string[]]$PnpmArgs,
    [switch]$AllowFailure
  )
  if ($Profile -eq 'desktop' -or $Profile -eq 'web') {
    throw "拒绝在既有 profile '$Profile' 上跑 dsh plugin（验收纪律）"
  }
  $env:DSH_HOME = $script:DshHome
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $script:DshCli
  $all = @('plugin', '--profile', $Profile) + $PnpmArgs
  $psi.Arguments = ($all | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['DSH_HOME'] = $script:DshHome
  $psi.WorkingDirectory = $script:RepoRoot
  $proc = [System.Diagnostics.Process]::Start($psi)
  $o = $proc.StandardOutput.ReadToEndAsync()
  $e = $proc.StandardError.ReadToEndAsync()
  if (-not $proc.WaitForExit(600000)) { try { $proc.Kill() } catch { } ; throw "dsh plugin 超时" }
  $res = [pscustomobject]@{ ExitCode = $proc.ExitCode; StdOut = $o.Result; StdErr = $e.Result }
  if ($res.ExitCode -ne 0 -and -not $AllowFailure) {
    throw "dsh plugin 失败 ($($res.ExitCode)): $($res.StdErr) $($res.StdOut)"
  }
  return $res
}

# ---------------------------------------------------------------- 起宿主
function Start-DshHost {
  param(
    [Parameter(Mandatory)][string]$Profile,
    [Parameter(Mandatory)][int]$Port,
    [string]$Tag = '',
    [hashtable]$ExtraEnv = $null,
    [int]$ReadyTimeoutSec = 150
  )
  Ensure-Dirs
  if (-not $Tag) { $Tag = "$Profile-$Port-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
  $outFile = Join-Path $script:LogDir "host-$Tag.out.log"
  $errFile = Join-Path $script:LogDir "host-$Tag.err.log"

  # 关键：cmd.exe /c call "<dsh.cmd>" ... —— 见文件头 5.1 约束
  $argLine = '--profile "' + $Profile + '" --port ' + $Port + ' --no-open'
  $cmdLine = '/c call "' + $script:DshCli + '" ' + $argLine +
             ' 1>"' + $outFile + '" 2>"' + $errFile + '"'

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = $cmdLine
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['DSH_HOME'] = $script:DshHome
  $psi.WorkingDirectory = $script:RepoRoot
  # 额外环境变量：用于把 DSHM_REGISTRY_URL 指向受控的本地计数 fixture，
  # 把「冷启动期间到底有没有发网络请求」变成可观测事实，而不是推断。
  if ($null -ne $ExtraEnv) {
    foreach ($k in $ExtraEnv.Keys) { $psi.EnvironmentVariables[[string]$k] = [string]$ExtraEnv[$k] }
  }

  $proc = [System.Diagnostics.Process]::Start($psi)
  $ready = Wait-PortListening -Port $Port -TimeoutSec $ReadyTimeoutSec
  if ($ready) { Start-Sleep -Seconds 2 }   # 端口通了之后再给首页/客户端 bundle 一点时间

  return [pscustomobject]@{
    Process = $proc
    Pid     = $proc.Id
    Port    = $Port
    Profile = $Profile
    OutFile = $outFile
    ErrFile = $errFile
    Ready   = $ready
    CmdLine = $cmdLine
    Logs    = @()
  }
}

# 把宿主两条日志读成一个大字符串（同时把 tail 记进结果对象，方便 REPORT 引用）
function Get-HostLog {
  param([Parameter(Mandatory)]$Host_, [int]$Tail = 0)
  $out = ''
  $err = ''
  if (Test-Path $Host_.OutFile) { $out = Read-FileShared $Host_.OutFile }
  if (Test-Path $Host_.ErrFile) { $err = Read-FileShared $Host_.ErrFile }
  return [pscustomobject]@{ Out = $out; Err = $err; All = ($out + "`n" + $err) }
}

# 从启动日志取带 token 的完整鉴权 URL。不猜 token、不绕过鉴权。
function Get-AuthUrlFromLog {
  param([Parameter(Mandatory)]$Host_, [int]$TimeoutSec = 30)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    $log = Get-HostLog -Host_ $Host_
    $text = $log.All
    if ($text) {
      # 优先带 token/access_token/t 参数的完整 URL
      $m = [regex]::Match($text, 'https?://(?:127\.0\.0\.1|localhost|\[::1\]):\d+/[^\s"'']*[?&](?:token|access_token|t)=[A-Za-z0-9._~+/\-=%]+')
      if ($m.Success) { return $m.Value }
      # 退一步：日志里的裸 http URL（后面单独验证是否可用）
      $m2 = [regex]::Match($text, 'https?://(?:127\.0\.0\.1|localhost|\[::1\]):\d+[^\s"'']*')
      if ($m2.Success) { return $m2.Value }
    }
    if ((Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  } while ((Get-Date) -lt $deadline)
  return $null
}

# ---------------------------------------------------------------- 已鉴权会话
# 为什么单列一个函数：宿主的写接口有**两层**防护，不区分就会测错层。
#   第 1 层 = 宿主信任层：未带会话 cookie 的请求会被它以**空 body 403** 拦掉；
#   第 2 层 = 插件守卫（isSameOrigin）：只有进到插件里的请求才由它判定。
# 因此测 §5.5 的写接口必须先用「带 token 的 URL → 303 → Set-Cookie」把会话建立起来，
# 再用同一个 CookieContainer 发后续请求；否则测的是第 1 层，结论对插件毫无意义。
function New-AuthSession {
  param(
    [Parameter(Mandatory)][string]$AuthUrl,
    [int]$TimeoutSec = 30
  )
  $cc = New-Object System.Net.CookieContainer
  $probe = Invoke-HttpProbe -Uri $AuthUrl -CookieContainer $cc -TimeoutSec $TimeoutSec
  $cookies = @()
  try {
    foreach ($c in $cc.GetCookies([uri]$AuthUrl)) { $cookies += "$($c.Name)=$($c.Value)" }
  } catch { }
  return [pscustomobject]@{
    CookieContainer = $cc
    Status          = $probe.Status
    Cookies         = $cookies
    CookieCount     = $cookies.Count
    Ok              = (($probe.Status -eq 200) -and ($cookies.Count -gt 0))
  }
}

# 把 CookieContainer 里的 cookie 拼成请求头字符串，供 curl 交叉复核复用同一条会话。
function Get-CookieHeader($CookieContainer, [string]$Uri) {
  if ($null -eq $CookieContainer) { return '' }
  try {
    $parts = @()
    foreach ($c in $CookieContainer.GetCookies([uri]$Uri)) { $parts += "$($c.Name)=$($c.Value)" }
    return ($parts -join '; ')
  } catch { return '' }
}

# ---------------------------------------------------------------- HTTP
#
# 直接用 System.Net.HttpWebRequest，不用 Invoke-WebRequest。
# 为什么必须换掉（这是第一轮验收 9 条假失败的根因）：
#   PS 5.1 的 Invoke-WebRequest 在 4xx/5xx 时抛异常，而它已经把响应流读走/释放了，
#   于是从 $_.Exception.Response.GetResponseStream() 再读只会得到空正文；
#   $_.ErrorDetails.Message 在 5.1 上也不可靠。结果就是 403/404/400/405 的
#   **状态码对、正文全空**，`error.code` 一律读成空 —— 看起来像实现缺陷，其实是工具没读到。
# HttpWebRequest 在异常路径下交出的 HttpWebResponse 流是完整可读的。
function Invoke-HttpProbe {
  param(
    [Parameter(Mandatory)][string]$Uri,
    [string]$Method = 'GET',
    [hashtable]$Headers = @{},
    [string]$Body = $null,
    [string]$ContentType = 'application/json',
    # 传入共享的 CookieContainer 即可复用同一条已鉴权会话。测宿主的写接口必须这样传：
    # 否则测到的是宿主的信任层（未鉴权会被它以空 body 403 拦掉），而不是插件自己的守卫。
    [System.Net.CookieContainer]$CookieContainer = $null,
    [int]$TimeoutSec = 30
  )
  $res = [pscustomobject]@{
    Uri = $Uri; Method = $Method; Status = 0; Body = ''; Error = $null; SentHeaders = $Headers; Headers = @{}
  }
  $req = $null
  $resp = $null
  try {
    $req = [System.Net.HttpWebRequest]::Create($Uri)
    $req.Method = $Method
    $req.Timeout = $TimeoutSec * 1000
    $req.ReadWriteTimeout = $TimeoutSec * 1000
    $req.AllowAutoRedirect = $true
    # 必须给一个 CookieContainer：首页鉴权是「带 token 的 URL → 303 重定向 → Set-Cookie →
    # 带 cookie 再取文档」。HttpWebRequest 不像 Invoke-WebRequest 会自动建 cookie 容器，
    # 不设它就会在重定向后丢 cookie，于是首页变成 401（改用 HttpWebRequest 后踩过这个坑）。
    # 传了共享容器就用它，让多个请求落在同一条已鉴权会话上。
    $req.CookieContainer = if ($null -ne $CookieContainer) { $CookieContainer } else { New-Object System.Net.CookieContainer }
    $req.UserAgent = 'deepseek-harness-market-verifier/1.0'
    # 不主动请求压缩：让正文是可读的 JSON，避免解压环节引入变量
    $req.AutomaticDecompression = [System.Net.DecompressionMethods]::None
    # POST 时默认的 Expect: 100-continue 会在部分服务端引入额外往返，关掉
    try { $req.ServicePoint.Expect100Continue = $false } catch { }

    if ($Headers -and $Headers.Count -gt 0) {
      foreach ($k in $Headers.Keys) {
        if ($k -ieq 'Host') { $req.Host = [string]$Headers[$k] }
        elseif ($k -ieq 'Content-Type') { $req.ContentType = [string]$Headers[$k] }
        else { $req.Headers.Add([string]$k, [string]$Headers[$k]) }
      }
    }
    # [string] 形参不给值时是 '' 而不是 $null，必须判空字符串，否则 GET 会被附上空正文
    if (-not [string]::IsNullOrEmpty($Body)) {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
      if (-not ($Headers.Keys | Where-Object { $_ -ieq 'Content-Type' })) { $req.ContentType = $ContentType }
      $req.ContentLength = $bytes.Length
      $s = $req.GetRequestStream()
      $s.Write($bytes, 0, $bytes.Length)
      $s.Dispose()
    }

    try {
      $resp = $req.GetResponse()
    } catch [System.Net.WebException] {
      $resp = $_.Exception.Response
      if ($null -eq $resp) { throw }
    }

    if ($null -ne $resp) {
      try { $res.Status = [int]$resp.StatusCode } catch { $res.Status = 0 }
      # 二进制读再自行 UTF-8 解码：不依赖响应头 charset，避免中文被按 latin1 读成乱码
      try {
        $ms = New-Object System.IO.MemoryStream
        $resp.GetResponseStream().CopyTo($ms)
        $res.Body = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
        $ms.Dispose()
      } catch { $res.Body = '' }
      try {
        foreach ($k in $resp.Headers.AllKeys) { $res.Headers[$k] = [string]$resp.Headers[$k] }
      } catch { }
    }
  } catch {
    $res.Error = $_.Exception.Message
  } finally {
    if ($null -ne $resp) { try { $resp.Dispose() } catch { } }
  }
  return $res
}

# 独立的第二个 HTTP 客户端（curl.exe），用来交叉复核 4xx/5xx 正文。
# 两个不同实现给出同样的正文，才能排除「是探测工具读不到」这一可能。
function Invoke-CurlProbe {
  param(
    [Parameter(Mandatory)][string]$Uri,
    [string]$Method = 'GET',
    [hashtable]$Headers = @{},
    [string]$Body = $null,
    [string]$ContentType = 'application/json',
    [int]$TimeoutSec = 30
  )
  $out = [pscustomobject]@{ Available = $false; Status = 0; Body = ''; Error = $null; Raw = '' }
  # 显式传 -Headers $null 会覆盖默认值 @{}，StrictMode 下 $Headers.Keys 直接崩，先归一化
  if ($null -eq $Headers) { $Headers = @{} }
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { $out.Error = 'curl.exe 不可用'; return $out }
  $out.Available = $true
  $tmpDir = [System.IO.Path]::GetTempPath()
  $tmpBody = Join-Path $tmpDir ("curlprobe-" + [guid]::NewGuid().ToString('N') + ".txt")
  $tmpData = $null
  $args = @('-sS', '-o', $tmpBody, '-w', '%{http_code}', '-X', $Method, '--max-time', "$TimeoutSec")
  foreach ($k in $Headers.Keys) { $args += @('-H', "$k`: $($Headers[$k])") }
  if (-not [string]::IsNullOrEmpty($Body)) {
    # 正文必须走文件（--data-binary @file）：PowerShell 5.1 往 curl.exe 传含引号/大括号的
    # JSON 字符串时，命令行引号会被剥掉，curl 收到的是被改写的正文（实测变成 400 bad-request），
    # 于是「独立复核」反而给出与主探针不一致的假证据。
    $tmpData = Join-Path $tmpDir ("curldata-" + [guid]::NewGuid().ToString('N') + ".json")
    [System.IO.File]::WriteAllText($tmpData, $Body, (New-Object System.Text.UTF8Encoding($false)))
    $args += @('-H', "Content-Type: $ContentType", '--data-binary', "@$tmpData")
  }
  $args += $Uri
  try {
    $statusText = & $curl.Source @args 2>&1 | Out-String
    $out.Raw = $statusText.Trim()
    if ($out.Raw -match '(\d{3})') { $out.Status = [int]$Matches[1] }
    if (Test-Path $tmpBody) { $out.Body = [System.IO.File]::ReadAllText($tmpBody) }
  } catch {
    $out.Error = $_.Exception.Message
  } finally {
    foreach ($f in @($tmpBody, $tmpData)) {
      if ($f -and (Test-Path $f)) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
    }
  }
  return $out
}

# 区分「字段不存在」与「字段值为 null」。契约里 /status 冷启动 catalog 就是 null，
# 用 Get-PropOrNull 判定会把正确的 null 误报成缺字段。
function Test-PropExists($Obj, [string]$Name) {
  if ($null -eq $Obj) { return $false }
  return ($null -ne $Obj.PSObject.Properties[$Name])
}

# 安全取数组：$null 经 @() 会变成含 1 个 null 的数组，计数就成了 1 而不是 0。
# 必须用 `,@()` 返回：直接 `return @()` 会被 PowerShell 展开成「无输出」，
# 调用方拿到 $null，紧接着的 .Count 在 StrictMode 下就崩。
function Get-ArrayProp($Obj, [string]$Name) {
  $v = Get-PropOrNull $Obj $Name
  if ($null -eq $v) { return ,@() }
  return ,@($v)
}

# StrictMode Latest 下读不存在的属性会抛异常；JSON 响应字段是否齐全正是断言对象，
# 不能让「字段缺失」变成「工具崩溃」，所以统一走这个安全取值器。
function Get-PropOrNull($Obj, [string]$Name) {
  if ($null -eq $Obj) { return $null }
  $p = $Obj.PSObject.Properties[$Name]
  if ($null -eq $p) { return $null }
  return $p.Value
}

function ConvertFrom-JsonSafe([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
  try { return ($Text | ConvertFrom-Json) } catch { return $null }
}

# 取首页 HTML 与 __DSH_BOOT__ 图。
# 实测（0.2.0-rc.2）真实写法是 `globalThis["__DSH_BOOT__"] = {...}`，不是契约 §5.2 写的
# `window.__DSH_BOOT__`；两种都认，并把命中的写法记在 Shape 里供 REPORT 引用。
# 图结构 = { rev, entries: [{id,url,rev,inject}], batches: [{phase,url,rev,entries}] }。
function Get-BootGraph {
  param([Parameter(Mandatory)][string]$Url, [int]$TimeoutSec = 30)
  $res = Invoke-HttpProbe -Uri $Url -TimeoutSec $TimeoutSec
  $html = $res.Body
  $boot = $null
  $shape = '<none>'
  if ($html) {
    $m = [regex]::Match($html, 'globalThis\["__DSH_BOOT__"\]\s*=\s*')
    if ($m.Success) { $shape = 'globalThis["__DSH_BOOT__"]' }
    else {
      $m = [regex]::Match($html, 'window\.__DSH_BOOT__\s*=\s*')
      if ($m.Success) { $shape = 'window.__DSH_BOOT__' }
    }
    if ($m.Success) {
      # 括号配平截断 JSON（不能靠行尾，值里含换行与字符串）
      $start = $m.Index + $m.Length
      $depth = 0; $end = -1; $inStr = $false; $esc = $false
      for ($i = $start; $i -lt $html.Length; $i++) {
        $ch = $html[$i]
        if ($inStr) {
          if ($esc) { $esc = $false }
          elseif ($ch -eq '\') { $esc = $true }
          elseif ($ch -eq '"') { $inStr = $false }
          continue
        }
        if ($ch -eq '"') { $inStr = $true; continue }
        if ($ch -eq '{') { $depth++ }
        elseif ($ch -eq '}') { $depth--; if ($depth -eq 0) { $end = $i; break } }
      }
      if ($end -gt $start) {
        $json = $html.Substring($start, $end - $start + 1)
        $boot = ConvertFrom-JsonSafe $json
      }
    }
  }
  return [pscustomobject]@{ Status = $res.Status; Html = $html; Boot = $boot; Error = $res.Error; Shape = $shape }
}

# 在 boot 图里按 id 找 entry；找不到返回 $null（断言要报「缺失」而不是崩）
function Get-BootEntry($Boot, [string]$Id) {
  if ($null -eq $Boot) { return $null }
  $entries = @(Get-PropOrNull $Boot 'entries')
  foreach ($e in $entries) {
    if ((Get-PropOrNull $e 'id') -eq $Id) { return $e }
  }
  return $null
}

# ---------------------------------------------------------------- 清理
# 必须可靠：taskkill 整棵进程树 + 按端口占用兜底 + 回读确认端口已释放
function Stop-DshHost {
  param([Parameter(Mandatory)]$Host_)
  $port = $Host_.Port
  $pid_ = $null
  if ($null -ne $Host_.Process) { $pid_ = $Host_.Process.Id }
  if ($pid_) {
    try { & taskkill.exe /PID $pid_ /T /F 2>&1 | Out-Null } catch { }
    try { $null = $Host_.Process.WaitForExit(10000) } catch { }
  }
  # 兜底：端口若仍被占，按 OwningProcess 杀
  foreach ($op in (Get-PortOwners $port)) {
    try {
      $pname = (Get-Process -Id $op -ErrorAction SilentlyContinue).ProcessName
      Write-Host "  [cleanup] 端口 $port 仍被 pid=$op ($pname) 占用，强杀"
      & taskkill.exe /PID $op /T /F 2>&1 | Out-Null
    } catch { }
  }
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline -and (Test-PortListening -Port $port)) { Start-Sleep -Milliseconds 300 }
  $released = -not (Test-PortListening -Port $port)
  return $released
}

# ---------------------------------------------------------------- 断言框架
# 每条断言固定留：编号 / 标题 / 复现命令 / 预期 / 实际 / 结论 / 证据
function New-Assertion {
  param([string]$Id, [string]$Title, [string]$Command, [string]$Expected)
  return [pscustomobject]@{
    Id = $Id; Title = $Title; Command = $Command; Expected = $Expected
    Actual = ''; Pass = $false; Evidence = ''
  }
}

function Set-Assertion {
  param([Parameter(Mandatory)]$A, [bool]$Pass, [string]$Actual, [string]$Evidence = '')
  $A.Pass = $Pass
  $A.Actual = $Actual
  if ($Evidence) { $A.Evidence = $Evidence }
  $mark = 'PASS'
  if (-not $Pass) { $mark = 'FAIL' }
  Write-Host ("  [{0}] {1} — {2}" -f $mark, $A.Id, $Actual)
  return $A
}

# ---------------------------------------------------------------- 杂项
# 用宿主自带的 Node，避免 PATH 上的 Node 版本与宿主不一致导致 --check 结论不可比
function Get-NodeExe {
  $candidates = @(
    'D:\Software\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe',
    'C:\Users\28062\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
  )
  foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { return $c } }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

# 同源 POST 头。契约 §1 允许两条路径：Sec-Fetch-Site: same-origin 或 Origin.host === Host。
# 分开构造是为了把「只给 Origin」「只给 Sec-Fetch-Site」两种情况都测到，而不是只测一条。
function New-SameOriginHeaders([int]$Port, [switch]$OnlyOrigin, [switch]$OnlySecFetch) {
  $h = @{}
  if (-not $OnlySecFetch) { $h['Origin'] = "http://127.0.0.1:$Port" }
  if (-not $OnlyOrigin) { $h['Sec-Fetch-Site'] = 'same-origin' }
  return $h
}

# 跑 `node --check`，返回 @{ ExitCode; Output }
function Invoke-NodeCheck([string]$File) {
  $node = Get-NodeExe
  if (-not $node) { return [pscustomobject]@{ ExitCode = -1; Output = 'no node executable found' } }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node
  $psi.Arguments = '--check "' + $File + '"'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $o = $p.StandardOutput.ReadToEndAsync()
  $e = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit(60000)) { try { $p.Kill() } catch { } ; return [pscustomobject]@{ ExitCode = -1; Output = 'timeout' } }
  return [pscustomobject]@{ ExitCode = $p.ExitCode; Output = (($o.Result + "`n" + $e.Result).Trim()) }
}

# 每条断言的原始输出都落进一个**固定的**证据文件。
#
# 两个必须遵守的纪律（都是踩过的坑）：
#  * 证据路径只能是启动时定好的常量路径，绝不拿命令输出/断言文本去拼路径。
#  * 记录证据本身不许弄死整个验收：路径异常时只记一条告警，继续跑完剩余断言。
function Add-Evidence {
  param([Parameter(Mandatory)][string]$File, [string]$Title, [string]$Text)
  $stamp = Get-Date -Format 'HH:mm:ss.fff'
  $block = "`n========== [$stamp] $Title ==========`n$Text`n"
  try {
    if ([string]::IsNullOrWhiteSpace($File) -or $File.IndexOfAny([char[]]'<>:"|?*') -ge 0) {
      # 允许盘符里的冒号：只在缺少盘符样式时才算非法
      if ($File -notmatch '^[A-Za-z]:\\') {
        throw "证据路径非法: '$File'"
      }
    }
    [System.IO.File]::AppendAllText($File, $block, (New-Object System.Text.UTF8Encoding($false)))
  } catch {
    $warn = "[$(Get-Date -Format 'HH:mm:ss')] Add-Evidence 失败: $($_.Exception.Message)`n  目标: $File`n  标题: $Title`n"
    Write-Host "  [warn] $warn"
    try {
      $fallback = Join-Path (Get-LogDir) 'evidence-errors.log'
      [System.IO.File]::AppendAllText($fallback, $warn, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
  }
}

# 取原始字节再自行按 UTF-8 解码。
# 为什么不能只用 Invoke-WebRequest 的 .Content：bundle 的中文是否正确，取决于响应头
# charset 与实际字节；必须拿到原始字节自己解，才能把「编码跟随文档编码」这个真实风险测出来。
function Invoke-HttpBytes {
  param([Parameter(Mandatory)][string]$Uri, [int]$TimeoutSec = 30)
  $out = [pscustomobject]@{ Status = 0; Bytes = $null; Text = ''; Error = $null }
  try {
    $req = [System.Net.HttpWebRequest]::Create($Uri)
    $req.Timeout = $TimeoutSec * 1000
    $req.AllowAutoRedirect = $true
    $req.CookieContainer = New-Object System.Net.CookieContainer
    $resp = $req.GetResponse()
    $out.Status = [int]$resp.StatusCode
    $ms = New-Object System.IO.MemoryStream
    $resp.GetResponseStream().CopyTo($ms)
    $out.Bytes = $ms.ToArray()
    $ms.Dispose()
    $resp.Dispose()
    $out.Text = [System.Text.Encoding]::UTF8.GetString($out.Bytes)
  } catch {
    $ex = $_.Exception
    $resp = $null
    if ($ex -is [System.Net.WebException]) { try { $resp = $ex.Response } catch { } }
    if ($null -ne $resp) {
      try { $out.Status = [int]$resp.StatusCode } catch { }
      try {
        $ms = New-Object System.IO.MemoryStream
        $resp.GetResponseStream().CopyTo($ms)
        $out.Bytes = $ms.ToArray()
        $ms.Dispose()
        $out.Text = [System.Text.Encoding]::UTF8.GetString($out.Bytes)
      } catch { }
    } else {
      $out.Error = $ex.Message
    }
  }
  return $out
}

function Get-FileSha256([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '<missing>' }
  try { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash } catch { return '<error>' }
}

# ---------------------------------------------------------------- 受控 Node 服务
# 起一个本地 Node stub/fixture 服务，靠它自己写的端口文件来同步（不去读它的 stdout：
# 读 stdout 需要管道/重定向，在 5.1 上更容易把子进程拖死）。
function Start-NodeServer {
  param(
    [Parameter(Mandatory)][string]$Script,
    [string[]]$ArgList = @(),
    [Parameter(Mandatory)][string]$Tag,
    [int]$TimeoutSec = 30
  )
  Ensure-Dirs
  $node = Get-NodeExe
  if (-not $node) { throw '找不到 node 可执行文件' }
  $portFile = Join-Path $script:LogDir "nodesrv-$Tag.port"
  if (Test-Path $portFile) { Remove-Item $portFile -Force }

  $args = '"' + $Script + '"'
  foreach ($a in $ArgList) { $args += ' "' + $a + '"' }
  $args += ' "' + $portFile + '"'

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node
  $psi.Arguments = $args
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $proc = [System.Diagnostics.Process]::Start($psi)

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $portFile) {
      $txt = (Read-FileShared $portFile).Trim()
      if ($txt -match '^\d+$') {
        $pn = [int]$txt
        if (Wait-PortListening -Port $pn -TimeoutSec 10) {
          return [pscustomobject]@{ Process = $proc; Pid = $proc.Id; Port = $pn; PortFile = $portFile; Args = $args }
        }
      }
    }
    if ($proc.HasExited) { throw "Node 服务 $Tag 启动即退出，exit=$($proc.ExitCode)" }
    Start-Sleep -Milliseconds 200
  }
  try { & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null } catch { }
  throw "Node 服务 $Tag 未在 $TimeoutSec 秒内上报端口"
}

function Stop-NodeServer($Server) {
  if ($null -eq $Server) { return }
  try { & taskkill.exe /PID $Server.Process.Id /T /F 2>&1 | Out-Null } catch { }
  foreach ($op in @(Get-PortOwners $Server.Port)) {
    try { & taskkill.exe /PID $op /T /F 2>&1 | Out-Null } catch { }
  }
}

