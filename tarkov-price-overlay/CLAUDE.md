# Tarkov Price Overlay — EFT 시세 오버레이

Escape from Tarkov 게임 화면의 아이템 툴팁을 F2 전역 핫키로 캡처·OCR 해 플리마켓/상인 시세를 투명 오버레이 카드로 보여주는 Windows 데스크톱 앱.
**운영 중** — 최신 릴리즈 v1.2.1, 언어 ko/en/ru, 커뮤니티 배포 + 인앱 자동업데이트.

## 아키텍처

- `src/` — React + TypeScript UI (오버레이 카드·설정·피드백 패널). i18n: `src/i18n.ts`
- `src-tauri/` — Tauri 2 셸: 투명 always-on-top 윈도우, 전역 핫키, 사이드카 관리, 업데이터
- `python-core/` — 사이드카 로컬 서버(FastAPI): mss 캡처 + EasyOCR(ko/en/키릴) + tarkov.dev GraphQL 시세. PyInstaller 번들(`tarkov-server.spec`, torch 2.7.1+cpu 핀 — 호환성 때문에 버전 올리지 말 것)
- `landing/` — 정적 랜딩 tarkov.aquapado.com (ko/en/ru, JSON-LD, 웹 유입 비콘)
- 텔레메트리·인앱 피드백 → api.aquapado.com(Neon). 분석·triage는 user-level 스킬 **`/통계`, `/피드백`** 사용 (토큰이 그쪽에 있음 — 이 공개 레포에 토큰 금지)

## 브랜치·릴리즈 정책 (절대 규칙)

- **dev** = 작업·로컬 테스트 라인. 모든 커밋은 dev에. **master** = 릴리즈 라인 — 직접 커밋 금지.
- push·릴리즈는 사용자가 명시 요청할 때만. 릴리즈 전체 절차는 user-level 스킬 **`/릴리즈`** 를 따른다.
- `scripts/release.ps1`이 릴리즈를 전부 자동화: 3파일 버전 일치 검증 → 전체 빌드 → dev push → master 머지·태그 → PUBLIC 배포 레포 `pado8/tarkov-price-overlay-releases`에 GitHub Release(.exe 첨부).
- 버전 범프는 3파일 동시: `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` — 하나라도 빠지면 release.ps1이 거부한다.

## 명령

| 목적 | 명령 |
|---|---|
| 프론트 타입체크 | `npx tsc --noEmit` |
| Rust 체크 | `src-tauri`에서 `cargo check` |
| 전체 빌드 | `powershell -ExecutionPolicy Bypass -File scripts\build.ps1` (PyInstaller + Tauri NSIS) |
| 빠른 빌드 | `scripts\build-quick.ps1` (`-SkipPython` `-SkipBundle` 지원) |
| 로컬 실행 테스트 | 빌드 후 `scripts\run-local.ps1` — NSIS 인스톨러 우회. **코드 수정 후엔 항상 이걸로 실행 확인** |
| 포터블 ZIP | `scripts\portable.ps1` |

## 함정 (위반하면 실제로 깨진다)

- **Tauri 2 `resources`**: `**/*` 글로브 + 매핑은 하위 폴더를 평탄화한다 → 디렉터리 자체를 매핑할 것.
- **게임 화면은 직접 볼 수 없다** → "고쳤다" 단정 금지. 빌드 + 코드 경로 + 로그로만 검증하고, 인게임 검증은 사용자 몫임을 항상 명시.
- **한글 포함 HTTP 전송(공지 게시 등)은 Python UTF-8 스크립트로** — curl 인자에 한글을 넣으면 cp949로 깨져 서버에 잘못 저장된다.
- **README 3종 동기화**: 릴리즈 때 이 레포 `README.md`(ko/en 내역) + PUBLIC 배포 레포 README + `scripts/portable-readme.txt`를 함께 갱신. 랜딩 `landing/` JSON-LD `softwareVersion`도 새 버전으로.
- `marketing-plans/` `community-posts/`는 gitignore된 로컬 초안 — 커밋 시도 금지.
