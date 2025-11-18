<#
.SYNOPSIS
SkyOps Git branch synchronization utilities.
Author: Paul Sattaur
Date: 2025-10-14
Purpose: Safely synchronize main and dev branches for SkyEco repositories.

.DESCRIPTION
This script provides interactive PowerShell functions to realign Git branches
in the SkyOps ecosystem.  It is designed to be dropped in your
tools/Git_Repo_Mgmt directory and sourced into a session via:

    . .\tools\PowerShell\Git_Repo_Mgmt\Git_Repo_Actions.ps1
#>

# --- Utility ------------------------------------------------------------------
function Write-Info($msg, $color = 'Cyan') {
    Write-Host $msg -ForegroundColor $color
}

function Confirm-Action($question) {
    $response = Read-Host "$question [y/N]"
    return $response -match '^[Yy]'
}

# --- Core Functions -----------------------------------------------------------

function Sync-MainToDev {
<#
.SYNOPSIS
Force-aligns main to match dev.
.DESCRIPTION
Updates local branches, resets main to origin/dev, and force-pushes to origin/main.
This ensures main mirrors the current dev tip exactly.
#>
    param(
        [string]$Dev  = "origin/dev",
        [string]$Main = "origin/main"
    )

    Write-Info "🔄 Fetching latest refs..."
    git fetch origin

    Write-Info "💡 Ensuring dev is current..."
    git switch dev
    git pull origin dev

    Write-Info "🩵 Preparing to reset main to dev..."
    if (-not (Confirm-Action "Proceed to reset main to dev?")) {
        Write-Info "❌ Operation cancelled." "Yellow"
        return
    }

    git switch main
    git reset --hard $Dev

    Write-Info "🚀 Force-pushing to remote main..." "Yellow"
    git push origin main --force

    Write-Info "✅ main is now aligned with dev." "Green"
}

function Sync-DevToMain {
<#
.SYNOPSIS
Force-aligns dev to match main.
.DESCRIPTION
Updates local branches, resets dev to origin/main, and force-pushes to origin/dev.
Used after production release to re-baseline development branch.
#>
    param(
        [string]$Dev  = "origin/dev",
        [string]$Main = "origin/main"
    )

    Write-Info "🔄 Fetching latest refs..."
    git fetch origin

    Write-Info "💡 Ensuring main is current..."
    git switch main
    git pull origin main

    Write-Info "🩵 Preparing to reset dev to main..."
    if (-not (Confirm-Action "Proceed to reset dev to main?")) {
        Write-Info "❌ Operation cancelled." "Yellow"
        return
    }

    git switch dev
    git reset --hard $Main

    Write-Info "🚀 Force-pushing to remote dev..." "Yellow"
    git push origin dev --force

    Write-Info "✅ dev is now aligned with main." "Green"
}

function Sync-Branches {
<#
.SYNOPSIS
Interactive branch synchronization tool.
.DESCRIPTION
Prompts the user to choose a direction (main→dev or dev→main)
and then calls the corresponding function with confirmation.
#>
    Write-Info "SkyOps Branch Synchronizer" "Magenta"
    Write-Host ""
    Write-Host "1️⃣  Sync main → dev"
    Write-Host "2️⃣  Sync dev → main"
    $choice = Read-Host "Select operation [1/2]"
    switch ($choice) {
        '1' { Sync-MainToDev }
        '2' { Sync-DevToMain }
        default { Write-Info "No valid option selected. Exiting..." "Yellow" }
    }
}

function Test-SkyBranchHealth {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [ValidateSet("SkyOps","SkyOne","SkyServer","SkyProject","NeoFinTech")]
        [string]$RepoName,
        [switch]$ShowFiles
    )

    $RepoPaths = @{
        "SkyOne"     = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOne System\SkyOne"
        "SkyProject" = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyProject System\SkyProject"
        "SkyOps"     = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOps System\SkyOps"
        "SkyServer"  = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyServer System\SkyServer"
        "NeoFinTech"  = "C:\Users\pauls\Dropbox\Programming\NeoFinTech System\NeoFinTech"
    }

    Set-Location $RepoPaths[$RepoName]
    git fetch origin | Out-Null
    Write-Host "🪶 Current branch: $(git rev-parse --abbrev-ref HEAD)" -ForegroundColor Magenta

    $aheadBehind = git rev-list --left-right --count origin/main...origin/dev 2>$null
    if ($aheadBehind) {
        $p = $aheadBehind -split '\s+'
        Write-Host "🧭 Sync summary (main vs dev): main behind $($p[1]) ahead $($p[0])" -ForegroundColor Cyan
    }

    if ($ShowFiles) {
        # Capture as a single string, then split into lines explicitly
        $filesText = git diff --name-only origin/main..origin/dev 2>$null | Out-String
        $files = $filesText -split '\r?\n' | Where-Object { $_.Trim() -ne '' }

        $count = $files.Count
        Write-Host "`n📂 Files differing between origin/main and origin/dev ($count):" -ForegroundColor Yellow
        if ($count -gt 0) {
            foreach ($f in $files) { Write-Host "  - $f" }
        } else {
            Write-Host "  (none)"
        }
    }

    $status = git status -s
    if ($status) { Write-Host "`n⚠️  Uncommitted local changes:" -ForegroundColor Red; Write-Host $status }
    else         { Write-Host "`n✅ Working tree clean." -ForegroundColor Green }
}


function Invoke-SkyRepoCommit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("SkyOps", "SkyOne", "SkyServer", "SkyProject", "NeoFinTech")]
        [string]$RepoName,

        [Parameter(Mandatory = $true)]
        [string]$Message,

        [switch]$RunDelta
    )

    Write-Host "🚀 Starting SkyRepo commit workflow for $RepoName..." -ForegroundColor Cyan

    # --- Absolute repo paths ---
    $RepoPaths = @{
        "SkyOne"     = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOne System\SkyOne"
        "SkyProject" = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyProject System\SkyProject"
        "SkyOps"     = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOps System\SkyOps"
        "SkyServer"  = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyServer System\SkyServer"
        "NeoFinTech"  = "C:\Users\pauls\Dropbox\Programming\NeoFinTech System\NeoFinTech"
    }

    # --- Shared SkyOps Python script ---
    $SkyOpsScript = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOps System\SkyOps\tools\Python\Git_Repo_Docs\dev_commit_auto.py"

    # --- Validate repo path ---
    if (-not (Test-Path $RepoPaths[$RepoName])) {
        Write-Host "❌ Repo path not found: $($RepoPaths[$RepoName])" -ForegroundColor Red
        return
    }

    Set-Location $RepoPaths[$RepoName]
    Write-Host "📁 Working directory: $(Get-Location)" -ForegroundColor Yellow

    # --- Ensure we’re on dev branch ---
    Write-Host "🌿 Switching to dev branch..." -ForegroundColor Cyan
    git fetch origin
    $switchResult = git switch dev 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to switch to dev. Make sure the dev branch exists." -ForegroundColor Red
        Write-Host $switchResult -ForegroundColor DarkGray
        return
    }

    # --- 🧩 Run Sky Delta Update FIRST ---
    if ($RunDelta) {
        Write-Host "🧠 Generating delta files before commit..." -ForegroundColor Cyan

        # Repo-root output paths
        $RepoMapPath = "RepoMap_${RepoName}.json"
        $ReportPath  = "DeltaReport_${RepoName}.md"

        python $SkyOpsScript --name $RepoName --repo-path . --repomap $RepoMapPath --report $ReportPath

        # Wait briefly to ensure file flush
        Start-Sleep -Seconds 2

        # Confirm existence before continuing
        if ((Test-Path $RepoMapPath) -and (Test-Path $ReportPath)) {
            Write-Host "✅ Delta files created: $RepoMapPath, $ReportPath" -ForegroundColor Green
        } else {
            Write-Host "⚠️  Delta files missing or not detected; continuing anyway..." -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "⚙️  Skipping Sky Delta Update (RunDelta flag not set)." -ForegroundColor DarkYellow
    }

    # --- Stage, commit, push ---
    Write-Host "📦 Staging changes (including RepoMap + DeltaReport)..." -ForegroundColor Yellow
    git add -A

    Write-Host "💬 Committing with message: $Message" -ForegroundColor Yellow
    git commit -m $Message

    Write-Host "🚀 Pushing to origin/dev..." -ForegroundColor Yellow
    git push origin dev

    Write-Host "✅ Completed SkyRepo commit workflow for $RepoName." -ForegroundColor Green
}

function Invoke-MainMergeAuto {
    <#
    .SYNOPSIS
    Automates local post-release merge, fast-forward, and optional push for Sky repos.

    .DESCRIPTION
    Runs the Python automation main_merge_auto.py to:
      1. Update local 'main' from origin/main
      2. Optionally create a version tag (vYYYY.MM.DD[-n])
      3. Update and fast-forward 'dev' from new main
      4. Optionally push all changes (includes tag and fast-forward commits)

    .PARAMETER RepoName
    Logical name of the repository ("SkyOps", "SkyOne", "SkyProject", "SkyServer")

    .PARAMETER Tag
    Switch to enable release tagging.

    .PARAMETER TagSuffix
    Optional suffix for tag (e.g. "-1")

    .PARAMETER Push
    Pushes local changes (tags, merges) to origin when complete.

    .EXAMPLE
    Invoke-MainMergeAuto -RepoName "SkyOps"
    Invoke-MainMergeAuto -RepoName "SkyOne" -Tag -Push
    #>

    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("SkyOps", "SkyOne", "SkyProject", "SkyServer", "NeoFinTech")]
        [string]$RepoName,

        [switch]$Tag,
        [string]$TagSuffix,
        [switch]$Push
    )

    try {
        # --- Absolute repo paths ---
        $RepoPaths = @{
            "SkyOne"     = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOne System\SkyOne"
            "SkyProject" = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyProject System\SkyProject"
            "SkyOps"     = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOps System\SkyOps"
            "SkyServer"  = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyServer System\SkyServer"
            "NeoFinTech"  = "C:\Users\pauls\Dropbox\Programming\NeoFinTech System\NeoFinTech"
        }

        if (-not $RepoPaths.ContainsKey($RepoName)) {
            throw "Unknown repository name '$RepoName'. Valid options: $($RepoPaths.Keys -join ', ')"
        }

        $RepoPath = $RepoPaths[$RepoName]
        $ScriptPath = Join-Path $PSScriptRoot "..\..\Python\Git_Repo_Docs\main_merge_auto.py"

        if (-not (Test-Path $ScriptPath)) {
            throw "Python automation script not found at $ScriptPath"
        }

        $Args = @("--name", $RepoName, "--repo-path", $RepoPath)
        if ($Tag) { $Args += "--tag" }
        if ($TagSuffix) { $Args += @("--tag-suffix", $TagSuffix) }

        Write-Host "`n[SkyOps] Running post-release Git sync for $RepoName`n" -ForegroundColor Cyan
        python $ScriptPath @Args

        if ($Push) {
            Write-Host "`n→ Pushing updated branches and tags to origin...`n" -ForegroundColor Yellow
            Push-Location $RepoPath
            git push origin main
            git push origin dev
            git push --tags
            Pop-Location
        }

        Write-Host "`n✅ Post-release Git sync complete for $RepoName`n" -ForegroundColor Green
    }
    catch {
        Write-Host "`n❌ Error during main merge automation:`n$($_.Exception.Message)`n" -ForegroundColor Red
    }
}
