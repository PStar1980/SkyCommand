<#
.SYNOPSIS
  Cleans Vite and npm build caches for a specified frontend folder.

.DESCRIPTION
  Deletes .vite cache, clears npm cache, and optionally restarts the Vite dev server.

.PARAMETER FrontendPath
  Absolute path to the frontend folder.
  Example:
  "C:\Users\pauls\Dropbox\Programming\NeoFinTech System\NeoFinTech\frontend"

.EXAMPLE
cd "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOps System\SkyOps\tools\PowerShell\MERN_Tools"  
./Clean-FrontendCache.ps1 -FrontendPath "C:\Users\pauls\Dropbox\Programming\NeoFinTech System\NeoFinTech\frontend"
./Clean-FrontendCache.ps1 -FrontendPath "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyWeb System\SkyWeb\apps\web"
#>

param (
    [Parameter(Mandatory = $true)]
    [string]$FrontendPath
)

# --- Validation ---
if (-not (Test-Path $FrontendPath)) {
    Write-Host "❌ The specified path does not exist: $FrontendPath" -ForegroundColor Red
    exit 1
}

Write-Host "🧭 Target frontend path: $FrontendPath" -ForegroundColor Cyan

# --- Paths ---
$viteCache = Join-Path $FrontendPath "node_modules\.vite"

# --- Cleanup Phase ---
Write-Host "`n🧹 Cleaning Vite cache..." -ForegroundColor Cyan
if (Test-Path $viteCache) {
    Remove-Item -Recurse -Force $viteCache
    Write-Host "✅ Removed .vite cache folder:`n   $viteCache"
} else {
    Write-Host "ℹ️  No .vite cache folder found.`n   $viteCache"
}

# --- NPM Cache ---
Write-Host "`n🧼 Clearing npm cache..." -ForegroundColor Cyan
Push-Location $FrontendPath
npm cache clean --force | Out-Null
Pop-Location
Write-Host "✅ npm cache cleared."

# --- Optional Restart ---
$choice = Read-Host "`nRestart Vite dev server now? (y/n)"
if ($choice -eq 'y' -or $choice -eq 'Y') {
    Write-Host "`n🚀 Starting Vite dev server..." -ForegroundColor Green
    Push-Location $FrontendPath

    if (Test-Path (Join-Path $FrontendPath "package.json")) {
        npm run dev
    } else {
        Write-Host "⚠️  package.json not found in:`n   $FrontendPath" -ForegroundColor Yellow
    }

    Pop-Location
} else {
    Write-Host "`n✨ Frontend cleanup complete. Start Vite manually when ready." -ForegroundColor Green
}
