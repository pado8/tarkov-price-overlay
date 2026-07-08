# 스티키 메모 (Sticky Notes) — 크롬 확장

어떤 웹페이지 위에든 포스트잇 메모를 붙이는 Manifest V3 크롬 확장.
빌드 도구 없는 순수 HTML/CSS/JS — `chrome://extensions`에서 폴더를 바로 로드해 테스트한다.

## 구조

```
manifest.json          MV3. permissions: ["storage"]만. content_scripts <all_urls>
_locales/{ko,en}/      chrome.i18n 메시지 (UI 문구 하드코딩 금지)
content/styles.js      Shadow DOM에 주입되는 CSS 문자열 (STICKY_NOTES_CSS)
content/content.js     메모 렌더링/드래그/리사이즈/저장. closed Shadow DOM으로 페이지와 격리
popup/                 툴바 팝업: 새 메모, 표시 토글, 사이트별/전역 메모 목록
options/               옵션: 새 메모 기본 표시 범위(site/global)
icons/                 icon.svg(원본) + icon{16,32,48,128}.png (scripts/make-icons.py로 생성)
store/                 웹스토어 등록 자료 (권한 사유, 개인정보처리방침 ko/en, 리스팅 초안)
scripts/package.ps1    등록용 zip 생성 (dist/에 출력, store·scripts·svg 제외)
```

## 데이터 모델 (chrome.storage.local)

- `note_<uuid>` → `{ id, text, x, y, w, h, color, scope: "site"|"global", domain, createdAt, updatedAt }`
  - `scope: "site"`면 `domain === location.hostname`인 페이지에서만 표시. `"global"`이면 항상 표시(domain은 빈 문자열).
  - 메모당 키 1개 — 키 입력 debounce(300ms) 저장 시 다른 메모를 덮어쓰지 않기 위함.
- `settings` → `{ defaultScope, notesVisible }`

탭 간 동기화는 `chrome.storage.onChanged`로 처리한다. 자기 탭에서 조작 중인 메모
(드래그 중, textarea 포커스 중)는 onChanged 반영에서 제외해 커서 점프/지터를 막는다.

## 규칙

- **권한 추가 금지가 기본값** — 웹스토어 심사 대비. 새 권한이 필요하면 store/permissions-justification.md에 사유를 함께 갱신할 것.
- 원격 코드(외부 CDN·eval) 금지, UI 문구는 반드시 `_locales`에.
- 버전 올릴 때: manifest.json `version` → `scripts/package.ps1`이 zip 이름에 자동 반영.
- 테스트는 크롬 실기기 로드(사용자 담당). 코드 수준 검증: `node --check`, JSON 파싱, i18n 키 대조.
