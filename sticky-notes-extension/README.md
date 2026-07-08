# 스티키 메모 (Sticky Notes)

어떤 웹페이지 위에든 포스트잇 메모를 붙일 수 있는 크롬 확장 프로그램 (Manifest V3, 바닐라 JS).

- 툴바 아이콘 → 새 메모 생성, 드래그 이동·크기 조절, 입력 즉시 자동 저장
- 메모마다 표시 범위 선택: **이 사이트에서만** / **모든 사이트에서**
- 5가지 색상, 전체 숨기기 토글, 팝업에서 목록 관리
- 모든 데이터는 `chrome.storage.local`에만 저장 — 외부 전송 없음

## 개발/테스트

1. `chrome://extensions` → 우측 상단 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드합니다** → 이 폴더 선택
3. 코드 수정 후에는 확장 카드의 새로고침(↻) 버튼 클릭 (content script는 페이지도 새로고침)

## 패키징 (웹스토어 제출용)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package.ps1
# → dist/sticky-notes-extension-v<버전>.zip
```

## 아이콘 재생성

```powershell
python scripts\make-icons.py   # icons/icon.svg 디자인과 동일한 PNG 4종 생성
```

스토어 등록 자료(권한 사유·개인정보처리방침·리스팅 초안)는 [store/](store/) 참조.
