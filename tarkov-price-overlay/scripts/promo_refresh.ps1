# 프로모 코드 자동 최신화 — 매주 예약 작업(작업 스케줄러 "TarkovGuidePromoRefresh")이 돌린다.
#   1) scripts/promo_check.py 로 정리 사이트를 긁어 guide_data/promo_status.json 갱신
#   2) 바뀐 게 있으면 가이드 네 언어(ko/en/ru/zh) 재빌드 → deploy_landing.ps1(hosting.txt 대로 Vercel/Cloudflare) → IndexNow(프로모 페이지)
# 수동 실행: powershell -ExecutionPolicy Bypass -File scripts\promo_refresh.ps1 [-Force]
# 로그: scripts\promo_refresh.log (최근 실행이 맨 아래)
param([switch]$Force)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$py = Join-Path $root "python-core\.venv\Scripts\python.exe"
$log = Join-Path $root "scripts\promo_refresh.log"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Log($m) { $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m; Add-Content -Path $log -Value $line -Encoding UTF8; Write-Host $line }

Set-Location $root
Log "== promo_refresh 시작"
& $py (Join-Path $root "scripts\promo_check.py") 2>&1 | ForEach-Object { Log $_ }
$code = $LASTEXITCODE
# 시세 신선도(11-05): 가이드의 시세(제작 수익·카파템·열쇠)는 빌드 날짜에 굳는다 → 마지막 빌드가 2일 이상 지났으면 프로모 변화가 없어도 재빌드
$stale = $false
$hub = Join-Path $root "landing\guide\index.html"
if (Test-Path $hub) {
    $m = [regex]::Match((Get-Content $hub -Raw -Encoding UTF8), '데이터 기준 (\d{4}-\d{2}-\d{2})')
    if ($m.Success) {
        $age = ((Get-Date).Date - [datetime]::ParseExact($m.Groups[1].Value, "yyyy-MM-dd", $null)).TotalDays
        if ($age -ge 2) { $stale = $true; Log ("마지막 빌드가 {0}일 지남 — 시세 갱신을 위해 재빌드" -f [int]$age) }
    }
}
if ($code -ne 3 -and -not $Force -and -not $stale) { Log "변경 없음(exit $code) — 재빌드 안 함"; exit 0 }

foreach ($lang in @("ko", "en", "ru", "zh")) {
    $env:GUIDE_LANG = $lang
    & $py (Join-Path $root "scripts\build_guide.py") 2>&1 | Select-String "정적 페이지|한글 남은|Error|Traceback" | ForEach-Object { Log $_.Line }
    if ($LASTEXITCODE -ne 0) { Log "빌드 실패($lang) — 배포 중단"; exit 1 }
}
Remove-Item Env:GUIDE_LANG -ErrorAction SilentlyContinue
# 배포는 deploy_landing.ps1 에 맡긴다 — scripts\hosting.txt(vercel|cloudflare) 대로 보내고,
# Vercel 대상인데 광고 코드가 있으면 거부한다(Vercel Hobby 는 AdSense 금지, 2026-11-02).
$out = & powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts\deploy_landing.ps1") 2>&1
$ready = ($LASTEXITCODE -eq 0)
$out | ForEach-Object { Log $_ }
Log ("배포 " + $(if ($ready) { "완료" } else { "실패(exit $LASTEXITCODE)" }))
if ($ready) {
    $env:MSYS_NO_PATHCONV = "1"
    & python (Join-Path $root "scripts\indexnow.py") "/guide/promo/" 2>&1 | ForEach-Object { Log $_ }
}
Log "== promo_refresh 끝"
