<#
.SYNOPSIS
Builds SkyBoot.zip for the SkyOne repo (clean rebuild each run).

.DESCRIPTION
- Deletes everything in dist at start.
- Recreates fresh build structure.
- Builds inner SkyOne_Bootloader.zip.
- Packages outer SkyBoot.zip.
- Copies SkyOne_Rehydrate_Util.py to dist.
- Removes all staging directories.
#>

[CmdletBinding()]
param()

Write-Host "`n=== Building SkyBoot package for SkyOne ===" -ForegroundColor Cyan

# --- Paths ---
$SkyOneRoot = "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOne System\SkyOne"
$DistDir    = Join-Path $SkyOneRoot "dist"
$StageDir   = Join-Path $DistDir "stage_boot"     # outer stage
$InnerStage = Join-Path $DistDir "inner_stage"    # inner stage (separate)
$InnerDir   = Join-Path $InnerStage "SkyOne_Bootloader"

# --- Step 1: Clean dist folder ---
Write-Host "`n→ Cleaning dist folder..." -ForegroundColor Yellow
if (Test-Path $DistDir) {
    try {
        Get-ChildItem -Path $DistDir -Force | Remove-Item -Recurse -Force -ErrorAction Stop
        Write-Host "✔ Cleared existing dist contents."
    }
    catch {
        Write-Warning "Retrying dist cleanup..."
        Start-Sleep -Milliseconds 500
        Get-ChildItem -Path $DistDir -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
}
Write-Host "→ Fresh dist ready at: $DistDir"

# --- Step 2: Create staging directories ---
New-Item -ItemType Directory -Force -Path $InnerDir | Out-Null

# --- Step 3: Copy inner bootloader files ---
$InnerFiles = @(
  "SkyOne_Bootloader.py",
  "SkyOne_Boot_Manifest.csv",
  "SkyOne_Bootload_Util.py",
  "SkyOne_Rehydrate_Util.py",
  "SkyOne_Functions_Core.py",
  "SkyOne_Functions_Index.py",
  "SkyOne_Functions_Logs.py",
  "SkyOne_Functions_Memory.py",
  "SkyOne_Functions_Schedule.py",
  "SkyOne_Functions_Sky.py",
  "SkyOne_Functions_Test.py"
)

Write-Host "`n→ Copying inner bootloader files..." -ForegroundColor Yellow
foreach ($file in $InnerFiles) {
    $src = Join-Path $SkyOneRoot $file
    $dest = Join-Path $InnerDir $file
    if (Test-Path $src) {
        Copy-Item $src -Destination $dest -Force
    } else {
        Write-Warning "Missing file: $file"
    }
}

# --- Step 4: Build inner zip ---
# Source is the SkyOne repo root (SkyOne_* files live here)
$SourceDir = $SkyOneRoot   # <-- use the repo root you already set at the top

$InnerZip = Join-Path $InnerStage "SkyOne_Bootloader.zip"
if (Test-Path $InnerZip) { Remove-Item $InnerZip -Force }

# Container folder inside inner_stage so the zip has a single top-level folder
$InnerFolder = Join-Path $InnerStage "SkyOne_Bootloader"
if (Test-Path $InnerFolder) { Remove-Item $InnerFolder -Recurse -Force }
New-Item -ItemType Directory -Path $InnerFolder | Out-Null

# Copy bootloader files into the container folder
$SourcePattern = Join-Path $SourceDir "SkyOne_*.*"
if (-not (Test-Path $SourceDir)) {
    throw "❌ Source directory not found: $SourceDir"
}
Copy-Item $SourcePattern -Destination $InnerFolder -Force

Write-Host "`n→ Creating inner bootloader package..." -ForegroundColor Yellow
Compress-Archive -Path (Join-Path $InnerStage "SkyOne_Bootloader") -DestinationPath $InnerZip -Force
Write-Host "   Waiting for inner zip to finish writing..." -ForegroundColor DarkGray

# Wait for the zip to appear and be readable
$maxWait = 10
$wait = 0
while (-not (Test-Path $InnerZip) -and ($wait -lt $maxWait)) {
    Start-Sleep -Milliseconds 300
    $wait++
}
if (-not (Test-Path $InnerZip)) {
    throw "❌ Inner zip was not created successfully at $InnerZip"
}

# Give filesystem a moment to unlock the handle (for slower drives / Dropbox sync)
Start-Sleep -Milliseconds 500

Write-Host "✔ Inner package created: $InnerZip" -ForegroundColor Green

# --- Step 5: Build outer SkyBoot package (single canonical block) ---
Write-Host "`n> Preparing outer package..." -ForegroundColor Yellow

$InnerZip  = Join-Path $InnerStage "SkyOne_Bootloader.zip"
$StageDir  = Join-Path $DistDir "stage_boot"
$OuterZip  = Join-Path $DistDir "SkyBoot.zip"

# Ensure inner zip exists (Dropbox may lag briefly)
$maxWait = 10; $wait = 0
while (-not (Test-Path $InnerZip) -and ($wait -lt $maxWait)) { Start-Sleep -Milliseconds 300; $wait++ }
if (-not (Test-Path $InnerZip)) { throw "❌ Inner zip missing or locked: $InnerZip" }

# Fresh stage_boot
if (Test-Path $StageDir) {
  $retry=0; while ($retry -lt 5) {
    try { Remove-Item $StageDir -Recurse -Force -ErrorAction Stop; break }
    catch { Write-Warning "stage_boot in use, retrying..."; Start-Sleep -Milliseconds 300; $retry++ }
  }
}
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

# Copy artifacts
Write-Host "   Copying build artifacts..." -ForegroundColor DarkGray
Copy-Item $InnerZip -Destination $StageDir -Force
$readme   = Join-Path $SourceDir "README_SkyBoot.txt"
$bootUtil = Join-Path $SourceDir "SkyOne_Bootload_Util.py"
if (Test-Path $readme)   { Copy-Item $readme   -Destination $StageDir -Force }
if (Test-Path $bootUtil) { Copy-Item $bootUtil -Destination $StageDir -Force }

Start-Sleep -Milliseconds 300
if ((Get-ChildItem $StageDir -Force | Measure-Object).Count -eq 0) { throw "❌ Nothing to package in $StageDir." }

# Build SkyBoot.zip from the CONTENTS of stage_boot (not the folder)
if (Test-Path $OuterZip) { Remove-Item $OuterZip -Force }
Write-Host "   Creating outer package..." -ForegroundColor Yellow
Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $OuterZip -Force
if (-not (Test-Path $OuterZip)) { throw "❌ Outer zip was not created at $OuterZip" }
Write-Host "✔ Outer package created: $OuterZip" -ForegroundColor Green

# --- Step 6: Release inner folder before outer compression ---
if (Test-Path $InnerDir) {
    try {
        Write-Host "→ Cleaning inner folder before outer zip..."
        Remove-Item $InnerDir -Recurse -Force -ErrorAction Stop
        Start-Sleep -Milliseconds 300
    } catch {
        Write-Warning "Could not remove inner folder on first try."
    }
}

# --- Step 6b: Remove inner_stage directory before outer compression ---
if (Test-Path $InnerStage) {
    try {
        Write-Host "→ Removing inner_stage before packaging outer zip..." -ForegroundColor Yellow
        Remove-Item $InnerStage -Recurse -Force -ErrorAction Stop
        Start-Sleep -Milliseconds 300
        Write-Host "✔ inner_stage folder removed successfully." -ForegroundColor Green
    } catch {
        Write-Warning "Could not remove inner_stage folder on first try."
    }
}

# --- Step 7: Build outer zip ---
$OuterZip = Join-Path $DistDir "SkyBoot.zip"
if (Test-Path $OuterZip) { Remove-Item $OuterZip -Force }
Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $OuterZip -Force
Write-Host "✔ Outer package created: $OuterZip" -ForegroundColor Green

# --- Step 8: Copy standalone Rehydrate util ---
$RehydrateSrc = Join-Path $SkyOneRoot "SkyOne_Rehydrate_Util.py"
$RehydrateDst = Join-Path $DistDir "SkyOne_Rehydrate_Util.py"
if (Test-Path $RehydrateSrc) {
    Copy-Item $RehydrateSrc -Destination $RehydrateDst -Force
    Write-Host "✔ Copied SkyOne_Rehydrate_Util.py to dist." -ForegroundColor Green
} else {
    Write-Warning "Missing: SkyOne_Rehydrate_Util.py"
}

# --- Step 9: Final cleanup with retries ---
Write-Host "`n→ Cleaning up staging area..." -ForegroundColor Yellow
$cleanupAttempts = 0
while ((Test-Path $StageDir) -and ($cleanupAttempts -lt 6)) {
    try {
        Remove-Item $StageDir -Recurse -Force -ErrorAction Stop
        Write-Host "✔ Stage cleaned up." -ForegroundColor Green
        break
    } catch {
        $cleanupAttempts++
        Write-Warning "Cleanup attempt #$cleanupAttempts failed, retrying..."
        Start-Sleep -Milliseconds 500
    }
}
if (Test-Path $StageDir) {
    Write-Warning "⚠ Could not fully remove $StageDir after several attempts."
} 

Write-Host "`n✅ Build complete! Output in:" -ForegroundColor Green
Write-Host "   $DistDir" -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor DarkGray
