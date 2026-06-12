# TPO 사용자 피드백 5건 구현 작업 지시

너는 Tarkov Price Overlay(TPO) 코드베이스에서 작업하는 시니어 엔지니어다. 아래 5건의 사용자 피드백을 구현해라. 각 항목에 **문제 / 변경 파일 / 데이터 가용성 / 구현 단계 / 결정(기본값) / 함정**이 정리돼 있다. 결정 사항은 기본값으로 진행하되, 코드를 읽고 더 나은 길이 보이면 그 이유와 함께 제안해도 된다.

## 프로젝트 구조 (먼저 숙지)
- **하이브리드 앱**: Python 사이드카(FastAPI) + React(Tauri) 프론트엔드.
- `python-core/tarkov_api.py` (~1062L) — tarkov.dev **GraphQL 쿼리 정의 + 응답 가공 + 인메모리 캐싱**. 가장 중요한 파일.
  - `_QUERY_BY_NAME` (~17L~): 단일 아이템 조회용 쿼리 (cold-path)
  - `_QUERY_ALL_PRICED` (~150L~): 카탈로그 워밍업용 쿼리 (warm-path)
  - **GraphQL 필드를 추가할 땐 위 두 쿼리를 반드시 함께 수정**해야 한다. 하나만 고치면 조회 경로에 따라 동작이 갈린다.
  - `_build_cache_entry` (~521L~): GraphQL 응답 → 내부 dict 가공
  - 인메모리 가격 캐시 `_price_cache` + 백그라운드 리프레셔 `_refresher_loop`(CACHE_TTL_SEC≈10분). **쿼리 스키마를 바꾸면 기존 캐시 엔트리엔 새 필드가 없으므로** 캐시 강제 클리어 또는 캐시 버전 범프를 고려.
- `python-core/main.py` (~793L) — FastAPI 엔드포인트 + Pydantic 응답 모델. tarkov_api의 dict를 Pydantic 모델로 매핑.
- `python-core/ocr.py` (~197L) — EasyOCR. `recognize_text_fragments`가 `(bbox, text, confidence)` 반환 (bbox는 4코너 픽셀좌표).
- `python-core/capture.py` — mss 화면 캡처.
- `python-core/quest_tracker.py` (~741L) — EFT 게임 로그 파싱으로 퀘스트/은신처 진행도 추적. `quest_status_for(quest_id, game_mode)` → `'started'|'completed'|'failed'|None`.
- `src/App.tsx` (~4517L) — **UI 전체가 이 한 파일**. TS 타입 정의는 ~276–410L.
- `src/App.css`, `src/i18n.ts` (ko/en 번역).

> ⚠️ **라인 번호는 조사 시점 기준 참고값**이다. 실제 위치는 함수명·심볼·인접 코드로 찾아라. 작업 전 해당 파일을 직접 읽고 확인할 것.

## 공통 규칙
1. GraphQL 필드 추가 시 `_QUERY_BY_NAME`과 `_QUERY_ALL_PRICED` **양쪽** 수정.
2. 스키마 변경 후엔 캐시를 클리어(또는 버전 범프)해 stale 엔트리가 새 필드 없이 남지 않게 할 것.
3. UI에 새 문구가 생기면 `src/i18n.ts`에 **ko/en 둘 다** 추가.
4. tarkov.dev 응답은 `lang` 변수로 현지화된다 — 아이템/퀘스트 이름은 UI 언어에 맞춰 자동으로 나온다.
5. 각 작업 후 빌드/타입체크가 통과하는지 확인. 추측으로 "됐다" 하지 말고 컴파일·코드경로로 검증.
6. 작업은 작은 단위로 나눠 커밋. 버전 번프(v1.1.4)와 변경로그(한/영 README + portable-readme.txt)는 전체 완료 후 별도로.

---

## 작업 1 — 은신처 제작(crafts) 미가용분도 미리 표시 [난이도: 中]

**문제**: 현재 은신처 제작 항목은 필터 없이 전부 나열되지만, 사용자의 은신처 스테이션 레벨과 무관하게 표시돼 "지금 할 수 있는 것"과 "나중에 할 것"이 구분되지 않는다. 사용자는 아직 못 하는 제작도 **필요 스테이션 레벨 표시와 함께** 보고 미래 계획을 세우고 싶어 한다.

**참고할 기성 패턴**: `needed_for_hideout` 섹션(App.tsx ~4110–4156)이 이미 `hideoutLevels[station_id]`로 필터링하고 완료분을 마킹한다. crafts_for도 이 패턴을 그대로 따른다.

**데이터 가용성 (부분)**: craftsFor 쿼리가 현재 `station { name }`만 가져온다 — **`station.id`가 없어** 사용자 레벨과 매칭 불가. 이게 유일한 블로커. (tarkov.dev는 `station.id`를 노출함 — `_QUERY_HIDEOUT_STATIONS`가 이미 사용 중.)

**구현 단계**:
1. `tarkov_api.py`: `_QUERY_BY_NAME`과 `_QUERY_ALL_PRICED`의 craftsFor에서 `station { name }` → `station { id name }`.
2. `tarkov_api.py` `_build_cache_entry`의 crafts_for 생성부: `sid = station.get("id")` 추출 → dict에 `"station_id": sid` 추가.
3. `main.py`: `HideoutCraft` Pydantic 모델에 `station_id: str = ""` 필드 추가 + crafts_for 매핑부에 `station_id=c.get("station_id", "")`.
4. `src/App.tsx`: `HideoutCraft` 타입에 `station_id` 추가. crafts_for 렌더부에서 `const canDoCraft = (hideoutLevels[c.station_id] ?? 0) >= c.level` 계산 → 미가용 제작은 회색/저투명(opacity~0.5) + `Lv{c.level} 필요` 배지로 표시.

**▶ 결정 (기본값)**:
- **표시 방식**: `[기본] 같은 섹션에서 미가용분을 회색+필요레벨 배지로` (별도 "미래 제작" 섹션으로 분리하지 않음). needed_for_hideout과 일관.
- **hideoutLevels 비어 있을 때**: `[기본] 전부 가용으로 표시` (needed_for_hideout 로직과 동일).
- **미가용 제작 클릭/상호작용**: `[기본] 읽을 수 있게 유지하되 스타일만 다르게` (pointer-events 차단 안 함).

**함정**:
- `station_id`는 숫자가 아니라 문자열 UUID. `hideoutLevels`의 키로 쓰임 — craftsFor의 station id가 은신처 스테이션 목록(`get_station_list`)의 id와 **일치하는지** 확인.
- 캐시: 쿼리 변경 후 클리어 안 하면 기존 엔트리에 station_id 없음.
- i18n: `Lv N 필요` 배지 문구 ko/en 추가.

---

## 작업 2 — 퀘스트 잠금 바터가 "가용"으로 잘못 표시됨 [난이도: 中 · 데이터 정확성 버그]

**문제**: 특정 퀘스트 완료로 잠금 해제되는 바터가 마치 지금 가능한 것처럼 표시된다. (예: Therapist LL2에서 사과주스 3개 → Propital 교환은 특정 퀘스트 완료가 선행이지만 TPO는 그냥 보여줌.) 사용자가 명시적으로 "실수"라고 지적한 정확성 문제.

**데이터 가용성 (미페치)**: bartersFor 쿼리가 `taskUnlock`을 안 가져온다. tarkov.dev Barter 타입은 `taskUnlock { id name }`을 노출함. quest_tracker는 이미 `quest_status_for(quest_id, game_mode)`로 완료 여부를 안다 (main.py가 used_in_tasks에서 같은 패턴 사용 중).

**구현 단계**:
1. `tarkov_api.py`: `_QUERY_BY_NAME`/`_QUERY_ALL_PRICED`의 **bartersFor와 bartersUsing 양쪽**에 `taskUnlock { id name }` 추가.
   → 블록 예: `bartersFor { trader { name } level taskUnlock { id name } requiredItems { count item { name shortName } } }`
2. `tarkov_api.py` `_build_cache_entry`: barters/barters_using dict에 `"task_unlock": {"id":..., "name":...} or None` 추가.
3. `main.py`: `Barter`/`BarterUsing` Pydantic 모델에 `task_unlock: Optional[Dict[str,str]]` 추가 + 매핑. **선택 결정(b) 채택 시** lookup 응답 빌드에서 `quest_tracker.quest_status_for(task_unlock["id"], game_mode)`를 호출해 완료상태도 함께 내려줌(used_in_tasks와 동일 패턴, game_mode 전달).
4. `src/App.tsx`: `Barter`/`BarterUsing` 타입에 `task_unlock?: {id:string; name:string; status?:string} | null` 추가. 바터 렌더(트레이더 레벨 옆)에 조건부 배지: task_unlock 있으면 `퀘스트 필요: {name}` 표시.

**▶ 결정 (기본값)**:
- **표시 vs 숨김**: `[기본] 항상 표시 + 빨간 "퀘스트 필요" 배지` (플레이어는 곧 풀릴 바터를 미리 알고 싶어함). 숨김+토글 옵션은 채택 안 함.
- **완료상태 연동**: `[기본] 연동함(옵션 b)` — quest_tracker로 사용자 진행도를 교차확인해 **미완료=빨강 / 완료=초록**으로 배지 스타일 분기. quest_tracker가 이미 통합돼 있어 자연스러운 다음 단계. (단순 라벨만 원하면 status 호출 생략하고 항상 빨강.)
- **bartersUsing에도 적용**: `[기본] 예` (bartersUsing도 taskUnlock 있음, 동일 처리).

**함정**:
- **먼저 tarkov.dev 라이브 스키마에서 필드명이 `taskUnlock`인지 확인**(test query 1회). 다를 가능성 낮지만 확정 후 진행.
- Null 처리: taskUnlock 없는 바터는 `task_unlock: null`로 정상 렌더. GraphQL 응답에 필드 없어도 Python이 안 죽게.
- quest id는 변형 없이 tarkov.dev가 준 문자열 그대로 `quest_status_for`에 넘길 것.
- game_mode 전달 필수 (PVE/PVP 바터 게이팅).
- 캐시: 세션 중 퀘스트 완료하면 캐시된 바터 상태가 즉시 안 바뀜 — 대부분 재조회하므로 허용. 엄격한 실시간 필요하면 바터는 캐시 스킵 또는 quest_status를 캐시 키에 포함.
- 퀘스트 이름은 `lang` 변수로 현지화되는지 확인.

---

## 작업 3 — 거래(Trade) 메뉴에서 OCR이 가격/상태 문구에 막히는 문제 [난이도: 小]

**문제**: 거래창에서 캡처 영역에 아이템 이름뿐 아니라 그 아래 가격 라벨(`#####₽`, `₽ 98,000`)이나 `The trader cannot buy this item` 같은 문구가 함께 잡힌다. 조인된 텍스트("Bitcoins #####₽")가 퍼지매칭에 실패하고, 프래그먼트 재시도에서 가격 노이즈가 엉뚱한 아이템에 매칭되거나 조회가 실패한다. 사용자 제안: 이걸 감지해 **가격 라인 위쪽 텍스트를 스캔**.

**데이터 가용성 (있음)**: EasyOCR `detail=1`이 이미 **프래그먼트별 4코너 bbox(픽셀좌표)**를 준다. ocr.py가 이미 Y값을 추출해 배경 필터링에 사용 중. 추가 GraphQL 불필요. 가격/상태 라인 감지는 로컬 정규식으로.

**구현 단계 (권장: STEP A 우선, 부족하면 STEP B 추가)**:

**STEP A — 프래그먼트 필터 패스 (간단·무비용, 먼저 적용)**:
- `ocr.py`에 헬퍼 추가:
  ```python
  _CURRENCY_PATTERNS = [
      re.compile(r'^\d[\d,\.\s]*\s*[₽$€]$'),   # "98,000₽", "123 $"
      re.compile(r'^[₽$€]\s*\d'),               # "₽ 123"
      re.compile(r'^#+\s*[₽$€]?'),              # "#####₽"
      re.compile(r'The trader'),                # 영문 상태문구
      re.compile(r'(Пусто|Недостаточ)'),        # 러시아어 상태문구
  ]
  def _is_price_or_status_line(text: str) -> bool:
      t = (text or "").strip()
      return any(p.search(t) for p in _CURRENCY_PATTERNS)
  ```
- `main.py`의 lookup 실패 후 프래그먼트 재시도 직전에, 가격/상태로 판정된 프래그먼트를 **후보에서 제외**하고 남은 텍스트로 재조회.

**STEP B — Y축 크롭 재OCR (폴백, A로 부족할 때만)**:
- `recognize_text_fragments`에 `return_bboxes=True` 옵션을 추가해 `(text, bbox)` 반환.
- 가격/상태 라인의 최상단 Y를 찾아, 그 위쪽(`y - 약 10px` 여유)으로 이미지를 크롭(`image[:y, :]`)해 재OCR → 재조회.
- **실패 경로에서만** 돌므로 추가 ~60–80ms는 허용(매 F2마다가 아님).

**▶ 결정 (기본값)**:
- **감지 방식**: `[기본] 정규식` (패턴 안정적, 학습데이터 불필요, 지연 없음). ML 분류 안 씀.
- **방식 선택**: `[기본] 필터 패스(A) 먼저, Y크롭(B)은 폴백`.
- **적용 범위**: `[기본] 전 메뉴 전역 적용` (가격패턴이 잡힐 때만 발동하므로 오탐 무해).
- **필터 위치**: `[기본] 조인 텍스트와 재시도 후보 양쪽 모두에서 제거`.

**함정**:
- bbox는 경계사각형이 아니라 4코너(시계방향, top-left부터). Y는 min/max로 span 계산 (ocr.py가 이미 올바르게 처리 중).
- 거래창은 러시아어가 섞임(`Пусто`, `Недостаточно`). EasyOCR 인식은 OK, 문제는 "이게 상태라인인지 감지". 키릴 패턴 포함.
- 가격 포맷 다양: `₽ 123,456`(콤마), `#####₽`(가려진 가격), `The trader cannot buy this`(요건 미충족). 단일 정규식 불가 → 패턴 리스트, 하나라도 매치하면 가격라인.
- 크롭 시 off-by-one: 텍스트 하단 Y가 150이면 `image[:150]`은 [0,149]. 안티에일리어싱/디센더(g,y,p) 고려해 `y_bottom - 5~10`에서 크롭.
- 같은 가로줄에 이름·가격이 나란히 있으면 위치보다 **내용(가격패턴)으로** 거르는 게 안전.

---

## 작업 4 — 아이템 풀네임 호버 표시 [난이도: 小 · 데이터 이미 있음]

**문제**: 오버레이가 `6B5-16`, `MBSS` 같은 짧은 이름만 보여줘 초보자가 무슨 아이템인지 모른다(alt-tab/검색 필요). 이름에 마우스 호버하면 풀네임을 보여주자.

**데이터 가용성 (완비)**: tarkov.dev 쿼리가 이미 `name`(풀네임)과 `shortName`을 둘 다 가져오고, 응답에도 둘 다 담긴다. 메인 카드는 `result.item_name`(풀네임)을, 바터/제작 항목은 `it.short_name ?? it.name`을 렌더 중. **추가 데이터·쿼리 변경 전혀 불필요.** 순수 프론트 작업.

**구현 단계 (App.tsx, title 속성만 추가)**:
1. 메인 카드 이름 div: `<div className="item-name" title={result.item_name}>`.
2. 바터 항목 span: `<span className="barter-item" title={it.name}>…{it.short_name ?? it.name}…</span>`.
3. barters_using 보상 항목, crafts 재료 항목에도 동일하게 `title={it.name}` 추가.
4. (선택) `src/App.css`의 `.item-name`, `.barter-item`에 `cursor: help` 추가해 호버 가능 힌트.

**▶ 결정 (기본값)**:
- **메인 카드도 툴팁**: `[기본] 예`.
- **바터/제작 항목도 툴팁**: `[기본] 예` (데이터 이미 있어 무비용).
- **시각 힌트(cursor:help 등)**: `[기본] cursor: help만 추가` (최소). 네이티브 `title`로 시작, 긴 이름 잘림이 신경 쓰이면 CSS 커스텀 툴팁으로 후속 개선.

**함정**:
- 네이티브 `title`은 오버레이 윈도우 밖으로 떠서 잘림 없음. 단 매우 긴 이름은 일부 브라우저에서 잘릴 수 있음 → MVP는 네이티브로 충분, 필요시 `:before` 기반 커스텀 툴팁.
- `it.name`이 null이어도 `title=""`라 빈 툴팁 안 뜸(안전). DOM 구조 변경 불필요, 기존 엘리먼트에 속성만 추가.

---

## 작업 5 — 탄약 매트릭스에서 "이 팩이 어느 줄인지" 하이라이트 [난이도: 小]

**문제**: 포장 탄약(예: "M855A1 박스")을 조회하면 해당 구경의 모든 라운드를 매트릭스로 보여주지만, **그 팩에 든 라운드가 어느 행인지 표시하지 않아** 눈으로 찾아야 한다. (단일 라운드 조회 시엔 이미 `r.name === result.item_name`으로 그 행을 하이라이트함.)

**데이터 가용성 (부분)**: 현재 ammo 박스의 `containsItems.item.properties.caliber`만 가져와 구경 문자열만 추출한다. **팩 안 라운드의 `id`/`name`은 안 가져옴.** tarkov.dev는 `containsItems.item { id name shortName }`을 노출함(requiredItems가 이미 같은 패턴 사용).

**구현 단계**:
1. `tarkov_api.py`: `_QUERY_BY_NAME`/`_QUERY_ALL_PRICED`의 containsItems에서 `item { properties{…} }` → `item { id name shortName properties{…} }` (양쪽).
2. `tarkov_api.py` `_build_cache_entry`: 구경 추출 시 팩 안 라운드의 id/name도 추출 → 반환 dict에 `"ammo_pack_round_id"`, `"ammo_pack_round_name"` 추가.
3. `main.py`: LookupResponse 모델 + 빌더에 위 두 필드 추가.
4. `src/App.tsx`: `LookupResult`에 `ammo_pack_round_id?`, `ammo_pack_round_name?` 추가. 매트릭스 하이라이트 조건을 확장:
   ```typescript
   const isCurrent = !!(
     r.name === result.item_name ||
     (result.ammo_pack_round_id && r.id === result.ammo_pack_round_id)
   );
   ```
   (id 매칭 우선, id 없을 때 name 폴백.) 자동확장 트리거(`currentId`)도 팩 케이스를 포함하도록 갱신.

**▶ 결정 (기본값)**:
- **매칭 기준**: `[기본] id 우선 + name 폴백` (id가 언어 무관·충돌 없음).
- **무기 조회 시 하이라이트**: `[기본] 안 함(현행 유지)` — 무기는 구경 전체를 보여주되 특정 행 하이라이트 안 함.
- **팩에 여러 라운드가 든 경우**: `[기본] containsItems[0](대표 라운드)만 하이라이트` + 코드 주석으로 가정 명시.

**함정**:
- 쿼리 양쪽 동기화 필수(안 그러면 _QUERY_BY_NAME 경로에서 필드 부재).
- stale 캐시: 구버전 응답엔 `ammo_pack_round_id`가 undefined → name 폴백으로 안전. 개발 중 캐시 클리어하면 다음 리프레시에 반영.
- name 폴백은 번역 충돌 가능성(희박) → id 매칭을 1순위로(`||` 단락평가).
- containsItems.item 필드가 null일 수 있음 → `.get()` 기본값 + React에서 `&&` 가드.
- 페이로드 증가는 팩당 ~30–50B, 카탈로그에 팩 ~20종뿐 → 무시 가능.

---

## 권장 작업 순서
1. **작업 4**(풀네임 호버) — 데이터 완비, 가장 쉬움. 워밍업.
2. **작업 2**(퀘스트 잠금 바터) — 사용자가 지적한 **정확성 버그**라 우선순위 높음.
3. **작업 5**(탄약 팩 하이라이트) → **작업 1**(은신처 제작) — 둘 다 GraphQL 필드 추가 패턴 동일, 연달아 하면 효율적.
4. **작업 3**(OCR) — 독립적, 마지막. STEP A만 먼저 넣고 실측 후 B 판단.

각 작업 완료 시 빌드/타입체크 통과 확인 후 개별 커밋. 5건 끝나면 버전 v1.1.4로 범프하고 한/영 README + portable-readme.txt 변경로그 동기화.
