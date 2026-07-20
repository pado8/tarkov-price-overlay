# PoE 3.29 Simulators — 작업 로그 & 재개 런북

> 다른 세션에서 이 문서만 읽으면 바로 이어서 작업할 수 있도록 쓴 핸드오프 문서.
> 구조·개념 요약은 [CLAUDE.md](CLAUDE.md) 참조. 이 문서는 "왜 이렇게 됐고, 다음에 뭘 어떻게 하는지"를 담는다.

## 0. 세션 제약 (중요)

- **2026-07-20 사용자 결정으로 런칭됨.** Vercel 프로덕션 라이브: https://poe-simulator.vercel.app (프로젝트 `aquapados-projects/poe-simulator`, `poe-simulator/` 폴더에서 `vercel deploy --prod`). 커스텀 도메인 `poe.aquapado.com` 프로젝트에 추가됨 — **DNS(CNAME)는 사용자 몫**(hosting.co.kr, 대시보드 고유 CNAME 값 확인 필요).
- git push / PR은 여전히 금지 (모노레포 로컬 전용). 커밋은 로컬 `dev`까지만, 배포는 vercel CLI 직접 업로드.
- **한글 용어는 docs/TRANSLATION.md 규칙 준수** — 용어집(docs/poe-glossary.json) 우선, 추측 금지, 미확정은 docs/TODO-terms.md.

## 1. 프로젝트 배경

- 목표: craftofexile.com 같은 PoE 플래닝 도구. 타깃은 **3.29 "Curse of the Allflame"** 신규/개편 시스템 3종.
- **리그 오픈: 2026-07-24 20:00 UTC** ([공지](https://www.pathofexile.com/forum/view-thread/3982050)). 이런 도구는 리그 초반 트래픽이 전부라 오픈 시점에 데이터가 채워져 있어야 가치가 있다.
- 개발 시점(07-20)엔 클라이언트 패치 미배포 → 세부 수치가 세상에 존재하지 않음. 그래서 **"룰은 하드코딩, 수치는 status 플래그 달린 JSON 주입 슬롯"** 구조로 만들었다. 오픈 후 JSON만 교체하면 코드 수정 없이 완성된다.

## 2. 현재 상태 (2026-07-20 세션 종료 기준)

- 커밋 (모두 로컬 dev, 시간순): `76bce71` 인슈라우딩 MVP → `ac7a5a4` i18n+홈+올플레임/색채 → `667b68a` PLAN.md → `2979b02` 색채 방법비교표(siveran식) → `66292f5` 삼색의 징조 → `2a92bcc` 올플레임 아이템 크래프팅 재설계 → `06bae3b` 무형화 점감 모델(방송 검토).
- 도구 3종 최종 형태:
  - **/enshrouding**: 유니크 방어구 593종 → 크리스탈/흔적/결과 풀. 데이터 대기 슬롯.
  - **/allflame**: 인게임 Ctrl+C 아이템 붙여넣기 → 화폐 16종(두캇 포함) → 고스트 미리보기 택1. 무형화=점감 모델(기본)·유황·로그. 새 모드는 간이 풀 근사.
  - **/chromatic**: 원하는 소켓 입력 → 색채 스팸 vs 벤치 3종 vs 삼색의 징조 5개 방법을 평균 비용으로 랭킹(몬테카를로 30k/방법). 비백색 확률·징조 가격 수동 입력 가능.
- 사용자 피드백 반영 완료: 색채=siveran식 비교표, 올플레임=아이템 기반, 징조 추가, 방송 검토 1건 수정.
- **한글화 전면 교정 완료 (`c02310e`, 07-20)**: docs/ 용어집 기반 감사→교정 (색채의 오브·홈·하얀색·고유·고정 속성·두카트·작업대·휩싸는 수정·삼색성의 징조). 데이터 레이어 en/ko 쌍(화폐 name_ko·크리스탈 name_ko·슬롯/등급/능력치 i18n), canApply 사유 i18n 키화, 색채 계산기 하이드레이션 수정(마운트 후 몬테카를로). 미확정 용어 = docs/TODO-terms.md (리그 오픈 후 poedb.tw/kr 재확인 → 용어집 이관 + 코드 교정).
- 프로덕션 빌드 클린(8페이지 정적). **주의: dev 서버 실행 중 `npm run build` 하면 .next 캐시 충돌로 500 → 서버 중지 후 빌드하거나 빌드 후 .next 삭제+재시작.**
- 실행: 프리뷰 서버 `poe-simulator`(포트 3100, 루트 `.claude/launch.json`에 등록됨 — launch.json은 gitignore) 또는 `npm run dev`.

## 3. 3.29 조사 결과 요약 (2026-07-20 기준 확정 팩트)

### 군단 리워크 (→ /enshrouding)
- 인큐베이터 삭제, 대체 보상 = 흔적(Vestigial) 유니크 변환.
- 크리스탈 5종(Karui/Imperial/Maraketh/Templar/Vaal) = 방어구 슬롯 5종 1:1. 확정: **Imperial=Boots**(poedb), **Maraketh=Body Armour**(aoeah). 나머지 3종 미확정.
- 절차: 크리스탈을 유니크 방어구에 사용(착용불가 상태) → 무궁한 대립의 영지의 순열의 수정(Crystal of Permutation, 4개)에 배치 → 몬스터 처치로 충전 → **같은 슬롯의 다른 유니크**로 변환 + 원본 대표 모드의 약화판이 흔적 암시적 모드로 부착.
- 규칙: 결과 풀 = Ancient Orb 획득 가능 유니크(보스 전용 불가). 타락·Fatelorn 불가, 장신구·무기 불가. 레플리카 모드도 흔적화 가능, 레플리카→원본 변환 가능. 다중 모드 유니크(Shaper's Touch류)는 모드 1개 무작위 선택.
- 크리스탈은 영지 안에서 드랍 안 됨(맵 장군 드랍).
- 부가: 가혹한 휘장 삭제(효과는 일반 휘장에 흡수), 몬스터 90%+상자·부사관·장군 해방 시 자동 전체 해방, 파편은 장군 위주로 스택 커짐, 아틀라스 파편→휘장 0.6%→0.3%.

### 올플레임 크래프팅 = 신규 리그 메커니즘 (→ /allflame)
- 베스퍼(Vesper) NPC: 아이템 + 일반 크래프팅 화폐(약 95-98% 지원, **바알 오브 제외**) + 망자의 유황(Dead Man's Sulphur) 제출 → **고스트 미리보기 여러 개** 생성 → 하나 선택, 나머지 소멸.
- **무형화(Intangibility)**: 제작마다 누적, "다음 제작이 미리보기 1개짜리가 될 확률". 고가 화폐일수록 크게 증가. 리셋: 새 베이스 재조합 / Awakener's Orb / 리셋 두캇(50% 제거·50% 파괴).
- 두캇 4종: Kishara's(고스트 4개, 각각 원본 모드 1개 유지), Genteel's(능력치 요구 교체 STR↔DEX↔INT), Brinehook's(신성 Aspect, 상세 미공개), Intangibility-Reset(50/50).
- 유황은 거래 가능, 리그 컨텐츠 전반에서 드랍.
- **무형화 해석 상충 (07-20 라이브 방송 검토)**: 방송 정리(epiccarry 등)는 "제작할수록 결과 개수 점감", aoeah는 "단일 결과가 될 확률 누적". **방송 표현(reduction)을 기본 채택** — `allflame.json intangibilityModel`로 chance 모델 전환 가능. 리그 실측으로 확정할 것.
- 방송 검토 결과 인슈라우딩·색채는 시뮬레이터와 모순 없음 (색채 오브 "비백색 1개 보장" 재확인, Brinehook은 방송에서도 의도적 비공개).

### 색채 오브 리워크 (→ /chromatic)
- 소켓 기본 백색. 소켓 생성 시 낮은 확률로 R/G/B 롤(능력치 요구 비례, 퀄리티·아이템레벨↑ → 확률↑).
- 소켓 색 제한 자체가 사라짐(아무 젬이나 장착 가능). 색 일치는 보너스: **젬 퀄리티 +10%** (확정).
- 색채 오브 = **비백색 1개 강제**, 나머지는 일반 롤 (확정). 더 희귀해지고 상점 구매 불가.
- 신규 벤치 (확정): 비백색 ≥2 = 색채 5개 / ≥3 = 20개 / ≥4 = 75개. 기존 R/G/B 지정 벤치 삭제.
- **삼색의 징조(Omen of Trichromatism)** (확정, poedb): 구 Omen of Blanching 리네임. 색채 오브 사용 시 소모되어 R/G/B 각 1개 이상 보장. 계산기에서 가격은 사용자 입력(시장가).

### 주요 출처
- 공식 패치노트: https://www.pathofexile.com/forum/view-thread/3985332
- Maxroll 정리: https://maxroll.gg/poe/news/3-29-curse-of-the-allflame-patch-notes , https://maxroll.gg/poe/news/3-29-curse-of-the-allflame-reveal-summary
- 올플레임/인슈라우딩 상세: https://www.aoeah.com/news/4693--poe-329-allflame-crafting-enshrouding-crystal-ducats--vestigial-uniques
- 소켓 리워크 해설: https://fullcleared.com/news/path-of-exile-is-finally-killing-socket-color-restrictions/

## 4. 리그 오픈(7/24) 후 데이터 주입 런북

각 항목은 독립적. 순서 추천: ①→②→⑤→④→③ (인슈라우딩이 핵심 차별화 기능).

### ① vestigial.json — 유니크별 흔적 모드 (최우선)
- poedb에서 `Vestigial` 검색: `https://poedb.tw/us/search?q=Vestigial` (07-20엔 0건이었음 — 클라이언트 패치 후 생김).
- 대안: 레딧 r/pathofexile 데이터마이닝 스레드, 커뮤니티 스프레드시트 검색.
- 형식: `entries` 맵에 `유니크이름: { mod, status: "confirmed", source }`. UI는 자동 반영.
- 주의: **poewiki.net은 Anubis 봇차단**이라 WebFetch 불가. poedb를 쓸 것.

### ② crystals.json — 크리스탈↔슬롯 3종 확정
- poedb 아이템 페이지 5개 확인: `https://poedb.tw/us/{Karui|Imperial|Maraketh|Templar|Vaal}_Enshrouding_Crystal` (07-20엔 Imperial만 존재했음. 페이지의 "Unique Boots" 같은 대상 표기 확인).
- `confirmed: true` + `source` 갱신. `unassignedSlots` 배열 비우기.

### ③ pool-overrides.json — 결과 풀 정밀화
- `excludedFromPool`: Ancient Orb로 안 나오는 보스 전용 유니크 목록. poedb 유니크 페이지의 drop source, 또는 Ancient Orb 관련 데이터마이닝 참조.
- `fatelornUniques`: Fatelorn 유니크 목록(3.28+ 신규 카테고리) — poedb에서 Fatelorn 검색.

### ④ allflame.json — 베스퍼 수치 + 정식 모드 풀
- `config.ghostCopies`, `intangibilityTiers`(화폐별 무형화 %), `sulphurCostTiers` 를 실측/데이터마이닝 값으로 교체하고 `status: "confirmed"` + notes 갱신.
- 화폐별 개별 수치가 나오면 tier 방식 대신 `vesper.ts`의 VESPER_CURRENCIES에 per-currency 필드 추가.
- **정식 모드 풀 주입 (큰 작업)**: 현재 신규/재굴림 모드는 `generic-mods.json` 간이 풀(방어구 공통 20종) 근사. 제대로 하려면 RePoE-fork(`https://repoe-fork.github.io/` — mods.min.json + base_items.min.json)에서 아이템 클래스·태그·ilvl별 접두/접미 풀을 빌드 스크립트로 추출해 교체. craftofexile 코어에 해당하는 작업이라 별도 세션 잡을 것. Brinehook's Ducat 메커니즘 공개 시 vesper.ts에 구현.

### ⑤ chromatic-config.json — 소켓 확률 공식
- `baseNonWhiteChance`, `qualityBonusPerPoint`, `itemLevelScaling`, `colorWeightBase` 교체.
- 아이템레벨 스케일링이 확인되면 ChromaticCalculator.tsx에 ilvl 입력 필드 추가 필요 (현재 UI에 없음, 파라미터만 0으로 존재).
- 색채 오브의 "나머지 소켓 일반 롤"이 재롤인지 유지인지 실검증 필요 — 현재 모델은 **전체 재롤 + 비백색 0개면 1개 강제**. 다르면 `simulateChromatic()` 수정.

### 데이터 갱신 공통
- 유니크 목록 갱신: `node scripts/fetch-uniques.mjs` (3.29 신규 유니크 반영. poe.ninja 리그명이 바뀌므로 필요시 스크립트의 league 파라미터를 신규 리그명으로 — Standard 유지도 무방).
- **poe.ninja API 주의**: 구 `api/data/itemoverview`는 404. 현행: `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=Standard&type=UniqueArmour`.

## 5. 코드 맵 (빠른 참조)

| 파일 | 역할 |
|---|---|
| `src/lib/i18n.tsx` | LangProvider + useT(). **새 UI 문자열은 dict.en/ko 양쪽에 추가** |
| `src/lib/enshrouding.ts` | 인슈라우딩 룰 엔진. 적격성 reasons는 i18n 키로 반환 |
| `src/components/Simulator.tsx` | 인슈라우딩 UI |
| `src/components/AllflameSimulator.tsx` | 올플레임 UI: 아이템 붙여넣기 → 화폐/두캇 클릭 → 고스트 미리보기 택1. 무형화는 `intangRef`로 미러링(배칭 대응 — 지우면 연속클릭 버그 재발) |
| `src/lib/itemParser.ts` | 인게임 Ctrl+C 아이템 텍스트 파서 + SAMPLE_ITEM_TEXT(데모용 예시 레어) |
| `src/lib/vesper.ts` | 베스퍼 크래프팅 엔진: 화폐 16종 정의(적용조건 canApply·두캇 포함), applyCurrency, generateGhosts(Kishara=4개 각기 다른 원본모드 유지) |
| `src/data/generic-mods.json` | **간이 모드 풀 (placeholder)** — 방어구 공통 접두 8/접미 12. 정식 모드 풀 주입 전 근사용 |
| `src/components/ChromaticCalculator.tsx` | 색채 계산기. siveran(https://siveran.github.io/calc.html) 방식 방법 비교표 — 색채 스팸 vs 벤치 ≥2/3/4를 몬테카를로 30k/방법으로 돌려 평균 비용 랭킹. 비백색 확률 % 수동 오버라이드 입력 있음(리그 오픈 후 실측값 넣는 용도) |
| `src/components/Header.tsx` | 네비 + 언어 토글 |
| `scripts/fetch-uniques.mjs` | poe.ninja → uniques.json 생성기 |

## 6. 함정 / 알아두면 좋은 것

- **poewiki.net = Anubis 봇차단** (WebFetch 403류). poedb.tw 사용.
- poedb 직접 URL 추측은 자주 404 — `poedb.tw/us/search?q=...` 또는 메인 페이지 링크에서 진입.
- 브라우저 프리뷰 검증 시: 유니크 리스트의 poecdn 아이콘 593개 로딩 때문에 **스크린샷이 타임아웃**날 수 있음 → `read_page`/`javascript_tool`로 DOM 검증. `computer` 합성 클릭·타이핑이 간헐적으로 씹히면 `form_input`이나 JS `.click()` 사용.
- 데이터 JSON들은 `as unknown as` 캐스팅으로 임포트 — 구조 바꾸면 `types.ts`도 같이.
- 홈/시뮬레이터는 전부 client component (i18n 훅 의존). metadata는 각 route의 서버 `page.tsx`에.

## 7. 남은 작업 (우선순위)

1. **[7/24 이후] 데이터 주입 5건** — 위 런북 ①~⑤
2. 역방향 조회: 원하는 흔적 모드 → 어떤 원본 유니크를 인슈라우딩해야 하나 (vestigial.json 채워진 뒤에만 의미 있음)
3. UI 다듬기: 모바일 반응형 점검, 유니크 리스트 가상화(성능), OG/SEO 메타
4. ~~배포~~ **완료 (07-20)**: https://poe-simulator.vercel.app 라이브. 남은 것 = poe.aquapado.com DNS(사용자, hosting.co.kr) + 새 배포는 `vercel deploy --prod`. GGG 무관 고지 푸터 확인됨
5. 색채 계산기: 닫힌 형태 확률식으로 교체 검토(몬테카를로 대신) — 공식 확정되면 정확도·성능 모두 이득
