# 市场路由断言集 —— 抽成独立模块的唯一理由：同一套断言要能被指向
#   (a) 真实宿主 origin（验收）
#   (b) 故意返回错东西的本地 stub（selfcheck，证明断言真的会红）
# 如果断言只写在主流程里，就没法证明它「能失败」，只能靠嘴说。
#
# 取值纪律：
#  * 一律走 Get-PropOrNull / ConvertFrom-JsonSafe，响应不是 JSON 时判 FAIL 而不是崩。
#  * 数组计数一律走 Get-ArrayProp：$null 经 @() 会变成含 1 个 null 的数组，计数会假成 1。
#  * 「字段不存在」与「字段值为 null」用 Test-PropExists 区分：契约 §2.1 规定 /status
#    冷启动 catalog 必须是 null，把 null 当缺字段会把正确行为误报成缺陷。
#  * 所有 4xx/5xx 断言都附一份 curl.exe 交叉复核正文（含同一会话 cookie）：两个客户端
#    给出同样正文，才能排除「是探测工具读不到」。第一轮验收就是只信一个客户端，9 条被误判。
#
# ★ 两层防护（必须区分，否则测错层 —— 这是线上 403 事件暴露的测量前提）
#   第 1 层 宿主信任层：未带会话 cookie 的写请求会被宿主以**空 body 403** 拦掉。
#   第 2 层 插件守卫 isSameOrigin：只有进到插件里的请求才由它判定来源。
#   所以 §5.5 的写接口断言一律在 -Session（token→303→Set-Cookie）已建立的会话上做；
#   未鉴权的那一发单独记成诊断（A5g），且只允许出现「空 body 403」形态。
#
# ★ 桌面壳形状（线上真缺陷的回归项）
#   官方 Electron 壳 dsh-desktop-host 的 forwardWebRequest 会删掉
#   Host / Origin / Cookie / Sec-Fetch-Site，再补上宿主 cookie。所以桌面端写请求
#   **天然没有 Origin 与 Sec-Fetch-Site**。契约 §1 因此规定：两个头都不存在时，
#   仅当来源是回环地址才放行。把它当跨站拒绝，会导致 Electron 内安装/卸载/开关/刷新全部 403。

function Invoke-MarketRouteChecks {
  param(
    [Parameter(Mandatory)][string]$BaseUrl,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][scriptblock]$Collect,
    [System.Net.CookieContainer]$Session = $null,
    [switch]$IncludeExtras,
    [int]$CatalogTimeoutSec = 60
  )

  $sameOrigin = New-SameOriginHeaders -Port $Port
  $outsideBody = '{"name":"evil/not-in-catalog-pkg","spec":"evil-not-in-catalog-pkg-xyz"}'
  $selfBody = '{"name":"dsh-market"}'
  $haveSession = ($null -ne $Session)

  function Probe([string]$Path, [string]$Method = 'GET', $Headers = $null, [string]$Body = $null, [int]$Timeout = 40, [string]$CType = 'application/json', [switch]$NoCookie) {
    $p = @{ Uri = "$BaseUrl$Path"; Method = $Method; TimeoutSec = $Timeout; ContentType = $CType }
    if ($Headers) { $p.Headers = $Headers }
    if ($Body) { $p.Body = $Body }
    if (-not $NoCookie -and $null -ne $Session) { $p.CookieContainer = $Session }
    return Invoke-HttpProbe @p
  }

  # 参数名刻意避开 `$Evidence`：PowerShell 动态作用域下它会在调用方遮蔽 `$evidence` 路径变量。
  function Emit($Id, $Title, $Command, $Expected, [bool]$Pass, $Actual, $EvidenceText) {
    $null = & $Collect @{ Id = $Id; Title = $Title; Command = $Command; Expected = $Expected; Pass = $Pass; Actual = $Actual; Evidence = $EvidenceText }
  }

  function ErrField($Json, [string]$Field) {
    return (Get-PropOrNull (Get-PropOrNull $Json 'error') $Field)
  }

  # 用 curl.exe 独立复核同一条请求的正文（带上同一会话 cookie）
  function Cross($Path, [string]$Method = 'GET', $Headers = $null, [string]$Body = $null, [string]$CType = 'application/json', [switch]$NoCookie) {
    $h = @{}
    if ($Headers) { foreach ($k in $Headers.Keys) { $h[$k] = $Headers[$k] } }
    if (-not $NoCookie -and $haveSession) {
      $ck = Get-CookieHeader $Session $BaseUrl
      if ($ck) { $h['Cookie'] = $ck }
    }
    $c = Invoke-CurlProbe -Uri "$BaseUrl$Path" -Method $Method -Headers $h -Body $Body -ContentType $CType -TimeoutSec 40
    if (-not $c.Available) { return "curl 交叉复核不可用: $($c.Error)" }
    return "--- curl.exe 交叉复核（独立 HTTP 客户端，同一会话 cookie）---`nstatus=$($c.Status)`nbody=$($c.Body)"
  }

  # ---------------- §5.4 /status ----------------
  # 契约 §2.1：冷启动时 catalog 必须是 null（首屏不发网络请求）。所以判定是
  # 「catalog 字段存在」，值 null 或对象都合法；为对象时再要求内部字段齐全。
  $r = Probe '/status'
  $j = ConvertFrom-JsonSafe $r.Body
  $ok = Get-PropOrNull $j 'ok'
  $ct = ''; if ($r.Headers.ContainsKey('Content-Type')) { $ct = $r.Headers['Content-Type'] }
  $cc2 = ''; if ($r.Headers.ContainsKey('Cache-Control')) { $cc2 = $r.Headers['Cache-Control'] }
  $missing = @()
  foreach ($f in @('plugin', 'host', 'manager')) { if ($null -eq (Get-PropOrNull $j $f)) { $missing += $f } }
  $catPresent = Test-PropExists $j 'catalog'
  $catVal = Get-PropOrNull $j 'catalog'
  $catState = '缺失(违规)'
  $catInnerOk = $true
  $catInnerMsg = ''
  if ($catPresent) {
    if ($null -eq $catVal) {
      $catState = 'null(冷启动，符合契约 §2.1)'
    } else {
      $catState = '对象'
      $innerMissing = @()
      foreach ($f in @('source', 'count', 'updated', 'fetchedAt', 'stale')) { if (-not (Test-PropExists $catVal $f)) { $innerMissing += $f } }
      $catInnerOk = ($innerMissing.Count -eq 0)
      $catInnerMsg = "catalog 内缺字段=[$($innerMissing -join ',')]"
    }
  }
  $pn = Get-PropOrNull (Get-PropOrNull $j 'plugin') 'name'
  $pv = Get-PropOrNull (Get-PropOrNull $j 'plugin') 'version'
  # 期望版本从包清单读，不写死：写死会在每次发版后把「产品正确上报了当前版本」判成失败
  # （1.1.0 那一轮就是这样把 1.0.0 判成 fail 的）。契约要求的是「等于 package.json 里的版本」。
  $expectedVersion = ''
  try {
    $manifestPath = Join-Path (Get-RepoRoot) 'plugin-market\package.json'
    if (Test-Path -LiteralPath $manifestPath) {
      $expectedVersion = [string](Get-Content $manifestPath -Raw | ConvertFrom-Json).version
    }
  } catch { $expectedVersion = '' }
  $mgrAvail = Get-PropOrNull (Get-PropOrNull $j 'manager') 'available'
  $hostDsh = Get-PropOrNull (Get-PropOrNull $j 'host') 'dsh'
  Emit 'A4a' 'GET /status 返回 ok:true 且字段齐全（catalog 允许 null，§5.4/§2.1）' "GET $BaseUrl/status" `
    "HTTP 200；ok:true；含 plugin/host/manager/catalog 四个字段；Content-Type: application/json；plugin.name=dsh-market；plugin.version 等于 package.json 的 version（当前 $expectedVersion）；catalog 为 null 或含 source/count/updated/fetchedAt/stale 的对象" `
    (($r.Status -eq 200) -and ($ok -eq $true) -and ($missing.Count -eq 0) -and $catPresent -and $catInnerOk -and ($ct -match 'application/json') -and ($pn -eq 'dsh-market') -and ($expectedVersion -ne '') -and ($pv -eq $expectedVersion)) `
    "status=$($r.Status) ok=$ok 缺字段=[$($missing -join ',')] catalog=$catState $catInnerMsg plugin.name=$pn plugin.version=$pv manager.available=$mgrAvail host.dsh=$hostDsh contentType=$ct cacheControl=$cc2" `
    $r.Body.Substring(0, [Math]::Min(900, $r.Body.Length))

  # ---------------- §5.4 /catalog ----------------
  $r = Probe '/catalog?query=dsh&pageSize=5'
  $j = ConvertFrom-JsonSafe $r.Body
  $ok = Get-PropOrNull $j 'ok'
  $ct = ''; if ($r.Headers.ContainsKey('Content-Type')) { $ct = $r.Headers['Content-Type'] }
  $missing = @()
  foreach ($f in @('catalog', 'page', 'categories', 'items')) { if ($null -eq (Get-PropOrNull $j $f)) { $missing += $f } }
  $page = Get-PropOrNull $j 'page'
  $items = Get-ArrayProp $j 'items'
  $cats = Get-ArrayProp $j 'categories'
  $ps = Get-PropOrNull $page 'pageSize'
  $pgNum = Get-PropOrNull $page 'page'
  $total = Get-PropOrNull $page 'total'
  $catCount = Get-PropOrNull (Get-PropOrNull $j 'catalog') 'count'
  Emit 'A4b' 'GET /catalog?query=dsh&pageSize=5 返回 ok:true 且字段齐全（§5.4）' "GET $BaseUrl/catalog?query=dsh&pageSize=5" `
    'HTTP 200；ok:true；含 catalog/page/categories/items；page.pageSize=5；items 数 ≤ 5；Content-Type: application/json' `
    (($r.Status -eq 200) -and ($ok -eq $true) -and ($missing.Count -eq 0) -and ($ct -match 'application/json') -and ($ps -eq 5) -and ($items.Count -le 5)) `
    "status=$($r.Status) ok=$ok 缺字段=[$($missing -join ',')] page.page=$pgNum page.pageSize=$ps page.total=$total items=$($items.Count) categories=$($cats.Count) catalog.count=$catCount" `
    $r.Body.Substring(0, [Math]::Min(1200, $r.Body.Length))

  # ---------------- §5.4 /installed ----------------
  $r = Probe '/installed'
  $j = ConvertFrom-JsonSafe $r.Body
  $ok = Get-PropOrNull $j 'ok'
  $ct = ''; if ($r.Headers.ContainsKey('Content-Type')) { $ct = $r.Headers['Content-Type'] }
  $missing = @()
  foreach ($f in @('bundles', 'plugins')) { if ($null -eq (Get-PropOrNull $j $f)) { $missing += $f } }
  $bs = Get-ArrayProp $j 'bundles'
  $pls = Get-ArrayProp $j 'plugins'
  $selfRows = @($bs | Where-Object { (Get-PropOrNull $_ 'name') -eq 'dsh-market' }).Count
  Emit 'A4c' 'GET /installed 返回 ok:true 且 bundles 含市场自身（§5.4）' "GET $BaseUrl/installed" `
    'HTTP 200；ok:true；含 bundles/plugins；bundles 里能找到 name=dsh-market' `
    (($r.Status -eq 200) -and ($ok -eq $true) -and ($missing.Count -eq 0) -and ($ct -match 'application/json') -and ($selfRows -ge 1)) `
    "status=$($r.Status) ok=$ok 缺字段=[$($missing -join ',')] bundles=$($bs.Count) 含市场自身=$selfRows plugins=$($pls.Count)" `
    $r.Body.Substring(0, [Math]::Min(1200, $r.Body.Length))

  # ---------------- §5.5 写操作来源判定 ----------------
  #
  # A5a = 本次线上缺陷的**关键回归项**：桌面壳形状（无 Origin、无 Sec-Fetch-Site、回环 + 已鉴权）。
  # 旧契约要求这里 403，正是那一版把 Electron 里的写操作全拦了；新契约要求放行。
  # 判据不只是「不是 403」：要走到业务逻辑（目录外 spec → 400 not-in-catalog），
  # 才能证明守卫确实放行、而不是被别的东西挡住。
  $desk = Probe '/install' 'POST' $null $outsideBody 60
  $deskJ = ConvertFrom-JsonSafe $desk.Body
  $deskCode = ErrField $deskJ 'code'
  Emit 'A5a' '桌面壳形状（无 Origin、无 Sec-Fetch-Site、回环、已鉴权）必须放行（§5.5 关键回归项）' `
    "POST $BaseUrl/install  # 不带 Origin / Sec-Fetch-Site，但复用已鉴权会话 cookie；body=$outsideBody" `
    '不得判为 cross-origin；必须进到业务逻辑 → HTTP 400 error.code=not-in-catalog' `
    (($desk.Status -eq 400) -and ($deskCode -eq 'not-in-catalog')) `
    "status=$($desk.Status) error.code=$deskCode（若为 403 cross-origin 即线上缺陷复现）" `
    ($desk.Body + "`n`n两层防护说明：本条在已鉴权会话上做；未鉴权时的 403 属宿主信任层，不是插件行为。`n`n" + (Cross '/install' 'POST' $null $outsideBody))

  # 带外站 Origin → 403，且 hint 必须如实带上收到的信号
  $evilOrigin = @{ 'Origin' = 'https://evil.example' }
  $r = Probe '/install' 'POST' $evilOrigin $outsideBody 60
  $j = ConvertFrom-JsonSafe $r.Body
  $hint = [string](ErrField $j 'hint')
  Emit 'A5c' '带外站 Origin（host ≠ Host）→ 403 cross-origin，且 hint 带上收到的信号（§5.5/§1）' `
    "POST $BaseUrl/install  Origin: https://evil.example  body=$outsideBody" `
    'HTTP 403；error.code=cross-origin；hint 里如实出现 Origin=https://evil.example' `
    (($r.Status -eq 403) -and ((ErrField $j 'code') -eq 'cross-origin') -and ($hint -match 'evil\.example')) `
    "status=$($r.Status) error.code=$(ErrField $j 'code') hint含Origin信号=$($hint -match 'evil\.example') hint=$hint" `
    ($r.Body + "`n`n" + (Cross '/install' 'POST' $evilOrigin $outsideBody))

  # Sec-Fetch-Site: cross-site → 403
  $crossSite = @{ 'Sec-Fetch-Site' = 'cross-site' }
  $r = Probe '/install' 'POST' $crossSite $outsideBody 60
  $j = ConvertFrom-JsonSafe $r.Body
  Emit 'A5d' 'Sec-Fetch-Site: cross-site → 403 cross-origin（§5.5）' `
    "POST $BaseUrl/install  Sec-Fetch-Site: cross-site  body=$outsideBody" `
    'HTTP 403；error.code=cross-origin' `
    (($r.Status -eq 403) -and ((ErrField $j 'code') -eq 'cross-origin')) `
    "status=$($r.Status) error.code=$(ErrField $j 'code')" `
    ($r.Body + "`n`n" + (Cross '/install' 'POST' $crossSite $outsideBody))

  # 同源 Origin → 放行（走到业务逻辑）
  $r = Probe '/install' 'POST' $sameOrigin $outsideBody 60
  $j = ConvertFrom-JsonSafe $r.Body
  Emit 'A5e' '带同源 Origin（host = Host）→ 放行到业务逻辑（§5.5）' `
    "POST $BaseUrl/install  Origin=http://127.0.0.1:$Port  body=$outsideBody" `
    '不得判为 cross-origin；必须走到 HTTP 400 error.code=not-in-catalog' `
    (($r.Status -eq 400) -and ((ErrField $j 'code') -eq 'not-in-catalog')) `
    "status=$($r.Status) error.code=$(ErrField $j 'code')" `
    ($r.Body + "`n`n" + (Cross '/install' 'POST' $sameOrigin $outsideBody))

  # 同站不同端口 → 拒绝（Origin 的 host 含端口，必须与 Host 完全一致）
  $diffPort = @{ 'Origin' = 'http://127.0.0.1:3000' }
  $r = Probe '/install' 'POST' $diffPort $outsideBody 60
  $j = ConvertFrom-JsonSafe $r.Body
  Emit 'A5f' '同站不同端口 Origin（Host 不一致）→ 403 cross-origin（§5.5）' `
    "POST $BaseUrl/install  Origin: http://127.0.0.1:3000  body=$outsideBody" `
    'HTTP 403；error.code=cross-origin' `
    (($r.Status -eq 403) -and ((ErrField $j 'code') -eq 'cross-origin')) `
    "status=$($r.Status) error.code=$(ErrField $j 'code')" $r.Body

  # A5g 诊断：不带会话 cookie 的写请求 —— 只允许「空 body 403」形态（= 宿主信任层）
  $noCookie = Probe '/install' 'POST' $null $outsideBody 60 -NoCookie
  $isHostLayer403 = (($noCookie.Status -eq 403) -and ([string]::IsNullOrWhiteSpace($noCookie.Body)))
  $noCookieOk = (($noCookie.Status -ne 403) -or $isHostLayer403)
  Emit 'A5g' '未鉴权写请求只允许出现「空 body 403」形态（= 宿主信任层，不是插件）' `
    "POST $BaseUrl/install  # 不带会话 cookie、不带 Origin；body=$outsideBody" `
    '要么非 403（宿主信任层未拦），要么是 403 且 body 为空；若出现插件形状的 JSON 403，说明插件在收无 cookie 请求，需重新定性' `
    $noCookieOk `
    "status=$($noCookie.Status) body长度=$($noCookie.Body.Length) 属宿主信任层=$isHostLayer403 body前80字=$(if($noCookie.Body){$noCookie.Body.Substring(0,[Math]::Min(80,$noCookie.Body.Length))}else{'<空>'})" `
    ("本条是测量前提的诊断：不区分两层，就会把宿主的 403 当成插件的结果。`nbody=$($noCookie.Body)")

  # GET 到 POST 路由 → 405 + Allow
  $r = Probe '/install' 'GET' $null $null 40
  $j = ConvertFrom-JsonSafe $r.Body
  $allow = ''
  if ($r.Headers.ContainsKey('Allow')) { $allow = $r.Headers['Allow'] }
  Emit 'A5b' 'GET 到 POST 路由 /install → 405 method-not-allowed 且带 Allow: POST（§5.5）' "GET $BaseUrl/install" `
    'HTTP 405；error.code=method-not-allowed；响应头 Allow 含 POST' `
    (($r.Status -eq 405) -and ((ErrField $j 'code') -eq 'method-not-allowed') -and ($allow -match 'POST')) `
    "status=$($r.Status) error.code=$(ErrField $j 'code') Allow=$allow" `
    ($r.Body + "`n`n" + (Cross '/install' 'GET'))

  # ---------------- §5.6 目录外 spec ----------------
  $r = Probe '/install' 'POST' $sameOrigin $outsideBody 60
  $j = ConvertFrom-JsonSafe $r.Body
  Emit 'A6' 'POST /install 用目录外 spec → 400 not-in-catalog（§5.6）' `
    "POST $BaseUrl/install  Origin=http://127.0.0.1:$Port  body=$outsideBody" `
    'HTTP 400；error.code=not-in-catalog（安全约束：只允许装目录内插件）' `
    (($r.Status -eq 400) -and ((ErrField $j 'code') -eq 'not-in-catalog')) `
    "status=$($r.Status) error.code=$(ErrField $j 'code') message=$(ErrField $j 'message') hint=$(ErrField $j 'hint')" `
    ($r.Body + "`n`n" + (Cross '/install' 'POST' $sameOrigin $outsideBody))

  # ---------------- §5.7 卸载自身 ----------------
  $r = Probe '/remove' 'POST' $sameOrigin $selfBody 60
  $j = ConvertFrom-JsonSafe $r.Body
  Emit 'A7' 'POST /remove 卸载自身 → 400 not-allowed（§5.7）' `
    "POST $BaseUrl/remove  Origin=http://127.0.0.1:$Port  body=$selfBody" `
    'HTTP 400；error.code=not-allowed；message 给出终端替代命令' `
    (($r.Status -eq 400) -and ((ErrField $j 'code') -eq 'not-allowed')) `
    "status=$($r.Status) error.code=$(ErrField $j 'code') message=$(ErrField $j 'message')" `
    ($r.Body + "`n`n" + (Cross '/remove' 'POST' $sameOrigin $selfBody))

  # ---------------- §5.8 目录缓存 ----------------
  $r1 = Probe '/catalog' 'GET' $null $null $CatalogTimeoutSec
  $j1 = ConvertFrom-JsonSafe $r1.Body
  $fa1 = Get-PropOrNull (Get-PropOrNull $j1 'catalog') 'fetchedAt'
  Start-Sleep -Seconds 2
  $r2 = Probe '/catalog' 'GET' $null $null $CatalogTimeoutSec
  $j2 = ConvertFrom-JsonSafe $r2.Body
  $fa2 = Get-PropOrNull (Get-PropOrNull $j2 'catalog') 'fetchedAt'
  Emit 'A8a' '连续两次 GET /catalog 的 catalog.fetchedAt 不变（缓存命中，§5.8）' `
    "GET $BaseUrl/catalog ; Start-Sleep 2 ; GET $BaseUrl/catalog" `
    '两次 catalog.fetchedAt 相同且非空（TTL 10 分钟内不应重新抓取）' `
    (($fa1 -eq $fa2) -and (-not [string]::IsNullOrEmpty($fa1))) `
    "status#1=$($r1.Status) fetchedAt#1=$fa1 ; status#2=$($r2.Status) fetchedAt#2=$fa2" `
    $r1.Body.Substring(0, [Math]::Min(500, $r1.Body.Length))

  $rf = Probe '/refresh' 'POST' $sameOrigin $null 90
  $jf = ConvertFrom-JsonSafe $rf.Body
  $fa3 = Get-PropOrNull $jf 'fetchedAt'
  $rfok = Get-PropOrNull $jf 'ok'
  # 语义上「refresh 后变化」必须与刷新前**紧邻**的那次取值比较（fa2），不是最早那次（fa1）。
  # selfcheck 用「refresh 回吐紧邻上一次 fetchedAt」的 stub 抓出了这个断言原先的假阳性。
  Emit 'A8b' 'POST /refresh 后 fetchedAt 变化（§5.8）' `
    "POST $BaseUrl/refresh  Origin=http://127.0.0.1:$Port" `
    'HTTP 200；ok:true；fetchedAt 与刷新前紧邻一次（fa2）不同且非空' `
    (($rf.Status -eq 200) -and ($rfok -eq $true) -and ($fa3 -ne $fa2) -and (-not [string]::IsNullOrEmpty($fa3))) `
    "status=$($rf.Status) ok=$rfok fetchedAt#3=$fa3（刷新前紧邻 fa2=$fa2，更早 fa1=$fa1）" `
    $rf.Body.Substring(0, [Math]::Min(500, $rf.Body.Length))

  if (-not $IncludeExtras) { return }

  # ---------------- 额外：同源两条放行路径 ----------------
  $onlyOrigin = New-SameOriginHeaders -Port $Port -OnlyOrigin
  $r = Probe '/install' 'POST' $onlyOrigin $outsideBody 60
  $j = ConvertFrom-JsonSafe $r.Body
  Emit 'A14a' '同源放行路径：只给 Origin（host 与 Host 一致）不应判 cross-origin（额外）' `
    "POST $BaseUrl/install  headers=$(@($onlyOrigin.Keys) -join ',')  body=$outsideBody" `
    '不返回 403 cross-origin；应继续走到 400 not-in-catalog' `
    ((ErrField $j 'code') -ne 'cross-origin') `
    "status=$($r.Status) error.code=$(ErrField $j 'code')" $r.Body

  $onlySec = New-SameOriginHeaders -Port $Port -OnlySecFetch
  $r = Probe '/install' 'POST' $onlySec $outsideBody 60
  $j = ConvertFrom-JsonSafe $r.Body
  Emit 'A14b' '同源放行路径：只给 Sec-Fetch-Site: same-origin 不应判 cross-origin（额外）' `
    "POST $BaseUrl/install  headers=$(@($onlySec.Keys) -join ',')  body=$outsideBody" `
    '不返回 403 cross-origin；应继续走到 400 not-in-catalog' `
    ((ErrField $j 'code') -ne 'cross-origin') `
    "status=$($r.Status) error.code=$(ErrField $j 'code')" $r.Body

  # ---------------- 额外：未知子路径 ----------------
  $r = Probe '/definitely-not-a-route' 'GET' $null $null 30
  $j = ConvertFrom-JsonSafe $r.Body
  Emit 'A12' '未知子路径 → 404 not-found（契约 §1，额外）' "GET $BaseUrl/definitely-not-a-route" `
    'HTTP 404；error.code=not-found' `
    (($r.Status -eq 404) -and ((ErrField $j 'code') -eq 'not-found')) `
    "status=$($r.Status) error.code=$(ErrField $j 'code')" `
    ($r.Body + "`n`n" + (Cross '/definitely-not-a-route' 'GET'))

  # ---------------- 额外：请求体上限 64 KiB ----------------
  $huge = '{"name":"' + ('x' * 70000) + '"}'
  $r = Probe '/install' 'POST' $sameOrigin $huge 60
  $j = ConvertFrom-JsonSafe $r.Body
  Emit 'A13' 'POST 请求体 > 64 KiB → 400 bad-request（契约 §1，额外）' `
    "POST $BaseUrl/install  70000 字节 name 字段" `
    'HTTP 400；error.code=bad-request' `
    (($r.Status -eq 400) -and ((ErrField $j 'code') -eq 'bad-request')) `
    "status=$($r.Status) error.code=$(ErrField $j 'code')" `
    $r.Body.Substring(0, [Math]::Min(300, $r.Body.Length))

  # ---------------- 额外：非 JSON Content-Type ----------------
  $formBody = 'name=dsh-market&enabled=false'
  $r = Probe '/toggle' 'POST' $sameOrigin $formBody 60 'application/x-www-form-urlencoded'
  $j = ConvertFrom-JsonSafe $r.Body
  $code = ErrField $j 'code'
  Emit 'A15' 'POST 用非 JSON Content-Type（application/x-www-form-urlencoded）→ 400 bad-request（契约 §1，额外）' `
    "POST $BaseUrl/toggle  Content-Type: application/x-www-form-urlencoded  Origin=http://127.0.0.1:$Port  body=$formBody" `
    'HTTP 400；error.code=bad-request（同源已放行，所以失败原因必须是 Content-Type）' `
    (($r.Status -eq 400) -and ($code -eq 'bad-request')) `
    "status=$($r.Status) error.code=$code" `
    ($r.Body + "`n`n" + (Cross '/toggle' 'POST' $sameOrigin $formBody 'application/x-www-form-urlencoded'))
}
