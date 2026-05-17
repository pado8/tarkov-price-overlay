# Build a *test* version of the app with the updater endpoint pointed at
# the local test server (test-server.ps1) instead of the public GitHub
# releases repo. Lets us validate the full auto-update flow end-to-end
# (download + signature verify + NSIS install + relaunch) before shipping
# anything to real users.
#
# Usage (run twice, once for the "old" version, once for the "new"):
#   .\scripts\test-build.ps1 -Version 1.0.10-rc1   # install this one manually
#   .\scripts\test-build.ps1 -Version 1.0.10-rc2   # the upgrade target
#
# Then: .\scripts\test-server.ps1 — open the installed rc1 — verify it
# auto-updates to rc2.
#
# All file changes (3 version fields + endpoint swap) are restored in a
# finally block so the working tree is clean even if the build fails.

param(
    [Parameter(Mandatory=$true)] [string]$Version,
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Allow semver pre-release tags (rc1, beta2, test, etc.) for test builds.
# Production release.ps1 is stricter (no tags allowed).
if ($Version -notmatch '^\d+\.\d+\.\d+(-[\w\d.]+)?$') {
    throw "Version must be like 1.0.10 or 1.0.10-rc1 (got '$Version')"
}

# Reuse the same key + password flow as release.ps1 so signed test builds
# verify against the same pubkey baked into prod builds. That's the only
# way the test actually exercises the real signature-verify code path.
$signingKeyPath = Join-Path $HOME ".tauri\tarkov-overlay.key"
if (-not (Test-Path $signingKeyPath)) {
    throw "Updater signing key not found at $signingKeyPath. Generate it once with: npm run tauri -- signer generate -w `"$signingKeyPath`""
}
if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    $userPwd = [Environment]::GetEnvironmentVariable("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "User")
    if ($userPwd) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $userPwd
    } else {
        $sec = Read-Host "Updater key password" -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}
$env:TAURI_SIGNING_PRIVATE_KEY = $signingKeyPath

$pkgPath      = "$root\package.json"
$cargoPath    = "$root\src-tauri\Cargo.toml"
$tauriCfgPath = "$root\src-tauri\tauri.conf.json"

# Snapshot originals — restored in finally so test builds never pollute
# the working tree (no accidental commit of "1.0.10-rc1" or localhost URL).
$pkgBackup      = Get-Content -Raw $pkgPath
$cargoBackup    = Get-Content -Raw $cargoPath
$tauriCfgBackup = Get-Content -Raw $tauriCfgPath

$testEndpoint = "http://127.0.0.1:$Port/latest.json"

try {
    Write-Host "[test-build] === v$Version ==="
    Write-Host "[test-build] endpoint → $testEndpoint"

    # package.json — regex-replace preserves indentation and key order
    # (ConvertTo-Json reformats everything which would create noisy diffs).
    $newPkg = $pkgBackup -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`""
    [IO.File]::WriteAllText($pkgPath, $newPkg, [Text.UTF8Encoding]::new($false))

    # Cargo.toml — multiline ^anchor matches only the top-level
    # [package] version, not nested `version = "2"` in dependency tables.
    $newCargo = $cargoBackup -replace '(?m)^version\s*=\s*"[^"]+"', "version = `"$Version`""
    [IO.File]::WriteAllText($cargoPath, $newCargo, [Text.UTF8Encoding]::new($false))

    # tauri.conf.json — bump version, swap the GitHub endpoint to localhost,
    # AND inject `dangerousInsecureTransportProtocol: true` so the updater
    # plugin allows http://127.0.0.1 (it normally refuses non-https endpoints).
    # The endpoint regex matches any github.com .../latest.json so it's
    # robust against the public repo URL changing. The pubkey-line replace
    # is the cheapest place to splice in the new flag without touching the
    # outer object braces or risking trailing-comma issues.
    $newTauri = $tauriCfgBackup `
        -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"" `
        -replace 'https://github\.com/[^"]+/latest\.json', $testEndpoint `
        -replace '("pubkey":\s*"[^"]+")', "`$1,`r`n      `"dangerousInsecureTransportProtocol`": true"
    [IO.File]::WriteAllText($tauriCfgPath, $newTauri, [Text.UTF8Encoding]::new($false))

    Write-Host "[test-build] running build.ps1..."
    & "$root\scripts\build.ps1"

    $installer = "$root\src-tauri\target\release\bundle\nsis\Tarkov Price Overlay_${Version}_x64-setup.exe"
    $sig = "$installer.sig"
    if (-not (Test-Path $installer)) { throw "Installer not produced at $installer" }
    if (-not (Test-Path $sig))       { throw "Signature not produced at $sig" }

    Write-Host ""
    Write-Host "[test-build] DONE"
    Write-Host "  installer: $installer"
    Write-Host "  signature: $sig"
    Write-Host ""
    Write-Host "Next:"
    Write-Host "  - First test build  → install it: start `"`" `"$installer`""
    Write-Host "  - Second test build → run: .\scripts\test-server.ps1"
    Write-Host "    then open the previously-installed app to see the update banner"
}
finally {
    Write-Host ""
    Write-Host "[test-build] restoring original version + endpoint in tracked files"
    [IO.File]::WriteAllText($pkgPath,      $pkgBackup,      [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($cargoPath,    $cargoBackup,    [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($tauriCfgPath, $tauriCfgBackup, [Text.UTF8Encoding]::new($false))
}
