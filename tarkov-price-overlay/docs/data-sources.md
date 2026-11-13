# 데이터 출처 표 (기능별)

2026-11-06 기준. 앱(Tauri 셸 + React + Python 사이드카)과 웹 가이드(생성기·결과물은 11-06부터 별도 저장소)가 **무엇을 어디서 언제 가져오는지**, 실패하면 무엇으로 버티는지, 라이선스 조건이 무엇인지 한 곳에 모은다. 출처를 바꾸거나 기능을 추가하면 이 표부터 고친다.

라이선스 약칭: **NC** = CC BY-NC-SA(비영리·출처 표시·동일 조건) · **자체** = 이 저장소에서 직접 만든 데이터.

11-13 출처·라이선스 정리: **tarkov.dev 자료(api.tarkov.dev·json.tarkov.dev·assets.tarkov.dev)에는 데이터 라이선스가 명시돼 있지 않다** — MIT 는 사이트 코드 저장소(the-hideout/tarkov-dev)에만, API 코드(tarkov-api·tarkov-data-manager)는 GPL-3.0, API 문서의 자료 출처에 EFT 위키가 들어 있다. MIT 자료 2건(eft-where-am-i 프리셋 표, tarkov-dev maps.json 변환값)의 저작권 줄·전문은 `THIRD_PARTY_NOTICES.txt`(설치본·포터블에 포함). 앱 표기 = 설정 맨 아래 copyrightLine3~5(지도 그림·타일·자료·위키·스토리 CC0·상표 고지).

## 1. 앱

| 기능 | 출처 | 언제 | 실패하면 | 조건 | 근거 |
|---|---|---|---|---|---|
| 시세 카드(플리·24h·48h·크기·무게) | json.tarkov.dev `{mode}/items`·`items_{lang}` (mode = regular·pve·pvp-season) | 시작 직후 + 10분마다 ko·en·ru × 3모드, 못 찾으면 즉시 재갱신(5분 간격) | GitHub 미러(`data-mirror` 릴리즈, 매일) → GraphQL → 디스크 스냅샷(`%LOCALAPPDATA%\TarkovPriceOverlay\catalog`, 7일) | tarkov.dev 무료 공개(데이터 약관 없음) | `python-core/tarkov_api.py`, `tarkov_json_fallback.py` |
| 첫 실행 직후 조회(카탈로그 없음) | 위와 같은 json 카탈로그를 그 자리에서 채움 | 조회 때 | GraphQL 단건 조회(마지막 예비) | 〃 | `tarkov_api._cold_warm` (11-06) |
| 상인 판매·구매가 | json `{mode}/traders`·`traders_{lang}` | 카탈로그와 같이 | 카탈로그와 같음 | 〃 | `tarkov_json_fallback.py` |
| 플리 수수료·판매 조언 | json items 의 `fleaMarket` 계수 + tarkov-api 공식을 옮김 | 〃 | 값 없으면 표시 안 함 | 공식 = GPL-3.0 코드 참고 | `src/sellAdvice.ts` |
| 퀘스트 필요 표시 | json `{mode}/tasks`·`tasks_{lang}` + `data/quest_ko.json` | 〃 | 그 패널만 빈 값 | tarkov.dev / 자체 번역 | `tarkov_json_fallback.py`, `quest_ko.py` |
| 퀘스트 진행(완료·진행 중) | 게임 로그 `Logs/log_*/*push-notifications*`·`application*`·`backend*` | 2.5초마다 로그 파일만 읽음 | — | 이 PC 로그(메모리 안 읽음) | `quest_tracker.py` |
| 스토리 진행 추정 | 게임 `output_*.log` 경고 줄 | 런타임 | — | 〃 | `story_progress.py` |
| 바터·제작 | json `{mode}/barters`·`{mode}/crafts` | 카탈로그와 같이 | 그 패널만 빈 값 | tarkov.dev | `tarkov_json_fallback.py` |
| 은신처(재료 표시·시설 목록) | json `{mode}/hideout`·`hideout_{lang}` | 카탈로그와 같이 · 캐시 빔이면 즉시 | GraphQL(마지막 예비) → 빈 값 | 〃 | `tarkov_json_fallback.fetch_hideout_index` (11-06) |
| 탄약표 | json items(구경·관통·피해) | 첫 요청 | GraphQL → 빈 표 | 〃 | `tarkov_api.py` `_ammo` |
| 아이템 아이콘 | assets.tarkov.dev `gridImageLink` **핫링크** | 카드 그릴 때 | 아이콘 없이 표시 | 게임 이미지(BSG 저작물) | `src/App.tsx` |
| 위키 링크 버튼 | tarkov.dev `wikiLink` | — | — | 링크만 | `tarkov_api.py` |
| 별칭표 | `data/item_alias.json` | 번들 | 빈 표 | 자체 | |
| 거래 불가 아이템 쓰임새 | `data/item_usage.json` — **공식 위키를 보고 요약** | 번들 | 빈 표 | **NC** | `item_usage.py` |
| 건스미스 | `tarkov.aquapado.com/guide/gunsmith.json`(가이드 산출물, `ex` = 위키 예시 조립) | 시작, 하루 캐시 | 오래된 캐시 | `ex` 는 **NC** | `gunsmith.py` |
| 가이드에서 보기 | `tarkov.aquapado.com/guide/item-pages.json` | 시작, 하루 캐시 | 캐시 → 위키 링크 | 자체 | `guide_index.py` |
| 글자 인식(OCR) | 번들 EasyOCR 모델(craft_mlt_25k, korean_g2, english_g2, cyrillic_g2) | 빌드 때 포함 | — | EasyOCR Apache-2.0(모델 라이선스 표기는 저장소에 없음 — 확인 필요) | `ocr.py`, `tarkov-server.spec` |
| 지도: 내 위치·방향 | 게임 스크린샷 파일명의 좌표·쿼터니언 | 스크린샷 때 | — | 이 PC 파일 | `radar.py` |
| 지도: 현재 맵 | 게임 application 로그 `scene preset path` (표는 eft-where-am-i MIT 참고) | 런타임 | 이름 단어로 추측 | MIT 참고 | `radar.py` |
| 지도: 탈출구·트랜짓·위험·자물쇠·상자·스폰·보스 좌표 | json `regular/maps`·`maps_{lang}` | 6시간 메모리 캐시 | GitHub 미러 → 문서 없음 | tarkov.dev | `radar.py` |
| 지도: 지금 있는 탈출구·진영 | `data/extracts_current.json` ← **위키** Extractions 표(`scripts/wiki_extracts.py`) | 번들 | 거르지 않음 | **NC** | `extract_current.py` |
| 지도: 탈출 조건 문구 | `extract_conditions.py` — **위키 표를 옮김** | 코드 | — | **NC** | |
| 지도: 퀘스트 목표·필요 열쇠 | json tasks·items | 6시간 캐시 | 열쇠만 빠짐 | tarkov.dev | `radar.py` |
| 지도: 스토리 목표 위치 | `data/story_marks.json` ← szepiz/tarkov-quest-data | 번들(생성 스크립트 없음) | 빈 값 | **CC0** | `radar.py` |
| 지도 그림(SVG 10맵) | assets.tarkov.dev `maps/svg/*.svg` | 첫 표시, 7일 캐시 | 오래된 캐시 → 좌표만 | **NC + "치트·부당 이득 도구 사용 금지" 조항**(tarkov-dev-svg-maps) | `radar.py` |
| 지도 그림(타일: 연구소·미궁·쇄빙선) | assets.tarkov.dev 타일 PNG를 이어 붙임 | 7일 캐시 | 오래된 캐시 | 라이선스 표기 없음(연구소·미궁 © Tarkov.dev, 쇄빙선 © TarkovBOT.eu) | `radar.map_tile_png` |
| 지도 좌표 변환값 | `data/td_maps.json` ← tarkov-dev `src/data/maps.json` | 번들(`scripts/td_maps.py`) | 그림 없음 | MIT (Copyright (c) 2019 Oskar Risberg, 고지 = THIRD_PARTY_NOTICES.txt) | |
| 파티 방 | `wss://aquapado-party.aquapado.workers.dev` | 런타임 | 재접속 | 자체 서버(Cloudflare) | `src/party.ts` |
| 원격 공지·최소 버전 | `api.aquapado.com/priceoverlay/announcement` | 시작 | 무시 | 자체 서버(Vercel) | `App.tsx` |
| 익명 통계·피드백 | `api.aquapado.com/priceoverlay/events`·`feedback` | 30분 묶음 | 로컬 대기열 500건 | 자체 서버(Vercel→Neon) | `App.tsx` |
| 자동 업데이트 | GitHub `tarkov-price-overlay-releases` `latest.json`(minisign 서명) | 주기적 | 릴리즈 페이지 | 자체 | `tauri.conf.json` |

**GraphQL(api.tarkov.dev)** 은 2026-07-21부터 응답하지 않고(the-hideout/tarkov-api#474), tarkov.dev 문서도 2026-06-12부터 "유지보수 모드 — 스키마 변경 없음, JSON API 권장"이다. 앱에서 GraphQL 은 `tarkov_api.py` 한 파일에만 남아 있고 전부 **마지막 예비**다(11-06에 단독 경로 2곳 정리).

## 2. 웹 가이드 (별도 저장소)

| 페이지·데이터 | 출처 | 언제 | 조건 |
|---|---|---|---|
| 퀘스트·상인·은신처·제작·탄약·맵·보스·카파·열쇠·키파인더·모딩·레이드·검색 | json.tarkov.dev `regular`·`pve` + 로케일 | 빌드 때(실패하면 빌드 중단) | tarkov.dev |
| 아이콘·보스 초상 | assets.tarkov.dev **핫링크** | 브라우저가 볼 때 | 게임 이미지 |
| 맵 탈출구 걸러내기·조건 | 앱과 같은 `extracts_current.json`·`extract_conditions` | 빌드 | **NC** |
| 퀘스트 이전·다음 연결 | `guide_data/wiki_quest_links.json` ← 위키 | 수동 | **NC** |
| 퀘스트 받는 상인 레벨 | `guide_data/bundle_ll.json` ← 위키 | 수동 | **NC** |
| 사라진 퀘스트 안내 | `guide_data/wiki_historical.json` ← 위키 | 수동 | **NC** |
| 이벤트 퀘스트 | `guide_data/event_quests.json` ← 위키 + 자체 번역 | 수동 | **NC** |
| 건스미스 예시 조립 | `guide_data/gunsmith_builds.json` ← 위키 | 수동 | **NC** |
| 키파인더 사용처 보충 | `guide_data/key_wiki_uses.json` ← 위키 | 수동 | **NC** |
| 프로모 코드 | 자체 목록 + 정리 사이트 6곳 확인(`promo_check.py`) | 매주 | 사실 정보 |
| 패치·게임 버전·이벤트 | 자체 작성(위키로 경고만) | 빌드 | 자체 |
| 정확성 검증 | 위키 api.php + json.tarkov.dev | 빌드 뒤 | 검증용 |

## 3. 표기·정리 필요 (11-06 조사에서 나온 것)

- ~~앱 화면·`README.md` 에 위키 출처·CC BY-NC-SA 표기가 없다~~ → 1.3.1 에 표기, 11-13 출처 정리(tarkov.dev 데이터 라이선스 없음·타일·MIT 고지 파일·상표 고지)로 마무리. 위키 유래 3종(탈출구 표·조건 문구·보스 근거)을 우리 자료로 바꾸는 일은 1.3.3(사이트와 같이).
- `radar.py`·`src/RadarMap.tsx` 머리 주석의 "SVG 는 쓰지 않는다"는 옛 내용 — 10-27부터 SVG 를 쓴다.
- `README.md`·`CLAUDE.md`·`python-core/README.md` 의 "tarkov.dev GraphQL API 호출" 설명은 옛 내용 — 1순위는 json.tarkov.dev.
- EasyOCR 모델 파일의 라이선스 표기가 저장소에 없다.
- `data/story_marks.json` 을 만든 스크립트가 저장소에 없다.

자가 수급(외부 의존 줄이기) 계획은 [data-independence-plan.md](data-independence-plan.md).
