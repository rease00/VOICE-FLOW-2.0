param(
    [string]$ProjectId = $env:GOOGLE_CLOUD_PROJECT,
    [string]$Region = "",
    [string]$ConfigPath = "",
    [string]$Profile = "",
    [string]$Tag = "",
    [string]$RedisUrl = $env:VF_REDIS_URL,
    [string]$DunoRuntimeUrl = $env:VF_DUNO_RUNTIME_URL,
    [string]$DunoRuntimeToken = $env:VF_DUNO_RUNTIME_TOKEN,
    [string]$KokoroRuntimeUrl = $env:VF_KOKORO_RUNTIME_URL,
    [string]$KokoroRuntimeToken = $env:VF_KOKORO_RUNTIME_TOKEN,
    [string]$OpenVoiceRuntimeUrl = $env:VF_OPENVOICE_RUNTIME_URL,
    [string]$OpenVoiceRuntimeToken = $env:VF_OPENVOICE_RUNTIME_TOKEN,
    [string]$OpenVoiceArtifactSecret = $env:VF_OPENVOICE_ARTIFACT_SECRET,
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
            "__DUNO_RUNTIME_URL__" {
                if (-not $DunoRuntimeUrl) {
                    if ($DryRun) {
                        $resolved[$key] = "https://modal-duno-runtime.example"
                        break
                    }
                    $resolved[$key] = ""
                    break
                }
                $resolved[$key] = [string]$DunoRuntimeUrl
            }
            "__KOKORO_RUNTIME_URL__" {
                if (-not $KokoroRuntimeUrl) {
                    if ($DryRun) {
                        $resolved[$key] = "https://modal-kokoro-runtime.example"
                        break
                    }
                    throw "Modal Kokoro runtime URL is required. Pass -KokoroRuntimeUrl or set VF_KOKORO_RUNTIME_URL."
                }
                $resolved[$key] = [string]$KokoroRuntimeUrl
            }
            "__OPENVOICE_RUNTIME_URL__" {
                $runtimeUrl = [string]$RuntimeUrls["voiceflow-seed-vc-runtime"]
                if (-not $runtimeUrl) {
                    if ($DryRun) {
                        $resolved[$key] = "https://voiceflow-seed-vc-runtime.a.run.app"
                        break
                    }
                    throw "Seed VC runtime URL is not available yet."
                }
                $resolved[$key] = $runtimeUrl
            }
            "__OPENVOICE_MODAL_RUNTIME_URL__" {
                if (-not $OpenVoiceRuntimeUrl) {
                    if ($DryRun) {
                        $resolved[$key] = ""
                        break
                    }
                    $resolved[$key] = ""
                    break
                }
                $resolved[$key] = [string]$OpenVoiceRuntimeUrl
            }
            "__KOKORO_RUNTIME_TOKEN__" {
                if ($KokoroRuntimeToken) {
                    $resolved[$key] = [string]$KokoroRuntimeToken
                    break
                }
                $resolved[$key] = ""
            }
            "__OPENVOICE_RUNTIME_TOKEN__" {
                if ($OpenVoiceRuntimeToken) {
                    $resolved[$key] = [string]$OpenVoiceRuntimeToken
                    break
                }
                $resolved[$key] = ""
            }
            "__OPENVOICE_MODAL_RUNTIME_TOKEN__" {
                if ($OpenVoiceRuntimeToken) {
                    $resolved[$key] = [string]$OpenVoiceRuntimeToken
                    break
                }
                $resolved[$key] = ""
            }
            "__OPENVOICE_ARTIFACT_SECRET__" {
                if ($OpenVoiceArtifactSecret) {
                    $resolved[$key] = [string]$OpenVoiceArtifactSecret
                    break
                }
                $resolved[$key] = ""
            }
            default {
                $resolved[$key] = $value
            }
        }
    }
    return $resolved
}

function Resolve-SecretReference {
    param([string]$SecretValue)

    $token = [string]$SecretValue
    if (-not $token) {
        return ""
    }

    if ($token -match ':(latest|\d+)$') {
        return $token
    }

    return "$token`:1"
}

function Get-ServiceOrderingRank {
    param([string]$ServiceName)
    $name = [string]$ServiceName
    if ($name -like "*-runtime") {
        return 0
    }
    if ($name -like "*worker*") {
        return 1
    }
    if ($name -like "*api*") {
        return 2
    }
    return 3
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
if (-not $Profile) {
    if ($config.PSObject.Properties.Name -contains "deploymentProfile") {
        $Profile = [string]$config.deploymentProfile
    }
}
if (-not $Profile) {
    $Profile = "cloudrun-2vcpu"
}
$profileContract = $null
if ($config.PSObject.Properties.Name -contains "profileContractPath") {
    $profileContractPath = Join-Path $repoRoot ([string]$config.profileContractPath)
    if (-not (Test-Path $profileContractPath)) {
        throw "Profile contract not found: $profileContractPath"
    }
    $profileContract = Get-Content -Raw -Path $profileContractPath | ConvertFrom-Json
    $profileName = [string]$profileContract.name
    if ($profileName -and $profileName -ne $Profile) {
        throw "Requested profile '$Profile' does not match contract '$profileName'."
    }
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
Write-Host "Deployment profile: $Profile"
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

if ($profileContract -and ($profileContract.PSObject.Properties.Name -contains "services")) {
    $contractServices = $profileContract.services
    foreach ($svc in $services) {
        $serviceName = [string]$svc.name
        if (-not $serviceName) {
            continue
        }
        if (-not ($contractServices.PSObject.Properties.Name -contains $serviceName)) {
            throw "Service '$serviceName' is not declared in profile contract '$Profile'."
        }
        $contractSvc = $contractServices.$serviceName
        foreach ($field in @("cpu", "memory", "minInstances", "maxInstances", "concurrency", "cpuAlwaysAllocated")) {
            if (-not ($contractSvc.PSObject.Properties.Name -contains $field)) {
                continue
            }
            $expected = [string]$contractSvc.$field
            $actual = [string]$svc.$field
            if ($actual -ne $expected) {
                throw "Profile contract mismatch for $serviceName.$field (expected '$expected', found '$actual')."
            }
        }
    }
}

$imageByService = @{}
$builds = @{}
$imageUsageByName = @{}
foreach ($svc in $services) {
    $serviceName = [string]$svc.name
    $imageName = [string]$svc.imageName
    $dockerfile = [string]$svc.dockerfile
    if (-not $serviceName -or -not $imageName -or -not $dockerfile) {
        throw "Each service requires name, imageName, and dockerfile."
    }
    if ($imageUsageByName.ContainsKey($imageName)) {
        $first = $imageUsageByName[$imageName]
        if ([string]$first.dockerfile -ne $dockerfile) {
            throw ("Image name collision detected for '$imageName': services '{0}' and '{1}' use different dockerfiles. Assign distinct imageName values per service." -f [string]$first.serviceName, $serviceName)
        }
    }
    else {
        $imageUsageByName[$imageName] = @{
            serviceName = $serviceName
            dockerfile = $dockerfile
        }
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
$serviceByName = @{}
foreach ($svc in $services) {
    $serviceByName[[string]$svc.name] = $svc
}
$deployOrder = @()
$added = @{}
if ($profileContract -and ($profileContract.PSObject.Properties.Name -contains "rolloutOrder")) {
    foreach ($orderedName in @($profileContract.rolloutOrder)) {
        $name = [string]$orderedName
        if (-not $name) {
            continue
        }
        if (-not $serviceByName.ContainsKey($name)) {
            throw "Profile contract rolloutOrder contains unknown service '$name'."
        }
        if (-not $added.ContainsKey($name)) {
            $deployOrder += $serviceByName[$name]
            $added[$name] = $true
        }
    }
}

$remainingServices = @($services | Where-Object { -not $added.ContainsKey([string]$_.name) })
if ($remainingServices.Count -gt 0) {
    $remainingOrdered = @($remainingServices | Sort-Object `
        @{ Expression = { Get-ServiceOrderingRank -ServiceName ([string]$_.name) } }, `
        @{ Expression = { [string]$_.name } })
    foreach ($svc in $remainingOrdered) {
        $name = [string]$svc.name
        if (-not $added.ContainsKey($name)) {
            $deployOrder += $svc
            $added[$name] = $true
        }
    }
}
Write-Host ("Deploy order: " + (($deployOrder | ForEach-Object { [string]$_.name }) -join " -> "))

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

    $gpuCount = 0
    if ($svc.PSObject.Properties.Name -contains "gpuCount") {
        try {
            $gpuCount = [int]$svc.gpuCount
        }
        catch {
            $gpuCount = 0
        }
    }
    $gpuType = ""
    if ($svc.PSObject.Properties.Name -contains "gpuType") {
        $gpuType = [string]$svc.gpuType
    }
    if ($gpuCount -gt 0) {
        $deployArgs += @("--gpu", [string]$gpuCount)
        if ($gpuType) {
            $deployArgs += @("--gpu-type", $gpuType)
        }
    }

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
            $secretRef = Resolve-SecretReference -SecretValue ([string]$secretEnvMap[$k])
            $pairs += ("{0}={1}" -f $k, $secretRef)
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
foreach ($key in @("voiceflow-seed-vc-runtime", "voiceflow-gemini-runtime")) {
    $value = [string]$runtimeUrls[$key]
    if ($value) {
        Write-Host "  $key = $value"
    }
}
