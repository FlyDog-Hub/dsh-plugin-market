# Re-save files as UTF-8 WITH BOM, then verify they parse under PowerShell 5.1.
# ASCII-only on purpose: this helper must itself be safe before any BOM is applied.
param(
  [Parameter(Mandatory)][string[]]$Paths
)
$ErrorActionPreference = 'Stop'
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
foreach ($p in $Paths) {
  $full = (Resolve-Path -LiteralPath $p).Path
  $text = [System.IO.File]::ReadAllText($full)
  # Normalize to CRLF as well: with LF-only endings a GBK-misdecoded Chinese char can
  # swallow the LF and merge the next line into a comment. BOM fixes the decode, CRLF
  # removes the second half of the failure mode.
  $text = $text -replace "`r`n", "`n"
  $text = $text -replace "`r", "`n"
  $text = $text -replace "`n", "`r`n"
  [System.IO.File]::WriteAllText($full, $text, $utf8Bom)
  $bytes = [System.IO.File]::ReadAllBytes($full)
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  $tokens = $null
  $errors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile($full, [ref]$tokens, [ref]$errors)
  $state = 'OK'
  if (-not $hasBom) { $state = 'NO-BOM' }
  if ($errors -and $errors.Count -gt 0) { $state = "PARSE-ERRORS=$($errors.Count)" }
  Write-Host ("{0}  bom={1}  {2}" -f $state, $hasBom, $full)
  if ($errors -and $errors.Count -gt 0) {
    foreach ($e in $errors) {
      Write-Host ("    line {0} col {1}: {2}" -f $e.Extent.StartLineNumber, $e.Extent.StartColumnNumber, $e.Message)
    }
    exit 1
  }
}
