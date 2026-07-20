# PoE 3.29 Simulators

Path of Exile 3.29 "Curse of the Allflame" 시뮬레이터 3종 모음 (craftofexile류 웹 도구). ko/en 토글(i18n) 지원.

- `/` 홈 — 도구 3종 카드
- `/enshrouding` — 인슈라우딩 시뮬레이터 (군단 리워크 유니크 변환)
- `/allflame` — 올플레임 크래프팅 시뮬레이터 (베스퍼·무형화·유황·두캇)
- `/chromatic` — 색채 오브 계산기 (소켓 리워크, 몬테카를로 50k)

## 개념 1: 인슈라우딩 (군단 리워크)

1. 군단 장군이 드랍하는 5종 인슈라우딩 크리스탈을 유니크 **방어구**에 사용 (크리스탈 종류 = 슬롯 대응)
2. 무궁한 대립의 영지에서 순열의 수정에 넣고 몬스터 처치로 충전
3. 완충 시 **같은 슬롯의 다른 유니크**로 변환 + 원본의 대표 모드가 약화된 **흔적(Vestigial) 암시적 모드**로 부착
- 제한: 타락/Fatelorn 불가, 장신구·무기 불가. 결과 풀 = Ancient Orb 획득 가능 유니크(보스 전용 제외)

## 개념 2: 올플레임 크래프팅 (신규 리그)

베스퍼 NPC에게 아이템+화폐+망자의 유황 제출 → 고스트 미리보기 여러 개 중 택1. 제작마다 무형화(Intangibility) 누적 = 미리보기가 1개로 줄어드는 확률. 리셋: 재조합/리셋 두캇(50% 제거·50% 파괴). 두캇 4종(Kishara/Genteel/Brinehook/Reset). 바알 오브 사용 불가.
**수치 전부 미공개** → `src/data/allflame.json`의 config가 가정값(assumed), 데이터마이닝 후 교체.

## 개념 3: 색채 오브 (소켓 리워크)

소켓 기본 백색. R/G/B는 능력치 요구 비례 + 퀄리티·아이템레벨로 확률↑. 색채 오브 = 비백색 1개 강제, 나머지 일반 롤. 신규 벤치: 비백색 2/3/4개 = 색채 5/20/75개(확정). 젬 색 일치 시 젬 퀄 +10%(확정). 색채 오브 상점 구매 불가.
**확률 공식 미공개** → `src/data/chromatic-config.json`의 params가 가정값, 데이터마이닝 후 교체.

## i18n

`src/lib/i18n.tsx` — LangProvider + useT() 훅, 딕셔너리 ko/en 플랫 키, localStorage `poe-sim-lang` 저장. 새 UI 문자열은 반드시 dict 양쪽에 추가.

## 구조

- `scripts/fetch-uniques.mjs` — poe.ninja(Standard)에서 유니크 방어구 593종 수집 → `src/data/uniques.json`
  - API: `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=Standard&type=UniqueArmour` (구 itemoverview 엔드포인트는 404)
- `src/data/vestigial.json` — 유니크별 흔적 모드. **리그 시작(2026-07-24) 후 poedb 데이터마이닝으로 채울 것** (status: confirmed/reported/unknown)
- `src/data/crystals.json` — 크리스탈↔슬롯 대응 (확정 2/5: Imperial=Boots, Maraketh=Body Armour)
- `src/data/pool-overrides.json` — 결과 풀 제외 목록(보스 전용)·Fatelorn 목록 (수동 관리, 현재 비어있음)
- `src/lib/enshrouding.ts` — 룰 엔진 (적격성/결과 풀/흔적 조회)
- `src/components/Simulator.tsx` — 단일 페이지 UI (슬롯 → 유니크 검색·선택 → 크리스탈/흔적/결과 풀)

## 명령

- 개발 서버: 프리뷰 `poe-simulator` (포트 3100) 또는 `npm run dev`
- 데이터 갱신: `node scripts/fetch-uniques.mjs`

## 리그 시작 후 TODO

1. `vestigial.json` 데이터마이닝 주입 (poedb `Vestigial` 검색, 커뮤니티 스프레드시트)
2. `crystals.json` 나머지 3종 슬롯 확정 (Karui/Templar/Vaal)
3. `pool-overrides.json` 보스 전용·Fatelorn 목록 채우기
4. `allflame.json` config 실측값 교체 (고스트 개수·유황 비용·무형화 수치)
5. `chromatic-config.json` params 실제 공식 교체 (기본 확률·퀄리티/아이템레벨 스케일·색상 가중치)
6. 역방향 조회(원하는 흔적 모드 → 원본 유니크) 기능
7. 배포 결정 (Vercel, 도메인) — 사용자와 협의
