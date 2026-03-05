param(
    [Parameter(Mandatory = $true)][string]$ProjectId,
    [string]$Region = "us-central1",
    [string]$ServiceName = "voiceflow-api",
    [string]$CandidateRevision = "",
    [string]$StableRevision = "",
    [string]$Steps = "10,50,100",
    [int]$SoakSeconds = 180,
    [string]$ProbeUrl = "",
    [string[]]$RuntimeHealthUrls = @(),
    [string]$QueueMetricsUrl = "",
    [int]$MaxQueueDepth = 200,
    [int]$MaxOldestQueuedAgeMs = 120000,
    [string]$AuthBearerToken = $env:AUDIT_BEARER_TOKEN,
    [string]$DevUid = $env:AUDIT_DEV_UID,
    [switch]$AutoRollback,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Gcloud {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$Capture
    )
    $display = "gcloud " + ($Arguments -join " ")
    if ($DryRun) {
        Write-Host "[dry-run] $display"
        if ($Capture) { return "" }
        return $null
    }
    if ($Capture) {
        $output = & gcloud @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed: $display"
        }
        return ($output -join "`n").Trim()
    }
    & gcloud @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $display"
    }
    return $null
}

function Get-ServiceStatus {
    $raw = Invoke-Gcloud -Capture -Arguments @(
        "run", "services", "describe", $ServiceName,
        "--project", $ProjectId,
        "--region", $Region,
        "--format", "json(status.latestReadyRevisionName,status.traffic,status.url)"
    )
    if (-not $raw) { return $null }
    return ($raw | ConvertFrom-Json)
}

function Resolve-Revisions {
    param([object]$Status)
    $latestReady = [string]$Status.status.latestReadyRevisionName
    if (-not $CandidateRevision) {
        $script:CandidateRevision = $latestReady
    }
    if (-not $script:CandidateRevision) {
        throw "Unable to resolve candidate revision. Pass -CandidateRevision explicitly."
    }

    if (-not $StableRevision) {
        $trafficRows = @($Status.status.traffic)
        $stableRow = $trafficRows |
            Where-Object { [string]$_.revisionName -and [string]$_.revisionName -ne $script:CandidateRevision } |
            Sort-Object { [int]($_.percent) } -Descending |
            Select-Object -First 1
        if ($stableRow) {
            $script:StableRevision = [string]$stableRow.revisionName
        }
    }
}

function Build-Headers {
    $headers = @{
        "Accept" = "application/json"
    }
    $token = [string]$AuthBearerToken
    if ($token) {
        if ($token.ToLower().StartsWith("bearer ")) {
            $headers["Authorization"] = $token
        } else {
            $headers["Authorization"] = "Bearer $token"
        }
    } elseif ($DevUid) {
        $headers["x-dev-uid"] = [string]$DevUid
    }
    return $headers
}

function Invoke-JsonProbe {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [string]$Name = "probe"
    )
    if (-not $Url) { return }
    if ($DryRun) {
        Write-Host "[dry-run] probe $Name -> $Url"
        return $null
    }
    $headers = Build-Headers
    try {
        $resp = Invoke-WebRequest -UseBasicParsing -Method GET -Uri $Url -Headers $headers -TimeoutSec 20
    } catch {
        throw "$Name failed: $($_.Exception.Message)"
    }
    if ($resp.StatusCode -lt 200 -or $resp.StatusCode -ge 300) {
        throw "$Name non-2xx status: $($resp.StatusCode)"
    }
    return $resp
}

function Check-QueueMetrics {
    if (-not $QueueMetricsUrl) { return }
    $resp = Invoke-JsonProbe -Url $QueueMetricsUrl -Name "queue-metrics"
    if (-not $resp) { return }
    $payload = $resp.Content | ConvertFrom-Json
    $depth = [int]($payload.queue.total | ForEach-Object { $_ } | Select-Object -First 1)
    $oldest = [int]($payload.telemetry.oldestQueuedAgeMs | ForEach-Object { $_ } | Select-Object -First 1)
    if ($depth -gt $MaxQueueDepth) {
        throw "queue depth threshold exceeded ($depth > $MaxQueueDepth)"
    }
    if ($oldest -gt $MaxOldestQueuedAgeMs) {
        throw "queue oldest age threshold exceeded (${oldest}ms > ${MaxOldestQueuedAgeMs}ms)"
    }
    Write-Host "Queue OK: depth=$depth oldestAgeMs=$oldest"
}

function Run-HealthChecks {
    param([int]$Percent)
    if ($ProbeUrl) {
        [void](Invoke-JsonProbe -Url $ProbeUrl -Name "api-health")
        Write-Host "API health probe OK ($Percent%)."
    }
    foreach ($runtimeUrl in $RuntimeHealthUrls) {
        if (-not [string]::IsNullOrWhiteSpace($runtimeUrl)) {
            [void](Invoke-JsonProbe -Url $runtimeUrl -Name "runtime-health")
            Write-Host "Runtime probe OK: $runtimeUrl"
        }
    }
    Check-QueueMetrics
}

function Set-TrafficStep {
    param([int]$Percent)
    $safePercent = [Math]::Max(0, [Math]::Min(100, $Percent))
    $remaining = 100 - $safePercent

    $toRevisions = ""
    if ($script:StableRevision -and $script:StableRevision -ne $script:CandidateRevision -and $safePercent -lt 100) {
        $toRevisions = "$($script:CandidateRevision)=$safePercent,$($script:StableRevision)=$remaining"
    } else {
        $toRevisions = "$($script:CandidateRevision)=100"
    }

    Invoke-Gcloud -Arguments @(
        "run", "services", "update-traffic", $ServiceName,
        "--project", $ProjectId,
        "--region", $Region,
        "--to-revisions", $toRevisions
    ) | Out-Null
    Write-Host "Traffic updated: $toRevisions"
}

function Rollback-To-Stable {
    if (-not $script:StableRevision) {
        Write-Host "Rollback skipped: no stable revision detected."
        return
    }
    Invoke-Gcloud -Arguments @(
        "run", "services", "update-traffic", $ServiceName,
        "--project", $ProjectId,
        "--region", $Region,
        "--to-revisions", "$($script:StableRevision)=100"
    ) | Out-Null
    Write-Host "Rollback complete: $($script:StableRevision)=100"
}

$status = Get-ServiceStatus
if (-not $status) {
    throw "Unable to read Cloud Run service status for $ServiceName."
}

Resolve-Revisions -Status $status
Write-Host "Service: $ServiceName"
Write-Host "Candidate revision: $CandidateRevision"
if ($StableRevision) {
    Write-Host "Stable revision: $StableRevision"
} else {
    Write-Host "Stable revision: (none detected)"
}

$stepValues = @()
foreach ($token in ($Steps -split ",")) {
    $trimmed = [string]$token
    if (-not $trimmed) { continue }
    $value = 0
    if ([int]::TryParse($trimmed.Trim(), [ref]$value)) {
        $stepValues += [Math]::Max(0, [Math]::Min(100, $value))
    }
}
if ($stepValues.Count -eq 0) {
    throw "No valid rollout steps parsed from -Steps '$Steps'."
}

foreach ($percent in $stepValues) {
    Write-Host ""
    Write-Host "Applying rollout step: $percent%"
    try {
        Set-TrafficStep -Percent $percent
        if ($SoakSeconds -gt 0) {
            Write-Host "Soak ${SoakSeconds}s..."
            if (-not $DryRun) {
                Start-Sleep -Seconds $SoakSeconds
            }
        }
        Run-HealthChecks -Percent $percent
    } catch {
        Write-Host "Rollout check failed at ${percent}%: $($_.Exception.Message)"
        if ($AutoRollback) {
            Write-Host "Auto rollback enabled. Rolling back..."
            Rollback-To-Stable
        }
        throw
    }
}

$final = Get-ServiceStatus
if ($final) {
    Write-Host ""
    Write-Host "Rollout complete."
    Write-Host "Service URL: $($final.status.url)"
    Write-Host "Traffic:"
    foreach ($row in @($final.status.traffic)) {
        $rev = [string]$row.revisionName
        $pct = [int]($row.percent)
        Write-Host "  $rev = ${pct}%"
    }
}
