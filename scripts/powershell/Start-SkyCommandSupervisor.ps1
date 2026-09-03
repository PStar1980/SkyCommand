param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryRoot,

    [Parameter(Mandatory = $true)]
    [string]$NodePath
)

$ErrorActionPreference = 'Stop'

$repositoryPath = [System.IO.Path]::GetFullPath($RepositoryRoot)
$nodeExecutable = [System.IO.Path]::GetFullPath($NodePath)
$serverScript = Join-Path $repositoryPath 'packages\supervisor\src\server.js'
$logDirectory = Join-Path $repositoryPath 'logs\supervisor'
$logPath = Join-Path $logDirectory 'scheduled-task.log'
$runnerPidPath = Join-Path $logDirectory 'scheduled-task.runner.pid'

if (-not (Test-Path -LiteralPath $repositoryPath -PathType Container)) {
    throw "SkyCommand repository root does not exist: $repositoryPath"
}
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
    throw "Node.js executable does not exist: $nodeExecutable"
}
if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
    throw "SkyCommand Supervisor server script does not exist: $serverScript"
}

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
Set-Location -LiteralPath $repositoryPath

if (Test-Path -LiteralPath $logPath -PathType Leaf) {
    $existingLog = Get-Item -LiteralPath $logPath
    if ($existingLog.Length -ge 5MB) {
        Move-Item -LiteralPath $logPath -Destination "$logPath.1" -Force
    }
}

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ssK'
Add-Content -LiteralPath $logPath -Value "[$timestamp] SkyCommand Supervisor scheduled task starting (runner PID $PID)."
[System.IO.File]::WriteAllText($runnerPidPath, [string]$PID)

$wrapperErrorActionPreference = $ErrorActionPreference
$exitCode = 1
try {
    $ErrorActionPreference = 'Continue'
    & $nodeExecutable $serverScript *>> $logPath
    $exitCode = $LASTEXITCODE
}
catch {
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ssK'
    Add-Content -LiteralPath $logPath -Value "[$timestamp] SkyCommand Supervisor wrapper failed: $($_.Exception.Message)"
    throw
}
finally {
    $ErrorActionPreference = $wrapperErrorActionPreference
    if (Test-Path -LiteralPath $runnerPidPath -PathType Leaf) {
        $recordedPid = (Get-Content -LiteralPath $runnerPidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($recordedPid -and $recordedPid.Trim() -eq [string]$PID) {
            Remove-Item -LiteralPath $runnerPidPath -Force -ErrorAction SilentlyContinue
        }
    }
}

if ($null -eq $exitCode) { $exitCode = 1 }
$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ssK'
Add-Content -LiteralPath $logPath -Value "[$timestamp] SkyCommand Supervisor scheduled task exited with code $exitCode."
exit $exitCode
