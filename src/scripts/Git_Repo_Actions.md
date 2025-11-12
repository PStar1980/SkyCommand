# 🪶 SkyOps PowerShell Helper Utilities

This module provides safe, guided PowerShell commands for synchronizing  
`main` and `dev` branches across SkyEco repositories and automating commits, delta generation, and branch health checks.

---

- **SkyOne** (SkyEco ChatGPT bootloader)
  cd "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOne System\SkyOne"

- **SkyProject** (SkyEco project/memory tier)
  cd "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyProject System\SkyProject"

- **SkyOps** (SkyEco automation tier)
  cd "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOps System\SkyOps"

- **SkyServer** (SkyEco server tier)
  cd "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyServer System\SkyServer"

- **SkyWeb** (SkyEco multi tier application)
  cd "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyWeb System\SkyWeb"

- **NeoFinTech** (MERN architecture)
  cd "C:\Users\pauls\Dropbox\Programming\NeoFinTech System\NeoFinTech"

## 📂 Instructions

```powershell
# Navigate to the folder
cd "C:\Users\pauls\Dropbox\Programming\SkyEco System\SkyOps System\SkyOps\tools\PowerShell\Git_Repo_Mgmt"

# Load the script into your current session
. .\Git_Repo_Actions.ps1   # Note the dot and space before path
```

Then you can call any function directly, for example:

```powershell
Test-SkyBranchHealth -RepoName "SkyOps"
Sync-DevToMain / Sync-MainToDev
Invoke-SkyRepoCommit -RepoName "SkyOps" -Message "Updated delta utilities" -RunDelta
Invoke-MainMergeAuto -RepoName "SkyOps" -Push / Invoke-MainMergeAuto -RepoName "SkyOne" -Push -Tag -TagSuffix "-1"
```

---

## 🧠 Functions

### 1. `Sync-MainToDev`

Force-realigns `main` to match the current `dev` branch.

**Usage:**

```powershell
Sync-MainToDev
```

**Flow:**

1. Fetch latest refs
2. Update local `dev`
3. Confirm intent
4. Reset `main` to match `dev`
5. Force-push to GitHub

Use this **after successful CI validation** when `dev` should become production-ready.

---

### 2. `Sync-DevToMain`

Force-realigns `dev` to match `main`.

**Usage:**

```powershell
Sync-DevToMain
```

**Flow:**

1. Fetch latest refs
2. Update local `main`
3. Confirm intent
4. Reset `dev` to match `main`
5. Force-push to GitHub

Use this **after production release** to re-baseline `dev` with `main`.

---

### 3. `Sync-Branches`

Interactive menu that lets you pick the direction.

**Usage:**

```powershell
Sync-Branches
```

**Prompt:**

```
SkyOps Branch Synchronizer
1️⃣  Sync main → dev
2️⃣  Sync dev → main
```

---

### 4. `Invoke-SkyRepoCommit`

Automates the full development commit cycle for any SkyEco repository.  
Stages, commits, and pushes all changes to `dev`, optionally running the **Sky Delta Update** before committing.

**Usage:**

```powershell
Invoke-SkyRepoCommit -RepoName "SkyOps" -Message "Refactored utilities" -RunDelta
```

**Parameters:**

- **`RepoName`** — One of `SkyOps`, `SkyOne`, `SkyServer`, `SkyProject`.
- **`Message`** — Commit message text.
- **`RunDelta`** _(switch)_ — If set, runs the delta update (`sky_delta_update.py`) before staging and committing.

**Flow:**

1. Navigate to the specified repository path.
2. Switch explicitly to the `dev` branch.
3. _(Optional)_ Run the Sky Delta Update to regenerate `RepoMap_*.json` and `DeltaReport.md`.
4. Stage all changes, including the new delta files.
5. Commit and push to `origin/dev`.

**Notes:**

- Ensures generated files exist and are fully flushed to disk before staging.
- All changes commit atomically for complete traceability.
- Designed for local automation with full file system control.

---

### 5. `Test-SkyBranchHealth`

Checks the synchronization state between `main` and `dev` branches for any SkyEco repository.  
Displays current branch, tracking info, commit history, and ahead/behind counts.

**Usage:**

```powershell
Test-SkyBranchHealth -RepoName "SkyOps"
```

**Flow:**

1. Fetch latest refs from `origin`.
2. Display current branch and tracking status.
3. Compare `origin/main` vs `origin/dev` and report ahead/behind metrics.
4. Show last 5 commits with decorations.
5. Warn if local uncommitted changes are detected.

**Output Example:**

```
🩺 Checking branch health for SkyOps...
🪶 Current branch: dev
🧭 Sync summary (main vs dev):
  - main is behind dev by 1 commits
  - main is ahead of dev by 0 commits
✅ Working tree clean — no pending local changes.
✅ Branch health check complete for SkyOps.
```

**Notes:**

- Useful before and after `Invoke-SkyRepoCommit` to verify repo integrity.
- Provides quick visibility into local vs remote state without switching branches.
- Ideal for diagnosing sync or PR issues across multiple repositories.

---

## 💡 Notes

- All functions use colorized console output for clarity.
- Safe prompts and explicit actions reduce risk of accidental overwrites.
- Designed to integrate with both **SkyServer** (scheduled automation) and **local workflows**.

---

## 💝 Example Session

```powershell
PS C:\SkyOps> . .\tools\Powershell_Helper_Utils\Powershell_Utils.ps1
PS C:\SkyOps> Invoke-SkyRepoCommit -RepoName "SkyOps" -Message "Updated delta utilities" -RunDelta
PS C:\SkyOps> Test-SkyBranchHealth -RepoName "SkyOps"
```

---

## ✍️ Credits

**Author:** Paul Sattaur  
**Maintainer:** Sky (AI Operations Lead)  
**Project:** SkyOps – Automation layer for the Sky ecosystem  
**Version:** 2025.10.16
