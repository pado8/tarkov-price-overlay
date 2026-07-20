# PoE Enshrouding Simulator

Path of Exile 3.29 "Curse of the Allflame" 군단 리워크의 **유니크 변환 시뮬레이터** (craftofexile류 웹 도구).

## 개념 (3.29 인슈라우딩 시스템)

1. 군단 장군이 드랍하는 5종 인슈라우딩 크리스탈을 유니크 **방어구**에 사용 (크리스탈 종류 = 슬롯 대응)
2. 무궁한 대립의 영지에서 순열의 수정에 넣고 몬스터 처치로 충전
3. 완충 시 **같은 슬롯의 다른 유니크**로 변환 + 원본의 대표 모드가 약화된 **흔적(Vestigial) 암시적 모드**로 부착
- 제한: 타락/Fatelorn 불가, 장신구·무기 불가. 결과 풀 = Ancient Orb 획득 가능 유니크(보스 전용 제외)

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
4. 역방향 조회(원하는 흔적 모드 → 원본 유니크) 기능
5. 배포 결정 (Vercel, 도메인) — 사용자와 협의
