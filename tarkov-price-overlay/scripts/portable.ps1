# Build a portable ZIP of tarkov-price-overlay.
#
# What it does:
#   Copies just the runtime files (main exe + sidecar exe + _internal/)
#   from target\release\ into a staging folder and zips it. The result
#   can be unzipped anywhere and run directly — no install needed.
#
# Output:
#   src-tauri\target\release\portable\Tarkov Price Overlay_<version>_portable.zip
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\portable.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $root "src-tauri\target\release"
$binDir = Join-Path $root "src-tauri\binaries"
# Main app exe only exists in target\release (it's the Tauri Rust binary).
$mainExe = Join-Path $releaseDir "tarkov-price-overlay.exe"
# Sidecar exe + _internal: take them from src-tauri\binaries, which is the
# *dead-weight-stripped source of truth* (build.ps1 / the .spec produce the
# diet there). The Tauri-copied target\release\_internal is NOT usable here:
# Tauri's resource copy never DELETES files that vanished from source, so once
# any earlier build staged a pre-diet tree, target\release\_internal keeps the
# orphaned torch\lib\*.lib (~820MB) + torch\include forever - making the
# portable zip ~2.3x its real size and turning the v1.1.2 "half the size"
# headline into a lie on the portable channel. binaries\_internal is rebuilt
# clean each run (710MB vs 1585MB measured), so source from it.
$serverExe = Join-Path $binDir "tarkov-server-x86_64-pc-windows-msvc.exe"
$internalDir = Join-Path $binDir "_internal"

# Read version from package.json
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
Write-Host "[portable] version=$version"

foreach ($p in @($mainExe, $serverExe, $internalDir)) {
    if (-not (Test-Path $p)) {
        throw "Missing build artifact: $p. Run 'npm run tauri -- build --bundles nsis' first."
    }
}

# Guard against silently shipping a pre-diet _internal. The stripped tree is
# ~710MB; the fat one is ~1585MB. If the source dir is anywhere near the fat
# size the diet didn't run (or stale orphans crept back) - fail loudly rather
# than publish a bloated portable that contradicts the release notes.
$internalMB = [Math]::Round((Get-ChildItem -Recurse -File $internalDir | Measure-Object Length -Sum).Sum / 1MB, 0)
Write-Host "[portable] source _internal size: ${internalMB} MB"
if ($internalMB -gt 1100) {
    throw "_internal is ${internalMB}MB (expected ~710MB stripped). Dead-weight strip did not apply - refusing to ship a fat portable. Re-run scripts\build.ps1."
}
$leftoverLib = @(Get-ChildItem -Recurse -File -Filter *.lib $internalDir).Count
if ($leftoverLib -gt 0) {
    throw "_internal still contains $leftoverLib .lib file(s) (dead weight). Re-run scripts\build.ps1 to re-strip."
}

$stageRoot = Join-Path $releaseDir "portable"
$stageName = "Tarkov Price Overlay_${version}_portable"
$stageDir = Join-Path $stageRoot $stageName
$zipPath = Join-Path $stageRoot "$stageName.zip"

if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

Write-Host "[portable] copying runtime files..."
Copy-Item $mainExe (Join-Path $stageDir "Tarkov Price Overlay.exe")
# Rename the triple-suffixed externalBin to the runtime name the app spawns.
Copy-Item $serverExe (Join-Path $stageDir "tarkov-server.exe")
Copy-Item -Recurse $internalDir $stageDir

# Drop a quick-start README inside the ZIP root.
# Read the template from a separate UTF-8 file so the .ps1 itself can
# stay ASCII-clean — Windows PowerShell 5.1 reads BOM-less .ps1 files
# as the system code page (cp949 on Korean Windows), which corrupts any
# Korean here-strings inline before they ever reach Set-Content.
$readmeTemplate = Join-Path $PSScriptRoot "portable-readme.txt"
if (-not (Test-Path $readmeTemplate)) {
    throw "Missing readme template at $readmeTemplate"
}
$readmeBytes = [System.IO.File]::ReadAllBytes($readmeTemplate)
$readmeContent = [System.Text.Encoding]::UTF8.GetString($readmeBytes).Replace("{VERSION}", $version)
$readmePath = Join-Path $stageDir "READ_ME_FIRST.txt"
# Write UTF-8 with BOM so Notepad and most archive tools auto-detect it.
$utf8WithBom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($readmePath, $readmeContent, $utf8WithBom)

# Portable marker — the running app detects this file next to the .exe and
# disables the in-app NSIS auto-updater path. Portable users get a "open
# downloads page" link instead, so updating doesn't silently install a
# *second* copy at the default NSIS path (C:\Users\<user>\AppData\Local\...)
# leaving their portable folder stuck at the old version.
$markerPath = Join-Path $stageDir "_portable.marker"
[System.IO.File]::WriteAllText($markerPath, "portable build v$version`r`nDo not delete — disables auto-updater so updates don't silently install elsewhere.`r`n", $utf8WithBom)

Write-Host "[portable] zipping..."
# Prefer 7-Zip when installed: several times faster than Compress-Archive
# AND produces a smaller archive (= faster user download). Falls back to
# the built-in cmdlet so the pipeline never depends on 7-Zip.
$sevenZip = @("$env:ProgramFiles\7-Zip\7z.exe",
              "${env:ProgramFiles(x86)}\7-Zip\7z.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($sevenZip) {
    Write-Host "[portable] using 7-Zip ($sevenZip)"
    & $sevenZip a -tzip -mx=5 -bso0 -bsp1 $zipPath "$stageDir\*"
    if ($LASTEXITCODE -ne 0) { throw "7z failed with exit code $LASTEXITCODE" }
} else {
    Write-Host "[portable] 7-Zip not found - falling back to Compress-Archive (slower; install 7-Zip to speed this up)"
    Compress-Archive -Path "$stageDir\*" -DestinationPath $zipPath -CompressionLevel Optimal
}

# Show summary
$zipSize = [Math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "[portable] done."
Write-Host "  Output: $zipPath"
Write-Host "  Size:   ${zipSize} MB"

# Belt-and-suspenders: even after the source asserts, sanity-check the final
# archive. A stripped tree compresses to roughly 250-400MB; anything past
# 700MB means dead weight slipped through somewhere downstream.
if ($zipSize -gt 700) {
    throw "Portable zip is ${zipSize}MB - far above the expected ~250-400MB for the stripped build. Aborting before publish."
}

# Cleanup the unzipped staging dir; keep only the .zip
Remove-Item -Recurse -Force $stageDir
