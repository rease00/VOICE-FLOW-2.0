$ErrorActionPreference = 'Stop'

$logDir = 'docs/audits/artifacts/2026-02-28-deep-audit-run'
$stdoutLog = Join-Path $logDir 'auth-enforced-backend-stdout.log'
$stderrLog = Join-Path $logDir 'auth-enforced-backend-stderr.log'
$resultPath = Join-Path $logDir 'auth-enforced-probe-results.json'
$payloadPath = Join-Path $logDir 'auth-enforced-tts-payload.json'

$cmdArgs = '/c set VF_AUTH_ENFORCE=1&&set VF_BACKEND_PORT=7900&&set VF_BACKEND_HOST=127.0.0.1&&python app.py'
$proc = Start-Process -FilePath cmd.exe -ArgumentList $cmdArgs -WorkingDirectory 'backend' -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $code = curl.exe -sS -o NUL -w "%{http_code}" http://127.0.0.1:7900/health
    if ($code -eq '200' -or $code -eq '401' -or $code -eq '403') {
      $ready = $true
      break
    }
  } catch {
    # wait and retry
  }
}

if (-not $ready) {
  if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
  throw 'AUTH_ENFORCE_BACKEND_START_FAILED'
}

function Probe {
  param(
    [string]$Name,
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers,
    [string]$PayloadFile
  )

  $tmp = New-TemporaryFile
  $args = @('-sS', '-o', $tmp.FullName, '-w', '%{http_code}', '-X', $Method, $Url)

  if ($Headers) {
    foreach ($k in $Headers.Keys) {
      $args += @('-H', "${k}: $($Headers[$k])")
    }
  }
  if ($PayloadFile) {
    $args += @('-H', 'Content-Type: application/json', '--data-binary', "@$PayloadFile")
  }

  $statusText = (& curl.exe @args)
  $status = -1
  if ($statusText -match '^\d{3}$') {
    $status = [int]$statusText
  }

  $body = Get-Content $tmp.FullName -Raw
  Remove-Item $tmp.FullName -Force -ErrorAction SilentlyContinue
  $snippet = ($body -replace '\s+', ' ')
  if ($snippet.Length -gt 180) {
    $snippet = $snippet.Substring(0, 180)
  }

  [pscustomobject]@{
    name = $Name
    status = $status
    snippet = $snippet
  }
}

Set-Content -Path $payloadPath -Value '{"engine":"GEM","text":"auth-enforced check"}' -NoNewline -Encoding UTF8

$base = 'http://127.0.0.1:7900'
$rows = @()
$rows += Probe -Name 'health_noauth' -Method 'GET' -Url "$base/health" -Headers @{} -PayloadFile ''
$rows += Probe -Name 'entitlements_noauth' -Method 'GET' -Url "$base/account/entitlements" -Headers @{} -PayloadFile ''
$rows += Probe -Name 'tts_noauth' -Method 'POST' -Url "$base/tts/synthesize" -Headers @{} -PayloadFile $payloadPath
$rows += Probe -Name 'admin_users_noauth' -Method 'GET' -Url "$base/admin/users" -Headers @{} -PayloadFile ''
$rows += Probe -Name 'entitlements_devuid' -Method 'GET' -Url "$base/account/entitlements" -Headers @{ 'x-dev-uid' = 'audit_user' } -PayloadFile ''
$rows += Probe -Name 'admin_users_devuid_admin' -Method 'GET' -Url "$base/admin/users" -Headers @{ 'x-dev-uid' = 'local_admin_unlimited' } -PayloadFile ''
$rows += Probe -Name 'entitlements_bad_bearer' -Method 'GET' -Url "$base/account/entitlements" -Headers @{ 'Authorization' = 'Bearer invalid_token' } -PayloadFile ''
$rows += Probe -Name 'admin_users_bad_bearer' -Method 'GET' -Url "$base/admin/users" -Headers @{ 'Authorization' = 'Bearer invalid_token' } -PayloadFile ''

$rows | ConvertTo-Json -Depth 5 | Out-File -FilePath $resultPath -Encoding utf8

$pids = netstat -ano | Select-String ':7900' | ForEach-Object { ($_ -split '\s+')[-1] } | Where-Object { $_ -match '^\d+$' } | Sort-Object -Unique
foreach ($pid in $pids) {
  try {
    Stop-Process -Id ([int]$pid) -Force -ErrorAction Stop
  } catch {
    # ignore
  }
}
if (-not $proc.HasExited) {
  try {
    Stop-Process -Id $proc.Id -Force
  } catch {
    # ignore
  }
}

Get-Content $resultPath
