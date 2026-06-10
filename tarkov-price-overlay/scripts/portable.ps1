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
$mainExe = Join-Path $releaseDir "tarkov-price-overlay.exe"
$serverExe = Join-Path $releaseDir "tarkov-server.exe"
$internalDir = Join-Path $releaseDir "_internal"

# Read version from package.json
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
Write-Host "[portable] version=$version"

foreach ($p in @($mainExe, $serverExe, $internalDir)) {
    if (-not (Test-Path $p)) {
        throw "Missing build artifact: $p. Run 'npm run tauri -- build --bundles nsis' first."
    }
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
Copy-Item $serverExe $stageDir
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
    Compress-Archive -Path "$stageDir\*" -DestinationPath $zipPath -CompressionLevel Optimal
}

# Show summary
$zipSize = [Math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "[portable] done."
Write-Host "  Output: $zipPath"
Write-Host "  Size:   ${zipSize} MB"

# Cleanup the unzipped staging dir; keep only the .zip
Remove-Item -Recurse -Force $stageDir
