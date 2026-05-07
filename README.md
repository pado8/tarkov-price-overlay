# Tarkov Price Overlay

타르코프(EFT) 게임 중 아이템에 마우스를 올리고 단축키를 누르면, 해당 아이템의 **플리 마켓 / 상인 최고가**를 투명 오버레이로 즉시 표시하는 Windows 데스크톱 앱.

---

## 목차

1. [기능](#기능)
2. [아키텍처](#아키텍처)
3. [기술 스택](#기술-스택)
4. [폴더 구조](#폴더-구조)
5. [동작 흐름](#동작-흐름)
6. [주요 컴포넌트 상세](#주요-컴포넌트-상세)
   - [Python 코어 (FastAPI 사이드카)](#python-코어-fastapi-사이드카)
   - [Tauri 백엔드 (Rust)](#tauri-백엔드-rust)
   - [React 프론트엔드 (TypeScript)](#react-프론트엔드-typescript)
7. [API 명세](#api-명세)
8. [설정 항목](#설정-항목)
9. [빌드 및 배포](#빌드-및-배포)
10. [알려진 제약 / 핵심 구현 노트](#알려진-제약--핵심-구현-노트)

---

## 기능

| 기능 | 설명 |
|------|------|
| **핫키 조회** | 기본 `F2` (변경 가능). 게임 내 어디서나 누르면 커서 위치 기준으로 아이템명 캡처 |
| **OCR** | EasyOCR (한국어 + 영어 동시 인식). 처음 로드 후 모델 재사용으로 이후 빠른 인식 |
| **가격 조회** | tarkov.dev GraphQL API — 플리 마켓 24h 평균가 + 상인 최고가 표시 |
| **퍼지 매칭** | OCR 결과가 정확히 매칭되지 않으면 `difflib` 유사도 검색으로 가장 가까운 아이템 자동 보정 |
| **투명 오버레이** | 보더리스 + 항상 위 + 반투명. 게임 화면 위에 떠 있음 |
| **영역 기반 클릭스루** | 카드 영역 밖은 완전 패스스루 — 게임 조작 방해 없음 |
| **시스템 트레이** | 닫기(✕) 시 트레이로 숨김. 트레이 아이콘 좌클릭 / 우클릭 메뉴로 재표시 |
| **다국어** | 한국어 / English UI 전환. 조회 언어(OCR 대상)도 별도 설정 |
| **PVP / PVE 모드** | tarkov.dev API의 `gameMode` 파라미터로 시세 구분 |
| **위치 기억** | 카드 위치 / 설정값 / 핫키 모두 `localStorage` 영구 저장 |
| **자동 숨기기** | 조회 완료 후 설정한 시간(기본 5초) 뒤 카드 자동 숨김. 마우스 오버 시 타이머 정지 |
| **듀얼 모니터 대응** | 커서 위치 기준 모니터 클램프 + 좌/우 대칭 미러 캡처로 인벤토리 양쪽 지원 |
| **DPI 인식** | 퍼 모니터 DPI Aware (`SetProcessDpiAwareness=2`) — 125%·150% 배율 환경 정상 동작 |
| **후원 / 피드백** | 설정 패널 내 카카오페이 QR 후원 / 이메일 피드백 버튼 |

---

## 아키텍처

```
┌─────────────────────────────────────────┐
│          Tauri App (Windows)            │
│                                         │
│  ┌──────────────────────────────────┐   │
│  │   React + TypeScript (WebView)   │   │
│  │   투명 오버레이 UI / 설정 패널   │   │
│  └──────────┬───────────────────────┘   │
│             │ invoke / emit (IPC)        │
│  ┌──────────▼───────────────────────┐   │
│  │      Tauri Core (Rust)           │   │
│  │  - 글로벌 핫키 등록              │   │
│  │  - 커서 좌표 읽기                │   │
│  │  - 트레이 아이콘 관리            │   │
│  │  - Python 사이드카 수명 관리     │   │
│  └──────────┬───────────────────────┘   │
│             │ HTTP REST (127.0.0.1:8765) │
│  ┌──────────▼───────────────────────┐   │
│  │   Python FastAPI (sidecar)       │   │
│  │  - mss 화면 캡처                 │   │
│  │  - EasyOCR 텍스트 인식           │   │
│  │  - tarkov.dev GraphQL 조회       │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

- Tauri가 앱 시작 시 Python 실행 파일을 **사이드카**로 spawn, 종료 시 자동 kill
- React ↔ Rust: Tauri IPC (`invoke`, `emit`/`listen`)
- Rust ↔ Python: HTTP (`fetch`는 React에서 직접 호출, Rust는 커서 좌표만 전달)

---

## 기술 스택

### Python 코어
| 패키지 | 버전 | 역할 |
|--------|------|------|
| `fastapi` | 0.115.0 | REST API 서버 |
| `uvicorn[standard]` | 0.32.0 | ASGI 서버 |
| `mss` | 9.0.2 | 화면 캡처 (멀티모니터 지원) |
| `easyocr` | 1.7.2 | OCR 엔진 (ko + en) |
| `opencv-python` | 4.10.0.84 | 이미지 전처리 (그레이스케일) |
| `Pillow` | 10.4.0 | 이미지 처리 |
| `requests` | 2.32.3 | tarkov.dev GraphQL 호출 |
| `pydantic` | 2.9.2 | 요청/응답 모델 검증 |

> PyInstaller 빌드 시 torch 호환성: `torch==2.7.1+cpu` 핀 필요

### Tauri / Rust
| 크레이트 | 역할 |
|---------|------|
| `tauri 2` | 앱 프레임워크, 트레이, IPC |
| `tauri-plugin-global-shortcut 2` | 글로벌 핫키 등록/해제 |
| `tauri-plugin-shell 2` | Python 사이드카 spawn/kill |
| `tauri-plugin-notification 2` | 트레이 숨김 시 알림 |
| `tauri-plugin-opener 2` | 외부 URL/이메일 열기 |
| `device_query 2` | 커서 좌표 읽기 (WinAPI 수준) |
| `serde` / `serde_json` | IPC 직렬화 |

### React / TypeScript
| 패키지 | 역할 |
|--------|------|
| `react 18` + `typescript` | UI |
| `vite` | 번들러 |
| `@tauri-apps/api 2` | IPC / 윈도우 제어 |
| `@tauri-apps/plugin-opener` | URL / 이메일 열기 |
| `qrcode.react` | 카카오페이 후원 QR 코드 렌더링 |

---

## 폴더 구조

```
/
├── python-core/          # Python FastAPI 사이드카
│   ├── main.py           # FastAPI 앱, /health, /lookup, /debug/screen
│   ├── capture.py        # mss 화면 캡처
│   ├── ocr.py            # EasyOCR 래퍼 (모델 캐시, 그레이스케일 전처리)
│   ├── tarkov_api.py     # tarkov.dev GraphQL + 퍼지 매칭
│   ├── requirements.txt
│   └── models/easyocr/   # 번들된 OCR 모델 (앱 자체 포함, ~다운로드 불필요)
│
├── src/                  # React 프론트엔드
│   ├── App.tsx           # 메인 UI 컴포넌트
│   ├── i18n.ts           # 한국어/영어 번역 테이블
│   └── App.css           # 스타일
│
├── src-tauri/            # Tauri 백엔드
│   ├── src/lib.rs        # Rust 코어 로직
│   ├── tauri.conf.json   # 앱 설정 (윈도우, 번들, 아이콘 등)
│   ├── Cargo.toml
│   ├── icons/            # 앱 아이콘
│   └── binaries/         # PyInstaller 빌드 결과물 (tarkov-server.exe + _internal/)
│
├── scripts/
│   ├── release.ps1       # PUBLIC 레포로 릴리즈 자동화
│   ├── portable.ps1      # 포터블 ZIP 생성
│   └── run-local.ps1     # 인스톨러 없이 로컬 테스트 실행
│
└── dist-python/          # PyInstaller 출력 (tarkov-server/)
```

---

## 동작 흐름

```
1. 앱 시작
   └─ Tauri가 tarkov-server (Python) sidecar spawn
   └─ Python: DPI Aware 설정 → FastAPI 서버 기동 (port 8765)
   └─ Python: EasyOCR 모델 워밍업 (ko + en)
   └─ React: 핫키 등록 (기본 F2), 저장된 위치·설정 복원

2. 핫키 입력 (예: F2)
   └─ Rust: ShortcutState::Pressed → WinAPI 커서 좌표 읽기
   └─ Rust: `hotkey-lookup` 이벤트 emit → React로 커서 좌표 전달

3. React: /lookup 요청 구성
   └─ 커서 좌표 + offsetX/Y → 캡처 영역 계산
   └─ mirror_x 계산 (좌/우 대칭 대체 캡처용)
   └─ cursor_x/y 포함 → Python에 POST /lookup

4. Python: 캡처 → OCR → 가격 조회
   └─ WinAPI 커서 재측정 (DPI 좌표 보정)
   └─ 커서 포함 모니터로 캡처 영역 클램프
   └─ mss 화면 캡처 → 그레이스케일 변환
   └─ EasyOCR 텍스트 인식
   └─ tarkov.dev GraphQL 직접 조회
   └─ 매칭 실패 시 → 전체 아이템 이름 목록으로 difflib 퍼지 검색
   └─ mirror 캡처 폴백 (primary 매칭 실패 시)

5. React: 결과 표시
   └─ 아이템명 + 플리가 + 상인 최고가 표시
   └─ 보정된 경우 원본 OCR 결과 → 매칭명 표시
   └─ hideDelaySec 후 자동 숨김
```

---

## 주요 컴포넌트 상세

### Python 코어 (FastAPI 사이드카)

#### 화면 캡처 (`capture.py` / `main.py`)
- `mss` 라이브러리로 지정 영역 캡처
- `SetProcessDpiAwareness(2)` (퍼 모니터 DPI Aware) — mss와 좌표계 일치
- 커서 위치 기준 모니터 클램프: 듀얼 모니터 환경에서 캡처가 다른 화면으로 넘어가는 것을 방지
- WinAPI `GetCursorPos`로 재측정한 커서 좌표를 기준으로 offset을 재계산해 DPI 불일치 보정

#### OCR (`ocr.py`)
- EasyOCR Reader 인스턴스 앱 생명주기 동안 싱글톤 유지 (재로드 없음)
- 모델 경로: 앱 번들 내 `models/easyocr/` (유저 홈 `~/.EasyOCR` 불필요)
- 레거시 마이그레이션: 기존 `~/.EasyOCR/model`의 파일을 번들 경로로 자동 복사
- 이미지 전처리: BGR/BGRA → 그레이스케일 변환 후 OCR 입력
- `paragraph=False` 모드: 라인 그루핑 후처리 생략으로 속도 향상 (아이템명은 단일 라인)

#### 가격 조회 (`tarkov_api.py`)
- API: `https://api.tarkov.dev/graphql` (GraphQL)
- 1차: OCR 결과 문자열로 직접 `items(name:...)` 쿼리
- 2차 (퍼지 폴백):
  - 전체 아이템 이름 목록 `items(lang:...)` — 언어별 인메모리 캐시
  - `difflib.get_close_matches(cutoff=0.6)` 로 가장 유사한 이름 탐색
  - 보정된 이름으로 재쿼리
- 응답: 플리 24h 평균가 + `sellFor` 중 Flea Market 제외 최고 상인가

### Tauri 백엔드 (Rust)

| 커맨드 | 역할 |
|--------|------|
| `get_cursor_position` | `device_query`로 현재 커서 좌표 반환 |
| `register_hotkey(accelerator)` | 기존 등록 전체 해제 후 새 핫키 등록 |
| `unregister_hotkey` | 핫키 녹화 중 OS 그랩 해제용 |
| `hide_to_tray` | 메인 윈도우 숨김 + 트레이 알림 |
| `exit_app` | `IsQuitting` 플래그 → 사이드카 kill → 앱 종료 |
| `log_msg` | React 로그를 Rust stdout으로 포워딩 |

**트레이 동작**
- 좌클릭: 윈도우 show + `tray-show` 이벤트 emit
- 우클릭 메뉴: 표시 / 설정 / 종료 (한/영 병기)
- `RunEvent::ExitRequested`: `IsQuitting=false`이면 종료 차단 → 트레이 숨김

**사이드카 수명 관리**
- `setup()`에서 `tarkov-server` spawn, `SidecarChild` state로 보관
- stdout/stderr 실시간 포워딩 (디버깅용)
- 앱 종료 / 트레이 Exit 시 `CommandChild::kill()` 호출

### React 프론트엔드 (TypeScript)

#### 윈도우 / UI
- 800×600 투명 보더리스 Always-on-Top 윈도우 (skipTaskbar)
- 카드 영역 밖: `setIgnoreCursorEvents(true)` — 클릭 게임으로 패스스루
- 40ms 폴링으로 커서 위치 감지 → 카드 위에 있을 때만 `setIgnoreCursorEvents(false)`
- 드래그 핸들: `.header` 영역 `data-tauri-drag-region`

#### 상태 관리
```typescript
type Status = "idle" | "loading" | "success" | "error"
type Region = { offsetX, offsetY, width, height, lang, gameMode, hideDelaySec }
```
- `localStorage` 키: `tarkov.captureRegion`, `tarkov.windowPosition`, `tarkov.hotkey`
- 창 이동 시 `tauri://move` 이벤트로 위치 자동 저장

#### 핫키 녹화 UX
- 녹화 시작: `unregister_hotkey` 호출 (선택 키가 OS에 먹히지 않도록)
- `keydown` 캡처: F1~F12, A-Z, 0-9, Space, Enter, Tab, 조합키(Ctrl/Shift/Alt/Meta)
- ESC: 녹화 취소
- 녹화 완료: `register_hotkey` 재등록

#### 캡처 영역 계산
```
캡처 x = cursor_x + offsetX   (기본 +10px)
캡처 y = cursor_y + offsetY   (기본 -75px)
mirror_x = cursor_x - offsetX - width  (좌우 대칭)
```

---

## API 명세

### `GET /health`
```json
{ "status": "ok" }
```

### `GET /debug/screen`
```json
{
  "dpi_status": "per-monitor-aware (shcore.SetProcessDpiAwareness=2)",
  "monitors": [{ "left": 0, "top": 0, "width": 2560, "height": 1440 }, ...]
}
```

### `POST /lookup`

**요청**
```json
{
  "x": 960,
  "y": 465,
  "width": 300,
  "height": 70,
  "lang": "ko",
  "game_mode": "regular",
  "mirror_x": 660,
  "cursor_x": 950,
  "cursor_y": 540
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `x`, `y` | int | 캡처 시작 좌표 (물리 픽셀) |
| `width`, `height` | int | 캡처 크기 |
| `lang` | `"ko"` \| `"en"` | OCR 및 tarkov.dev 언어 |
| `game_mode` | `"regular"` \| `"pve"` | 시세 구분 |
| `mirror_x` | int? | 대칭 보조 캡처 x (primary 실패 시 시도) |
| `cursor_x`, `cursor_y` | int? | 커서 좌표 (모니터 클램프 기준) |

**응답**
```json
{
  "raw_text": "자동 IFAK 지혈 시스템",
  "item_name": "자동 IFAK 지혈 시스템",
  "flea_price": 24500,
  "trader_price": 18200,
  "matched_from": null
}
```

| 필드 | 설명 |
|------|------|
| `raw_text` | OCR 원본 결과 |
| `item_name` | 매칭된 아이템명 (`null` = 미매칭) |
| `flea_price` | 플리 마켓 24h 평균가 (루블) |
| `trader_price` | 상인 최고가 (루블) |
| `matched_from` | 퍼지 보정 전 원본 텍스트 (보정 없으면 `null`) |

---

## 설정 항목

| 설정 | 기본값 | 설명 |
|------|--------|------|
| 언어 | `ko` | UI 언어 및 OCR/API 언어 |
| 게임 모드 | `regular` | PVP / PVE 시세 전환 |
| 핫키 | `F2` | 글로벌 단축키 (게임 내 작동) |
| 자동 숨김 지연 | `5`초 | 조회 결과 표시 후 카드 숨김까지 대기 시간 (1~60초) |
| 캡처 offsetX | `10` | 커서 기준 가로 오프셋 (px) |
| 캡처 offsetY | `-75` | 커서 기준 세로 오프셋 (px) |
| 캡처 width | `300` | 캡처 너비 (px) |
| 캡처 height | `70` | 캡처 높이 (px) |

---

## 빌드 및 배포

### 개발 환경 실행
```powershell
# Python 코어 (별도 터미널)
cd python-core
.venv\Scripts\activate
python main.py

# Tauri 앱
npm run tauri dev
```

### 로컬 릴리즈 빌드 테스트
```powershell
# Python 사이드카 PyInstaller 빌드 (필요 시)
cd python-core
pyinstaller tarkov_server.spec

# Tauri 빌드
npm run tauri build

# 인스톨러 없이 바로 실행
.\scripts\run-local.ps1
```

### 포터블 ZIP 생성
```powershell
.\scripts\portable.ps1
```

### PUBLIC 레포 릴리즈 배포
```powershell
.\scripts\release.ps1
```

### 번들 구조
```
src-tauri/binaries/
├── tarkov-server-x86_64-pc-windows-msvc.exe   # Python 사이드카 (PyInstaller onedir)
└── _internal/                                  # EasyOCR 모델, torch, 의존 라이브러리 등
```

---

## 알려진 제약 / 핵심 구현 노트

### DPI 좌표 불일치 (중요)
- **문제**: React(Tauri WebView)의 `window.devicePixelRatio`와 `device_query`(Rust)의 커서 좌표가 DPI 배율 환경에서 불일치
- **해결**: Python에서 WinAPI `GetCursorPos`로 커서를 재측정하고, frontend가 보낸 `offset` (cursor와 캡처 영역의 상대 거리)을 재적용하여 물리 좌표 기준으로 캡처

### 듀얼 모니터 캡처 클램프
- `mss.monitors[1:]`로 각 모니터 경계 확인 → 커서가 속한 모니터 경계 안으로 캡처 영역 강제 제한
- `mirror_x` 폴백: 인벤토리 좌/우 중 primary가 매칭 실패하면 반대편 좌표로 재시도

### EasyOCR 모델 번들
- 첫 실행 시 `~/.EasyOCR/model`의 모델을 앱 내부 `models/easyocr/`로 자동 마이그레이션
- PyInstaller 빌드 후 `_internal/models/easyocr/` 경로로 번들링

### Tauri resources 번들 주의
- `tauri.conf.json`의 `resources` 설정: `"binaries/_internal": "_internal"` 형태로 디렉터리 자체 매핑
- `**/*` 글로브 + 매핑 조합 사용 시 하위 폴더가 평탄화되므로 사용 금지

### 트레이 hide-on-close
- `RunEvent::ExitRequested`에서 `IsQuitting` 플래그 확인
- 트레이 "종료" / `exit_app` 커맨드만 `IsQuitting=true`로 설정
- Alt+F4 / 창 X 버튼은 트레이로 숨김 (종료 아님)

### 핫키 녹화 중 OS 그랩 해제
- 녹화 시작 시 `unregister_hotkey` 호출 필수 — 그렇지 않으면 현재 핫키가 OS에 먹혀 녹화 불가
- 녹화 종료(성공/취소) 시 항상 `register_hotkey` 재등록
