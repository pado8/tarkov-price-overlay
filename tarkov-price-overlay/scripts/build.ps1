# Integrated build for tarkov-price-overlay (PyInstaller -> Tauri NSIS).
#
# Run from C:\project root in PowerShell:
#   pwsh -File scripts\build.ps1
# or:
#   powershell -ExecutionPolicy Bypass -File scripts\build.ps1
#
# Flags (for faster iteration on the parts you actually changed):
#   -SkipPython   reuse the already-staged sidecar in src-tauri\binaries\
#                 (3-5 min saved; safe ONLY when no python-core/* changed)
#   -SkipBundle   pass --no-bundle to tauri so NSIS isn't built
#                 (~1 min saved; the local-test loop runs target\release\exe
#                  directly anyway, so NSIS is only needed for release.ps1)
#   -SkipDeps     skip `pip install` step (no-op if requirements.txt unchanged
#                 since last build — kept as an opt-in escape hatch)
#
# Typical loops:
#   UI / Rust tweak only ......... build.ps1 -SkipPython -SkipBundle   (~1 min)
#   backend edit ................. build.ps1 -SkipBundle               (~4 min)
#   full release prep ............ build.ps1                           (~5-8 min)
#
# Prereqs (one-time):
#   - python-core/.venv exists (python -m venv python-core/.venv)
#   - npm install run at repo root
#   - rust + tauri CLI (cargo install tauri-cli OR npm-installed via @tauri-apps/cli)

param(
    [switch]$SkipPython,
    [switch]$SkipBundle,
    [switch]$SkipDeps
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "[build] working dir: $root"
Write-Host ("[build] flags: SkipPython=$SkipPython SkipBundle=$SkipBundle SkipDeps=$SkipDeps")

$staged = "$root\src-tauri\binaries"
$platform = "x86_64-pc-windows-msvc"
$stagedSidecar = "$staged\tarkov-server-$platform.exe"

if ($SkipPython) {
    # Need a staged sidecar from a previous full build. Without it Tauri
    # bundle would silently skip the externalBin and produce a broken app.
    if (-not (Test-Path $stagedSidecar)) {
        throw "[-SkipPython] no staged sidecar at $stagedSidecar — run a full build.ps1 once first."
    }
    Write-Host "[build] -SkipPython → reusing existing sidecar at $stagedSidecar"
} else {
    # 1) Python deps + PyInstaller
    $venvPython = "$root\python-core\.venv\Scripts\python.exe"
    if (-not (Test-Path $venvPython)) {
        throw "venv python not found at $venvPython. Create it: python -m venv python-core\.venv"
    }
    if ($SkipDeps) {
        Write-Host "[build] -SkipDeps → skipping pip install (assuming requirements unchanged)"
    } else {
        Write-Host "[build] installing python deps + pyinstaller"
        & $venvPython -m pip install --upgrade pip
        & $venvPython -m pip install -r "$root\python-core\requirements.txt"
        & $venvPython -m pip install pyinstaller
    }

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
    if (Test-Path $staged) { Remove-Item -Recurse -Force $staged }
    New-Item -ItemType Directory -Force -Path $staged | Out-Null
    Copy-Item -Recurse -Force "$distPython\tarkov-server\*" $staged

    # Tauri requires a platform suffix on externalBin entries.
    Rename-Item "$staged\tarkov-server.exe" "tarkov-server-$platform.exe"
}

# 4) Tauri build. --no-bundle skips NSIS (we run target\release\*.exe directly
# during local testing). Full bundle is only needed for release.ps1 / signed
# updater artifacts.
if ($SkipBundle) {
    Write-Host "[build] running tauri build (--no-bundle)"
    & npm run tauri -- build --no-bundle
} else {
    Write-Host "[build] running tauri build (NSIS only)"
    & npm run tauri -- build --bundles nsis
}

Write-Host ""
Write-Host "[build] ✅ done."
if ($SkipBundle) {
    Write-Host "  exe at: src-tauri\target\release\tarkov-price-overlay.exe"
    Write-Host "  (launch via scripts\run-local.ps1)"
} else {
    Write-Host "  installer at: src-tauri\target\release\bundle\nsis\*.exe"
}
