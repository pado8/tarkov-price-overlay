# tarkov.aquapado.com 를 Vercel → Cloudflare Pages 로 옮기고 가이드에 AdSense 를 켜는 전환 스크립트.
# 절차·배경: scripts\cloudflare\CUTOVER.md (사용자 할 일 = Cloudflare 가입·wrangler 로그인·대시보드 도메인 추가·hosting.kr DNS 한 줄)
#
#   -Phase preflight : wrangler 로그인 확인 + Pages 프로젝트 없으면 만들기(아무것도 안 바뀜, 몇 번 돌려도 됨)
#   -Phase deploy    : 광고 ID·hosting=cloudflare·방침 문구 켜기 → Cloudflare 에 배포 → pages.dev 주소로 검사
#                      (이 단계까지는 실제 tarkov.aquapado.com 은 여전히 Vercel — 방문자에겐 변화 없음)
#   -Phase verify    : 사용자가 DNS 를 바꾼 뒤 tarkov.aquapado.com 이 Cloudflare 에서 광고와 함께 나오는지 검사
#   -Phase rollback  : 광고·hosting·방침을 원래대로(사용자는 hosting.kr 에서 tarkov 를 A 76.76.21.21 로 되돌림)
param([ValidateSet("preflight", "deploy", "verify", "rollback")][string]$Phase = "preflight")
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$py = Join-Path $root "python-core\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
$AD = "ca-pub-5433916923351258"
$project = (Get-Content (Join-Path $root "scripts\cloudflare\project.txt") -Raw).Trim()
$domain = "tarkov.aquapado.com"
function Say($m) { Write-Host "[cutover] $m" }
function Get-Page($url) {
    try { return Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 30 -MaximumRedirection 0 -ErrorAction Stop }
    catch { return $_.Exception.Response }
}
function Check($label, $cond) { if ($cond) { Say "  OK   $label" } else { Say "  실패 $label"; $script:fail++ } }

switch ($Phase) {
    "preflight" {
        $who = & npx --yes wrangler@4 whoami 2>&1
        if (($who | Select-String "You are logged in|associated with the email") -eq $null) {
            Say "wrangler 로그인이 안 돼 있음 → 터미널에서: npx wrangler@4 login (브라우저에서 Cloudflare 허용)"; $who | Select-Object -Last 3 | ForEach-Object { Say "  $_" }; exit 1
        }
        Say "로그인 확인"
        $list = & npx --yes wrangler@4 pages project list 2>&1
        if (($list | Select-String "\b$project\b") -eq $null) {
            Say "Pages 프로젝트 '$project' 만들기"
            & npx --yes wrangler@4 pages project create $project --production-branch main 2>&1 | Select-Object -Last 4 | ForEach-Object { Say "  $_" }
            $list = & npx --yes wrangler@4 pages project list 2>&1
        }
        $line = $list | Select-String "\b$project\b" | Select-Object -First 1
        Say "프로젝트: $line"
        Say "pages.dev 주소가 '$project.pages.dev' 와 다르면 scripts\cloudflare\project.txt·CUTOVER.md 의 CNAME 값을 그 주소로 고칠 것"
        exit 0
    }
    "deploy" {
        Set-Content -Path (Join-Path $root "scripts\adsense_client.txt") -Value $AD -Encoding ascii
        Set-Content -Path (Join-Path $root "scripts\hosting.txt") -Value "cloudflare" -Encoding ascii
        & $py (Join-Path $root "scripts\privacy_hosting.py") on
        if ($LASTEXITCODE -ne 0) { Say "방침 문구 갱신 실패 — 중단"; exit 1 }
        & powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts\deploy_landing.ps1")
        if ($LASTEXITCODE -ne 0) { Say "배포 실패 — 중단(실제 사이트는 그대로 Vercel)"; exit 1 }
        Start-Sleep -Seconds 8
        $base = "https://$project.pages.dev"
        $script:fail = 0
        Say "검사: $base"
        $r = Get-Page "$base/"; Check "메인 200·광고 없음" ($r.StatusCode -eq 200 -and $r.Content -notmatch "adsbygoogle")
        $r = Get-Page "$base/guide/hideout/vents/"; Check "가이드 200·광고 코드 있음" ($r.StatusCode -eq 200 -and $r.Content -match "adsbygoogle\.js\?client=$AD")
        $r = Get-Page "$base/guide/gunsmith/"; Check "건스미스 광고 없음" ($r.StatusCode -eq 200 -and $r.Content -notmatch "adsbygoogle")
        $r = Get-Page "$base/guide/quest/scavenger/"; Check "가이드 Vercel 분석 스크립트 없음" ($r.Content -notmatch "_vercel/insights")
        $r = Get-Page "$base/nope-404-check/"; Check "없는 주소 404" ([int]$r.StatusCode -eq 404)
        $r = Get-Page "$base/"; Check "pages.dev 는 noindex" ("$($r.Headers['X-Robots-Tag'])" -match "noindex")
        $r = Get-Page "$base/en?src=guide"; Check "/en?src=guide 열림(200 또는 /en/ 로 이동하며 src 유지)" ($r.StatusCode -eq 200 -or "$($r.Headers['Location'])" -match "src=guide")
        $r = Get-Page "$base/sitemap.xml"; Check "sitemap.xml" ($r.StatusCode -eq 200)
        if ($script:fail -gt 0) { Say "검사 $($script:fail)개 실패 — DNS 는 아직 바꾸지 말 것"; exit 1 }
        Say "pages.dev 검사 통과. 다음 = 사용자: Cloudflare 대시보드에 도메인 추가 → hosting.kr 에서 tarkov 를 CNAME $project.pages.dev 로 (CUTOVER.md 3·4단계)"
        exit 0
    }
    "verify" {
        $script:fail = 0
        $dns = Resolve-DnsName $domain -Server 1.1.1.1 -ErrorAction SilentlyContinue
        $cn = ($dns | Where-Object { $_.Type -eq "CNAME" } | Select-Object -First 1).NameHost
        Check "DNS CNAME → $cn" ($cn -match "pages\.dev$")
        $r = Get-Page "https://$domain/"; Check "메인 200·Cloudflare 응답" ($r.StatusCode -eq 200 -and "$($r.Headers['Server'])" -match "cloudflare")
        Check "메인 noindex 아님" ("$($r.Headers['X-Robots-Tag'])" -notmatch "noindex")
        $r = Get-Page "https://$domain/guide/hideout/vents/"; Check "가이드 광고 코드" ($r.Content -match "adsbygoogle")
        $r = Get-Page "https://$domain/nope-404-check/"; Check "없는 주소 404" ([int]$r.StatusCode -eq 404)
        if ($script:fail -gt 0) { Say "검사 $($script:fail)개 실패 — DNS 전파 중이면 10~30분 뒤 다시"; exit 1 }
        Say "전환 완료. 이제 promo_refresh.ps1·수동 배포는 deploy_landing.ps1 을 통해 Cloudflare 로 간다."
        exit 0
    }
    "rollback" {
        Set-Content -Path (Join-Path $root "scripts\adsense_client.txt") -Value "" -Encoding ascii
        Set-Content -Path (Join-Path $root "scripts\hosting.txt") -Value "vercel" -Encoding ascii
        & $py (Join-Path $root "scripts\privacy_hosting.py") off
        & $py (Join-Path $root "scripts\adsense.py")
        Say "로컬 파일을 Vercel·광고 없음 상태로 돌렸다. 사용자: hosting.kr 에서 tarkov 레코드를 'A 76.76.21.21' 로 되돌리면"
        Say "Vercel 에 남아 있는 마지막 배포(광고 없음)가 그대로 다시 보인다. Vercel 분석 스크립트는 다음 가이드 재빌드 때 다시 들어간다."
        exit 0
    }
}
