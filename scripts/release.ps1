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

# Tauri updater signing — required so the in-app updater (v1.0.10+) can
# verify each new release's signature against the pubkey baked into the
# app. The private key lives in $HOME\.tauri\ and is NEVER checked in.
# The password protects the key file content; the env vars are read by
# `tauri build` during the bundle step.
$signingKeyPath = Join-Path $HOME ".tauri\tarkov-overlay.key"
if (-not (Test-Path $signingKeyPath)) {
    throw "Updater signing key not found at $signingKeyPath. Generate it once with: npx tauri signer generate -w `"$signingKeyPath`""
}
if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    $sec = Read-Host "Updater key password" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
# Tauri accepts either a path or the key content. Path is simpler and
# keeps the secret out of process listings.
$env:TAURI_SIGNING_PRIVATE_KEY = $signingKeyPath

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

# Tauri 2 emits the .sig file alongside the installer when createUpdaterArtifacts=true
# and TAURI_SIGNING_PRIVATE_KEY is set. The sig content (not a path) gets
# embedded in latest.json so the in-app updater can verify the download.
$installerSig = "$installer.sig"
if (-not (Test-Path $installerSig)) {
    throw "Installer signature not found at $installerSig — make sure TAURI_SIGNING_PRIVATE_KEY is set during build"
}
Write-Host "[release] installer signature ready: $installerSig"

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

# 5a. Build latest.json — the manifest the in-app updater polls. GitHub's
# /releases/latest/download/<asset> URL pattern redirects to whatever the
# newest published release tagged. So we ship a fresh latest.json with
# every release and the endpoint in tauri.conf.json always finds it.
$sigContent = (Get-Content -Raw $installerSig).Trim()
$installerUrl = "https://github.com/$publicRepo/releases/download/$tag/Tarkov.Price.Overlay_${Version}_x64-setup.exe"
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$latestJson = [ordered]@{
    version   = $tag
    notes     = $Notes
    pub_date  = $pubDate
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $sigContent
            url       = $installerUrl
        }
    }
} | ConvertTo-Json -Depth 5
$latestJsonPath = "$root\src-tauri\target\release\bundle\nsis\latest.json"
# Write without BOM so GitHub serves clean UTF-8 (PowerShell 5.1 Out-File
# adds a BOM by default which some HTTP clients choke on).
[IO.File]::WriteAllText($latestJsonPath, $latestJson, [Text.UTF8Encoding]::new($false))
Write-Host "[release] latest.json written: $latestJsonPath"

# 5b. Create release on PUBLIC distribution repo (installer + portable ZIP + latest.json)
Write-Host "[release] creating GitHub Release on $publicRepo..."
& $ghExe release create $tag $installer $portableZip $latestJsonPath `
    --repo $publicRepo `
    --title "Tarkov Price Overlay $tag" `
    --notes $Notes

# 6. Back to dev
& git checkout dev
Write-Host ""
Write-Host "[release] DONE."
Write-Host "  Public release: https://github.com/$publicRepo/releases/tag/$tag"
Write-Host "  Reminder: update project_status.md memory with the new release info."
