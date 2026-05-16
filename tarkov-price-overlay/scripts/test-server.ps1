# Serve the newest signed test build over localhost so an already-installed
# rcN app (built via test-build.ps1) can auto-update to rcN+1.
#
# Auto-picks the most recent *_x64-setup.exe from the bundle dir, generates
# a latest.json with the embedded signature, and starts `python -m http.server`
# in a staging dir. Ctrl+C stops it.
#
# Usage:
#   .\scripts\test-server.ps1              # serves whatever's newest
#   .\scripts\test-server.ps1 -Port 18000  # different port

param(
    [int]$Port = 8000,
    [string]$TestDir = "C:\update-test"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# Newest installer wins. Test cycle is build-rc1 → install → build-rc2 →
# this script; the rc2 build is mtime-newer so it's picked automatically.
$bundleDir = "$root\src-tauri\target\release\bundle\nsis"
$exe = Get-ChildItem "$bundleDir\*_x64-setup.exe" -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) {
    throw "No installer in $bundleDir. Run .\scripts\test-build.ps1 -Version <ver> first."
}
$sigPath = "$($exe.FullName).sig"
if (-not (Test-Path $sigPath)) {
    throw "Signature missing: $sigPath. Build was not signed — TAURI_SIGNING_PRIVATE_KEY env was unset?"
}

# Parse version from filename so we don't have to take it as a param.
# Pattern: "Tarkov Price Overlay_1.0.10-rc2_x64-setup.exe"
if ($exe.Name -notmatch '_([\d.]+(-[\w\d.]+)?)_x64-setup\.exe$') {
    throw "Can't parse version from $($exe.Name)"
}
$version = $matches[1]

# Rename spaces → dots in the served filename. Matches the GitHub URL
# pattern (GitHub auto-dots asset names on upload) AND avoids URL-encoded
# %20 in latest.json's url field, which keeps debugging easier.
$dottedName = $exe.Name -replace ' ', '.'

if (-not (Test-Path $TestDir)) { New-Item -ItemType Directory -Path $TestDir | Out-Null }
# Clear previous test artifacts — keep only what we're serving now,
# otherwise the dir accumulates every build and is confusing to inspect.
Get-ChildItem $TestDir -File | Remove-Item -Force
Copy-Item -Force $exe.FullName "$TestDir\$dottedName"

$sigContent = (Get-Content -Raw $sigPath).Trim()
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$latestJson = [ordered]@{
    version   = "v$version"
    notes     = "local test build"
    pub_date  = $pubDate
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $sigContent
            url       = "http://127.0.0.1:$Port/$dottedName"
        }
    }
} | ConvertTo-Json -Depth 5
# Write without BOM — Tauri's reqwest-based fetcher handles BOM fine but
# clean UTF-8 keeps the file diffable and matches release.ps1 output.
[IO.File]::WriteAllText("$TestDir\latest.json", $latestJson, [Text.UTF8Encoding]::new($false))

Write-Host "[test-server] serving v$version on http://127.0.0.1:$Port"
Write-Host "[test-server] dir: $TestDir"
Write-Host "[test-server] latest.json url: http://127.0.0.1:$Port/latest.json"
Write-Host "[test-server] installer url:   http://127.0.0.1:$Port/$dottedName"
Write-Host "[test-server] press Ctrl+C to stop"
Write-Host ""

# Foreground so the user sees access logs (rc1 fetching latest.json, then
# downloading the installer). Easy to spot if the polling isn't happening.
Set-Location $TestDir
& python -m http.server $Port
