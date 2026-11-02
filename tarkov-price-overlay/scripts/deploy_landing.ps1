# tarkov.aquapado.com(landing/) 배포 — scripts/hosting.txt 가 정한 곳으로 보낸다. 성공 = exit 0.
#   vercel     : landing 에서 vercel --prod --yes --archive=tgz
#                ⚠ Vercel Hobby 는 AdSense 게재 금지(vercel.com/docs/limits/fair-use-guidelines) →
#                  adsense_client.txt 에 ID 가 있거나 HTML 에 adsbygoogle 가 남아 있으면 배포를 거부한다(exit 2).
#   cloudflare : landing → scripts\cloudflare\.stage (vercel.json·.vercel 제외) + _headers 복사 → npx wrangler pages deploy
# 배포 전에 adsense.py·hosting.py 를 돌려 광고·분석 조각을 상태에 맞춘다(-SkipPrep 로 생략).
# 쓰는 곳: promo_refresh.ps1(주간 프로모 갱신), 수동 배포, cutover_cloudflare.ps1
param([switch]$SkipPrep)
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
$adId = if (Test-Path $adFile) { (Get-Content $adFile -Raw).Trim() } else { "" }
$project = (Get-Content (Join-Path $root "scripts\cloudflare\project.txt") -Raw).Trim()   # Cloudflare Pages 프로젝트 이름

Write-Host ("[deploy] 대상=" + $target + " · 광고=" + $(if ($adId) { $adId } else { "없음" }))
if (-not $SkipPrep) {
    & $py (Join-Path $root "scripts\adsense.py")
    & $py (Join-Path $root "scripts\hosting.py")
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
    # /MIR: 지운 파일도 따라 지운다. robocopy 는 0~7 이 성공(8 이상이 실패)
    robocopy $landing $stage /MIR /XF vercel.json /XD .vercel /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Write-Host "[deploy] 스테이징 복사 실패(robocopy $LASTEXITCODE)"; exit 1 }
    # _headers 는 LF·BOM 없이 — 윈도우 저장소(autocrlf)라 CRLF 로 꺼내질 수 있고, PS5.1 Set-Content utf8 은 BOM 을 붙인다
    $hdr = ([IO.File]::ReadAllText((Join-Path $root "scripts\cloudflare\_headers"))) -replace "`r`n", "`n"
    [IO.File]::WriteAllText((Join-Path $stage "_headers"), $hdr.TrimStart([char]0xFEFF), (New-Object System.Text.UTF8Encoding($false)))
    $n = (Get-ChildItem $stage -Recurse -File).Count
    Write-Host "[deploy] 스테이징 $n 개 파일 → Cloudflare Pages '$project'"
    $out = & npx --yes wrangler@4 pages deploy $stage --project-name $project --branch main --commit-dirty=true 2>&1
    $out | Select-Object -Last 6 | ForEach-Object { Write-Host "  $_" }
    $ok = ($out | Select-String 'Deployment complete') -ne $null
    Write-Host ("[deploy] cloudflare " + $(if ($ok) { "완료" } else { "실패" }))
    if ($ok) { exit 0 } else { exit 1 }
}
else {
    Write-Host "[deploy] scripts\hosting.txt 값이 이상함: '$target' (vercel 또는 cloudflare)"
    exit 1
}
