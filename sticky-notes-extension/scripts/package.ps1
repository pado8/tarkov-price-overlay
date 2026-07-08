# 웹스토어 등록용 zip 생성 스크립트.
# 배포에 필요한 파일만 담고(manifest, _locales, content, popup, options, icons/*.png),
# 개발용 파일(store/, scripts/, *.svg, 문서)은 제외한다.
#
# Compress-Archive 대신 .NET ZipFile을 쓰는 이유: PowerShell 5.1의 Compress-Archive는
# zip 엔트리 경로 구분자를 백슬래시로 기록해 일부 압축 해제기와 호환 문제가 있다.
#
# 사용법: powershell -ExecutionPolicy Bypass -File scripts\package.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version

$distDir = Join-Path $root 'dist'
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory $distDir | Out-Null }
$zipPath = Join-Path $distDir "sticky-notes-extension-v$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$include = @('manifest.json', '_locales', 'content', 'popup', 'options', 'icons')

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# 배포 대상 파일 목록 수집 (디자인 원본 svg 제외)
$files = @()
foreach ($item in $include) {
    $full = Join-Path $root $item
    if (-not (Test-Path $full)) { throw "누락된 배포 파일: $item" }
    if (Test-Path $full -PathType Leaf) {
        $files += Get-Item $full
    }
    else {
        $files += Get-ChildItem $full -Recurse -File | Where-Object { $_.Extension -ne '.svg' }
    }
}

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel)
    }
}
finally {
    $zip.Dispose()
}
$count = $files.Count

$sizeKB = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host "완료: $zipPath (${count}개 파일, ${sizeKB}KB)"
