# 시즌 퀘스트 동기화 (2단계) 설계 — 2026-08-18 조사 확정본

1단계(시즌 시세·바터·제작·은신처, `a93c5bd`)는 출하됨. 이 문서는 남은 2단계
"시즌 래더 퀘스트 **진행 동기화**"의 확정 설계다. 근거는 2026-08-18 4각도
조사(TarkovMonitor/TarkovTracker 코드·이슈, GitHub 전역, 커뮤니티, tarkov.dev
데이터 파이프라인)로 교차 검증됨.

## 핵심 사실 (확정)

- **시즌 세션의 로그 라벨 = `Session mode: PvpSeason`** (CamelCase).
  실로그 3건 교차 확인: TarkovMonitor #187(1.1.0.0.46608, 이 값으로 구파서
  크래시), Kadenvh/tarkov-ai-companion 리서치 문서(46624), josephjang/
  TarkovHelper 로그 분석(46657 — PvE=`Pve`, 시즌=`PvpSeason`, 영구PvP=`Regular` 표).
- **1.1부터 영구 PvP 토큰은 `Regular`** (구버전의 `Pvp`가 아님). 우리
  `_classify_mode_word`는 이미 `("pvp", "regular")` 둘 다 수용하므로 무해 —
  단 quest_tracker.py 16행 주석의 "(or Pvp)"는 구버전 기준.
- 우리 정규식 `Session mode:\s*([A-Za-z0-9_]+)`(283행)은 `PvpSeason`을 이미
  캡처한다. 현재는 `_classify_mode_word`가 몰라서 `unknown` → 폴더 스킵 +
  `unknown_mode_folders` 카운트. **오염 없음(설계 의도대로 방어 성공), 시즌
  진행만 동기화 안 되는 상태.**
- 보조 신호(폴백): backend 로그의 시즌 게이트웨이 `gw-pvp-season.escapefromtarkov.com`.
  기존 Signal 2 정규식 `gw-([a-z0-9_-]+)`가 캡처 가능 — 매핑만 추가.
- API 슬러그 함정: 로그 토큰 `PvpSeason`을 lowercase하면 `pvpseason` ≠ API
  슬러그 `pvp-season`. **명시 매핑 상수 필수** (TarkovMonitor도 이걸 밟고
  ToApiString을 따로 만들었음).

## 구현 체크리스트 (quest_tracker.py 중심)

1. `GameMode = Literal["pvp", "pve", "season"]`, `MODES = ("pvp", "pve", "season")`
   (62-63행). `_status`/`counts_by_mode`/`ignore_before`는 MODES 순회 생성이라
   자동 확장 — 기존 사용자의 `quest_state.json`에 season 키 없음 → 로드 시
   빈 dict 기본값 마이그레이션만.
2. `_classify_mode_word`(292행)에 추가:
   - `"pvpseason"` → `"season"` (확정)
   - `"pvp-season"` → `"season"` (backend 호스트 폴백, 확정)
   - `"seasonal"`, `"szn"` → `"season"` (speculative — TarkovMonitor의 방어적
     별칭, 실관측 0건. 넣어도 무해)
   - 그 외 `unknown` fail-safe 유지.
3. 정규식 하드닝(283행): `[A-Za-z0-9_]+` → `[^\s|]+` (EFT 로그는 파이프 구분.
   TarkovMonitor 커밋 a0c5e82 동일 조치. 현재 값들엔 무변화, 미래 대비).
4. 내부 모드명 `"season"` ↔ tarkov.dev 슬러그 `"pvp-season"` 매핑 상수.
   main.py의 카탈로그 game_mode("pvp-season")와 트래커 모드("season")가
   다른 이름 체계임에 주의 — 조회 시 변환 지점 한 곳으로 몰 것.
5. 프론트: `questDisplayMode` 2→3원화(pvp/pve/season), 와이프 리셋 버튼
   시즌 스코프 추가, main.py `_build_response`의 시즌 상태 블랭킹(1단계에서
   넣음)을 시즌 트래커 상태로 교체, `status_by_mode`에 `season` 키 추가.
6. **혼합 세션 방어(유일한 구조적 리스크)**: tarkov-ai-companion이 "게임
   재시작 없이 표준↔시즌 캐릭터 전환 시 한 로그 폴더에 모드 라인 2개"를
   실관측했다고 주장(단일 소스, 교차 미확인). 사실이면 `_folder_mode`
   캐시의 "폴더=단일 모드" 전제가 깨짐. 최소 방어: 스니프 구간에서 서로
   다른 모드 라인 ≥2개면 `mixed`(=unknown 취급)로 스킵 + 카운터 노출.

## 구현 전 로컬 검증 절차 (시즌 캐릭터 선택 → 메인 메뉴 진입이면 충분, 레이드 불필요)

```powershell
# 최신 로그 폴더에서
Select-String "Session mode" <EFT>\Logs\log_*\*application*.log   # 기대: PvpSeason
Select-String "gw-" <EFT>\Logs\log_*\*backend*.log                # 기대: gw-pvp-season...
Select-String "SelectedProfile|PrepareSelectedProfileLocally" ... # 시즌 ProfileId 별도 확인
```
- 혼합 세션 실험: 재시작 없이 표준↔시즌 전환 → 같은 application 로그에
  `Session mode:` 라인이 2개인지, push-notifications 파일이 캐릭터별 분리인지.
- 로그 파일명 글롭 재검증: TarkovMonitor가 08-11에 `EndsWith("application.log")`로
  완화(타임스탬프 접두사형 시사). 우리 글롭 `*application_*.log`(313행)이 1.1
  실파일명과 매칭되는지 — 안 맞으면 Signal 1이 통째로 죽고 backend 폴백만 남음.

## 참고

- 이미 배포된 v1.2.x의 `unknown_mode_folders`(get_status, 574행)는 시즌 플레이
  사용자에서 >0이 됨 — 시즌 수요의 직접 proxy로 활용 가능. (외부 보도 기준
  래더 분포: 시즌 55% / PVE 38% / 표준 7%, likely.)
- TarkovTracker.org API는 시즌 키 접두사 SZN_, gameMode 변형
  seasonal|pvpseason|pvp-season|sn1|szn 전부 수용 — Phase 2와 무관하지만
  TarkovTracker 연동(백로그) 시 참고.
