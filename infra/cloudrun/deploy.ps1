param(
    [string]$ProjectId = $env:GOOGLE_CLOUD_PROJECT,
    [string]$Region = "",
    [string]$ConfigPath = "",
    [string]$Tag = "",
    [string]$RedisUrl = $env:VF_REDIS_URL,
    [string]$VpcConnector = $env:VF_CLOUDRUN_VPC_CONNECTOR,
    [switch]$SkipBuild,
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
        return ""
    }

    if ($Capture) {
        $output = & gcloud @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed: $display"
        }
        return (($output -join "`n").Trim())
    }

    & gcloud @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $display"
    }
    return $null
}

function Convert-ObjectToMap {
    param([object]$InputObject)
    $map = @{}
    if ($null -eq $InputObject) {
        return $map
    }
    foreach ($prop in $InputObject.PSObject.Properties) {
        $map[$prop.Name] = [string]$prop.Value
    }
    return $map
}

function Resolve-EnvMap {
    param(
        [hashtable]$RawMap,
        [hashtable]$RuntimeUrls,
        [string]$RedisValue
    )
    $resolved = @{}
    foreach ($key in $RawMap.Keys) {
        $value = [string]$RawMap[$key]
        switch ($value) {
            "__REDIS_URL__" {
                if (-not $RedisValue) {
                    if ($DryRun) {
                        $resolved[$key] = "redis://REQUIRED_FOR_DEPLOY"
                        break
                    }
                    throw "Redis URL placeholder detected but -RedisUrl was not provided."
                }
                $resolved[$key] = $RedisValue
            }
            "__GEMINI_RUNTIME_URL__" {
                $runtimeUrl = [string]$RuntimeUrls["voiceflow-gemini-runtime"]
                if (-not $runtimeUrl) {
                    if ($DryRun) {
                        $resolved[$key] = "https://voiceflow-gemini-runtime.a.run.app"
                        break
                    }
                    throw "Gemini runtime URL is not available yet."
                }
                $resolved[$key] = $runtimeUrl
            }
            "__KOKORO_RUNTIME_URL__" {
                $runtimeUrl = [string]$RuntimeUrls["voiceflow-kokoro-runtime"]
                if (-not $runtimeUrl) {
                    if ($DryRun) {
                        $resolved[$key] = "https://voiceflow-kokoro-runtime.a.run.app"
                        break
                    }
                    throw "Kokoro runtime URL is not available yet."
                }
                $resolved[$key] = $runtimeUrl
            }
            "__VOICE_TRANSFER_RUNTIME_URL__" {
                $runtimeUrl = [string]$RuntimeUrls["voiceflow-voice-transfer-runtime"]
                if (-not $runtimeUrl) {
                    if ($DryRun) {
                        $resolved[$key] = "https://voiceflow-voice-transfer-runtime.a.run.app"
                        break
                    }
                    throw "Voice Transfer runtime URL is not available yet."
                }
                $resolved[$key] = $runtimeUrl
            }
            default {
                $resolved[$key] = $value
            }
        }
    }
    return $resolved
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
if (-not $ConfigPath) {
    $ConfigPath = Join-Path $scriptRoot "services.default.json"
}
if (-not (Test-Path $ConfigPath)) {
    throw "Cloud Run config not found: $ConfigPath"
}
$config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
if (-not $ProjectId) {
    throw "Project id is required. Pass -ProjectId or set GOOGLE_CLOUD_PROJECT."
}
if (-not $Region) {
    $Region = [string]$config.region
}
if (-not $Region) {
    throw "Region is required. Pass -Region or set region in $ConfigPath."
}
if (-not $Tag) {
    $Tag = (Get-Date -Format "yyyyMMdd-HHmmss")
}

$repoName = [string]$config.artifactRegistryRepo
if (-not $repoName) {
    throw "artifactRegistryRepo is required in $ConfigPath."
}

Write-Host "Project: $ProjectId"
Write-Host "Region: $Region"
Write-Host "Artifact Registry repo: $repoName"
Write-Host "Image tag: $Tag"

if ($DryRun) {
    Write-Host "Dry-run mode enabled."
}

try {
    Invoke-Gcloud -Arguments @(
        "artifacts", "repositories", "describe", $repoName,
        "--project", $ProjectId,
        "--location", $Region
    ) | Out-Null
}
catch {
    Write-Host "Artifact Registry repo '$repoName' not found in $Region. Creating..."
    Invoke-Gcloud -Arguments @(
        "artifacts", "repositories", "create", $repoName,
        "--project", $ProjectId,
        "--location", $Region,
        "--repository-format", "docker",
        "--description", "VoiceFlow Cloud Run images"
    ) | Out-Null
}

$services = @($config.services)
if ($services.Count -eq 0) {
    throw "No services found in $ConfigPath."
}

$imageByService = @{}
$builds = @{}
foreach ($svc in $services) {
    $serviceName = [string]$svc.name
    $imageName = [string]$svc.imageName
    $dockerfile = [string]$svc.dockerfile
    if (-not $serviceName -or -not $imageName -or -not $dockerfile) {
        throw "Each service requires name, imageName, and dockerfile."
    }
    $imageUri = "$Region-docker.pkg.dev/$ProjectId/$repoName/$imageName`:$Tag"
    $imageByService[$serviceName] = $imageUri
    $buildKey = "$imageName|$dockerfile"
    if (-not $builds.ContainsKey($buildKey)) {
        $builds[$buildKey] = @{
            imageUri = $imageUri
            dockerfile = $dockerfile
        }
    }
}

if (-not $SkipBuild) {
    foreach ($build in $builds.Values) {
        $dockerfilePath = Resolve-Path (Join-Path $repoRoot ([string]$build.dockerfile))
        Write-Host "Building image: $($build.imageUri)"
        Invoke-Gcloud -Arguments @(
            "builds", "submit",
            [string]$repoRoot,
            "--project", $ProjectId,
            "--tag", [string]$build.imageUri,
            "--file", [string]$dockerfilePath
        ) | Out-Null
    }
}
else {
    Write-Host "Skipping builds (-SkipBuild)."
}

$runtimeUrls = @{}
$runtimeServices = @($services | Where-Object { [string]$_.name -like "*-runtime" })
$nonRuntimeServices = @($services | Where-Object { [string]$_.name -notlike "*-runtime" })
$deployOrder = @($runtimeServices + $nonRuntimeServices)

foreach ($svc in $deployOrder) {
    $name = [string]$svc.name
    $imageUri = [string]$imageByService[$name]
    $envMap = Convert-ObjectToMap -InputObject $svc.env
    $resolvedEnvMap = Resolve-EnvMap -RawMap $envMap -RuntimeUrls $runtimeUrls -RedisValue $RedisUrl
    $secretEnvMap = Convert-ObjectToMap -InputObject $svc.secretEnv
    $serviceAccount = ""
    if ($svc.PSObject.Properties.Name -contains "serviceAccount") {
        $serviceAccount = [string]$svc.serviceAccount
    }
    $timeoutSeconds = 0
    if ($svc.PSObject.Properties.Name -contains "timeoutSeconds") {
        try {
            $timeoutSeconds = [int]$svc.timeoutSeconds
        }
        catch {
            $timeoutSeconds = 0
        }
    }
    $executionEnvironment = ""
    if ($svc.PSObject.Properties.Name -contains "executionEnvironment") {
        $executionEnvironment = [string]$svc.executionEnvironment
    }
    $hasStartupCpuBoost = $svc.PSObject.Properties.Name -contains "startupCpuBoost"
    $startupCpuBoost = $false
    if ($hasStartupCpuBoost) {
        $startupCpuBoost = [bool]$svc.startupCpuBoost
    }
    $hasCpuAlwaysAllocated = $svc.PSObject.Properties.Name -contains "cpuAlwaysAllocated"

    $deployArgs = @(
        "run", "deploy", $name,
        "--project", $ProjectId,
        "--region", $Region,
        "--platform", "managed",
        "--image", $imageUri,
        "--port", "8080",
        "--ingress", [string]$svc.ingress,
        "--min-instances", [string]$svc.minInstances,
        "--max-instances", [string]$svc.maxInstances,
        "--concurrency", [string]$svc.concurrency,
        "--cpu", [string]$svc.cpu,
        "--memory", [string]$svc.memory
    )

    if ($timeoutSeconds -gt 0) {
        $deployArgs += @("--timeout", "$($timeoutSeconds)s")
    }

    if ($executionEnvironment) {
        $deployArgs += @("--execution-environment", $executionEnvironment)
    }

    if ([bool]$svc.allowUnauthenticated) {
        $deployArgs += "--allow-unauthenticated"
    }
    else {
        $deployArgs += "--no-allow-unauthenticated"
    }

    if ($hasCpuAlwaysAllocated) {
        if ([bool]$svc.cpuAlwaysAllocated) {
            $deployArgs += "--no-cpu-throttling"
        }
        else {
            $deployArgs += "--cpu-throttling"
        }
    }

    if ($hasStartupCpuBoost) {
        if ($startupCpuBoost) {
            $deployArgs += "--cpu-boost"
        }
        else {
            $deployArgs += "--no-cpu-boost"
        }
    }

    if ($VpcConnector) {
        $deployArgs += @("--vpc-connector", $VpcConnector, "--vpc-egress", "private-ranges-only")
    }

    if ($serviceAccount) {
        $deployArgs += @("--service-account", $serviceAccount)
    }

    if ($resolvedEnvMap.Count -gt 0) {
        $pairs = @()
        foreach ($k in $resolvedEnvMap.Keys) {
            $pairs += ("{0}={1}" -f $k, $resolvedEnvMap[$k])
        }
        $deployArgs += @("--set-env-vars", ($pairs -join ","))
    }

    if ($secretEnvMap.Count -gt 0) {
        $pairs = @()
        foreach ($k in $secretEnvMap.Keys) {
            $pairs += ("{0}={1}:latest" -f $k, $secretEnvMap[$k])
        }
        $deployArgs += @("--set-secrets", ($pairs -join ","))
    }

    Write-Host "Deploying service: $name"
    Invoke-Gcloud -Arguments $deployArgs | Out-Null

    $url = Invoke-Gcloud -Capture -Arguments @(
        "run", "services", "describe", $name,
        "--project", $ProjectId,
        "--region", $Region,
        "--format", "value(status.url)"
    )

    if ($url) {
        Write-Host "Service URL: $name => $url"
        $runtimeUrls[$name] = $url
    }
}

Write-Host ""
Write-Host "Cloud Run deployment completed."
Write-Host "Runtime URLs:"
foreach ($key in @("voiceflow-gemini-runtime", "voiceflow-kokoro-runtime", "voiceflow-voice-transfer-runtime")) {
    $value = [string]$runtimeUrls[$key]
    if ($value) {
        Write-Host "  $key = $value"
    }
}
