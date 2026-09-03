param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryRoot,

    [Parameter(Mandatory = $true)]
    [string]$NodePath
)

$ErrorActionPreference = 'Stop'

function Hide-HostAgentConsoleWindow {
    if ($env:OS -ne 'Windows_NT') {
        return
    }

    try {
        if (-not ([System.Management.Automation.PSTypeName]'SkyCommand.Native.ConsoleWindow').Type) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace SkyCommand.Native
{
    public static class ConsoleWindow
    {
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetConsoleWindow();

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    }
}
'@
        }

        $consoleWindow = [SkyCommand.Native.ConsoleWindow]::GetConsoleWindow()
        if ($consoleWindow -ne [IntPtr]::Zero) {
            # SW_HIDE = 0. Keep the scheduled PowerShell -> Node ownership chain intact;
            # only suppress the console surface allocated by Windows for the runner.
            [void][SkyCommand.Native.ConsoleWindow]::ShowWindow($consoleWindow, 0)
        }
    }
    catch {
        # Console suppression is visual polish only. Never prevent the Host Agent from
        # starting if Windows does not expose a hideable console handle.
    }
}

# Task Scheduler already launches this runner with -WindowStyle Hidden. Explicitly hide
# any console allocated by the Windows console host as a second layer of suppression.
Hide-HostAgentConsoleWindow

$repositoryPath = [System.IO.Path]::GetFullPath($RepositoryRoot)
$nodeExecutable = [System.IO.Path]::GetFullPath($NodePath)
$workerScript = Join-Path $repositoryPath 'packages\host-agent\src\worker.js'
$logDirectory = Join-Path $repositoryPath 'logs\host-agent'
$logPath = Join-Path $logDirectory 'scheduled-task.log'
$runnerPidPath = Join-Path $logDirectory 'scheduled-task.runner.pid'

if (-not (Test-Path -LiteralPath $repositoryPath -PathType Container)) {
    throw "SkyCommand repository root does not exist: $repositoryPath"
}

if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
    throw "Node.js executable does not exist: $nodeExecutable"
}

if (-not (Test-Path -LiteralPath $workerScript -PathType Leaf)) {
    throw "SkyCommand Host Agent worker script does not exist: $workerScript"
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
Add-Content -LiteralPath $logPath -Value "[$timestamp] SkyCommand Host Agent scheduled task starting (runner PID $PID)."

# Persist the PowerShell runner PID so the lifecycle helper can terminate the exact
# hidden PowerShell -> Node process tree. Stop-ScheduledTask owns wscript.exe, but
# Windows can otherwise leave its descendants alive after the GUI launcher exits.
[System.IO.File]::WriteAllText($runnerPidPath, [string]$PID)

# Windows PowerShell 5.1 can promote redirected stderr from a native command into
# PowerShell ErrorRecord objects. Temporal emits normal worker lifecycle messages on
# stderr, so leaving ErrorActionPreference=Stop active here can terminate an otherwise
# healthy long-running Host Agent as soon as the first Temporal INFO/WARN line appears.
# Keep strict error handling for the wrapper itself, but allow Node's native stdout/stderr
# to stream into the task log and use the native process exit code as the authority.
$wrapperErrorActionPreference = $ErrorActionPreference
$exitCode = 1
try {
    $ErrorActionPreference = 'Continue'
    & $nodeExecutable $workerScript *>> $logPath
    $exitCode = $LASTEXITCODE
}
catch {
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ssK'
    Add-Content -LiteralPath $logPath -Value "[$timestamp] SkyCommand Host Agent scheduled task wrapper failed: $($_.Exception.Message)"
    throw
}
finally {
    $ErrorActionPreference = $wrapperErrorActionPreference

    # Remove only our own marker. A rapid restart may already have replaced the PID
    # file with a newer runner value, and the older process must never delete it.
    if (Test-Path -LiteralPath $runnerPidPath -PathType Leaf) {
        $recordedPid = (Get-Content -LiteralPath $runnerPidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($recordedPid -and $recordedPid.Trim() -eq [string]$PID) {
            Remove-Item -LiteralPath $runnerPidPath -Force -ErrorAction SilentlyContinue
        }
    }
}

if ($null -eq $exitCode) {
    $exitCode = 1
}

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ssK'
Add-Content -LiteralPath $logPath -Value "[$timestamp] SkyCommand Host Agent scheduled task exited with code $exitCode."
exit $exitCode
