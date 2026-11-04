# tarkov.aquapado.com(landing/) 배포 — scripts/hosting.txt 가 정한 곳으로 보낸다. 성공 = exit 0.
#   vercel     : landing 에서 vercel --prod --yes --archive=tgz
#                ⚠ Vercel Hobby 는 AdSense 게재 금지(vercel.com/docs/limits/fair-use-guidelines) →
#                  adsense_client.txt 에 ID 가 있거나 HTML 에 adsbygoogle 가 남아 있으면 배포를 거부한다(exit 2).
#   cloudflare : landing → scripts\cloudflare\.stage (vercel.json·.vercel 제외) + _headers 복사 → npx wrangler pages deploy
# 배포 전에 adsense.py·hosting.py 를 돌려 광고·분석 조각을 상태에 맞춘다(-SkipPrep 로 생략).
# 쓰는 곳: promo_refresh.ps1(주간 프로모 갱신), 수동 배포, cutover_cloudflare.ps1
param([switch]$SkipPrep, [switch]$Maintenance, [switch]$Preview, [switch]$SkipQA)   # -Maintenance: 전 경로를 '잠시 점검 중' 페이지로(cloudflare 만). 되돌리기 = 스위치 없이 다시 배포
# -Preview(2026-11-04): 운영(tarkov.aquapado.com)은 그대로 두고 같은 Pages 프로젝트의 'dev' 가지에만 올린다 → https://dev.<프로젝트>.pages.dev
#   검색 차단(X-Robots-Tag: noindex)을 붙인다. ⚠ 광고·Google 차단 복구 메시지는 aquapado.com 에 묶여 있어 미리보기 주소에선 안 나온다(배치·문구·우리 스크립트 확인용)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$py = Join-Path $root "python-core\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
$landing = Join-Path $root "landing"
$hostFile = Join-Path $root "scripts\hosting.txt"
$target = if (Test-Path $hostFile) { (Get-Content $hostFile -Raw).Trim().ToLower() } else { "vercel" }
$adFile = Join-Path $root "scripts\adsense_client.txt"
$adId = if (Test-Path $adFile) { ([string](Get-Content $adFile -Raw)).Trim() } else { "" }   # 빈 파일이면 Get-Content -Raw 가 $null 이라 [string] 으로 감싼다(11-03)
$project = ([string](Get-Content (Join-Path $root "scripts\cloudflare\project.txt") -Raw)).Trim()   # Cloudflare Pages 프로젝트 이름

Write-Host ("[deploy] 대상=" + $target + " · 광고=" + $(if ($adId) { $adId } else { "없음" }))
if (-not $SkipPrep) {
    & $py (Join-Path $root "scripts\adsense.py")
    & $py (Join-Path $root "scripts\hosting.py")
}
# 배포 전 품질 게이트(11-04) — 검색 0행·hreflang·noindex·en/ru 한글 같은 회귀가 있으면 올리지 않는다. 점검 페이지 배포는 예외
if (-not $Maintenance -and -not $SkipQA) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\qa\guide_qa.ps1")
    if ($LASTEXITCODE -ne 0) { Write-Host "[deploy] 품질 게이트 실패 — 배포하지 않음(급하면 -SkipQA, 사유를 커밋에 남길 것)"; exit 3 }
}

if ($target -eq "vercel") {
    $adHtml = Get-ChildItem $landing -Recurse -Filter *.html | Select-String -Pattern "adsbygoogle" -List | Select-Object -First 1
    if ($adId -or $adHtml) {
        Write-Host "[deploy] 거부: Vercel Hobby 는 AdSense 광고 게재가 금지라 광고가 든 랜딩을 Vercel 에 올리지 않는다."
        Write-Host "         hosting.txt 를 cloudflare 로 바꾸거나(전환 절차 scripts\cloudflare\CUTOVER.md) adsense_client.txt 를 비우고 다시."
        exit 2
    }
    Push-Location $landing
    $out = & vercel --prod --yes --archive=tgz 2>&1   # 가이드 1,800쪽: 파일별 업로드는 무료 플랜 하루 5,000개 한도
    Pop-Location
    $ok = ($out | Select-String '"readyState": "READY"') -ne $null
    $out | Select-Object -Last 4 | ForEach-Object { Write-Host "  $_" }
    Write-Host ("[deploy] vercel " + $(if ($ok) { "완료" } else { "실패" }))
    if ($ok) { exit 0 } else { exit 1 }
}
elseif ($target -eq "cloudflare") {
    $stage = Join-Path $root "scripts\cloudflare\.stage"
    New-Item -ItemType Directory -Force $stage | Out-Null
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    if ($Maintenance) {
        # 점검 모드: 점검 페이지 하나 + _redirects(모든 경로 → /maintenance.html 200 rewrite) + 캐시 금지 헤더만 올린다.
        # Pages 는 _redirects 의 200 을 같은 사이트 안 rewrite 로 처리한다(대상은 .html 없이 — Pages 가 .html 을 308 로 정규화해 루프가 난다). 복구 = 스위치 없이 다시 배포(전체 파일이 다시 올라감).
        Remove-Item -Recurse -Force $stage; New-Item -ItemType Directory -Force $stage | Out-Null
        Copy-Item (Join-Path $landing "maintenance.html") (Join-Path $stage "maintenance.html")
        [IO.File]::WriteAllText((Join-Path $stage "_redirects"), "/* /maintenance 200`n", $utf8)
        [IO.File]::WriteAllText((Join-Path $stage "_headers"), "/*`n  Cache-Control: no-store`n  Retry-After: 300`n  X-Robots-Tag: noindex`n", $utf8)
        Write-Host "[deploy] ⚠ 점검 모드: 전 경로가 '잠시 점검 중' 페이지로 바뀐다"
    }
    else {
        # /MIR: 지운 파일도 따라 지운다. robocopy 는 0~7 이 성공(8 이상이 실패)
        robocopy $landing $stage /MIR /XF vercel.json /XD .vercel /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { Write-Host "[deploy] 스테이징 복사 실패(robocopy $LASTEXITCODE)"; exit 1 }
        # _headers 는 LF·BOM 없이 — 윈도우 저장소(autocrlf)라 CRLF 로 꺼내질 수 있고, PS5.1 Set-Content utf8 은 BOM 을 붙인다
        $hdr = ([IO.File]::ReadAllText((Join-Path $root "scripts\cloudflare\_headers"))) -replace "`r`n", "`n"
        $hdr = $hdr.TrimStart([char]0xFEFF)
        if ($Preview) { $hdr = "/*`n  X-Robots-Tag: noindex`n`n" + $hdr }   # 미리보기는 검색에 안 잡히게
        [IO.File]::WriteAllText((Join-Path $stage "_headers"), $hdr, $utf8)
    }
    $branch = if ($Preview) { "dev" } else { "main" }
    $n = (Get-ChildItem $stage -Recurse -File).Count
    Write-Host ("[deploy] 스테이징 $n 개 파일 → Cloudflare Pages '$project' · " + $(if ($Preview) { "미리보기(dev) — 운영 영향 없음 → https://dev.$project.pages.dev" } else { "운영(main)" }))
    $out = & npx --yes wrangler@4 pages deploy $stage --project-name $project --branch $branch --commit-dirty=true 2>&1
    $out | Select-Object -Last 6 | ForEach-Object { Write-Host "  $_" }
    $ok = ($out | Select-String 'Deployment complete') -ne $null
    Write-Host ("[deploy] cloudflare " + $(if ($ok) { "완료" } else { "실패" }))
    if ($ok) { exit 0 } else { exit 1 }
}
else {
    Write-Host "[deploy] scripts\hosting.txt 값이 이상함: '$target' (vercel 또는 cloudflare)"
    exit 1
}
