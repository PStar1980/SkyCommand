<#
.SYNOPSIS
  Cleans backend caches, temporary build artifacts, and npm cache for Node.js apps.

.DESCRIPTION
  Deletes .cache, dist, and log directories under the specified backend path.
  Clears npm’s cache and optionally restarts the backend dev server.

.PARAMETER BackendPath
  Absolute path to the backend folder. Example:
  "C:\Users\pauls\Dropbox\Programming\NeoFinTech System\NeoFinTech\backend"

.EXAMPLE
cd "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOps System\SkyOps\tools\PowerShell\MERN_Tools"
./Clean-BackendCache.ps1 -BackendPath "C:\Users\pauls\Dropbox\Programming\NeoFinTech System\NeoFinTech\backend"
./Clean-BackendCache.ps1 -BackendPath "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyWeb System\SkyWeb\apps\server"
#>

param (
    [Parameter(Mandatory = $true)]
    [string]$BackendPath
)

# --- Validation ---
if (-not (Test-Path $BackendPath)) {
    Write-Host "❌ The specified path does not exist: $BackendPath" -ForegroundColor Red
    exit 1
}

Write-Host "🧭 Target backend path: $BackendPath" -ForegroundColor Cyan

# --- Paths ---
$cacheDirs = @(
    (Join-Path $BackendPath ".cache"),
    (Join-Path $BackendPath "dist"),
    (Join-Path $BackendPath "logs"),
    (Join-Path $BackendPath "node_modules\.cache")
)

# --- Cleanup Phase ---
Write-Host "`n🧹 Cleaning backend caches..." -ForegroundColor Cyan
foreach ($dir in $cacheDirs) {
    if (Test-Path $dir) {
        Remove-Item -Recurse -Force $dir
        Write-Host "✅ Removed cache folder:`n   $dir"
    } else {
        Write-Host "ℹ️  No cache folder found:`n   $dir"
    }
}

# --- NPM Cache ---
Write-Host "`n🧼 Clearing npm cache..." -ForegroundColor Cyan
Push-Location $BackendPath
npm cache clean --force | Out-Null
Pop-Location
Write-Host "✅ npm cache cleared."

# --- Optional Restart ---
$choice = Read-Host "`nRestart backend server now? (y/n)"
if ($choice -eq 'y' -or $choice -eq 'Y') {
    Write-Host "`n🚀 Launching backend dev server..." -ForegroundColor Green
    Push-Location $BackendPath

    if (Test-Path (Join-Path $BackendPath "package.json")) {
        # Prefer npm run dev if defined
        if ((Get-Content package.json | Select-String '"dev"')) {
            npm run dev
        } elseif (Test-Path (Join-Path $BackendPath "server.js")) {
            nodemon server.js
        } else {
            Write-Host "⚠️  No recognized start command found. Start manually." -ForegroundColor Yellow
        }
    }
    Pop-Location
} else {
    Write-Host "`n✨ Backend cleanup complete. Start manually when ready." -ForegroundColor Green
}
