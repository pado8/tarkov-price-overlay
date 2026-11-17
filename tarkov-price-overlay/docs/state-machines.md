# 숨어 있는 상태 머신 지도 (2026-11-17)

이 앱에는 "하나의 상태 값"이 아니라 여러 불리언·ref·저장 키·타이머가 함께 만들어 내는 상태가 많다.
아래는 그 목록과 **깨지면 안 되는 조건**, 그리고 손댈 때 볼 곳이다. 코드를 고치기 전에 해당 줄을 읽고,
조건을 바꾸면 이 문서도 같이 고친다. 줄 번호는 적지 않는다(금방 낡는다) — 식별자로 찾는다.

> 원칙: 여기 적힌 것을 한꺼번에 "명시적 상태 머신"으로 바꾸지 않는다. 실제 버그가 나온 곳만, 그 조건을 순수 함수로 빼고
> 시험을 붙이는 식으로 조금씩 한다(예: `lookupOutcome.ts`, `captureHelp.ts`, `planDone.ts`).

## 화면 (src/App.tsx)

| 머신 | 상태를 만드는 것 | 깨지면 안 되는 조건 | 이미 빼 둔 순수 함수 |
|---|---|---|---|
| 본 창 화면 모드 | `cardVisible` `showSettings` `captureModalOpen` `historyVisible` `radarActive` `radarMini` `wideMode` `tourStep` + 파생 `pipActive`·`miniOn`·`companionOn` | 나란히(`wideMode`)일 때 카드 안 지도(`radarActive`)를 켜지 않는다 · 설정과 기록은 같이 안 열린다 · 미니맵(`pipActive`)은 설정 중·나란히 중엔 아니다 | `wideLayout.ts`(배치만) |
| 조회 수명주기 | `status` `result` `error` + `lookupSeqRef` `lookupInFlightRef` `lookupAbortRef` | `status="loading"` 인데 진행 중 조회가 없으면 안 된다 · 옛 번호(seq)의 응답이 새 결과를 덮으면 안 된다 | `lookupOutcome.ts` (`pressView`·`viewAfterLookup`·`shotAction`) |
| 엔진(사이드카) 상태 | `sidecarDeadRef` `sidecarMissingRef` `sidecarBlockedRef` `connFailRef` + 시작 45초 창 | 문구 우선순위 = 차단 > 파일 없음 > 복구 포기 > 켜지는 중 > 연결 실패(`sidecarErrorText`) · 조회가 성공하면 missing·blocked 를 푼다 | — |
| 자동 숨김 | `hideTimerRef` + `scheduleHide`·`armHide` 의 조건 목록 | 조회 중·설정 중·마우스가 카드 위·둘러보기 중·나란히 중엔 숨기지 않는다. **두 함수의 조건 목록은 같이 고친다** | `cursorHold.ts` |
| 업데이트 | `updatePhase`(idle/downloading/downloaded/ready/error) `pendingUpdateRef` `UPDATE_PENDING_KEY` | 받는 중엔 다시 확인하지 않는다 · `prepare_quit` 을 부른 뒤에는 앱이 반드시 끝나거나 다시 켜져야 한다(엔진·단축키가 꺼진 상태로 남으면 안 된다) | `version.ts` |
| 창 크기·위치 모드 | 보통 / 나란히 / 미니맵 + `WIDE_PREV_POS_KEY` `WIDE_RECT_KEY` `wideSaveArmedAtRef` `dprHoldRef` | 모드를 바꾸는 순간의 이동·크기 변경은 "사용자가 바꾼 것"으로 저장하지 않는다(무장 시각으로 막음) | `miniSnap.ts` |
| 처음 사용 안내 | `startCard` `tourStep` `tourOpenedRef` · 캡처 도움 상자 · 지도 자료 묻기(`mapShareAsked`) | 둘러보기가 연 화면은 둘러보기가 닫는다(저장하지 않는다) · **오류와 못 찾은 조회는 둘러보기 중에도 보인다** · 설정에서 직접 정했으면 다시 묻지 않는다 | `captureHelp.ts` |
| 단축키 녹음 | `recordingTarget` + Rust 쪽 등록 상태 | 녹음 중엔 전역 단축키가 풀려 있어야 한다 | — |
| 캡처 상자 | `tarkov.captureRegion` + 조회 응답의 `mon` | 손대지 않은 기본 상자는 게임 모니터를 따라간다, 직접 조정한 상자는 건드리지 않는다 | `captureHelp.ts` (`refitBox`·`refitStreak`) |

## 지도·파티 (src/Radar.tsx · RadarMap.tsx · party.ts · LootPlan.tsx)

| 머신 | 상태를 만드는 것 | 깨지면 안 되는 조건 | 순수 함수 |
|---|---|---|---|
| 지도 출처 | `radarMapRef`(수동 선택) `radarManualFallbackRef` + 응답의 `map_source` `pre_raid` `loading` `shot` | 새 레이드(로그)면 수동 선택을 푼다 · **로그로 맵을 못 찾으면 풀었던 수동 선택을 되돌린다** | — |
| 지도 보기 | `view`(null = 내 위치 따라감) `hold` `lastVRef` + 끌기(`dragRef`·`movedRef`) | 맵이 바뀌면 보기·선택을 처음으로 · 잠금이면 새 스크린샷에도 보던 화면 유지 | — |
| 레이드 진영 맞춤 | `layers.pmc` `showScav` `myExitsOnly` + 모듈 전역 `sideAppliedFor` | 같은 레이드에서 사용자가 직접 바꾼 칩은 그대로 둔다 | — |
| 파티 연결 | `status`(off/connecting/on/full/error) `wsRef` `codeRef` `retryRef` 핑·퐁 타이머 + 보낼 위치 대기열 | 옛 연결의 타이머·대기 위치는 새 연결에 넘어가지 않는다 · 방을 나가면 코드·저장값을 같이 지운다 | — |
| 루팅 계획 진행 | `planId` `planDone`(정류장 **순번** 집합) | 다른 계획으로 바꾸면 비운다 · 정류장을 지우거나 옮기면 표시가 그 정류장을 따라간다 | `planDone.ts` (`remapDone`) |
| 지도 자료 보내기 동의 | `mapShareOn` `mapShareAsked` `mapShareClosed` | 답했거나 설정에서 정했으면 묻지 않는다 · 서버가 닫혀 있으면 묻지 않는다 | — |

## 셸·엔진 (src-tauri/src/lib.rs · python-core)

| 머신 | 상태를 만드는 것 | 깨지면 안 되는 조건 |
|---|---|---|
| 앱 종료 | `IsQuitting` `MouseHotkeyStop` `SidecarChild` | `prepare_quit` 뒤에는 되돌리는 길이 없다 — 부른 쪽이 끝내거나 다시 켠다 |
| 엔진 프로세스 | spawn → 실행 → 죽음 → 2·4·8·16·32초 뒤 재시작 → 포기, 곁가지 파일 없음·차단(`SIDECAR_MISSING_SENT`·`SIDECAR_BLOCKED_SENT`) | 포기한 뒤 다시 띄우지 않는다 · 종료 중엔 재시작하지 않는다 |
| 창 보이기·숨기기 | tao 가 아는 값과 윈도우의 실제 값이 따로다 | **숨길 때는 늘 `hide_window_hard`** — 포커스 없이 띄운 창은 `window.hide()` 로 안 숨는다(본 창·미니맵 창 모두 실측) |
| 단축키 슬롯 | `Hotkeys`(등록) `KeyPolls`(엿듣기) `MouseHotkeys` — 슬롯마다 하나만 | 마우스로 바꿀 땐 키보드 슬롯을 먼저 비운다(프런트가 ""로 등록) |
| 툴팁 대기 보정 | `_tw`(켬 → 놓침이 쌓이면 끔 → 가끔 재확인) + `tooltip_wait.json` | 끈 동안엔 기록을 배우지 않는다 · 파일은 내용이 바뀔 때만 쓴다 |
| 시세 목록 | `_price_cache` + 갱신 중 표시 두 벌(`_forced_running`·`_refreshing_now`) | 조회 경로는 네트워크를 기다리지 않는다(`allow_cold=False`) |
| 조회 대체 | `_lookup_seq` ↔ 프런트 `lookupSeqRef` | 가장 새 누름은 대체되지 않는다(번호는 프런트가 매긴다) |
| 지도 엔진 | 레이드 단계(수동 / 로딩 중 / 레이드 중)는 저장하지 않고 호출마다 다시 계산 · 문서 캐시(메모리 6시간 → 디스크 7일 → 네트워크) | 빈 응답은 기억하지 않는다 |
| 퀘스트 추적 | 모드별 상태 + 초기화 기준 시각 + 파일 오프셋 | 초기화하면 오프셋·폴더 판정을 같이 비운다 |

## 시험 도구 (에이전트·개발자용)

- 순수 함수 시험: `npm run test:layout` (tests/*.test.mjs) · 엔진: `python-core/test_*.py`
- 가짜 Tauri 환경(로컬 전용 `dev/` 도구 — 공개 저장소에는 없다): `DIST=<빌드 폴더> node dev/mock-server.mjs <포트>` + 화면 없는 브라우저(CDP).
  엔진 응답은 페이지에 `window.__sidecar(url, init)` 를 미리 심어 정한다(값을 돌려주면 그 답, `undefined` 면 연결 실패).
  이벤트는 `window.__mock.emit("hotkey-lookup", {x, y})` 처럼 보낸다.
- 실제 앱 확인: 별도 `WEBVIEW2_USER_DATA_FOLDER` + `--remote-debugging-port=9222` 로 띄우고 CDP 로 조종한다.
  창이 정말 보이는지는 웹뷰가 아니라 윈도우에 묻는다(`IsWindowVisible`).
