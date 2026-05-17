# Fast build loop for UI / Rust-only changes (no python-core edits).
#
# Reuses the sidecar staged by a previous full build.ps1 and skips NSIS
# packaging. Typical runtime ~1 min vs ~5-8 min for a full build.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\build-quick.ps1
#   then: powershell -ExecutionPolicy Bypass -File scripts\run-local.ps1
#
# Safe when you only changed:
#   - src/**           (React / TypeScript)
#   - src-tauri/src/*  (Rust)
#   - src-tauri/*.toml or *.json (deps + capabilities)
#
# NOT safe when you changed python-core/ — use the full build.ps1 instead.

& "$PSScriptRoot\build.ps1" -SkipPython -SkipBundle
