# Release pipeline for tarkov-price-overlay
#
# What it does:
#   1. Verifies version is bumped consistently across package.json / Cargo.toml / tauri.conf.json
#   2. Runs full build (PyInstaller + Tauri NSIS) via build.ps1
#   3. Pushes dev branch
#   4. Merges dev -> master, pushes master, tags vX.Y.Z
#   5. Creates GitHub Release on the PUBLIC distribution repo (tarkov-price-overlay-releases)
#      with the .exe attached
#   6. Returns to dev branch
#
# Usage:
#   pwsh -File scripts\release.ps1 -Version 0.1.2 -Notes "release notes here"
# or:
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.1.2 -Notes "..."

param(
    [Parameter(Mandatory=$true)] [string]$Version,
    [Parameter(Mandatory=$true)] [string]$Notes
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$ghExe = "C:\Program Files\GitHub CLI\gh.exe"
$publicRepo = "pado8/tarkov-price-overlay-releases"

# Validate semver-ish
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Version must be like 0.1.2 (got '$Version')"
}
$tag = "v$Version"

Write-Host "[release] === preparing $tag ==="

# 1. Verify versions are consistent
$pkg = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version
$cargoLine = (Get-Content "$root\src-tauri\Cargo.toml" | Select-String '^version\s*=').Line
$cargo = $cargoLine -replace '^version\s*=\s*"([^"]+)".*', '$1'
$tauriCfg = (Get-Content "$root\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).version

Write-Host "[release] versions: package.json=$pkg, Cargo.toml=$cargo, tauri.conf.json=$tauriCfg"
foreach ($v in @($pkg, $cargo, $tauriCfg)) {
    if ($v -ne $Version) {
        throw "Version mismatch: expected $Version but found '$pkg' / '$cargo' / '$tauriCfg'. Bump all three first."
    }
}

# 2. Confirm we're on dev with clean tree
$branch = (& git branch --show-current).Trim()
if ($branch -ne "dev") {
    throw "Must be on 'dev' branch (currently '$branch'). Run: git checkout dev"
}
$dirty = & git status --porcelain
if ($dirty) {
    throw "Working tree is dirty. Commit or stash first:`n$dirty"
}

# 3. Full build
Write-Host "[release] running full build (PyInstaller + Tauri NSIS)..."
& "$root\scripts\build.ps1"

$installer = "$root\src-tauri\target\release\bundle\nsis\Tarkov Price Overlay_${Version}_x64-setup.exe"
if (-not (Test-Path $installer)) {
    throw "Installer not found at $installer"
}
Write-Host "[release] installer ready: $installer"

# 3b. Build portable ZIP from the same target/release artifacts
Write-Host "[release] building portable ZIP..."
& "$root\scripts\portable.ps1"
$portableZip = "$root\src-tauri\target\release\portable\Tarkov Price Overlay_${Version}_portable.zip"
if (-not (Test-Path $portableZip)) {
    throw "Portable ZIP not found at $portableZip"
}
Write-Host "[release] portable zip ready: $portableZip"

# 4. Push dev, merge to master, tag
Write-Host "[release] pushing dev..."
& git push origin dev

Write-Host "[release] merging dev -> master..."
& git checkout master
& git merge --ff-only dev
if ($LASTEXITCODE -ne 0) {
    Write-Host "[release] fast-forward failed, doing merge commit"
    & git merge --no-ff dev -m "Merge dev for release $tag"
}
& git tag -a $tag -m "Release $tag"
& git push origin master --tags

# 5. Create release on PUBLIC distribution repo (installer + portable ZIP)
Write-Host "[release] creating GitHub Release on $publicRepo..."
& $ghExe release create $tag $installer $portableZip `
    --repo $publicRepo `
    --title "Tarkov Price Overlay $tag" `
    --notes $Notes

# 6. Back to dev
& git checkout dev
Write-Host ""
Write-Host "[release] DONE."
Write-Host "  Public release: https://github.com/$publicRepo/releases/tag/$tag"
Write-Host "  Reminder: update project_status.md memory with the new release info."
