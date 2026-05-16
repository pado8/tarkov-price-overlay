# 프로젝트 목표
타르코프 게임 화면의 특정 영역을 캡처하여 아이템 이름을 인식(OCR)하고, 해당 아이템의 플리 마켓/상인 시세를 투명 오버레이로 보여주는 데스크톱 앱.

# 기술 스택 (하이브리드 아키텍처)
1. Core Logic (Python): `mss` (화면 캡처), `EasyOCR` 또는 `pytesseract` (텍스트 인식), `requests` (tarkov.dev GraphQL API 통신)
2. Frontend & Window OS (Tauri + React + TypeScript): 투명 보더리스 윈도우(Always on top) 및 UI 렌더링
3. 통신: Python 로직은 독립된 로컬 API 서버(FastAPI)로 띄우거나 Tauri Sidecar 패턴으로 통신.

# 폴더 구조 계획
- `/python-core`: Python 스크린 캡처 및 API 로직
- `/src`: React 프론트엔드 UI
- `/src-tauri`: Tauri 백엔드 및 윈도우 설정
