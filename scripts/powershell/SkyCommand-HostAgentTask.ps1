param(
    [ValidateSet('Install', 'Uninstall', 'Status', 'Start', 'Stop')]
    [string]$Action = 'Status',

    [string]$TaskName = 'SkyCommand Host Agent'
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'SkyCommand Host Agent automatic startup is currently supported only on Windows.'
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$runnerScript = Join-Path $repositoryRoot 'scripts\powershell\Start-SkyCommandHostAgent.ps1'
$envPath = Join-Path $repositoryRoot '.env'
$workerScript = Join-Path $repositoryRoot 'packages\host-agent\src\worker.js'
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$scheduledTaskLogPath = Join-Path $repositoryRoot 'logs\host-agent\scheduled-task.log'

function Get-NodeExecutable {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    }
    if (-not $nodeCommand) {
        throw 'Node.js was not found in PATH. Install Node.js or make node.exe available before installing the Host Agent task.'
    }
    return $nodeCommand.Source
}

function Assert-HostAgentEnvironment {
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
        throw "SkyCommand .env was not found at $envPath"
    }

    $enabled = Select-String -LiteralPath $envPath -Pattern '^\s*SKYCOMMAND_HOST_AGENT_ENABLED\s*=\s*true\s*$' -CaseSensitive:$false
    if (-not $enabled) {
        throw 'SKYCOMMAND_HOST_AGENT_ENABLED=true is required in .env before installing automatic Host Agent startup.'
    }

    if (-not (Test-Path -LiteralPath $workerScript -PathType Leaf)) {
        throw "Host Agent worker script was not found at $workerScript"
    }
}

function Get-HostAgentTask {
    return Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Get-HostAgentProcesses {
    $workerPattern = [regex]::Escape($workerScript)
    return @(
        Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
            Where-Object {
                $_.CommandLine -and (
                    $_.CommandLine -match $workerPattern -or
                    ($_.CommandLine -match 'host-agent' -and $_.CommandLine -match 'worker\.js')
                )
            }
    )
}

function Get-HostAgentRunnerProcesses {
    $runnerPattern = [regex]::Escape($runnerScript)
    return @(
        Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
            Where-Object {
                $_.CommandLine -and $_.CommandLine -match $runnerPattern
            }
    )
}

switch ($Action) {
    'Install' {
        Assert-HostAgentEnvironment
        $nodePath = Get-NodeExecutable
        $powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
        $existingTask = Get-HostAgentTask

        if ($existingTask -and $existingTask.State -eq 'Running') {
            Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
            for ($attempt = 0; $attempt -lt 10; $attempt += 1) {
                Start-Sleep -Milliseconds 250
                if ((Get-HostAgentProcesses).Count -eq 0) {
                    break
                }
            }
        }

        $existingProcesses = Get-HostAgentProcesses
        if ($existingProcesses.Count -gt 0) {
            $processIds = ($existingProcesses | ForEach-Object { $_.ProcessId }) -join ', '
            throw "A host-native SkyCommand Host Agent is already running (PID(s): $processIds). Stop the manual 'npm run host-agent' process before installing automatic startup."
        }

        $arguments = @(
            '-NoProfile',
            '-NonInteractive',
            '-WindowStyle', 'Hidden',
            '-ExecutionPolicy', 'Bypass',
            '-File', ('"{0}"' -f $runnerScript),
            '-RepositoryRoot', ('"{0}"' -f $repositoryRoot),
            '-NodePath', ('"{0}"' -f $nodePath)
        ) -join ' '

        $taskAction = New-ScheduledTaskAction `
            -Execute $powershellPath `
            -Argument $arguments `
            -WorkingDirectory $repositoryRoot

        $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentIdentity
        $taskPrincipal = New-ScheduledTaskPrincipal `
            -UserId $currentIdentity `
            -LogonType Interactive `
            -RunLevel Limited
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
            -Description 'Starts the host-native SkyCommand Host Agent after user logon. The Host Agent polls only its dedicated Temporal activity queue.' `
            -Action $taskAction `
            -Trigger $taskTrigger `
            -Principal $taskPrincipal `
            -Settings $taskSettings `
            -Force | Out-Null

        Start-ScheduledTask -TaskName $TaskName
        Write-Host "[SkyCommand Host Agent] Automatic startup installed and started: $TaskName"
        Write-Host "[SkyCommand Host Agent] Repository: $repositoryRoot"
        Write-Host "[SkyCommand Host Agent] Log: $(Join-Path $repositoryRoot 'logs\host-agent\scheduled-task.log')"
    }

    'Uninstall' {
        $task = Get-HostAgentTask
        if (-not $task) {
            Write-Host "[SkyCommand Host Agent] Scheduled task is not installed: $TaskName"
            break
        }

        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[SkyCommand Host Agent] Automatic startup removed: $TaskName"
    }

    'Start' {
        $task = Get-HostAgentTask
        if (-not $task) {
            throw "Scheduled task is not installed: $TaskName"
        }
        Start-ScheduledTask -TaskName $TaskName
        Write-Host "[SkyCommand Host Agent] Start requested: $TaskName"
    }

    'Stop' {
        $task = Get-HostAgentTask
        if (-not $task) {
            throw "Scheduled task is not installed: $TaskName"
        }
        Stop-ScheduledTask -TaskName $TaskName
        Write-Host "[SkyCommand Host Agent] Stop requested: $TaskName"
    }

    'Status' {
        $task = Get-HostAgentTask
        if (-not $task) {
            Write-Host "[SkyCommand Host Agent] Automatic startup: NOT INSTALLED"
            exit 1
        }

        $info = Get-ScheduledTaskInfo -TaskName $TaskName
        $processes = Get-HostAgentProcesses
        $runnerProcesses = Get-HostAgentRunnerProcesses
        $processCount = $processes.Count
        $runnerProcessCount = $runnerProcesses.Count
        $processIds = if ($processCount -gt 0) {
            ($processes | ForEach-Object { $_.ProcessId }) -join ', '
        } else {
            '-'
        }
        $runnerProcessIds = if ($runnerProcessCount -gt 0) {
            ($runnerProcesses | ForEach-Object { $_.ProcessId }) -join ', '
        } else {
            '-'
        }
        $lastTaskResultHex = '0x{0:X8}' -f ([uint32]$info.LastTaskResult)
        $taskIsRunning = $task.State -eq 'Running'

        $operationalState = 'STOPPED'
        $statusExitCode = 1
        if ($taskIsRunning -and $processCount -gt 0) {
            $operationalState = 'RUNNING'
            $statusExitCode = 0
        } elseif ($taskIsRunning -and $runnerProcessCount -gt 0) {
            # Task Scheduler directly owns the PowerShell runner. Windows CIM can
            # occasionally omit the child node.exe command line even though the
            # long-running task is healthy, so the runner is a valid task-layer proof.
            $operationalState = 'RUNNING (RUNNER OBSERVED; NODE PROCESS UNOBSERVED)'
            $statusExitCode = 0
        } elseif ($taskIsRunning) {
            # 0x00041301 / 267009 is SCHED_S_TASK_RUNNING, an informational
            # Task Scheduler result meaning the task is currently running. Do not
            # misclassify it as a failure merely because CIM process discovery
            # cannot see the child process. The Temporal health check remains the
            # end-to-end authority for host-agent reachability.
            $operationalState = 'RUNNING (TASK SCHEDULER CONFIRMED; PROCESS UNOBSERVED)'
            $statusExitCode = 0
        } elseif ($processCount -gt 0) {
            $operationalState = 'RUNNING OUTSIDE SCHEDULED TASK'
        } elseif ($task.State -eq 'Ready' -and $info.LastTaskResult -eq 267014) {
            # 0x00041306 / 267014 is SCHED_S_TASK_TERMINATED. This is the normal
            # result after an explicit Stop-ScheduledTask request, so report the
            # Host Agent as intentionally stopped rather than failed.
            $operationalState = 'STOPPED (TASK SCHEDULER READY)'
        } elseif ($info.LastTaskResult -ne 0) {
            $operationalState = 'FAILED'
        }

        Write-Host "[SkyCommand Host Agent] Automatic startup: INSTALLED"
        Write-Host "[SkyCommand Host Agent] Task: $TaskName"
        Write-Host "[SkyCommand Host Agent] Task state: $($task.State)"
        Write-Host "[SkyCommand Host Agent] Operational state: $operationalState"
        Write-Host "[SkyCommand Host Agent] Host process count: $processCount"
        Write-Host "[SkyCommand Host Agent] Host process PID(s): $processIds"
        Write-Host "[SkyCommand Host Agent] Runner process count: $runnerProcessCount"
        Write-Host "[SkyCommand Host Agent] Runner process PID(s): $runnerProcessIds"
        Write-Host "[SkyCommand Host Agent] Last run: $($info.LastRunTime)"
        Write-Host "[SkyCommand Host Agent] Last result: $($info.LastTaskResult) ($lastTaskResultHex)"
        Write-Host "[SkyCommand Host Agent] Next run: $($info.NextRunTime)"
        Write-Host "[SkyCommand Host Agent] Log: $scheduledTaskLogPath"
        Write-Host "[SkyCommand Host Agent] Health proof: npm run host-agent:check"

        if ($taskIsRunning -and $processCount -eq 0) {
            Write-Host "[SkyCommand Host Agent] Node process discovery is advisory on Windows; Task Scheduler still reports the registered runner as active. Use the health proof for end-to-end confirmation."
        } elseif ($operationalState -like 'STOPPED*') {
            Write-Host "[SkyCommand Host Agent] Automatic Host Agent is intentionally stopped. Start it before launching host-dependent workflows."
        } elseif ($statusExitCode -ne 0) {
            Write-Host "[SkyCommand Host Agent] Automatic Host Agent is not currently running because the last task run failed. Review the task log before launching host-dependent workflows."
        }
        exit $statusExitCode
    }
}
