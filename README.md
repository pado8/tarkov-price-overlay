# Tarkov Price Overlay

> 타르코프 게임 화면에서 아이템 이름을 자동 인식해 **플리 마켓 시세·상인 가격·바터·제작·퀘스트 정보**를 투명 오버레이로 즉시 표시하는 무료 Windows 앱

**[⬇ 최신 버전 다운로드](https://github.com/pado8/tarkov-price-overlay-releases/releases/latest)**

---

## 주요 기능

| 기능 | 설명 |
|---|---|
| **자동 OCR** | 단축키 하나로 게임 화면을 캡처해 아이템 이름을 자동 인식 |
| **플리 마켓 시세** | 현재가 · 24시간 범위 · 직전 거래가 |
| **상인 구매가** | 전 상인 최고가 비교 |
| **바터 정보** | 이 아이템으로 얻는 바터 / 이 아이템을 쓰는 바터 |
| **하이드아웃 제작** | 재료로 사용되는 제작 레시피 |
| **퀘스트 정보** | 필요 퀘스트·수량·FiR(인레이드) 여부 |
| **PVP / PVE** | 게임 모드별 시세 분리 |
| **한국어 / 영어** | UI 언어 전환 |
| **투명 오버레이** | 게임 위에 항상 표시, 드래그로 위치 이동 |

---

## 스크린샷

> *(첫 조회 후 오버레이 카드가 화면에 표시됩니다)*

---

## 다운로드 및 설치

### 인스톨러 (권장)

1. [Releases 페이지](https://github.com/pado8/tarkov-price-overlay-releases/releases/latest)에서  
   **`Tarkov.Price.Overlay_1.0.0_x64-setup.exe`** 다운로드
2. 실행 후 설치 마법사를 따릅니다
3. 시작 메뉴 또는 바탕화면 바로가기로 실행

### 포터블 (설치 없이 바로 사용)

1. 같은 페이지에서 **`Tarkov.Price.Overlay_1.0.0_portable.zip`** 다운로드
2. 압축 해제 후 `tarkov-price-overlay.exe` 실행

> **Windows SmartScreen 경고가 뜨는 경우**  
> "추가 정보" → "실행"을 눌러주세요.  
> 코드 서명 인증서 비용 문제로 서명이 없어 발생하는 경고이며, 악성코드가 아닙니다.

---

## 사용 방법

### 1단계 — 앱 실행

- 앱을 실행하면 **시스템 트레이(우측 하단 아이콘)** 에 등록됩니다.
- **첫 실행 시** EasyOCR 모델을 자동 다운로드합니다 (약 1~5분, 최초 1회만).

### 2단계 — 단축키 설정

1. 트레이 아이콘 **우클릭 → 설정** 또는 오버레이 카드의 ⚙ 클릭
2. **단축키** 항목 클릭 → 원하는 키 입력 (기본값: `F2`)
3. **카드 토글 단축키**: 조회 없이 오버레이를 숨기거나 다시 표시 (기본값: `Shift+F2`)

### 3단계 — 아이템 시세 조회

1. 타르코프 인게임에서 **아이템 이름이 화면에 표시되도록** 합니다  
   *(인벤토리에 마우스를 올리거나, 바닥 아이템에 조준 등)*
2. 설정한 단축키(`F2`)를 누릅니다
3. 잠시 후 오버레이 카드에 시세 정보가 표시됩니다

### 캡처 영역 조정

인식이 잘 안 될 때는 캡처 영역을 조정합니다.

| 설정 | 기본값 | 설명 |
|---|---|---|
| X 오프셋 | `10` | 마우스 커서 기준 캡처 시작 가로 위치 (픽셀) |
| Y 오프셋 | `-75` | 마우스 커서 기준 캡처 시작 세로 위치 (픽셀) |
| 너비 | `300` | 캡처 영역 너비 |
| 높이 | `70` | 캡처 영역 높이 |

아이템 이름 텍스트가 캡처 영역 안에 들어오도록 값을 조절하세요.

### 오버레이 이동

- 카드 빈 곳을 **드래그**해서 원하는 위치로 옮길 수 있습니다 (위치 자동 저장).

---

## 설정 전체 항목

| 항목 | 설명 |
|---|---|
| 언어 | 한국어 / English |
| 게임 모드 | PVP (일반) / PVE |
| 단축키 | 가격 조회 단축키 |
| 카드 토글 단축키 | 오버레이 표시/숨김 |
| 소리 알림 | 조회 완료 시 알림음 |
| 숨김 딜레이 | 카드 자동 숨김까지 대기 시간(초) |
| 폰트 크기 | 10px ~ 25px 선택 |
| 표시 항목 | 플리 24h 범위 / 직전 거래 / 무게·효율 / 구매처 / 바터 / 제작 / 퀘스트 개별 ON/OFF |
| 패널 기본 펼침 | 바터·제작·퀘스트 패널을 처음부터 펼쳐서 표시 |
| 자동 업데이트 확인 | 실행 시 새 버전 자동 확인 |

---

## 자주 묻는 질문

**Q. 단축키를 눌러도 아무 반응이 없어요.**  
A. 첫 실행 후 OCR 모델 다운로드 중일 수 있습니다(최대 5분). 이후에도 안 되면 설정에서 단축키를 다시 등록해보세요.

**Q. 인식 실패 또는 엉뚱한 아이템이 나와요.**  
A. X/Y 오프셋과 너비/높이를 조정해 아이템 이름 텍스트만 캡처 영역에 들어오게 맞춰주세요.

**Q. OCR 오인식을 직접 고치고 싶어요.**  
A. 설정 → **어드밴스드 모드** 를 켜면 오인식→정답 교정 목록을 등록할 수 있습니다.

**Q. PVE 서버인데 가격이 이상해요.**  
A. 설정 → **게임 모드**를 PVE로 변경하세요.

**Q. 설치 시 바이러스/SmartScreen 경고가 떠요.**  
A. 코드 서명 인증서 미적용으로 인한 경고입니다. "추가 정보 → 실행"으로 진행하세요.

**Q. 의견·버그 제보는 어디에 하나요?**  
A. [GitHub Issues](https://github.com/pado8/tarkov-price-overlay-releases/issues) 또는 이메일(floe9235@gmail.com)로 보내주세요.

---

## 후원

개발이 도움이 되셨다면 후원을 고려해주세요.  
앱 설정 하단에서 카카오페이 QR 코드를 확인할 수 있습니다.

---

*가격 데이터 제공: [tarkov.dev](https://tarkov.dev)*

---
---

# Tarkov Price Overlay — English Guide

> A free Windows overlay app for Escape from Tarkov.  
> Press a hotkey while in-game to instantly see **flea market prices, trader prices, barters, crafts, and quest requirements** — without leaving your game window.

**[⬇ Download Latest](https://github.com/pado8/tarkov-price-overlay-releases/releases/latest)**

---

## Features

| Feature | Description |
|---|---|
| **Auto OCR** | Captures the game screen and recognizes item names automatically |
| **Flea market price** | Current price · 24h range · last trade price |
| **Trader prices** | Best buy price across all traders |
| **Barter info** | What you can get via barter / what uses this item in barters |
| **Hideout crafts** | Recipes that use this item as an ingredient |
| **Quest info** | Required quests, quantities, and FiR (Found in Raid) status |
| **PVP / PVE mode** | Separate price data per game mode |
| **Korean / English UI** | Switch interface language in settings |
| **Transparent overlay** | Floats above the game, draggable to any position |

---

## Download & Install

### Installer (recommended)

1. Go to the [Releases page](https://github.com/pado8/tarkov-price-overlay-releases/releases/latest)
2. Download **`Tarkov.Price.Overlay_1.0.0_x64-setup.exe`**
3. Run the installer and follow the wizard
4. Launch from the Start Menu or desktop shortcut

### Portable (no install required)

1. From the same page, download **`Tarkov.Price.Overlay_1.0.0_portable.zip`**
2. Extract and run `tarkov-price-overlay.exe`

> **Windows SmartScreen warning**  
> Click "More info" → "Run anyway".  
> This appears because the executable is not code-signed (cost reasons). The app contains no malware.

---

## How to Use

### Step 1 — Launch the app

- The app runs in the **system tray** (bottom-right of the taskbar).
- **On first launch**, EasyOCR downloads its recognition model automatically — this takes **1–5 minutes** and only happens once.

### Step 2 — Set your hotkey

1. Right-click the tray icon → **Settings**, or click ⚙ on the overlay card
2. Click the **Hotkey** field and press your desired key (default: `F2`)
3. **Toggle card hotkey** — shows/hides the card without triggering a lookup (default: `Shift+F2`)

### Step 3 — Look up an item price

1. In Tarkov, make sure the **item name is visible on screen**  
   *(hover over an inventory item, aim at a ground item, etc.)*
2. Press your hotkey (`F2` by default)
3. The overlay card appears with price information

### Adjusting the capture region

If recognition is inaccurate, adjust the capture region:

| Setting | Default | Description |
|---|---|---|
| X offset | `10` | Horizontal offset from your cursor (pixels) |
| Y offset | `-75` | Vertical offset from your cursor (pixels) |
| Width | `300` | Capture area width |
| Height | `70` | Capture area height |

Make sure only the item name text falls inside the capture box.

### Moving the overlay

- Drag the card to any position on screen. Position is saved automatically.

---

## Settings Reference

| Setting | Description |
|---|---|
| Language | Korean / English |
| Game mode | PVP (regular) / PVE |
| Hotkey | Trigger a price lookup |
| Toggle card hotkey | Show/hide the overlay card |
| Sound notification | Play a sound when lookup completes |
| Hide delay | Seconds before the card auto-hides |
| Font size | 10px – 25px dropdown |
| Display items | Toggle each section: 24h range, last trade, weight/efficiency, buy from, barters, crafts, quests |
| Panels open by default | Expand barter/craft/quest panels on first render |
| Auto update check | Check for new versions on startup |

---

## FAQ

**Q. Nothing happens when I press the hotkey.**  
A. On first launch the OCR model is downloading (up to 5 min). If it still fails, re-register the hotkey in Settings.

**Q. Wrong item name or "no match" result.**  
A. Adjust X/Y offset and width/height so only the item name text is inside the capture box.

**Q. Can I fix recurring OCR misreads?**  
A. Enable **Advanced mode** in Settings to access the OCR correction editor. Add `misread → correct name` mappings.

**Q. I play PVE — prices look wrong.**  
A. Set **Game mode** to PVE in Settings.

**Q. SmartScreen / antivirus flags the installer.**  
A. The executable is unsigned. Click "More info → Run anyway". Source code is public.

**Q. Bug reports / feedback?**  
A. Open a [GitHub Issue](https://github.com/pado8/tarkov-price-overlay-releases/issues) or email floe9235@gmail.com.

---

*Price data provided by [tarkov.dev](https://tarkov.dev) — community-maintained EFT database.*
