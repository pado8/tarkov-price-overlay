# Integrated build for tarkov-price-overlay (PyInstaller -> Tauri NSIS).
#
# Run from C:\project root in PowerShell:
#   pwsh -File scripts\build.ps1
# or:
#   powershell -ExecutionPolicy Bypass -File scripts\build.ps1
#
# Prereqs (one-time):
#   - python-core/.venv exists (python -m venv python-core/.venv)
#   - npm install run at repo root
#   - rust + tauri CLI (cargo install tauri-cli OR npm-installed via @tauri-apps/cli)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "[build] working dir: $root"

# 1) Python deps + PyInstaller
$venvPython = "$root\python-core\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    throw "venv python not found at $venvPython. Create it: python -m venv python-core\.venv"
}
Write-Host "[build] installing python deps + pyinstaller"
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r "$root\python-core\requirements.txt"
& $venvPython -m pip install pyinstaller

# 2) PyInstaller bundle
Write-Host "[build] running PyInstaller..."
$distPython = "$root\dist-python"
if (Test-Path $distPython) { Remove-Item -Recurse -Force $distPython }
& $venvPython -m PyInstaller "$root\tarkov-server.spec" `
    --distpath $distPython `
    --workpath "$root\build-python" `
    --noconfirm

$serverExe = "$distPython\tarkov-server\tarkov-server.exe"
if (-not (Test-Path $serverExe)) {
    throw "PyInstaller did not produce $serverExe. Check the build log above."
}

# 3) Copy PyInstaller --onedir output into src-tauri\binaries\
Write-Host "[build] staging sidecar files into src-tauri\binaries"
$dst = "$root\src-tauri\binaries"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item -Recurse -Force "$distPython\tarkov-server\*" $dst

# Tauri requires a platform suffix on externalBin entries.
$platform = "x86_64-pc-windows-msvc"
Rename-Item "$dst\tarkov-server.exe" "tarkov-server-$platform.exe"

# 4) Tauri NSIS build
Write-Host "[build] running tauri build (NSIS only)"
& npm run tauri -- build --bundles nsis

Write-Host ""
Write-Host "[build] ✅ done. Installer should be at:"
Write-Host "  src-tauri\target\release\bundle\nsis\*.exe"
