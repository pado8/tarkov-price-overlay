# 타르코프 시세 오버레이 (Tarkov Price Overlay)

> **아이템에 마우스 올리고 `F2`** — 플리마켓 시세·상인가·바터·하이드아웃 제작·퀘스트 정보를 게임 화면 위에 약 1초 만에 띄우는 **무료 오픈소스 Windows 오버레이**. 알트탭으로 위키 켤 필요 없이.

<p align="center">
  <b><a href="https://tarkov.aquapado.com">⬇ 다운로드 페이지 — tarkov.aquapado.com</a></b>
  &nbsp;·&nbsp; <a href="https://github.com/pado8/tarkov-price-overlay-releases/releases/latest">최신 릴리즈 바로받기</a>
  &nbsp;·&nbsp; <a href="https://tarkov.aquapado.com/en">English</a> / <a href="https://tarkov.aquapado.com/ru">Русский</a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Download](https://img.shields.io/badge/⬇-Download-c8aa64)](https://tarkov.aquapado.com)
[![Built on tarkov.dev](https://img.shields.io/badge/prices-tarkov.dev-8a909c)](https://tarkov.dev)

<p align="center">
  <img src="https://tarkov.aquapado.com/screenshots/01-main-lookup.png" width="360" alt="타르코프 시세 오버레이 메인 카드 — 플리 시세, 상인가, 바터, 제작, 퀘스트 정보" />
</p>

## 이게 뭔가요?

Escape from Tarkov(타르코프)에서 인벤토리 아이템에 마우스를 올리고 **F2**를 누르면, 그 아이템의 **플리마켓 시세·상인 최고가·바터·하이드아웃 제작 재료·퀘스트 필요 여부**가 투명 카드로 게임 위에 바로 뜹니다. 시세 확인하려고 알트탭으로 브라우저·위키 열 필요가 없어요.

- 💰 **플리마켓** 현재가 · 24시간 범위 · 칸당 가격(₽/슬롯)
- 🏪 **상인** 최고가 및 구매처
- 🔄 **바터**(양방향) · 🏠 **하이드아웃** 제작·업그레이드 재료(FiR 표시)
- 🎯 **퀘스트 자동 동기화**(내 진행상황 색 구분) · 🔫 **탄약 비교표**(같은 구경 관통/데미지)
- ⭐ 루팅 등급 · ⚖️ 무게 효율 · **PVP/PVE 분리** · 🇰🇷 한국어 / 🇬🇧 English / 🇷🇺 Русский(베타)

## 밴 걱정은요?

**화면 캡처 + OCR(글자 인식)만** 사용합니다. 게임 메모리를 읽거나 DLL 인젝션·게임 파일 수정을 **하지 않아요** — OBS 녹화나 디스코드 화면공유와 같은 범주입니다. 코드가 이 저장소에 100% 공개돼 있어 직접 검토할 수 있습니다. 동일 방식 오버레이로 밴된 사례는 현재까지 보고된 바 없습니다. (단 BSG 공식 승인 도구는 아니므로 사용 책임은 본인에게 있습니다.)

## 다운로드

공식 다운로드는 **[tarkov.aquapado.com](https://tarkov.aquapado.com)** 또는 **[GitHub Releases](https://github.com/pado8/tarkov-price-overlay-releases/releases/latest)** 한 곳뿐입니다. 인스톨러(권장) 또는 포터블 ZIP 중 선택하세요. 설치 시 SmartScreen 경고가 뜨면 "추가 정보 → 실행"을 누르면 됩니다(코드 서명 비용 문제일 뿐, 코드는 공개됨).

📖 자세한 사용법·FAQ·스크린샷: **[다운로드 페이지](https://tarkov.aquapado.com)** · [상세 문서](tarkov-price-overlay/README.md)

## 소스에서 빌드 (개발자용)

하이브리드 아키텍처 — **Python**(`mss` 화면 캡처 + `EasyOCR`) 사이드카 + **Tauri 2**(Rust) 윈도우 + **React/TypeScript** UI. 시세 데이터는 [tarkov.dev](https://tarkov.dev) 공개 GraphQL API.

```
tarkov-price-overlay/
├─ python-core/   # 화면 캡처 + OCR + tarkov.dev 조회 (FastAPI 로컬 사이드카)
├─ src/           # React 프론트엔드 (투명 오버레이 UI)
└─ src-tauri/     # Tauri (Rust) 윈도우·시스템 통합
```

요구: Node 18+, Rust(stable), Python 3.11+.

```bash
cd tarkov-price-overlay
npm install
npm run tauri dev            # 개발 실행
# 릴리즈 빌드(PyInstaller 사이드카 + NSIS 인스톨러): scripts/build.ps1
```

## 링크

- 🌐 **다운로드·소개**: [tarkov.aquapado.com](https://tarkov.aquapado.com) — [한국어](https://tarkov.aquapado.com) · [English](https://tarkov.aquapado.com/en) · [Русский](https://tarkov.aquapado.com/ru)
- 📦 **릴리즈**: [전체 버전](https://github.com/pado8/tarkov-price-overlay-releases/releases)
- 🐛 **버그 제보**: 앱 설정의 ✉ 버튼 또는 [Issues](https://github.com/pado8/tarkov-price-overlay-releases/issues)

## 라이선스

MIT. 본 도구는 **비공식 도구**이며 Battlestate Games와 무관합니다. *Escape from Tarkov* 및 관련 자산은 Battlestate Games Limited의 상표/저작권입니다.

---

# Tarkov Price Overlay — English

> **Hover an item, press `F2`** — flea market price, trader prices, barters, hideout crafts, and quest requirements appear as a transparent card on top of Escape from Tarkov in about a second. No alt-tabbing to a wiki. **Free, open source, Windows.**

**⬇ [Download — tarkov.aquapado.com/en](https://tarkov.aquapado.com/en)** · [Latest release](https://github.com/pado8/tarkov-price-overlay-releases/releases/latest)

**What it is** — In Escape from Tarkov, hover any inventory item and press F2 to instantly see its flea market price, best trader price, barters, hideout craft/upgrade requirements, and quest needs — as a transparent overlay card, no alt-tab required.

**Will I get banned?** It uses **screen capture + OCR only** — no memory reading, no DLL injection, no game-file modification (same category as OBS recording or Discord screen share). Full source is in this repo. No bans reported for this class of overlay — but it isn't officially endorsed by BSG, so use at your own discretion.

**Features** — flea price / 24h range / price-per-slot · best trader · barters (both directions) · hideout crafts & upgrades (FiR flags) · quest auto-sync · ammo comparison matrix · loot tier · PVP/PVE split · Korean / English / Russian (beta) UI.

**Build from source** — Python (`mss` + `EasyOCR`) sidecar + Tauri 2 (Rust) + React/TS. Prices from the [tarkov.dev](https://tarkov.dev) API.

```bash
cd tarkov-price-overlay
npm install
npm run tauri dev
```

MIT licensed. Unofficial tool, not affiliated with Battlestate Games. *Escape from Tarkov* and related assets are trademarks/copyright of Battlestate Games Limited.
