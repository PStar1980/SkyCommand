param(
    [ValidateSet('Install', 'Uninstall', 'Status', 'Start', 'Stop')]
    [string]$Action = 'Status',

    [string]$TaskName = 'SkyCommand Supervisor'
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'SkyCommand Supervisor automatic startup is currently supported only on Windows.'
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$runnerScript = Join-Path $repositoryRoot 'scripts\powershell\Start-SkyCommandSupervisor.ps1'
$hiddenLauncherScript = Join-Path $repositoryRoot 'scripts\powershell\Start-SkyCommandSupervisorHidden.vbs'
$serverScript = Join-Path $repositoryRoot 'packages\supervisor\src\server.js'
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$logDirectory = Join-Path $repositoryRoot 'logs\supervisor'
$logPath = Join-Path $logDirectory 'scheduled-task.log'
$runnerPidPath = Join-Path $logDirectory 'scheduled-task.runner.pid'

function Get-NodeExecutable {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction SilentlyContinue }
    if (-not $nodeCommand) {
        throw 'Node.js was not found in PATH. Install Node.js or make node.exe available before installing the Supervisor task.'
    }
    return $nodeCommand.Source
}

function Assert-SupervisorFiles {
    foreach ($requiredPath in @($runnerScript, $hiddenLauncherScript, $serverScript)) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "SkyCommand Supervisor file was not found: $requiredPath"
        }
    }
}

function Get-SupervisorTask {
    return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Get-SupervisorProcesses {
    $serverPattern = [regex]::Escape($serverScript)
    return @(
        Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -match $serverPattern }
    )
}

function Get-SupervisorRunnerProcesses {
    $runnerPattern = [regex]::Escape($runnerScript)
    return @(
        Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -match $runnerPattern }
    )
}

function Remove-StaleRunnerPidFile {
    if (-not (Test-Path -LiteralPath $runnerPidPath -PathType Leaf)) { return }
    $rawPid = (Get-Content -LiteralPath $runnerPidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    $runnerProcessId = 0
    if (-not $rawPid -or -not [int]::TryParse($rawPid.Trim(), [ref]$runnerProcessId)) {
        Remove-Item -LiteralPath $runnerPidPath -Force -ErrorAction SilentlyContinue
        return
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $runnerProcessId" -ErrorAction SilentlyContinue
    if (-not $process) { Remove-Item -LiteralPath $runnerPidPath -Force -ErrorAction SilentlyContinue }
}

function Get-RecordedSupervisorRunnerProcess {
    Remove-StaleRunnerPidFile
    if (-not (Test-Path -LiteralPath $runnerPidPath -PathType Leaf)) { return $null }

    $rawPid = (Get-Content -LiteralPath $runnerPidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    $runnerProcessId = 0
    if (-not $rawPid -or -not [int]::TryParse($rawPid.Trim(), [ref]$runnerProcessId)) { return $null }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $runnerProcessId" -ErrorAction SilentlyContinue
    if (-not $process) {
        Remove-Item -LiteralPath $runnerPidPath -Force -ErrorAction SilentlyContinue
        return $null
    }

    $runnerPattern = [regex]::Escape($runnerScript)
    $repositoryPattern = [regex]::Escape($repositoryRoot)
    $isExpectedExecutable = $process.Name -and $process.Name -match '^(powershell|pwsh)\.exe$'
    $isExpectedCommand = $process.CommandLine -and $process.CommandLine -match $runnerPattern -and $process.CommandLine -match $repositoryPattern
    if (-not ($isExpectedExecutable -and $isExpectedCommand)) {
        throw "Refusing to use recorded Supervisor runner PID $runnerProcessId because it does not belong to the expected SkyCommand runner."
    }
    return $process
}

function Stop-ValidatedRunnerTree {
    param([Parameter(Mandatory = $true)]$RunnerProcess)

    $runnerProcessId = [int]$RunnerProcess.ProcessId
    $taskKillPath = (Get-Command taskkill.exe -ErrorAction Stop).Source
    & $taskKillPath /PID $runnerProcessId /T /F *> $null

    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
        Start-Sleep -Milliseconds 100
        $remaining = Get-CimInstance Win32_Process -Filter "ProcessId = $runnerProcessId" -ErrorAction SilentlyContinue
        if (-not $remaining) { return }
    }
    throw "SkyCommand Supervisor runner PID $runnerProcessId did not terminate after the guarded process-tree stop request."
}

function Stop-SupervisorRuntime {
    param($Task)

    $runnerProcesses = @()
    $recordedRunner = Get-RecordedSupervisorRunnerProcess
    if ($recordedRunner) { $runnerProcesses += $recordedRunner }
    foreach ($runner in (Get-SupervisorRunnerProcesses)) {
        if (-not ($runnerProcesses | Where-Object { $_.ProcessId -eq $runner.ProcessId })) {
            $runnerProcesses += $runner
        }
    }

    if ($Task -and $Task.State -eq 'Running') {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 150

    foreach ($runner in $runnerProcesses) {
        $stillRunning = Get-CimInstance Win32_Process -Filter "ProcessId = $($runner.ProcessId)" -ErrorAction SilentlyContinue
        if ($stillRunning) { Stop-ValidatedRunnerTree -RunnerProcess $runner }
    }

    Remove-Item -LiteralPath $runnerPidPath -Force -ErrorAction SilentlyContinue
    $remaining = Get-SupervisorProcesses
    if ($remaining.Count -gt 0) {
        $ids = ($remaining | ForEach-Object { $_.ProcessId }) -join ', '
        throw "SkyCommand Supervisor is still active after stop (PID(s): $ids)."
    }
}

switch ($Action) {
    'Install' {
        Assert-SupervisorFiles
        $nodePath = Get-NodeExecutable
        $powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
        $wscriptPath = (Get-Command wscript.exe -ErrorAction Stop).Source
        $existingTask = Get-SupervisorTask

        if ($existingTask) { Stop-SupervisorRuntime -Task $existingTask }
        $existingProcesses = Get-SupervisorProcesses
        if ($existingProcesses.Count -gt 0) {
            $ids = ($existingProcesses | ForEach-Object { $_.ProcessId }) -join ', '
            throw "A SkyCommand Supervisor is already running outside the scheduled task (PID(s): $ids). Stop it before installing automatic startup."
        }

        $arguments = @(
            '//B', '//Nologo',
            ('"{0}"' -f $hiddenLauncherScript),
            ('"{0}"' -f $powershellPath),
            ('"{0}"' -f $runnerScript),
            ('"{0}"' -f $repositoryRoot),
            ('"{0}"' -f $nodePath)
        ) -join ' '

        $taskAction = New-ScheduledTaskAction -Execute $wscriptPath -Argument $arguments -WorkingDirectory $repositoryRoot
        $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentIdentity
        $taskPrincipal = New-ScheduledTaskPrincipal -UserId $currentIdentity -LogonType Interactive -RunLevel Limited
        $taskSettings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -RestartCount 60 `
            -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -MultipleInstances IgnoreNew

        Register-ScheduledTask `
            -TaskName $TaskName `
            -Description 'Runs the host-native SkyCommand Supervisor used to bootstrap and control the local SkyCommand Docker runtime.' `
            -Action $taskAction `
            -Trigger $taskTrigger `
            -Principal $taskPrincipal `
            -Settings $taskSettings `
            -Force | Out-Null

        Start-ScheduledTask -TaskName $TaskName
        Write-Host "[SkyCommand Supervisor] Automatic startup installed and started: $TaskName"
        Write-Host "[SkyCommand Supervisor] Repository: $repositoryRoot"
        Write-Host "[SkyCommand Supervisor] Log: $logPath"
    }

    'Uninstall' {
        $task = Get-SupervisorTask
        if (-not $task) {
            Write-Host "[SkyCommand Supervisor] Scheduled task is not installed: $TaskName"
            break
        }
        Stop-SupervisorRuntime -Task $task
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[SkyCommand Supervisor] Automatic startup removed: $TaskName"
    }

    'Start' {
        $task = Get-SupervisorTask
        if (-not $task) { throw "Scheduled task is not installed: $TaskName" }
        if ($task.State -eq 'Running' -or (Get-SupervisorProcesses).Count -gt 0) {
            Write-Host "[SkyCommand Supervisor] Supervisor is already running: $TaskName"
            break
        }
        Remove-StaleRunnerPidFile
        Start-ScheduledTask -TaskName $TaskName
        Write-Host "[SkyCommand Supervisor] Start requested: $TaskName"
    }

    'Stop' {
        $task = Get-SupervisorTask
        if (-not $task) { throw "Scheduled task is not installed: $TaskName" }
        Stop-SupervisorRuntime -Task $task
        Write-Host "[SkyCommand Supervisor] Stop completed: $TaskName"
    }

    'Status' {
        $task = Get-SupervisorTask
        if (-not $task) {
            Write-Host '[SkyCommand Supervisor] Automatic startup: NOT INSTALLED'
            exit 1
        }

        $info = Get-ScheduledTaskInfo -TaskName $TaskName
        $processes = Get-SupervisorProcesses
        $runnerProcesses = Get-SupervisorRunnerProcesses
        $taskIsRunning = $task.State -eq 'Running'
        $operationalState = if ($taskIsRunning -and $processes.Count -gt 0) {
            'RUNNING'
        } elseif ($taskIsRunning) {
            'RUNNING (TASK SCHEDULER CONFIRMED; PROCESS UNOBSERVED)'
        } elseif ($processes.Count -gt 0) {
            'RUNNING OUTSIDE SCHEDULED TASK'
        } elseif ($task.State -eq 'Ready' -and $info.LastTaskResult -eq 267014) {
            'STOPPED (TASK SCHEDULER READY)'
        } else {
            'STOPPED'
        }

        Write-Host '[SkyCommand Supervisor] Automatic startup: INSTALLED'
        Write-Host "[SkyCommand Supervisor] Task: $TaskName"
        Write-Host "[SkyCommand Supervisor] Task state: $($task.State)"
        Write-Host "[SkyCommand Supervisor] Operational state: $operationalState"
        Write-Host "[SkyCommand Supervisor] Supervisor process count: $($processes.Count)"
        Write-Host "[SkyCommand Supervisor] Runner process count: $($runnerProcesses.Count)"
        Write-Host "[SkyCommand Supervisor] Runner PID file: $runnerPidPath"
        Write-Host "[SkyCommand Supervisor] Last run: $($info.LastRunTime)"
        Write-Host "[SkyCommand Supervisor] Last result: $($info.LastTaskResult)"
        Write-Host "[SkyCommand Supervisor] Log: $logPath"
        Write-Host '[SkyCommand Supervisor] Health proof: npm run supervisor:check'
        if ($operationalState -like 'RUNNING*') { exit 0 }
        exit 1
    }
}
