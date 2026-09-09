param(
    [Parameter(Mandatory = $true)]
    [int]$RootProcessId,

    [int]$TimeoutSeconds = 12,

    [int]$FocusDurationMs = 2500
)

$ErrorActionPreference = 'SilentlyContinue'

if ($env:OS -ne 'Windows_NT') {
    exit 0
}

if (-not ([System.Management.Automation.PSTypeName]'SkyCommand.Native.WindowPresenter').Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace SkyCommand.Native
{
    public static class WindowPresenter
    {
        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool SetActiveWindow(IntPtr hWnd);
    }
}
'@
}

function Get-DescendantProcessIds {
    param([int]$ParentId)

    $known = New-Object 'System.Collections.Generic.HashSet[int]'
    [void]$known.Add($ParentId)

    $changed = $true
    while ($changed) {
        $changed = $false
        $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
        foreach ($process in $processes) {
            if ($known.Contains([int]$process.ParentProcessId) -and -not $known.Contains([int]$process.ProcessId)) {
                [void]$known.Add([int]$process.ProcessId)
                $changed = $true
            }
        }
    }

    return @($known | Where-Object { $_ -ne $ParentId })
}

function Present-ChromiumWindow {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$DurationMs
    )

    $handle = [IntPtr]$Process.MainWindowHandle
    if ($handle -eq [IntPtr]::Zero) { return $false }

    $shell = New-Object -ComObject WScript.Shell
    $focusDeadline = (Get-Date).AddMilliseconds([Math]::Max(500, $DurationMs))

    do {
        # SW_SHOW = 5 and SW_MAXIMIZE = 3. Reapply for a short window because Chromium
        # can finish creating/repositioning its top-level window after the first handle
        # becomes visible when launched from the hidden Host Agent process tree.
        [void][SkyCommand.Native.WindowPresenter]::ShowWindowAsync($handle, 5)
        [void][SkyCommand.Native.WindowPresenter]::ShowWindowAsync($handle, 3)
        [void][SkyCommand.Native.WindowPresenter]::BringWindowToTop($handle)
        [void]$shell.AppActivate($Process.Id)
        [void][SkyCommand.Native.WindowPresenter]::SetActiveWindow($handle)
        [void][SkyCommand.Native.WindowPresenter]::SetForegroundWindow($handle)
        Start-Sleep -Milliseconds 200

        $Process.Refresh()
        if ($Process.HasExited) { break }
        if ($Process.MainWindowHandle -ne [IntPtr]::Zero) {
            $handle = [IntPtr]$Process.MainWindowHandle
        }
    } while ((Get-Date) -lt $focusDeadline)

    return $true
}

$deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))

while ((Get-Date) -lt $deadline) {
    foreach ($processId in (Get-DescendantProcessIds -ParentId $RootProcessId)) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (-not $process) { continue }
        if ($process.ProcessName -notmatch '^(chrome|chromium|msedge)$') { continue }
        if ($process.MainWindowHandle -eq [IntPtr]::Zero) { continue }

        if (Present-ChromiumWindow -Process $process -DurationMs $FocusDurationMs) {
            exit 0
        }
    }

    Start-Sleep -Milliseconds 125
}

# Presentation is best-effort visual behavior. A timeout must not fail the test itself.
exit 0
