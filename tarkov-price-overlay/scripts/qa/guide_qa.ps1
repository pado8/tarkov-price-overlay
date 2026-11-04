# 가이드 배포 전 품질 게이트(2026-11-04 점검에서 만든 회귀 검사 묶음). deploy_landing.ps1 이 배포 직전에 부른다.
#   막는 검사(오프라인·몇 초): static_check.py(?q= 도착 행·hreflang·noindex·en/ru 한글·og) · search_test.mjs(실제 search.js 로 자주 찾는 말)
#   경고만(-Full, 네트워크): guide_verify.py(위키 LL·탈출구·평판·Changelog/Events) — 위키가 잠깐 죽어도 자동 프로모 배포가 막히지 않게 경고로만
#   동작 시나리오(sync_scenarios.mjs·ll_scenarios.mjs)는 헤드리스 브라우저가 필요해 수동: node scripts\qa\sync_scenarios.mjs <미리보기 주소>
# 종료 코드: 0 통과 · 1 실패(배포 중단)
param([switch]$Full)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$py = Join-Path $root "python-core\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
$fail = 0

& $py (Join-Path $root "scripts\qa\static_check.py") (Join-Path $root "landing") | Select-Object -Last 6
if ($LASTEXITCODE -ne 0) { $fail++ }

if (Get-Command node -ErrorAction SilentlyContinue) {
    & node (Join-Path $root "scripts\qa\search_test.mjs") (Join-Path $root "landing\guide") | Select-Object -Last 4
    if ($LASTEXITCODE -ne 0) { $fail++ }
} else {
    Write-Host "[qa] node 없음 — 검색 시험 건너뜀"
}

if ($Full) {
    & $py (Join-Path $root "scripts\guide_verify.py") | Select-Object -Last 6
    if ($LASTEXITCODE -ne 0) { Write-Host "[qa] 경고: 정확성 대조 실패 항목 있음(배포는 막지 않음) — 위 목록 확인" }
}

if ($fail) { Write-Host "[qa] 실패 $fail 건 — 배포 중단"; exit 1 }
Write-Host "[qa] 통과"
exit 0
