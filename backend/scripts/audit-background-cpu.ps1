param(
  [int]$ThresholdPct = 0,
  [int]$SampleSec = 0,
  [switch]$RestartIfIdle,
  [string]$BackendBaseUrl = ''
)

$ErrorActionPreference = 'Stop'

function Get-EnvInt([string]$Name, [int]$DefaultValue) {
  $raw = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $DefaultValue
  }
  $parsed = 0
  if ([int]::TryParse($raw, [ref]$parsed)) {
    return $parsed
  }
  return $DefaultValue
}

function ClampInt([int]$Value, [int]$Min, [int]$Max) {
  if ($Value -lt $Min) { return $Min }
  if ($Value -gt $Max) { return $Max }
  return $Value
}

if ($ThresholdPct -le 0) {
  $ThresholdPct = Get-EnvInt -Name 'VF_CPU_AUDIT_THRESHOLD_PCT' -DefaultValue 60
}
if ($SampleSec -le 0) {
  $SampleSec = Get-EnvInt -Name 'VF_CPU_AUDIT_SAMPLE_SEC' -DefaultValue 8
}
$ThresholdPct = ClampInt -Value $ThresholdPct -Min 1 -Max 100
$SampleSec = ClampInt -Value $SampleSec -Min 2 -Max 120

if ([string]::IsNullOrWhiteSpace($BackendBaseUrl)) {
  $fromEnv = [Environment]::GetEnvironmentVariable('VF_MEDIA_BACKEND_URL')
  if ([string]::IsNullOrWhiteSpace($fromEnv)) {
    $BackendBaseUrl = 'http://127.0.0.1:7800'
  } else {
    $BackendBaseUrl = $fromEnv
  }
}
$BackendBaseUrl = $BackendBaseUrl.TrimEnd('/')

$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspaceRoot = (Resolve-Path (Join-Path $backendRoot '..')).Path
$pidDir = Join-Path $backendRoot '.runtime\pids'
$outDir = Join-Path $workspaceRoot 'output\audit'
$outPath = Join-Path $outDir 'background_cpu_after_run.json'

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$logicalCpu = [Environment]::ProcessorCount
if ($logicalCpu -lt 1) { $logicalCpu = 1 }

$pidRecords = @()
if (Test-Path $pidDir) {
  $pidFiles = Get-ChildItem -Path $pidDir -Filter '*.pid' -File
  foreach ($pidFile in $pidFiles) {
    $serviceId = [IO.Path]::GetFileNameWithoutExtension($pidFile.Name)
    $text = (Get-Content -Raw -Path $pidFile.FullName).Trim()
    $procId = 0
    if (-not [int]::TryParse($text, [ref]$procId)) {
      continue
    }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $pidRecords += [pscustomobject]@{
      serviceId = $serviceId
      pid = $procId
      processName = if ($proc) { $proc.ProcessName } else { '' }
      startCpuSec = if ($proc) { [double]$proc.CPU } else { 0.0 }
      runningAtStart = [bool]$proc
    }
  }
}

$metrics = $null
$metricsError = ''
try {
  $headers = @{ 'x-dev-uid' = 'local_admin' }
  $metrics = Invoke-RestMethod -Method Get -Uri "$BackendBaseUrl/admin/tts/queue/metrics" -Headers $headers -TimeoutSec 10
} catch {
  $metricsError = $_.Exception.Message
}

$queueTotal = 0
$engineQueued = 0
$engineRunning = 0
if ($metrics -and $metrics.queue) {
  $queueTotal = [int]($metrics.queue.total)
}
if ($metrics -and $metrics.engines) {
  foreach ($name in @('GEM', 'KOKORO')) {
    $engine = $metrics.engines.$name
    if ($engine) {
      $engineQueued += [int]($engine.queued)
      $engineRunning += [int]($engine.running)
    }
  }
}
$queueIdle = ($queueTotal -eq 0 -and $engineQueued -eq 0 -and $engineRunning -eq 0)

$netRows = @()
try {
  $netRows = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object {
      $p = [int]$_.OwningProcess
      $pidRecords.pid -contains $p
    } | Select-Object State, LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess)
} catch {
  $netRows = @()
}

Start-Sleep -Seconds $SampleSec

$processSamples = @()
foreach ($record in $pidRecords) {
  $proc = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
  $runningNow = [bool]$proc
  $endCpu = if ($proc) { [double]$proc.CPU } else { [double]$record.startCpuSec }
  $deltaCpu = [Math]::Max(0.0, $endCpu - [double]$record.startCpuSec)
  $cpuPct = [Math]::Round((($deltaCpu / [double]$SampleSec) / [double]$logicalCpu) * 100.0, 2)

  $sample = [ordered]@{
    serviceId = $record.serviceId
    pid = $record.pid
    processName = $record.processName
    runningAtStart = $record.runningAtStart
    runningAtEnd = $runningNow
    cpuDeltaSec = [Math]::Round($deltaCpu, 3)
    cpuPctApprox = $cpuPct
    threadCount = if ($proc) { $proc.Threads.Count } else { 0 }
    workingSetMb = if ($proc) { [Math]::Round($proc.WorkingSet64 / 1MB, 1) } else { 0.0 }
    privateMb = if ($proc) { [Math]::Round($proc.PrivateMemorySize64 / 1MB, 1) } else { 0.0 }
    sockets = @($netRows | Where-Object { [int]$_.OwningProcess -eq [int]$record.pid } | ForEach-Object {
      [ordered]@{
        state = [string]$_.State
        local = "{0}:{1}" -f $_.LocalAddress, $_.LocalPort
        remote = "{0}:{1}" -f $_.RemoteAddress, $_.RemotePort
      }
    })
  }
  $processSamples += $sample
}

$offenders = @($processSamples | Where-Object {
    $_.runningAtEnd -and [double]$_.cpuPctApprox -ge [double]$ThresholdPct
  })

$actions = @()
if ($RestartIfIdle.IsPresent -and $queueIdle -and $offenders.Count -gt 0) {
  foreach ($offender in $offenders) {
    $serviceId = [string]$offender.serviceId
    if ([string]::IsNullOrWhiteSpace($serviceId)) {
      continue
    }
    $ok = $false
    $error = ''
    try {
      Push-Location $backendRoot
      & node scripts/bootstrap-services.mjs restart $serviceId | Out-Null
      if ($LASTEXITCODE -eq 0) {
        $ok = $true
      } else {
        $error = "restart exit code $LASTEXITCODE"
      }
    } catch {
      $error = $_.Exception.Message
    } finally {
      Pop-Location
    }

    $actions += [ordered]@{
      serviceId = $serviceId
      action = 'restart'
      ok = $ok
      error = $error
    }
  }
}

$report = [ordered]@{
  generatedAt = (Get-Date).ToString('o')
  baseline = [ordered]@{
    logicalCpu = $logicalCpu
    sampleSeconds = $SampleSec
    thresholdPct = $ThresholdPct
    backendBaseUrl = $BackendBaseUrl
    queueIdle = $queueIdle
    queue = [ordered]@{
      total = $queueTotal
      engineQueued = $engineQueued
      engineRunning = $engineRunning
      metricsError = $metricsError
    }
  }
  offenders = @($offenders | ForEach-Object {
    [ordered]@{
      serviceId = $_.serviceId
      pid = $_.pid
      cpuPctApprox = $_.cpuPctApprox
      cpuDeltaSec = $_.cpuDeltaSec
    }
  })
  actions = $actions
  processes = $processSamples
}

$report | ConvertTo-Json -Depth 8 | Set-Content -Path $outPath -Encoding UTF8
Write-Output "CPU background audit written to: $outPath"
