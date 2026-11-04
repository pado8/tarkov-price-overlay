# 프로모 코드 매일 자동 갱신 — 작업 스케줄러 "TarkovGuidePromoDaily"(매일 20:30, 놓치면 켤 때)가 돌린다.
#   저장소 작업 트리를 건드리지 않도록 최신 dev 를 별도 폴더(git worktree, %LOCALAPPDATA%\TarkovGuidePromo\wt)에 받아
#   거기서 promo_refresh.ps1(점검 → 바뀌면 세 언어 재빌드 → 배포 → IndexNow)을 돌린다.
#   판정 결과(guide_data/promo_status.json)가 바뀌면 그 파일 하나만 저장소 dev 에 커밋해, 다음 수동 빌드가 옛 상태로 되돌리지 않게 한다.
# 수동 실행: powershell -ExecutionPolicy Bypass -File scripts\promo_daily.ps1 [-Force]
# 로그: %LOCALAPPDATA%\TarkovGuidePromo\promo_daily.log
param([switch]$Force)
$ErrorActionPreference = "Continue"
$main = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)   # ...\tarkov-price-overlay
$repo = (git -C $main rev-parse --show-toplevel).Trim()                           # 모노레포 루트
$sub = "tarkov-price-overlay"
$base = Join-Path $env:USERPROFILE "AppData\Local\TarkovGuidePromo"   # LOCALAPPDATA 는 실행하는 앱(예: 스토어판 앱)에 따라 가상 경로가 될 수 있어 쓰지 않는다
$wt = Join-Path $base "wt"
$log = Join-Path $base "promo_daily.log"
New-Item -ItemType Directory -Force $base | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Log($m) { $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m; Add-Content -Path $log -Value $line -Encoding UTF8; Write-Host $line }

Log "== promo_daily 시작"
# 1) 별도 폴더를 최신 dev 로 (처음이면 만들고, 있으면 dev 끝으로 되돌림 — git clean 은 정션을 따라갈 수 있어 쓰지 않는다)
if (-not (Test-Path (Join-Path $wt ".git"))) {
    git -C $repo worktree prune 2>&1 | Out-Null
    git -C $repo worktree add --detach $wt dev 2>&1 | ForEach-Object { Log $_ }
} else {
    git -C $wt checkout --detach --force dev 2>&1 | ForEach-Object { Log $_ }
    git -C $wt reset --hard dev 2>&1 | ForEach-Object { Log $_ }
}
if (-not (Test-Path (Join-Path $wt $sub))) { Log "작업 폴더 준비 실패 — 중단"; exit 1 }
Log ("작업 폴더 = dev " + (git -C $wt rev-parse --short HEAD).Trim())
# 2) 파이썬 가상환경은 깃에 없으니 원래 것을 정션으로 연결
$venvWt = Join-Path $wt "$sub\python-core\.venv"
if (-not (Test-Path $venvWt)) {
    cmd /c mklink /J "$venvWt" "$(Join-Path $main 'python-core\.venv')" | Out-Null
}
# 3) 점검·재빌드·배포 (promo_refresh.ps1 은 자기 폴더 기준으로 동작)
$statusRel = "$sub\scripts\guide_data\promo_status.json"
# 비교는 확인 날짜("checked")를 뺀 내용으로 — 날짜만 바뀐 날은 사이트도 다시 배포하지 않으므로 커밋하지 않는다
function StatusBody($p) { if (Test-Path $p) { ((Get-Content $p -Raw -Encoding UTF8) -replace '"checked":\s*"[^"]*",?', '') } else { $null } }
$before = StatusBody (Join-Path $wt $statusRel)
$args2 = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $wt "$sub\scripts\promo_refresh.ps1"))
if ($Force) { $args2 += "-Force" }
& powershell @args2 2>&1 | ForEach-Object { Log $_ }
$after = StatusBody (Join-Path $wt $statusRel)
# 4) 판정이 바뀌었으면 그 파일만 저장소 dev 에 커밋 (저장소가 dev 가 아니면 건너뜀)
if ($after -and ($before -ne $after)) {
    $branch = (git -C $repo branch --show-current).Trim()
    if ($branch -ne "dev") {
        Log "저장소가 $branch 브랜치라 promo_status.json 커밋을 건너뜀"
    } else {
        Copy-Item (Join-Path $wt $statusRel) (Join-Path $repo $statusRel) -Force
        git -C $repo commit --only -m "chore(guide): 프로모 코드 상태 자동 갱신 (promo_daily)" -- ($statusRel -replace '\\', '/') 2>&1 | ForEach-Object { Log $_ }
    }
} else {
    Log "판정 변화 없음"
}
Log "== promo_daily 끝"
