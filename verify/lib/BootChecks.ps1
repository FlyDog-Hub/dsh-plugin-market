# boot 图相关断言（§5.2 / §5.3）—— 抽成独立模块，selfcheck 才能喂「好图 / 坏图」两个方向。
#
# 实测要点（0.2.0-rc.2）：
#  * 真机是 `globalThis["__DSH_BOOT__"]`；契约 §5.2 写的 `window.__DSH_BOOT__` 两种都认。
#  * entry.url 是文档相对形式 `plugins/??<id>/client.js&rev=<rev>`（无前导 /），
#    契约 §5.2 写的是 `/plugins/...`。断言两种都接受，并在 REPORT 里记录该偏差。
#  * url 里的 rev 与本次 boot 绑定；跨次复用旧 rev 会 404，所以必须现取现用。
#  * 该 URL 不需要 token（鉴权栅栏只拦文档与非 /plugins 的 API）；给它加 &token= 反而会 404，
#    因为该路由按 pathname+search 精确查表。
#
# 注意（PowerShell 动态作用域坑）：参数名绝不要用 `$Evidence`。
# 调用方的收集器脚本块里若引用 `$evidence`，会被本函数同名参数遮蔽（变量名大小写不敏感），
# 于是「证据文件路径」变成断言文本 —— 上一版就是这样把验收整个打断的。

function Invoke-BootGraphChecks {
  param(
    [Parameter(Mandatory)]$BootGraph,          # Get-BootGraph 的返回对象
    [Parameter(Mandatory)][string]$Origin,     # 例如 http://127.0.0.1:1234
    [string]$AssertId = 'deepseek-harness-market',
    [Parameter(Mandatory)][scriptblock]$Collect
  )

  function EmitBoot($Id, $Title, $Command, $Expected, [bool]$Pass, $Actual, $EvidenceText) {
    $null = & $Collect @{ Id = $Id; Title = $Title; Command = $Command; Expected = $Expected; Pass = $Pass; Actual = $Actual; Evidence = $EvidenceText }
  }

  $boot = Get-PropOrNull $BootGraph 'Boot'
  $shape = Get-PropOrNull $BootGraph 'Shape'
  $status = Get-PropOrNull $BootGraph 'Status'
  $html = Get-PropOrNull $BootGraph 'Html'
  $htmlLen = 0
  if ($html) { $htmlLen = $html.Length }
  $entries = @()
  $batchCount = 0
  if ($null -ne $boot) {
    $entries = @(Get-PropOrNull $boot 'entries')
    $batchCount = @(Get-PropOrNull $boot 'batches').Count
  }

  # ---- §5.2 boot 图里存在 id === AssertId 的 entry ----
  $entry = Get-BootEntry $boot $AssertId
  $entryUrl = Get-PropOrNull $entry 'url'
  $entryRev = Get-PropOrNull $entry 'rev'
  $urlPattern = '^/?plugins/\?\?' + [regex]::Escape($AssertId) + '/client\.js&rev=.+$'
  $a2pass = ($null -ne $entry) -and ($entryUrl -match $urlPattern)
  EmitBoot 'A2' "首页 __DSH_BOOT__ 含 id=$AssertId 的 entry（§5.2）" `
    "GET <启动日志里的鉴权 URL>  →  解析 $shape  →  entries[] 中找 id === '$AssertId'" `
    "存在该 entry；url 形如 plugins/??$AssertId/client.js&rev=…（契约写绝对 /plugins/…，实测为文档相对，两种都接受）" `
    $a2pass `
    "httpStatus=$status htmlLen=$htmlLen shape=$shape entries=$($entries.Count) batches=$batchCount entry=$(if($null -ne $entry){'found'}else{'MISSING'}) url=$(if($entryUrl){$entryUrl}else{'<null>'}) rev=$(if($entryRev){$entryRev}else{'<null>'})" `
    "boot shape=$shape；entries 总数=$($entries.Count)；batches 总数=$batchCount"

  # ---- §5.3 该 URL 返回 JS 且含 __ModuleLoader__.load 与 id ----
  $bundleUrl = ''
  if ($entryUrl) { $bundleUrl = "$Origin/" + ($entryUrl -replace '^/', '') }

  $a3pass = $false
  $a3actual = 'entry url 缺失，无法抓取（依赖 A2 已找到 entry）'
  $a3ev = ''
  $text = ''
  $bytes = $null
  if ($bundleUrl) {
    $b = Invoke-HttpBytes -Uri $bundleUrl -TimeoutSec 30
    $text = $b.Text
    $bytes = $b.Bytes
    $byteLen = 0
    if ($null -ne $bytes) { $byteLen = $bytes.Length }
    $hasLoader = $text -match '__ModuleLoader__\s*\.\s*load'
    $idPattern = 'id\s*:\s*["'']' + [regex]::Escape($AssertId) + '["'']'
    $hasId = $text -match $idPattern
    $a3pass = ($b.Status -eq 200) -and $hasLoader -and $hasId -and ($byteLen -gt 0)
    $a3actual = "status=$($b.Status) bytes=$byteLen hasModuleLoaderLoad=$hasLoader hasId=$hasId"
    $a3ev = $text.Substring(0, [Math]::Min(400, $text.Length))
    EmitBoot 'A3' "client bundle URL 返回 JS 且含 __ModuleLoader__.load 与 id:`"$AssertId`"（§5.3）" `
      "GET $bundleUrl" `
      ("HTTP 200；正文含 __ModuleLoader__.load 且含 id:`"" + $AssertId + "`"") `
      $a3pass $a3actual $a3ev
  } else {
    EmitBoot 'A3' "client bundle URL 返回 JS 且含 __ModuleLoader__.load 与 id:`"$AssertId`"（§5.3）" `
      'GET <boot 图里 entry.url 的绝对化形式>' `
      ("HTTP 200；正文含 __ModuleLoader__.load 且含 id:`"" + $AssertId + "`"") `
      $a3pass $a3actual ''
  }

  # ---- 额外：bundle 按 UTF-8 解码后中文不变乱码 ----
  # 依据：客户端脚本的编码跟随文档编码，中文若被按 latin1/GBK 写回就会变乱码。
  # 这里拿原始字节自行 UTF-8 解码，断言含「插件市场」，并顺带报出替换字符 U+FFFD 的个数。
  $a3bPass = $false
  $a3bActual = 'bundle 未取到，无法判断编码'
  if ($bundleUrl -and $null -ne $bytes -and $bytes.Length -gt 0) {
    $decoded = $text
    $replacementCount = @([regex]::Matches($decoded, [string][char]0xFFFD)).Count
    $hasMarketZh = $decoded.Contains('插件市场')
    $a3bPass = $hasMarketZh -and ($replacementCount -eq 0)
    $a3bActual = "utf8DecodedBytes=$($bytes.Length) contains插件市场=$hasMarketZh U+FFFD个数=$replacementCount"
    EmitBoot 'A3b' 'served client bundle 按 UTF-8 解码后中文完整（含「插件市场」，无 U+FFFD）' `
      "GET $bundleUrl  →  [System.Text.Encoding]::UTF8.GetString(原始字节)  →  搜索「插件市场」" `
      '解码后包含「插件市场」；且不含替换字符 U+FFFD（中文未变乱码）' `
      $a3bPass $a3bActual ("解码后前 300 字：`n" + $decoded.Substring(0, [Math]::Min(300, $decoded.Length)))
  } else {
    EmitBoot 'A3b' 'served client bundle 按 UTF-8 解码后中文完整（含「插件市场」，无 U+FFFD）' `
      "GET $bundleUrl  →  UTF-8 解码" `
      '解码后包含「插件市场」；且不含替换字符 U+FFFD' `
      $a3bPass $a3bActual ''
  }
}
