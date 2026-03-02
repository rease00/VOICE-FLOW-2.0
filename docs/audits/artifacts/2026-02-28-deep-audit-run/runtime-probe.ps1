$ErrorActionPreference='Stop'
function Invoke-CurlAudit {
  param(
    [string]$Name,
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers,
    [string]$Body
  )
  $tmp = New-TemporaryFile
  $args = @('-sS','-o',$tmp.FullName,'-w','%{http_code}','-X',$Method,$Url)
  if($Headers){
    foreach($k in $Headers.Keys){
      $args += @('-H',"${k}: $($Headers[$k])")
    }
  }
  if($Body){
    $args += @('-H','Content-Type: application/json','--data',$Body)
  }
  $statusText = (& curl.exe @args)
  $status = -1
  if($statusText -match '^\d{3}$'){ $status = [int]$statusText }
  $content = ''
  if(Test-Path $tmp.FullName){ $content = Get-Content $tmp.FullName -Raw }
  Remove-Item $tmp.FullName -Force -ErrorAction SilentlyContinue
  $snippet = ($content -replace '\s+',' ')
  if($snippet.Length -gt 200){ $snippet = $snippet.Substring(0,200) }
  [pscustomobject]@{name=$Name; method=$Method; status=$status; url=$Url; snippet=$snippet}
}

$base='http://127.0.0.1:7800'
$rows=@()
$rows += Invoke-CurlAudit -Name 'health_noauth' -Method 'GET' -Url "$base/health" -Headers @{} -Body ''
$rows += Invoke-CurlAudit -Name 'system_version_noauth' -Method 'GET' -Url "$base/system/version" -Headers @{} -Body ''
$rows += Invoke-CurlAudit -Name 'entitlements_noauth' -Method 'GET' -Url "$base/account/entitlements" -Headers @{} -Body ''
$rows += Invoke-CurlAudit -Name 'tts_noauth' -Method 'POST' -Url "$base/tts/synthesize" -Headers @{} -Body '{"engine":"GEM","text":"audit ping"}'
$rows += Invoke-CurlAudit -Name 'admin_users_noauth' -Method 'GET' -Url "$base/admin/users" -Headers @{} -Body ''
$rows += Invoke-CurlAudit -Name 'pool_status_noauth' -Method 'GET' -Url "$base/admin/gemini/pool/status" -Headers @{} -Body ''
$rows += Invoke-CurlAudit -Name 'admin_usage_noauth' -Method 'GET' -Url "$base/admin/integrations/usage" -Headers @{} -Body ''
$rows += Invoke-CurlAudit -Name 'runtime_logs_noauth' -Method 'GET' -Url "$base/runtime/logs/tail?service=gemini-runtime" -Headers @{} -Body ''
$rows += Invoke-CurlAudit -Name 'guardian_status_noauth' -Method 'GET' -Url "$base/ops/guardian/status" -Headers @{} -Body ''

$rows += Invoke-CurlAudit -Name 'entitlements_devuid_user' -Method 'GET' -Url "$base/account/entitlements" -Headers @{'x-dev-uid'='audit_user'} -Body ''
$rows += Invoke-CurlAudit -Name 'tts_devuid_user' -Method 'POST' -Url "$base/tts/synthesize" -Headers @{'x-dev-uid'='audit_user'} -Body '{"engine":"GEM","text":"audit ping with dev uid"}'
$rows += Invoke-CurlAudit -Name 'admin_users_devuid_user' -Method 'GET' -Url "$base/admin/users" -Headers @{'x-dev-uid'='audit_user'} -Body ''

$rows += Invoke-CurlAudit -Name 'admin_users_devuid_admin' -Method 'GET' -Url "$base/admin/users" -Headers @{'x-dev-uid'='local_admin_unlimited'} -Body ''
$rows += Invoke-CurlAudit -Name 'pool_status_devuid_admin' -Method 'GET' -Url "$base/admin/gemini/pool/status" -Headers @{'x-dev-uid'='local_admin_unlimited'} -Body ''
$rows += Invoke-CurlAudit -Name 'admin_usage_devuid_admin' -Method 'GET' -Url "$base/admin/integrations/usage" -Headers @{'x-dev-uid'='local_admin_unlimited'} -Body ''
$rows += Invoke-CurlAudit -Name 'guardian_status_devuid_admin' -Method 'GET' -Url "$base/ops/guardian/status?include_route_stats=true" -Headers @{'x-dev-uid'='local_admin_unlimited'} -Body ''

$rows | ConvertTo-Json -Depth 6
