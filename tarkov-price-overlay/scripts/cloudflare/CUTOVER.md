# tarkov.aquapado.com → Cloudflare Pages 전환 (가이드 AdSense 용)

## 왜
- Vercel Hobby(무료)는 AdSense 게재를 **상업적 이용으로 금지**한다(vercel.com/docs/limits/fair-use-guidelines, "The inclusion of advertisements, including … Google AdSense"). 후원 요청은 허용.
- Cloudflare 셀프 서브 구독 계약(2025-09-12)·개발자 플랫폼 약관(2026-09-28)에는 비상업·광고 제한 문구가 없고, 무료 서비스 제한은 신용카드 정보 수집 금지(2.2.1 h)뿐 → 무료로 광고 가능.
- 옮기는 건 **tarkov.aquapado.com(landing/, 정적 1,833파일·71MB)만**. api.aquapado.com·콘솔·다른 사이트는 Vercel 그대로(광고 없음).

## 준비돼 있는 것 (2026-11-02, dev)
| 파일 | 역할 |
|---|---|
| `scripts/hosting.txt` | `vercel` / `cloudflare` — 지금 어디로 배포하나 |
| `scripts/deploy_landing.ps1` | hosting.txt 대로 배포. **Vercel 대상인데 광고가 있으면 거부(exit 2)** |
| `scripts/cutover_cloudflare.ps1` | `-Phase preflight / deploy / verify / rollback` |
| `scripts/hosting.py` | cloudflare 면 Vercel 분석 스크립트(`/_vercel/insights`) 제거 — build_guide 끝에서도 실행 |
| `scripts/privacy_hosting.py on/off` | 방침 5번(광고)·호스팅 표 문구 전환(멱등) |
| `scripts/adsense.py` | `/guide/` 아래만 광고, **건스미스 3쪽 제외**(위키 CC BY-NC-SA) |
| `scripts/cloudflare/_headers` | vercel.json 헤더 2개 이식 + `*.pages.dev` noindex |
| `scripts/cloudflare/project.txt` | Pages 프로젝트 이름(`tarkov-aquapado`) |
| `landing/404.html` | Pages 는 404.html 이 없으면 모든 없는 주소에 메인을 200 으로 준다(소프트 404) |
| `/en`·`/ru` → `/en/`·`/ru/` | Pages 는 슬래시 없는 디렉터리 주소를 308 으로 옮긴다 → canonical·hreflang·사이트맵·링크를 미리 슬래시로 |
| `promo_refresh.ps1` | 주간 갱신 배포가 deploy_landing.ps1 을 거치게 |

로컬 재현(`npx wrangler@4 pages dev`, 광고 켠 사본)으로 확인함: `/`·`/guide/` 200, `/en?src=guide` → `/en/?src=guide` 308(쿼리 유지), 없는 주소 404+404.html, 이미지 캐시 헤더, sitemap XML, `/_headers` 비공개, 광고 = 가이드 1,788쪽(건스미스 0)·메인 0, Vercel 분석 0.

## 사용자 할 일 (미리)
1. Cloudflare 가입 — https://dash.cloudflare.com/sign-up
2. 터미널: `cd C:\project\tarkov-price-overlay; npx wrangler@4 login` → 브라우저에서 Allow

## "진행해" 이후 순서
| # | 누가 | 할 일 |
|---|---|---|
| 1 | Claude | `powershell -ExecutionPolicy Bypass -File scripts\cutover_cloudflare.ps1 -Phase preflight` — 로그인 확인·프로젝트 생성, pages.dev 주소 확인 |
| 2 | Claude | `… -Phase deploy` — 광고 ID·hosting=cloudflare·방침 on → 배포 → pages.dev 8항목 검사. **이때까지 실제 사이트는 Vercel(변화 없음)** |
| 3 | 사용자 | Cloudflare 대시보드: Workers & Pages → `tarkov-aquapado` → Custom domains → Set up a domain → `tarkov.aquapado.com` → Continue. **반드시 4번보다 먼저**(순서 바뀌면 522 오류) |
| 4 | 사용자 | hosting.kr DNS: `tarkov` **A 76.76.21.21 삭제** → **CNAME `tarkov` → `tarkov-aquapado.pages.dev`** 추가 |
| 5 | Claude | `… -Phase verify` — DNS·Cloudflare 응답·광고·404 검사(전파 10~30분, 길면 몇 시간) |
| 6 | Claude | dev 커밋(hosting.txt·adsense_client.txt·방침·랜딩), IndexNow, 메모리 갱신 |
| 7 | 사용자 | 애드센스 가이드(console `/guides/adsense-setup_261102`) 1~5단계 · (나중) Vercel `landing` 프로젝트 Domains 에서 tarkov.aquapado.com 제거 |

DNS 가 바뀌는 동안 두 곳 다 같은 내용을 내므로 끊김은 없다(Vercel 쪽은 광고 없는 마지막 배포).

## 되돌리기
- `… -Phase rollback` (광고 ID 비움·hosting=vercel·방침 off·광고 코드 제거)
- 사용자: hosting.kr 에서 `tarkov` 를 **A 76.76.21.21** 로 되돌림(CNAME 삭제) → Vercel 의 마지막 배포가 다시 보인다
- Cloudflare 안내: 활성화된 커스텀 도메인의 CNAME 을 다른 곳으로 돌리면 도메인이 비활성화되고, 다시 Pages 로 돌려도 한동안 오류가 날 수 있다 → 되돌리기는 신중히

## 전환 뒤 달라지는 것
- 배포: `powershell -ExecutionPolicy Bypass -File scripts\deploy_landing.ps1` (가이드 재빌드 뒤에도 이걸로). `vercel --prod` 를 landing 에서 직접 치지 말 것(가드는 deploy_landing 안에만 있다)
- Vercel Web Analytics 의 tarkov 집계는 멈춘다 → 방문은 GA4·통계 콘솔 "한눈에"
- 자체 비콘(api.aquapado.com)·GA4·가이드 연동(127.0.0.1)은 그대로
