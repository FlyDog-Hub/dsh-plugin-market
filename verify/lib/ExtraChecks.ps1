# Lead 指定的额外断言（E 系列）。
#
# 与 lib\MarketChecks.ps1 分开的原因：这些断言依赖「受控目录 fixture」或「真实网络」这类
# 环境条件，跟 §5 的纯路由断言不是一回事，分开才能各自说明证据强度。
#
# 动态作用域纪律同 BootChecks：参数名不用 `$Evidence`，也不在参数里放叫 `$evidence` 的名字。

# ---------------------------------------------------------------- E1 profile 安装产物
function Invoke-ProfileArtifactChecks {
  param(
    [Parameter(Mandatory)][string]$ProfileDir,
    [Parameter(Mandatory)][string]$InstallCmd,
    [Parameter(Mandatory)][string]$PackageName,
    [Parameter(Mandatory)][scriptblock]$Collect
  )
  function EmitE($Id, $Title, $Command, $Expected, [bool]$Pass, $Actual, $EvidenceText) {
    $null = & $Collect @{ Id = $Id; Title = $Title; Command = $Command; Expected = $Expected; Pass = $Pass; Actual = $Actual; Evidence = $EvidenceText }
  }

  $pkg = ConvertFrom-JsonSafe (Read-FileShared (Join-Path $ProfileDir 'package.json'))
  $bundles = @(Get-PropOrNull (Get-PropOrNull (Get-PropOrNull $pkg 'dsh') 'profile') 'bundles')
  $patchPath = Join-Path $ProfileDir ("node_modules\$PackageName\cordis.patch.yml")
  $patchExists = Test-Path $patchPath
  $patchBody = ''
  if ($patchExists) { $patchBody = Read-FileShared $patchPath }

  EmitE 'E1' 'scratch profile 的 dsh.profile.bundles 含被测包，且 node_modules 内有 cordis.patch.yml' `
    "Get-Content `"$ProfileDir\package.json`" -Raw`nTest-Path `"$patchPath`"" `
    "bundles 含 $PackageName；node_modules\$PackageName\cordis.patch.yml 存在且非空" `
    (($bundles -contains $PackageName) -and $patchExists -and (-not [string]::IsNullOrWhiteSpace($patchBody))) `
    "bundles=[$($bundles -join ', ')]；cordis.patch.yml 存在=$patchExists；长度=$($patchBody.Length)" `
    ("安装命令: $InstallCmd`n--- cordis.patch.yml ---`n" + $patchBody)
}

# ---------------------------------------------------------------- E4 冷启动
# 证据强度说明：这里不是「推断没抓取」，而是把 DSHM_REGISTRY_URL 指向带计数器的 fixture，
# 直接用 /__count 读真实请求次数。冷启动后必须为 0；抓一次目录后必须 +1。
function Invoke-ColdStartChecks {
  param(
    [Parameter(Mandatory)][string]$BaseUrl,
    [Parameter(Mandatory)][string]$FixtureCountUrl,
    [Parameter(Mandatory)][scriptblock]$Collect
  )
  function EmitE($Id, $Title, $Command, $Expected, [bool]$Pass, $Actual, $EvidenceText) {
    $null = & $Collect @{ Id = $Id; Title = $Title; Command = $Command; Expected = $Expected; Pass = $Pass; Actual = $Actual; Evidence = $EvidenceText }
  }

  # 先把计数器归零，再读 /status，再读计数：归零与读取之间除了 /status 没有别的请求
  $reset = Invoke-HttpProbe -Uri $FixtureCountUrl.Replace('/__count', '/__reset')
  $st = Invoke-HttpProbe -Uri "$BaseUrl/status"
  $cntProbe = Invoke-HttpProbe -Uri $FixtureCountUrl
  $cntAfterStatus = -1
  $cj = ConvertFrom-JsonSafe $cntProbe.Body
  $v = Get-PropOrNull $cj 'count'
  if ($null -ne $v) { $cntAfterStatus = [int]$v }

  $sj = ConvertFrom-JsonSafe $st.Body
  $mgrAvail = Get-PropOrNull (Get-PropOrNull $sj 'manager') 'available'
  $catVal = Get-PropOrNull $sj 'catalog'
  $catIsNull = ($null -eq $catVal)

  EmitE 'E4' '冷启动 /status：manager.available=true、catalog=null、且未触发目录抓取（真实计数）' `
    "GET $($FixtureCountUrl.Replace('/__count','/__reset'))`nGET $BaseUrl/status`nGET $FixtureCountUrl" `
    'status=200；ok:true；manager.available=true；catalog 为 null；期间 fixture 请求计数 +0' `
    (($st.Status -eq 200) -and ((Get-PropOrNull $sj 'ok') -eq $true) -and ($mgrAvail -eq $true) -and $catIsNull -and ($cntAfterStatus -eq 0)) `
    "status=$($st.Status) ok=$(Get-PropOrNull $sj 'ok') manager.available=$mgrAvail catalog=$(if($catIsNull){'null'}else{'非 null'}) fixture请求数=$cntAfterStatus（期望 0）" `
    ("reset 响应: " + $reset.Body + "`n/status 响应: " + $st.Body.Substring(0, [Math]::Min(600, $st.Body.Length)) + "`n__count 响应: " + $cntProbe.Body)
}

# ---------------------------------------------------------------- E5 目录内容
# 同一个函数被调用两次，用不同 Id/Label 区分证据强度：
#   E5        → 真实网络源 https://awesome-dsh-plugin.com/plugins.json
#   E5-local  → 本地 fixture 直接吐未改动的 _ref/data/plugins.json 快照（4412 条，不注入）
# 这样即使公网路径不通，也能证明「目录解析/分页/字段映射」对真实 4412 条负载是对的。
function Invoke-CatalogContentChecks {
  param(
    [Parameter(Mandatory)][string]$BaseUrl,
    [string]$Id = 'E5',
    [string]$Label = '真实网络目录源',
    [int]$ExpectedCount = 4412,
    [int]$Tolerance = 50,
    [int]$TimeoutSec = 90,
    [Parameter(Mandatory)][scriptblock]$Collect
  )
  function EmitE($Id2, $Title, $Command, $Expected, [bool]$Pass, $Actual, $EvidenceText) {
    $null = & $Collect @{ Id = $Id2; Title = $Title; Command = $Command; Expected = $Expected; Pass = $Pass; Actual = $Actual; Evidence = $EvidenceText }
  }

  $r = Invoke-HttpProbe -Uri "$BaseUrl/catalog" -TimeoutSec $TimeoutSec
  $j = ConvertFrom-JsonSafe $r.Body
  $cat = Get-PropOrNull $j 'catalog'
  $count = Get-PropOrNull $cat 'count'
  $cats = Get-ArrayProp $j 'categories'
  $items = Get-ArrayProp $j 'items'
  $source = Get-PropOrNull $cat 'source'
  $upd2 = Get-PropOrNull $cat 'updated'
  $stale = Get-PropOrNull $cat 'stale'
  $fetchedAt = Get-PropOrNull $cat 'fetchedAt'

  $countOk = $false
  if ($null -ne $count) { $countOk = ([Math]::Abs([int]$count - $ExpectedCount) -le $Tolerance) }
  $catOk = ($cats.Count -gt 0)
  # catalog 对象本身也要字段齐全（契约 §2.2）
  $catFieldsMissing = @()
  foreach ($f in @('count', 'updated', 'fetchedAt', 'source', 'stale')) { if (-not (Test-PropExists $cat $f)) { $catFieldsMissing += $f } }

  $itemFieldReport = @()
  $itemOk = $false
  if ($items.Count -gt 0) {
    $i0 = $items[0]
    $desc = Get-PropOrNull $i0 'description'
    $required = @('id', 'name', 'owner', 'spec', 'stars', 'downloads', 'installed', 'updateAvailable')
    $miss = @()
    foreach ($f in $required) { if (-not (Test-PropExists $i0 $f)) { $miss += $f } }
    $zh = Get-PropOrNull $desc 'zh'
    $en = Get-PropOrNull $desc 'en'
    $itemOk = ($miss.Count -eq 0) -and (-not [string]::IsNullOrEmpty($zh)) -and (-not [string]::IsNullOrEmpty($en))
    $itemFieldReport = @("items[0]: id=$(Get-PropOrNull $i0 'id') name=$(Get-PropOrNull $i0 'name') owner=$(Get-PropOrNull $i0 'owner') spec=$(Get-PropOrNull $i0 'spec') stars=$(Get-PropOrNull $i0 'stars') downloads=$(Get-PropOrNull $i0 'downloads') installed=$(Get-PropOrNull $i0 'installed') updateAvailable=$(Get-PropOrNull $i0 'updateAvailable') description.zh 长度=$(([string]$zh).Length) description.en 长度=$(([string]$en).Length) 缺字段=[$($miss -join ',')]")
  } else {
    $itemFieldReport = @('items 为空，无法校验 items[0] 字段')
  }

  EmitE $Id "$Label：count≈$ExpectedCount（±$Tolerance）、categories 非空、items[0] 与 catalog 字段齐全" `
    "GET $BaseUrl/catalog" `
    "HTTP 200；ok:true；catalog.count 在 $ExpectedCount±$Tolerance；catalog 含 count/updated/fetchedAt/source/stale；categories 非空；items[0] 含 id/name/owner/spec/description.zh/description.en/stars/downloads/installed/updateAvailable" `
    (($r.Status -eq 200) -and ((Get-PropOrNull $j 'ok') -eq $true) -and $countOk -and $catOk -and $itemOk -and ($catFieldsMissing.Count -eq 0)) `
    "status=$($r.Status) ok=$(Get-PropOrNull $j 'ok') catalog.count=$count（期望 $ExpectedCount±$Tolerance）catalog 缺字段=[$($catFieldsMissing -join ',')] source=$source updated=$upd2 stale=$stale fetchedAt=$fetchedAt categories=$($cats.Count) items=$($items.Count)" `
    (($itemFieldReport -join "`n") + "`n`n原始响应前 1200 字：`n" + $r.Body.Substring(0, [Math]::Min(1200, $r.Body.Length)))
}

# ---------------------------------------------------------------- E8 updateAvailable 语义
function Invoke-UpdateSemanticsChecks {
  param(
    [Parameter(Mandatory)][string]$BaseUrl,
    [Parameter(Mandatory)][string]$NpmName,                 # 被对照的已装包 npm 名
    [Parameter(Mandatory)][string]$CatalogVersion,          # fixture 注入的目录版本
    [Parameter(Mandatory)][bool]$ExpectUpdateAvailable,
    [Parameter(Mandatory)][scriptblock]$Collect
  )
  function EmitE($Id, $Title, $Command, $Expected, [bool]$Pass, $Actual, $EvidenceText) {
    $null = & $Collect @{ Id = $Id; Title = $Title; Command = $Command; Expected = $Expected; Pass = $Pass; Actual = $Actual; Evidence = $EvidenceText }
  }

  $r = Invoke-HttpProbe -Uri "$BaseUrl/installed" -TimeoutSec 60
  $j = ConvertFrom-JsonSafe $r.Body
  $bundles = Get-ArrayProp $j 'bundles'

  $target = $null
  foreach ($b in $bundles) {
    if ((Get-PropOrNull $b 'name') -eq $NpmName) { $target = $b; break }
  }
  $instVer = Get-PropOrNull $target 'version'
  $latest = Get-PropOrNull $target 'latest'
  $upd = Get-PropOrNull $target 'updateAvailable'

  $wantText = 'false'
  if ($ExpectUpdateAvailable) { $wantText = 'true' }
  $semanticsOk = ($null -ne $target) -and ($upd -eq $ExpectUpdateAvailable) -and ($latest -eq $CatalogVersion)

  EmitE "E8-$(if($ExpectUpdateAvailable){'high'}else{'low'})" `
    "updateAvailable 语义：目录版本 $CatalogVersion vs 已装 $NpmName → 期望 updateAvailable=$wantText" `
    "GET $BaseUrl/installed  →  bundles[] 中 name=$NpmName" `
    "该 bundle 的 latest=$CatalogVersion，updateAvailable=$wantText" `
    $semanticsOk `
    "找到=$($null -ne $target) 已装版本=$instVer latest=$latest updateAvailable=$upd（期望 $wantText）" `
    $r.Body.Substring(0, [Math]::Min(1600, $r.Body.Length))

  # /installed 里 market:true 的那条必须是 dsh-market
  $marketRows = @($bundles | Where-Object { (Get-PropOrNull $_ 'market') -eq $true })
  $marketName = ''
  if ($marketRows.Count -ge 1) { $marketName = [string](Get-PropOrNull $marketRows[0] 'name') }
  EmitE 'E8-market' '/installed 里 market:true 的那条就是 dsh-market' `
    "GET $BaseUrl/installed  →  bundles[] 中筛选 market === true" `
    '恰好 1 条 market:true，且其 name === dsh-market' `
    (($marketRows.Count -eq 1) -and ($marketName -eq 'dsh-market')) `
    "market:true 条数=$($marketRows.Count) name=$marketName" `
    (($bundles | ForEach-Object { "name=$(Get-PropOrNull $_ 'name') market=$(Get-PropOrNull $_ 'market') official=$(Get-PropOrNull $_ 'official') installed=$(Get-PropOrNull $_ 'installed')" }) -join "`n")
}
