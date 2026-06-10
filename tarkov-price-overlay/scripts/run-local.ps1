# Local-test launcher for tarkov-price-overlay.
#
# Runs the freshly built target\release\tarkov-price-overlay.exe directly,
# without going through the NSIS installer. Useful for quick smoke tests
# after a build.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\run-local.ps1
# or just double-click scripts\run-local.cmd

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "src-tauri\target\release\tarkov-price-overlay.exe"
$internalDir = Join-Path $root "src-tauri\target\release\_internal"

if (-not (Test-Path $exe)) {
    throw "Build not found at $exe. Run: npm run tauri -- build --bundles nsis"
}
if (-not (Test-Path $internalDir)) {
    Write-Host "[warn] _internal\ not found at $internalDir — sidecar may fail to start." -ForegroundColor Yellow
}

# Kill any leftover tarkov-server / tarkov-price-overlay from a previous run.
# -like also catches the staged exe's name ("tarkov-server-x86_64-...").
Get-Process | Where-Object { $_.ProcessName -like "tarkov-server*" -or $_.ProcessName -eq "tarkov-price-overlay" } |
    ForEach-Object {
        Write-Host "[run-local] killing leftover $($_.ProcessName) (pid $($_.Id))"
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }

Write-Host "[run-local] launching $exe"
Write-Host "[run-local] stdout/stderr will print here. Press Ctrl+C to quit."
Write-Host ""

# Run in foreground so console logs (sidecar/out, hotkey, react) stream live.
& $exe
