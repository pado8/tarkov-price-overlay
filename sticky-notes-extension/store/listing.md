# Chrome Web Store 리스팅 초안

## 확장 이름

| 언어 | 이름 |
|---|---|
| 한국어 | 스티키 메모 — 웹페이지 포스트잇 |
| English | Sticky Notes — Post-its on Any Webpage |

(스토어 이름은 `_locales`의 `appName`과 달라도 됨. 검색 노출을 위해 부제 포함 추천.
45자 제한.)

## 짧은 설명 (132자 이내 — 두 안 모두 충족)

- 한국어 (66자):
  > 어떤 웹페이지에든 포스트잇 메모를 붙이세요. 내용과 위치가 자동 저장되고, 사이트별/전역 표시를 선택할 수 있습니다.
- English (115 chars):
  > Put sticky notes on any webpage. Content and position are saved automatically, with per-site or global visibility.

## 상세 설명

### 한국어

```
웹서핑 중 떠오른 생각, 사이트별 할 일, 자주 쓰는 메모를 화면 위 포스트잇으로 붙여두세요.

주요 기능
• 원클릭 생성 — 툴바 아이콘을 눌러 현재 페이지에 바로 메모를 추가
• 자유로운 배치 — 드래그로 이동, 모서리를 잡아 크기 조절
• 자동 저장 — 입력하는 즉시 저장, 새로고침·브라우저 재시작 후에도 그대로 복원
• 표시 범위 선택 — 메모마다 "이 사이트에서만" 또는 "모든 사이트에서" 표시 선택,
  만든 후에도 배지 클릭 한 번으로 전환
• 5가지 색상 — 용도별로 메모를 색으로 구분
• 한눈에 관리 — 팝업에서 현재 사이트 메모와 전역 메모 목록 확인·삭제
• 잠시 숨기기 — 토글 하나로 모든 메모를 숨겼다가 다시 표시

개인정보
모든 메모는 브라우저 로컬 저장소에만 저장되며 외부로 전송되지 않습니다.
계정·가입이 필요 없고, 분석·광고 코드가 없습니다.
```

### English

```
Pin your thoughts, per-site to-dos, and frequently used snippets right on top of any webpage.

Features
• One-click creation — add a note to the current page from the toolbar icon
• Place anywhere — drag to move, grab the corner to resize
• Auto-save — everything is saved as you type and restored after reloads and browser restarts
• Per-note visibility — show each note on "this site only" or on "all sites",
  switchable anytime with a single click on the badge
• 5 colors — organize notes by purpose
• Manage at a glance — the popup lists this site's notes and your global notes
• Hide temporarily — one toggle hides and restores all notes

Privacy
All notes are stored only in your browser's local storage and never leave your device.
No account, no analytics, no ads.
```

## 등록 폼 추천 값

| 항목 | 값 |
|---|---|
| Category | Productivity → **Workflow & Planning** |
| Language | 한국어(기본) + English 리스팅 추가 |
| 가격 | 무료 |
| Privacy policy URL | `https://aquapado.com/sticky-notes/privacy.html` (호스팅 후 실제 URL로) |
| Support email | floe9235@gmail.com |
| Single purpose | store/permissions-justification.md의 문구 사용 |

## 그래픽 자산

| 자산 | 크기 | 비고 |
|---|---|---|
| 스토어 아이콘 | 128×128 | `icons/icon128.png` 그대로 사용 |
| 스크린샷 | **1280×800** (또는 640×400) | 최소 1장, 최대 5장. PNG/JPEG, 24bit 알파 없음 |
| 프로모 타일(선택) | 440×280 | 없어도 등록 가능. 아이콘+이름 단순 구성 추천 |

## 스크린샷 촬영 가이드 (1280×800, 5장 구성 추천)

브라우저 창을 1280×800으로 맞추고(개발자도구 기기 모드나 창 크기 조절 유틸 사용) 촬영.
배경 페이지는 저작권 문제가 없는 자신의 사이트나 위키백과 등 중립적인 페이지 추천.

1. **대표 컷**: 밝은 웹페이지 위에 색이 다른 메모 3~4장이 자연스럽게 배치된 모습.
   각 메모에 실사용처럼 보이는 내용(할 일, 아이디어 등)을 채울 것.
2. **표시 범위**: 메모 헤더의 "이 사이트"/"모든 사이트" 배지가 대비되게 두 메모를
   나란히. 배지 부분이 잘 보이도록 메모를 크게.
3. **팝업 UI**: 툴바 아이콘 클릭으로 팝업을 연 상태 — 새 메모 버튼, 사이트/전역
   목록, 표시 토글이 모두 보이게.
4. **색상/이동**: 팔레트가 열린 메모 + 드래그 중인 느낌의 배치.
5. **복원 스토리**(선택): "브라우저를 껐다 켜도 그대로" 문구를 이미지에 오버레이한
   before/after 합성 컷. (스크린샷에 간단한 설명 텍스트 오버레이는 허용됨)

## 심사 시 주의 (요약)

- 권한 사유는 `permissions-justification.md`의 영어 문구를 폼에 그대로 입력.
- 데이터 수집 없음으로 신고 → Privacy practices에서 모든 수집 항목 체크 해제.
- 원격 코드 없음 신고.
- 첫 심사는 host 권한(<all_urls>) 때문에 수동 심사로 넘어가 며칠(1~2주까지) 걸릴 수 있음.
