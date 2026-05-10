# Tarkov Price Overlay

> **타르코프에서 마우스 올리고 F2** — 플리 시세 · 상인가 · 바터 · 제작 · 퀘스트 정보를 게임 위에 바로 띄워주는 무료 Windows 오버레이 앱

**[⬇ 최신 버전 다운로드](https://github.com/pado8/tarkov-price-overlay-releases/releases/latest)** · 한국어 / English

---

## ✨ 이런 분께

- 매번 알트탭으로 타르코프 위키나 가격 사이트 켜기 귀찮은 분
- 레이드 중 줍는 아이템이 팔만한 건지 즉석에서 판단하고 싶은 분
- 하이드아웃 / 퀘스트에 쓰이는 아이템인지 미리 알고 챙기고 싶은 분
- 바터·제작 재료 가치까지 한눈에 보고 싶은 분

---

## 🚀 기능 한눈에

| 기능 | 설명 |
|---|---|
| **F2 한 번에** | 마우스 올린 위치 캡처 → OCR → 가격 정보 표시 (1초 내외) |
| **플리 마켓** | 현재가 · 24h 범위 · 직전 거래가 · 칸당 가격 (₽/slot) |
| **상인 정보** | 최고가 상인 · 구매처 · 필요 상인 레벨 |
| **바터** | 이 아이템으로 얻는 바터 / 이 아이템이 재료인 바터 (양방향) |
| **하이드아웃 제작** | 재료로 사용되는 제작 레시피 |
| **퀘스트** | 필요 퀘스트 · 수량 · FiR(인레이드) 여부 |
| **PVP / PVE** | 게임 모드별 시세 분리 |
| **무게 효율** | ₽/kg 환산으로 운반 가치 비교 |
| **한 / 영** | UI 언어 즉시 전환 |
| **투명 오버레이** | 게임 위에 항상 표시, 자동 숨김, 위치 자유 이동 |

---

## 🛡️ 안전성 (밴 위험에 관해)

타르코프 커뮤니티에서 가장 걱정하는 부분이라 정직하게 적습니다.

이 프로그램은 **화면 캡처 + 글자 인식(OCR)** 만 사용합니다.

- ❌ 게임 프로세스 메모리 읽기/쓰기 **안 함**
- ❌ DLL 인젝션 **안 함**
- ❌ 게임 윈도우 후킹 / 키보드 저수준 후킹 **안 함**
- ❌ 게임 파일 수정 **안 함**
- ✅ 일반 Win32 데스크탑 캡처(BitBlt) + 화면 위에 겹치는 투명 윈도우 + `RegisterHotKey`(OS 표준 단축키)

기술적으로는 **유튜브 녹화 프로그램이나 디스코드 화면 공유와 같은 카테고리**입니다. 메모리 핵 · ESP · 에임봇과는 완전히 다릅니다.

다만 **BSG/BattlEye가 명시적으로 허용한 도구는 아닙니다.** 정책은 언제든 바뀔 수 있으므로 사용에 따른 책임은 본인에게 있습니다. 현재까지 동일한 방식의 오버레이 도구로 밴된 사례는 보고된 바 없으나, 100% 보장은 누구도 할 수 없습니다.

---

## 📦 다운로드

**[Releases 페이지](https://github.com/pado8/tarkov-price-overlay-releases/releases/latest)** 에서 둘 중 하나를 받습니다:

- **인스톨러** (`*-x64-setup.exe`) — 설치 마법사 권장
- **포터블** (`*-portable.zip`) — 압축 풀고 `tarkov-price-overlay.exe` 바로 실행

> ⚠️ **Windows SmartScreen 경고가 뜨는 경우**
> "추가 정보" → "실행"을 눌러주세요. 코드 서명 인증서 비용 문제로 서명을 안 했을 뿐, 악성코드가 아닙니다.

---

## 🎯 사용 방법

### 1. 첫 실행

- 트레이(우측 하단)에 아이콘이 등록됩니다
- **첫 실행 시 OCR 모델 다운로드** (약 1~5분, 1회만)

### 2. 인게임에서

1. 아이템 이름이 화면에 보이게 합니다 (인벤토리 호버, 바닥 아이템 조준 등)
2. **F2** 누름
3. 잠시 후 오버레이 카드에 시세 정보가 뜸

### 3. 인식이 잘 안 될 때

설정의 **캡처 영역** 항목에서 X/Y 오프셋과 너비/높이를 조정 — 아이템 이름 텍스트가 캡처 영역 안에 들어오도록 맞추면 됩니다.

| 설정 | 기본값 | 의미 |
|---|---|---|
| X 오프셋 | `10` | 마우스 커서 기준 가로 시작점 (px) |
| Y 오프셋 | `-75` | 마우스 커서 기준 세로 시작점 (px) |
| 너비 | `300` | 캡처 영역 너비 |
| 높이 | `70` | 캡처 영역 높이 |

### 4. 오버레이 위치 이동

카드 빈 곳을 **드래그**하면 어디든 옮길 수 있습니다 (위치 자동 저장).

---

## ⚙️ 전체 설정

| 항목 | 설명 |
|---|---|
| 언어 | 한국어 / English |
| 게임 모드 | PVP / PVE (가격 데이터가 분리되어 있음) |
| 단축키 | 가격 조회 단축키 (기본 `F2`) |
| 카드 토글 단축키 | 오버레이 표시/숨김 (기본 `Shift+F2`) |
| 소리 알림 | 조회 완료 시 띵 소리 |
| 숨김 딜레이 | 카드 자동 숨김까지 대기 시간 (1~60초) |
| 폰트 크기 | 12px ~ 20px |
| 표시 항목 | 24h 범위 / 직전 거래 / 무게 효율 / 구매처 / 바터 / 제작 / 퀘스트 개별 ON/OFF |
| 패널 기본 펼침 | 바터·제작·퀘스트 패널을 처음부터 펼쳐서 표시 |
| 자동 업데이트 확인 | 실행 시 새 버전 자동 확인 |
| 어드밴스드 모드 | OCR 오인식 직접 교정 (`misread → correct name` 매핑 저장) |

---

## ❓ 자주 묻는 질문

**Q. F2를 눌러도 아무 반응이 없어요.**
A. 첫 실행 후 OCR 모델 다운로드 중일 수 있습니다 (최대 5분). 이후에도 안 되면 설정에서 단축키를 다시 등록해보세요. 다른 프로그램이 F2를 점유하면 충돌할 수 있으니 다른 키로 변경도 시도해보세요.

**Q. 인식이 잘 안 되거나 엉뚱한 아이템이 나와요.**
A. 위 "캡처 영역" 부분 참조. 아이템 이름 텍스트만 캡처 박스 안에 들어오도록 X/Y 오프셋을 미세 조정하세요.

**Q. 같은 아이템을 자꾸 잘못 읽어요.**
A. 설정 → **어드밴스드 모드** ON → 오인식 → 정답 매핑을 저장할 수 있습니다. 다음번부터 자동 보정.

**Q. PVE인데 가격이 이상해요.**
A. 설정 → **게임 모드**를 PVE로 변경하세요.

**Q. 듀얼 모니터 / 4K / 125% 배율인데 좌표가 이상해요.**
A. Per-monitor DPI 처리되어 있어 동작합니다. 그래도 어긋나면 캡처 영역 X/Y 오프셋으로 보정하세요.

**Q. 설치 시 SmartScreen / 백신 경고가 떠요.**
A. 코드 서명 인증서 미적용 때문입니다. "추가 정보 → 실행"으로 진행하세요. 자세한 동작 원리는 위 "안전성" 섹션 참조.

**Q. 밴 안 당하나요?**
A. 위 "안전성" 섹션 참조. 화면 캡처 + OCR 방식이라 메모리 핵·ESP와는 완전히 다른 카테고리입니다. 단, BSG가 명시 허용한 건 아니므로 사용 책임은 본인에게 있습니다.

**Q. 의견·버그 제보는 어디에 하나요?**
A. [GitHub Issues](https://github.com/pado8/tarkov-price-overlay-releases/issues) 또는 이메일 floe9235@gmail.com

---

## 💝 후원

개발이 도움 되셨다면 후원 부탁드립니다. 앱의 설정 → 후원하기에서 두 가지 방법 중 선택할 수 있어요:

- **카카오페이** (한국)
- **PayPal** — [paypal.me/tarkovoverlay](https://paypal.me/tarkovoverlay) (해외)

---

## 📜 라이선스 / 면책

- 가격 데이터: [tarkov.dev](https://tarkov.dev) (커뮤니티 운영 EFT DB)
- 본 도구는 비공식 도구이며 **Battlestate Games와 무관**합니다
- *Escape from Tarkov* 및 관련 자산은 Battlestate Games Limited의 상표/저작권입니다
- © 2026 pado

---
---

# Tarkov Price Overlay — English Guide

> **Hover an item in Tarkov, press F2** — instantly see flea market prices, trader prices, barters, crafts, and quest requirements as a transparent overlay on top of the game.

**[⬇ Download Latest](https://github.com/pado8/tarkov-price-overlay-releases/releases/latest)** · Free · Windows

---

## ✨ Who is this for?

- Tired of alt-tabbing to wiki/price sites every time you pick up loot
- Want to instantly judge whether a found item is worth selling
- Need to know if an item is used in hideout / quest before vendoring it
- Want barter/craft material values at a glance

---

## 🚀 Features

| Feature | Description |
|---|---|
| **One-key lookup** | Hover, press F2, see prices in ~1 second |
| **Flea market** | Current price · 24h range · last trade · ₽/slot |
| **Trader info** | Best trader price · buy-from vendors · required trader level |
| **Barter** | Both directions — barters that produce / consume this item |
| **Hideout crafts** | Recipes that use this item as an ingredient |
| **Quest info** | Required quests · quantity · FiR (Found in Raid) status |
| **PVP / PVE** | Separate price data per game mode |
| **Weight efficiency** | ₽/kg conversion to compare carry value |
| **Korean / English** | Switch UI language instantly |
| **Transparent overlay** | Always-on-top, auto-hide, freely draggable |

---

## 🛡️ Safety (about ban risk)

The biggest concern in the Tarkov community, so to be straight with you:

This program uses **screen capture + OCR (text recognition) only**.

- ❌ Does **NOT** read/write game process memory
- ❌ Does **NOT** inject DLLs
- ❌ Does **NOT** hook the game window or use low-level keyboard hooks
- ❌ Does **NOT** modify any game files
- ✅ Uses standard Win32 desktop capture (BitBlt) + a transparent topmost window + `RegisterHotKey` (OS-level hotkey)

Technically this is **the same category as YouTube screen recorders or Discord screen sharing**. It is fundamentally different from memory hacks, ESP, or aimbots.

That said, **this tool is not officially sanctioned by BSG/BattlEye**. Their policy can change, so use is at your own risk. No bans have been reported for similar OCR-based overlay tools to date, but no one can guarantee 100% safety.

---

## 📦 Download

Grab one from **[Releases](https://github.com/pado8/tarkov-price-overlay-releases/releases/latest)**:

- **Installer** (`*-x64-setup.exe`) — recommended
- **Portable** (`*-portable.zip`) — extract and run `tarkov-price-overlay.exe`

> ⚠️ **Windows SmartScreen warning**
> Click "More info" → "Run anyway". The executable is unsigned (cost reasons), but contains no malware.

---

## 🎯 How to Use

### 1. First launch

- Runs in the **system tray** (bottom-right)
- **First launch downloads the OCR model** (1–5 min, one-time)

### 2. In-game

1. Make the item name visible on screen (hover inventory, aim at ground item, etc.)
2. Press **F2**
3. Overlay card appears with prices

### 3. If recognition is off

Adjust the **capture region** in settings — make sure only the item name text falls inside the capture box.

| Setting | Default | Meaning |
|---|---|---|
| X offset | `10` | Horizontal start from cursor (px) |
| Y offset | `-75` | Vertical start from cursor (px) |
| Width | `300` | Capture area width |
| Height | `70` | Capture area height |

### 4. Move the overlay

Drag any blank area of the card to reposition. Position is auto-saved.

---

## ⚙️ Settings Reference

| Setting | Description |
|---|---|
| Language | Korean / English |
| Game mode | PVP / PVE (price data is separated) |
| Hotkey | Lookup hotkey (default `F2`) |
| Toggle card hotkey | Show/hide overlay (default `Shift+F2`) |
| Sound notification | Ding on lookup complete |
| Hide delay | Auto-hide delay (1–60 seconds) |
| Font size | 12px – 20px |
| Display items | Toggle each section: 24h range, last trade, weight/efficiency, buy from, barters, crafts, quests |
| Panels open by default | Expand barter/craft/quest panels on first render |
| Auto update check | Check for new versions on startup |
| Advanced mode | OCR correction editor (`misread → correct name` mappings) |

---

## ❓ FAQ

**Q. Nothing happens when I press F2.**
A. The OCR model may still be downloading on first launch (up to 5 min). If it still fails, re-register the hotkey in Settings. Another program might be holding F2 — try a different key.

**Q. Wrong item name or "no match" result.**
A. See "capture region" above. Tune X/Y offset so only the item name is inside the capture box.

**Q. Same item keeps getting misread.**
A. Settings → enable **Advanced mode** → save a `misread → correct name` mapping. Auto-applied next time.

**Q. PVE prices look wrong.**
A. Switch **Game mode** to PVE in Settings.

**Q. Dual monitor / 4K / 125% scaling — coordinates are off.**
A. Per-monitor DPI is handled. If still off, fine-tune capture X/Y offset.

**Q. SmartScreen / antivirus flags it.**
A. Unsigned executable. Click "More info → Run anyway". See "Safety" section for technical details.

**Q. Will I get banned?**
A. See "Safety" section above. Screen capture + OCR is fundamentally different from memory hacks/ESP. That said, BSG has not officially sanctioned this tool, so use at your own risk.

**Q. Bug reports / feedback?**
A. Open a [GitHub Issue](https://github.com/pado8/tarkov-price-overlay-releases/issues) or email floe9235@gmail.com.

---

## 💝 Donate

If this helps you, donations are appreciated. Two options in Settings → Donate:

- **KakaoPay** (Korea)
- **PayPal** — [paypal.me/tarkovoverlay](https://paypal.me/tarkovoverlay) (international)

---

## 📜 License / Disclaimer

- Price data: [tarkov.dev](https://tarkov.dev) (community-maintained EFT database)
- This is an **unofficial tool, not affiliated with Battlestate Games**
- *Escape from Tarkov* and related assets are trademarks/copyright of Battlestate Games Limited
- © 2026 pado
