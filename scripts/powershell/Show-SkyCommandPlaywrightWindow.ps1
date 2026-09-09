param(
    [Parameter(Mandatory = $true)]
    [int]$RootProcessId,

    [int]$TimeoutSeconds = 12
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

$deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
$shell = New-Object -ComObject WScript.Shell

while ((Get-Date) -lt $deadline) {
    foreach ($processId in (Get-DescendantProcessIds -ParentId $RootProcessId)) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (-not $process) { continue }

        if ($process.ProcessName -notmatch '^(chrome|chromium|msedge)$') { continue }
        if ($process.MainWindowHandle -eq [IntPtr]::Zero) { continue }

        $handle = [IntPtr]$process.MainWindowHandle
        # SW_RESTORE = 9. This counteracts the hidden Host Agent launcher chain and
        # also restores a Chromium window that Windows elected not to foreground.
        [void][SkyCommand.Native.WindowPresenter]::ShowWindowAsync($handle, 9)
        [void][SkyCommand.Native.WindowPresenter]::BringWindowToTop($handle)
        [void]$shell.AppActivate($process.Id)
        [void][SkyCommand.Native.WindowPresenter]::SetForegroundWindow($handle)
        exit 0
    }

    Start-Sleep -Milliseconds 150
}

# Presentation is best-effort visual behavior. A timeout must not fail the test itself.
exit 0
