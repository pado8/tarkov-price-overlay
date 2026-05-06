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
$readmePath = Join-Path $stageDir "READ_ME_FIRST.txt"
$readmeContent = @"
Tarkov Price Overlay (Portable v$version)
==========================================

[실행]
- ``Tarkov Price Overlay.exe`` 더블클릭하면 끝.
- 설치 필요 없음. 폴더 통째로 옮겨도 동작합니다.
- ``_internal\`` 폴더와 ``tarkov-server.exe`` 는 같은 위치에 두세요.

[제거]
- 폴더 통째로 삭제하면 끝. 레지스트리/시작메뉴 흔적 없음.

[사용법]
1. 게임 인벤토리 아이템 위에 마우스 올리고 F2
2. ⚙ 설정에서 PVP/PVE, 언어, 단축키 변경
3. ✕ 버튼으로 종료

[자세히]
https://github.com/pado8/tarkov-price-overlay-releases
"@
Set-Content -Path $readmePath -Value $readmeContent -Encoding UTF8

Write-Host "[portable] zipping..."
Compress-Archive -Path "$stageDir\*" -DestinationPath $zipPath -CompressionLevel Optimal

# Show summary
$zipSize = [Math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "[portable] done."
Write-Host "  Output: $zipPath"
Write-Host "  Size:   ${zipSize} MB"

# Cleanup the unzipped staging dir; keep only the .zip
Remove-Item -Recurse -Force $stageDir
