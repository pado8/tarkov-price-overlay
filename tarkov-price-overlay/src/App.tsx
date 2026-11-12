import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition, PhysicalSize, LogicalSize, primaryMonitor, currentMonitor, availableMonitors } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check as checkForAppUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as openFolderDialog, message, ask } from "@tauri-apps/plugin-dialog";
import { QRCodeSVG } from "qrcode.react";
import { T, dataLang, type Lang, type GameLang, type GameMode } from "./i18n";
import { useParty } from "./party";
import { setStatSink, stat } from "./statBus";
import { holdStep, HOLD_START, type HoldState } from "./cursorHold";
import { effectiveFaction, filterFactionQuests, type FactionSetting } from "./factionQuests";
import { diag, diagBlock } from "./diagLog";
import { RadarPanel, type RadarState, RADAR_SIZE_KEY, loadRadarSize, RADAR_MINI_KEY, RADAR_MINI_SIZE_KEY, RADAR_MAP_ALPHA_KEY, RADAR_PIP_POS_KEY, loadMiniSize, loadMapAlpha } from "./Radar";
import { prefetchMap } from "./RadarMap";
import { MAP_SHARE_ASKED_KEY, MAP_SHARE_KEY, MapShareAsk, MapShareSettings, fetchMapShareClosed, loadMapShareAsked, loadMapShareOn, useMapShareAuto } from "./MapShare";
import { Icon } from "./Icon";
import { viewAfterLookup, shotAction, nomatchCategory, pressView } from "./lookupOutcome";
import { chooseHelpMode, captureScale, boxMismatch, type HelpMode } from "./captureHelp";
import { loadWideMapSide, saveWideMapSide, type WideMapSide } from "./wideLayout";
import { snapToWorkArea } from "./miniSnap";
import { sellAdvice, stillNeeded, WEAK_ALTERNATIVES, type AdviceQuest, type AdviceHideout } from "./sellAdvice";
import "./App.css";

declare const __APP_VERSION__: string;
const APP_VERSION = __APP_VERSION__;
const UPDATE_CHECK_KEY = "tarkov.autoCheckUpdate";
// 11-03 조용한 자동 업데이트(설치판): 새 버전을 뒤에서 받아 두고 앱을 닫을 때 설치.
// 배너의 '지금 설치'를 안 누르는 사람(1.2.5 공개 8일째 보급 73%에서 정체)을 흡수한다.
const UPDATE_AUTO_INSTALL_KEY = "tarkov.autoInstallUpdate";
// 11-04 첫 설정 도움: 한 번이라도 F2 로 아이템을 읽은 적 있음 / 도움 상자를 닫은 시각
const EVER_OK_KEY = "tarkov.everReadItem";
const CAPTURE_HELP_DISMISS_KEY = "tarkov.captureHelpDismissedAt";
// One-shot dismiss for the "run as administrator" diagnostic banner. We
// remember it forever per machine so users who already moved to elevated
// shortcuts never see it again. Clearing localStorage brings it back.
const ADMIN_BANNER_DISMISS_KEY = "tarkov.adminBannerDismissed";
// Server-driven announcement (editable live via /announcement-admin, no app
// release). Shown at most once per local day, and again whenever the content
// changes. ANNOUNCE_SEEN_KEY stores {id, date} of the last time we showed it.
const ANNOUNCEMENT_ENDPOINT = "https://api.aquapado.com/priceoverlay/announcement";
const ANNOUNCE_SEEN_KEY = "tarkov.announceSeen";
// Hideout levels: {[stationId]: currentLevel}. Persisted across sessions.
const HIDEOUT_LEVELS_KEY = "tarkov.hideoutLevels";
// 카드에서 직접 '달성' 표시한 퀘스트 id — 서버(모드)별 (피드백 #49-②).
const MANUAL_QUEST_DONE_KEY = "tarkov.manualQuestDone";
// 이미 안내한 프레스티지 시각(모드별) — 같은 프레스티지로 두 번 묻지 않도록.
const PRESTIGE_SEEN_KEY = "tarkov.prestigeSeen";

function loadAutoCheckUpdate(): boolean {
  const v = localStorage.getItem(UPDATE_CHECK_KEY);
  return v == null ? true : v === "true";
}
function loadAutoInstallUpdate(): boolean {
  const v = localStorage.getItem(UPDATE_AUTO_INSTALL_KEY);
  return v == null ? true : v === "true";
}
// "1.2.10" vs "1.2.9" 같은 숫자 비교(문자열 비교 함정 방지). 음수=a가 낮음.
function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

type Diagnostics = {
  is_admin: boolean | null;
  platform: string;
};

// Loot tier letter from ₽/slot + context flags. Five tiers (D/C/B/A/S):
// S — ≥100k ₽/slot OR a "rare" hard-to-find item (rare flag reserved for
//     future heuristic; currently always false).
// A — 50k–100k ₽/slot (gap-filling pure-price band).
// B — 30k–50k ₽/slot OR Kappa-required (Kappa boosts at least to B even
//     at low price so collector progression items aren't graded as junk).
// C — 10k–30k ₽/slot OR used in any quest / hideout upgrade (so quest
//     loot never drops below C even if it's cheap).
// D — <10k ₽/slot AND not quest/hideout/Kappa.
type LootTier = "S" | "A" | "B" | "C" | "D";
function computeLootTier(
  rubPerSlot: number,
  hasQuestOrHideout: boolean,
  hasKappa: boolean,
  rare: boolean
): LootTier {
  if (rare || rubPerSlot >= 100_000) return "S";
  if (rubPerSlot >= 50_000) return "A";
  if (hasKappa || rubPerSlot >= 30_000) return "B";
  if (hasQuestOrHideout || rubPerSlot >= 10_000) return "C";
  return "D";
}

// 마지막 진단 호출이 왜 실패했는지(사이드카가 끝내 안 뜰 때 sidecar_fail 에 실어 보낸다)
let lastDiagErr = "";
async function fetchDiagnostics(): Promise<Diagnostics | null> {
  try {
    const res = await fetch(`${PYTHON_API}/diagnostics`);
    if (!res.ok) {
      lastDiagErr = `http_${res.status}`;
      return null;
    }
    lastDiagErr = "";
    return await res.json();
  } catch (e) {
    lastDiagErr = e instanceof Error && e.name === "AbortError" ? "timeout" : "refused";
    return null;
  }
}

type UpdateInfo = { version: string; notes: string | null };

// Phases for the in-app updater UI:
//   idle       — no update or user hasn't clicked Install yet
//   downloading — bytes are streaming, show progress %
//   ready      — download + signature verify done, installer is on disk;
//                NSIS launches automatically on relaunch
//   error      — download/verify/install threw; we surface the message
//   downloaded — (11-03) 자동 업데이트가 뒤에서 받아 둔 상태. 앱을 닫을 때 설치하거나
//                배너의 '지금 적용'으로 바로 설치
type UpdatePhase = "idle" | "downloading" | "downloaded" | "ready" | "error";
const FEEDBACK_EMAIL = "floe9235@gmail.com";
const KAKAOPAY_URL = "https://qr.kakaopay.com/Ej8AkkdEJ";
const PAYPAL_URL = "https://paypal.me/tarkovoverlay";

// Anonymous usage stats — user-controlled, opt-in. Points at the user's
// own Cloudflare Worker (api.aquapado.com → D1) so all data lives on their
// own infra; no third-party analytics service is involved. Failures are
// always silent so a network blip never affects UX.
const STATS_ENDPOINT = "https://api.aquapado.com/priceoverlay/events";
const INSTALL_ID_KEY = "tarkov.installId";
const STATS_CONSENT_KEY = "tarkov.statsConsent";
// 11-07 시작 카드(처음 5분: F2·스크린샷 키·⚙ + 사용 설명서) — 첫 조회가 성공하거나 "알겠어요"를 누르면 끝. 이미 조회 기록이 있는 PC 는 안 띄움
const START_DONE_KEY = "tarkov.startCardDone";
// 11-08 첫 사용자 둘러보기 — 머리글 버튼을 하나씩 짚는 단계 패널. 처음 PC 에서 자동, 설정에서 다시 보기.
const TOUR_DONE_KEY = "tarkov.tourDone";
// 단계: id(문구 키 tourT_<id>·tourB_<id>) · sel(반짝일 요소 — '||' 로 여럿이면 앞에서부터 있는 것, 없으면 null) · open(그 단계에서 둘러보기가 여는 화면).
// 지도 안 버튼(칩·도구·파티)과 나란히 화면(오른쪽 패널·크기 조절)은 화면을 열어야 보여서 그 단계에서 열고, 둘러보기가 연 것만 닫는다.
type TourStep = { id: string; sel: string | null; open?: "map" | "wide" };
const TOUR: TourStep[] = [
  { id: "welcome", sel: null },
  { id: "f2", sel: '[data-tour="f2"]' },
  { id: "drag", sel: '[data-tour="drag"]' },
  { id: "hist", sel: '[data-tour="hist"]' },
  { id: "map", sel: '[data-tour="map"]' },
  { id: "layers", sel: ".radar-layers", open: "map" },
  // '내 탈출구만' 칩은 탈출구 목록이 찍힌 스크린샷이 있어야 생긴다 → 없으면 칩 줄을 짚는다(sel 은 '||' 앞부터 차례로)
  { id: "myexits", sel: '[data-chip="mine"]||.radar-layers', open: "map" },
  { id: "maptools", sel: ".radar-maptools", open: "map" },
  { id: "party", sel: ".radar-party-btn", open: "map" },
  { id: "wide", sel: '[data-tour="wide"]' },
  { id: "widepane", sel: ".wide-pane", open: "wide" },
  { id: "wideresize", sel: ".wide-resize-handle", open: "wide" },
  { id: "gear", sel: '[data-tour="gear"]' },
  { id: "hide", sel: '[data-tour="hide"]' },
  { id: "end", sel: null },
];
const FEEDBACK_DIAG_KEY = "tarkov.feedbackDiag";
// 피드백 #58(11-07) '마우스를 올리면 비켜 주기' — 게임이 앞에 있을 때 커서가 카드·미니맵 위면 투명 + 클릭은 게임으로(기본 꺼짐).
// 예전(1.3.0 전)엔 #55 버그로 카드에 마우스를 올리면 게임이 앞으로 와 오버레이를 덮었는데, 그걸 '장비창 위 미니맵 치우기'로 쓰던 사용자가 있었다.
// 포커스를 뺏는 옛 방식은 전체 화면 최소화(#55)가 같이 오므로 쓰지 않고, 투명 + 클릭 투과로만 비켜 준다.
const HOVER_DODGE_KEY = "tarkov.hoverDodge";
// 11-08 비켜 주기 예외 키 — 누른 채 올리면 비키지 않고 평소처럼 누를 수 있다. ctrl|shift|alt|none(기본 ctrl, 사용자 제안)
const HOVER_DODGE_MOD_KEY = "tarkov.hoverDodgeMod";
const DODGE_MOD_BIT: Record<string, number> = { ctrl: 1, shift: 2, alt: 4, none: 0 };
// 11-08 피드백 개인 답장 — 공지 응답(6시간 공용 캐시)에 실린 암호문 중 내 설치 ID 로 풀리는 것만 '개발자 답장'으로.
// 꼬리표 = SHA-256("reply-id:"+설치ID) 앞 16자, 키 = SHA-256("reply-key:"+설치ID)(AES-GCM). 본 것(n = 답장 시각)은 기억.
const REPLIES_SEEN_KEY = "tarkov.repliesSeen";
type DevReply = { n: number; text: string; at: number; msg: string };
async function openDevReplies(list: unknown): Promise<DevReply[]> {
  if (!Array.isArray(list) || !list.length || !crypto?.subtle) return [];
  const iid = ensureInstallId();
  const te = new TextEncoder();
  const sha = async (x: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(x)));
  const tag = [...(await sha("reply-id:" + iid))].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
  const mine = list.filter((r: any) => r && r.t === tag && typeof r.i === "string" && typeof r.c === "string");
  if (!mine.length) return [];
  let seen: number[] = [];
  try {
    seen = JSON.parse(localStorage.getItem(REPLIES_SEEN_KEY) || "[]");
  } catch {}
  const key = await crypto.subtle.importKey("raw", await sha("reply-key:" + iid), "AES-GCM", false, ["decrypt"]);
  const unb64 = (x: string) => Uint8Array.from(atob(x), (ch) => ch.charCodeAt(0));
  const out: DevReply[] = [];
  for (const r of mine as any[]) {
    if (seen.includes(Number(r.n))) continue;
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(r.i) }, key, unb64(r.c));
      const j = JSON.parse(new TextDecoder().decode(plain));
      if (typeof j.text === "string" && j.text) out.push({ n: Number(r.n), text: j.text, at: Number(j.at) || Number(r.n), msg: String(j.msg || "") });
    } catch {}
  }
  return out.sort((a, b) => a.n - b.n);
} // 피드백 '진단 정보 함께 보내기' 마지막 선택(기본 꺼짐)

// Public downloads page. Portable users get sent here from the update
// banner instead of going through `update.downloadAndInstall()`, which
// silently installs a *second* copy at the default NSIS path and leaves
// the portable folder's exe pinned at the old version.
// 서비스 상태 페이지(피드백 #49-①) — 헬스 엔드포인트를 사람이 읽는 화면으로.
const STATUS_PAGE_URL = "https://tarkov.aquapado.com/status/";
const GUIDE_URL = "https://tarkov.aquapado.com/guide/";
// 11-04 앱 → 가이드 연결. UI 언어별 가이드(ko=/guide/, 그 밖은 /guide/<lang>/ — en·ru·zh),
// src=app 은 GA4 에서 앱발 방문을 세려는 표식(페이지는 무시한다).
function guideBase(lang: string): string {
  return GUIDE_URL + (lang === "ko" ? "" : `${lang}/`);
}
function guideUrl(lang: string, path: string): string {
  const [p, hash] = path.split("#");
  return `${guideBase(lang)}${p}${p.includes("?") ? "&" : "?"}src=app${hash ? "#" + hash : ""}`;
}
// 사이드카 연결 실패 문구(F2·이름 조회 공통). 파일 없음(백신 격리 추정) > 복구 포기 > 켜지는 중(시작 45초 안) > 자동 복구 중(3번 연속이면 백신 한 줄 덧붙임)
// 11-09 통계: 시세 엔진이 24초 안에 못 뜨는 PC(sidecar_fail probe_refused, 14일 16명)에선 첫 조회가 '연결 실패 — 자동 복구 중'으로
// 보였다 — 고장이 아니라 첫 실행 OCR 모델 로딩(백신 검사까지 1분 가까이). 시작 직후엔 '켜지는 중'으로.
const APP_STARTED_AT = Date.now();
// 11-11 받아 둔 업데이트 → 다음 실행 때 설치. 통계: 1.3.1 뒤 업데이트 안 한 70곳 중 34곳이 이미 받아 뒀는데 설치 안 됨 —
// 받은 파일은 메모리에만 있고 설치는 트레이 '종료'·'지금 적용'에서만 됐다(창 X 는 트레이로 숨김, PC 종료는 설치 없이 끝).
// 받기를 마치면 버전을 남겨 두고, 다음 실행 직후(게임이 꺼져 있을 때만) 같은 버전이면 받아서 바로 설치·재시작한다.
const UPDATE_PENDING_KEY = "tarkov.update.pendingInstall"; // {"v":"1.3.2","at":ms}
const NEXT_LAUNCH_WINDOW_MS = 3 * 60 * 1000; // 켠 뒤 이 안에 확인이 끝났을 때만(오래 켜 둔 앱이 갑자기 재시작하지 않게)
function readPendingUpdate(): string | null {
  try {
    const j = JSON.parse(localStorage.getItem(UPDATE_PENDING_KEY) || "null");
    return j && typeof j.v === "string" ? j.v : null;
  } catch {
    return null;
  }
}
const SIDECAR_STARTING_MS = 45_000;
function sidecarErrorText(s: (typeof T)[Lang], dead: boolean, missing: boolean, fails: number): string {
  if (missing) return s.sidecarMissing;
  if (dead) return s.sidecarDead;
  if (Date.now() - APP_STARTED_AT < SIDECAR_STARTING_MS) return s.connStarting;
  return fails >= 3 ? `${s.connError} ${s.connErrorAvHint}` : s.connError;
}
function openGuide(lang: string, path: string): void {
  stat("gd"); // 11-09 하루 요약: 앱에서 가이드를 연 횟수
  openUrl(guideUrl(lang, path)).catch((e) => {
    console.warn("guide: openUrl failed", e);
  });
}
// 원격 공지(api.aquapado.com). 서버는 ko/en/ru 세 칸 — zh 칸이 없으면 영어로 폴백.
type RemoteAnnouncement = { id: number; ko: string; en: string; ru: string; zh?: string };
function getRemoteAnnouncementText(lang: Lang, a: RemoteAnnouncement): string {
  switch (lang) {
    case "ko":
      return a.ko || a.en;
    case "ru":
      return a.ru || a.en || a.ko;
    case "zh":
      return a.zh || a.en || a.ko;
    case "en":
      return a.en || a.ko;
  }
}
const openStatusPage = (lang: Lang) => {
  openUrl(`${STATUS_PAGE_URL}?lang=${lang}`).catch((e) => {
    log(`status: openUrl failed — ${String(e)}`);
  });
};
const RELEASES_PAGE_URL =
  "https://github.com/pado8/tarkov-price-overlay-releases/releases/latest";
// 1.2.7 포터블에서 설치판으로 옮겨 온 뒤 '옛 포터블 폴더는 지워도 돼요' 안내용(값 = 옛 폴더 경로, 닫으면 지움)
const PORTABLE_SWITCHED_KEY = "portableSwitchedFrom";
// 포터블 업데이트 배너를 닫은 뒤 다시 띄우기까지(트레이에 켜 둔 채일 때). 재시작하면 원래대로 바로 다시 뜬다
const PORTABLE_RENAG_MS = 5 * 24 * 60 * 60 * 1000;

// Anonymous device identifier. The canonical copy lives in a machine-wide file
// (%PROGRAMDATA%\TarkovPriceOverlay\install_id, written by the Rust backend),
// so it stays stable across reinstalls, WebView2 cache wipes, portable↔installer
// switches, and second Windows accounts — i.e. ONE id per physical PC. See the
// resolve_install_id command in lib.rs. localStorage holds a mirror so reads are
// synchronous; initInstallId() reconciles the two at startup.
//
// `cachedInstallId` is the reconciled machine id once initInstallId resolves.
// Until then (and if the backend is unavailable) ensureInstallId falls back to
// the localStorage value, generating one if absent.
let cachedInstallId: string | null = null;
const ensureInstallId = (): string => {
  if (cachedInstallId) return cachedInstallId;
  let id = localStorage.getItem(INSTALL_ID_KEY);
  if (!id) {
    // crypto.randomUUID is available in WebView2 / Tauri's webview.
    id = crypto.randomUUID();
    localStorage.setItem(INSTALL_ID_KEY, id);
  }
  return id;
};

// Resolve the machine-wide id via the Rust backend, seeding it with the current
// localStorage id so an existing user's identity is PROMOTED (not reset) on the
// first run of this build. Caches the result and mirrors it back into
// localStorage so both stores agree. Must be awaited before the first reported
// event so a reinstalled PC reports its original id, not a fresh localStorage
// one. Failures keep the localStorage id (telemetry still works).
const initInstallId = async (): Promise<void> => {
  const seed = ensureInstallId();
  try {
    const id = await invoke<string>("resolve_install_id", { candidate: seed });
    if (id && id.length >= 8) {
      cachedInstallId = id;
      localStorage.setItem(INSTALL_ID_KEY, id);
    } else {
      cachedInstallId = seed;
    }
  } catch {
    cachedInstallId = seed;
  }
};

// Opt-out model: anonymous stats are ON by default and only suppressed when
// the user explicitly turns them off (a brief one-time notice tells them so,
// without blocking). Absent key = enabled.
const STATS_NOTICE_KEY = "tarkov.statsNoticeShown";
const loadStatsEnabled = (): boolean =>
  localStorage.getItem(STATS_CONSENT_KEY) !== "false";
const loadStatsNoticeShown = (): boolean =>
  localStorage.getItem(STATS_NOTICE_KEY) === "true";

// Fire-and-forget event reporter. Skips only when the user has explicitly
// disabled stats. `keepalive: true` lets the request finish even if the
// renderer unloads (e.g. app close right after F2).
//
// Event types:
//   launch          — app start (one per session)
//   lookup          — F2 lookup that returned a priced item (success)
//   lookup_nomatch  — F2 lookup matched no item (OCR/recognition miss)
//   lookup_noprice  — matched an item with no market price (detail = public
//                     catalog item id, NOT raw OCR/search text)
//   hotkey          — the lookup hotkey binding at session start (detail =
//                     "default" | "custom_key" | "custom_mouse"). Lets the
//                     dashboard tell how many "never looked up" users simply
//                     REBOUND the key off F2 (so they're not really inactive —
//                     they press a different key) vs. a real activation gap.
//   hotkey_fail     — registering the lookup hotkey threw (detail = the
//                     accelerator that failed). A remapped key that collides
//                     with another app's global shortcut silently does nothing,
//                     which looks identical to "never tried" in the funnel.
// lookup_nomatch/noprice are post-patch breakage signals: a spike after a game
// update surfaces new/unrecognized items before users report it.
// (ad_impression/ad_click still accepted server-side for old clients.)
type StatsEvent =
  | "launch"
  | "lookup"
  | "lookup_nomatch"
  | "lookup_noprice"
  | "hotkey"
  | "hotkey_fail"
  // 지도 사용 횟수만(detail 없음). 좌표·맵·파일명은 절대 보내지 않는다
  | "radar_open"
  | "radar_shot"
  // 11-03 업데이트 보급 계측 — 구버전 잔존이 '안 누름'인지 '포터블'인지 가르기 위해
  | "install_mode" // 세션당 1회. detail = portable | installer
  | "update_check" // 확인 결과. detail = available:<ver> | none | error (세션 안에서 결과가 바뀔 때만)
  | "update_apply" // detail = downloaded | install_now | install_quit | install_next_launch | banner_shown | banner_dismiss | error | blocked:<min>
  // 11-03 2차 계측(v1.2.6). 전부 실행당 1회 또는 하루 1회라 행 수 영향은 하루 수백.
  | "sidecar_fail" // 사이드카가 끝내 안 뜸. detail = probe_refused|probe_timeout|probe_http_<n>|dead:<이유>
  | "display" // 실행당 1회. detail = <가로>x<세로>@<배율%> (물리 픽셀, 예 2560x1440@125)
  | "config" // 실행당 1~2회. detail = k=v;k=v (언어·모드·지도·나란히·단축키·공유·자동숨김·퀘스트표시 / 퀘스트연동)
  | "help" // 11-04 첫 설정 도움 상자: shown:<연속실패수> | shown_tip:<연속실패수>(11-07 툴팁 안내) | capture | autoscale | dismiss | recovered(표시 뒤 첫 성공)
  //          11-07 시작 카드·사용 설명서: start:shown | start:manual | start:got_it | start:done(첫 조회 성공) | manual:settings
  | "daily" // 사용자당 하루 1행(날짜 바뀐 뒤 첫 플러시). detail = hist=;man=;wide=;pin=;fb=;don=;lat=(중앙값ms);n=
  | "donate"; // 11-06 후원 창 사용: open:<탭> | tab:<탭> | paypal_open | copy:<탭> (탭 = kakao|paypal). 금액·결제 정보 없음
// Telemetry is BATCHED to spare the stats DB's serverless compute budget.
// Every event used to be its own POST → its own INSERT → its own wake of the
// (autosuspending) Postgres compute, so a busy raid kept the DB awake all
// session. Now the high-frequency lookup events are buffered and flushed as a
// single multi-row write. Low-frequency signals (launch / hotkey, ~once per
// session) still fire immediately so DAU and binding stats stay reliable even
// if a session ends abruptly. Failures are always silent.
type EventPayload = {
  install_id: string;
  event_type: StatsEvent;
  version: string;
  /** Occurrence time, stamped at enqueue. The server trusts this (within a
   *  sane window) so events that sat in the retry queue — even across a
   *  restart — are still filed on the day they actually happened. */
  ts: number;
  detail?: string;
};

// ── Durable, schedule-aligned telemetry queue ─────────────────────────────
// 2026-07: the stats DB (Neon free tier) burned through its monthly compute
// twice. Two root causes, both fixed here:
//
//  1. LOSS — the old queue lived in memory and was cleared the moment a POST
//     was fired. A failed request (DB down: the 07-21→07-28 outage returned
//     500 on every insert) silently dropped a whole batch, and closing the app
//     dropped whatever hadn't flushed. Now the queue is persisted and entries
//     are removed only after the server confirms the write.
//  2. QUOTA — an autosuspending Postgres bills from the moment a write wakes
//     it until it idles back out (~5 min). Clients each ran their own timer, so
//     wakes were spread across the clock and the compute effectively never
//     slept. Flushes are now ALIGNED to wall-clock boundaries: every client
//     writes inside the same short window, so the DB wakes a couple of times an
//     hour instead of continuously. That is the single biggest lever we have.
//
// Everything (including launch/hotkey) goes through the queue — a random-time
// "immediate" send is exactly the isolated wake we're trying to avoid, and
// delaying it costs nothing now that occurrence time travels with the event.
const STATS_FLUSH_MS = 30 * 60 * 1000; // aligned window: :00 and :30
// Small jitter so a few hundred clients don't hit the edge in the same
// millisecond; still well inside one DB wake window.
const STATS_JITTER_MS = 20_000;
// Safety valve: a marathon session shouldn't hold thousands of rows in memory.
// MUST NOT exceed the server's 100/req cap: the server silently truncates the
// list but still returns 200, and flushStats drops the WHOLE batch from the
// queue on success — anything past the cap would be lost, not retried.
const STATS_MAX_BATCH = 100; // max rows sent per request (= server cap)
const STATS_QUEUE_CAP = 500; // drop oldest beyond this (bounded localStorage)
const STATS_QUEUE_KEY = "tarkov.stats.queue";

let statsQueue: EventPayload[] = [];
let statsFlushTimer: ReturnType<typeof setTimeout> | null = null;
let statsFlushInFlight = false;

function loadStatsQueue(): void {
  try {
    const raw = localStorage.getItem(STATS_QUEUE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      statsQueue = parsed.filter(
        (e) => e && typeof e.install_id === "string" && typeof e.event_type === "string"
      );
    }
  } catch {
    /* corrupt entry — start clean rather than break startup */
  }
}

function persistStatsQueue(): void {
  try {
    if (!statsQueue.length) localStorage.removeItem(STATS_QUEUE_KEY);
    else localStorage.setItem(STATS_QUEUE_KEY, JSON.stringify(statsQueue));
  } catch {
    /* quota/serialization failure must never break the app */
  }
}

/** POST a batch. Resolves true only when the server accepted it, so the caller
 *  knows whether the events may be dropped from the queue. */
async function postStats(events: EventPayload[]): Promise<boolean> {
  try {
    const r = await fetch(STATS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function flushStats(): Promise<void> {
  if (statsFlushInFlight || !statsQueue.length) return;
  statsFlushInFlight = true;
  try {
    // Snapshot the head of the queue; anything enqueued mid-flight stays put.
    const batch = statsQueue.slice(0, STATS_MAX_BATCH);
    const ok = await postStats(batch);
    if (ok) {
      statsQueue = statsQueue.slice(batch.length);
      persistStatsQueue();
    }
    // On failure the queue is untouched — the next aligned window retries.
  } finally {
    statsFlushInFlight = false;
  }
}

/** Milliseconds until the next wall-clock-aligned flush window. */
function msToNextFlushWindow(): number {
  const now = Date.now();
  const next = Math.ceil(now / STATS_FLUSH_MS) * STATS_FLUSH_MS;
  return next - now + Math.floor(Math.random() * STATS_JITTER_MS);
}

function scheduleStatsFlush(): void {
  if (statsFlushTimer != null) return;
  statsFlushTimer = setTimeout(async () => {
    statsFlushTimer = null;
    dailyRollover(); // 며칠씩 켜 두는 사용자: 자정 지난 첫 창에서 전날 요약을 싣는다
    await flushStats();
    // Anything left means the send failed (or arrived mid-flight): keep the
    // cadence so the next window retries. New events re-arm the timer
    // themselves, so an empty queue simply stops scheduling.
    if (statsQueue.length) scheduleStatsFlush();
  }, msToNextFlushWindow());
}

// 본 창 여부 — 캡처 영역 미리보기 창은 index.html?window=preview-* 로 같은 번들을 띄운다(main.tsx 가 App 을 정적 import)
const IS_MAIN_WINDOW = typeof window === "undefined" || !new URLSearchParams(window.location.search).get("window");

const reportEvent = (eventType: StatsEvent, detail?: string, ts?: number) => {
  if (!IS_MAIN_WINDOW || !loadStatsEnabled()) return; // 미리보기 창은 통계를 쌓지 않는다(11-07 중복 원인)
  statsQueue.push({
    install_id: ensureInstallId(),
    event_type: eventType,
    version: APP_VERSION,
    // ts 를 넘기면 그 시각으로 기록(하루 요약을 '그날'에 싣기 위해). 서버는 30일 안이면 믿는다.
    ts: ts ?? Date.now(),
    ...(detail ? { detail } : {}),
  });
  if (statsQueue.length > STATS_QUEUE_CAP) {
    statsQueue = statsQueue.slice(statsQueue.length - STATS_QUEUE_CAP);
  }
  persistStatsQueue();
  scheduleStatsFlush();
};

// ── 11-03 하루 요약 누적기 ─────────────────────────────────────────────
// 기능마다 이벤트를 따로 보내지 않고 사용자당 하루 한 행에 횟수를 묶는다(행 수 하루 ~80).
// KST 날짜가 바뀐 뒤 처음 손댈 때(또는 플러시 창·다음 실행 때) 전날 치를 전날 23:59 시각으로 보낸다.
const DAILY_KEY = "tarkov.stats.daily";
// st = 11-09 성공 조회 단계별 시간(ms) 배열 — lw 툴팁 대기·lc 캡처·lo OCR·lm 매칭·la 읽은 상자 수(하루 중앙값만 보낸다)
type DailyAcc = { d: string; c: Record<string, number>; lat: number[]; st?: Record<string, number[]> };
type LookupTiming = { w?: number; c?: number; o?: number; m?: number; a?: number };
const kstDay = (ms = Date.now()) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
let dailyAcc: DailyAcc = { d: kstDay(), c: {}, lat: [] };
try {
  const raw = localStorage.getItem(DAILY_KEY);
  if (raw) {
    const p = JSON.parse(raw);
    if (p && typeof p.d === "string" && p.c && Array.isArray(p.lat)) dailyAcc = p;
  }
} catch {}
const persistDaily = () => {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(dailyAcc));
  } catch {}
};
function dailyRollover(): void {
  if (!IS_MAIN_WINDOW) return; // 전날 요약은 본 창만 보내고 비운다(미리보기 창이 같은 저장소를 읽어 또 보내던 것, 11-07)
  const today = kstDay();
  if (dailyAcc.d === today) return;
  const parts = Object.entries(dailyAcc.c)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v}`);
  if (dailyAcc.lat.length) {
    const s = [...dailyAcc.lat].sort((a, b) => a - b);
    parts.push(`lat=${s[Math.floor(s.length / 2)]}`, `n=${s.length}`);
  }
  for (const [k, arr] of Object.entries(dailyAcc.st || {})) {
    if (!Array.isArray(arr) || !arr.length) continue;
    const s2 = [...arr].sort((a, b) => a - b);
    parts.push(`${k}=${s2[Math.floor(s2.length / 2)]}`);
  }
  if (parts.length && /^\d{4}-\d{2}-\d{2}$/.test(dailyAcc.d)) {
    // 서버 detail 한도 64자 — 예전엔 64자에서 그냥 잘라 마지막 키가 'pr=12'→'pr=1'처럼 틀린 숫자로 갔다.
    // 키 단위로 64자까지 담고 넘치면 같은 날짜의 다음 행으로(콘솔은 행마다 키별로 더하므로 합계가 그대로 맞다, 11-05 파티 키 추가 때)
    const ts = Date.parse(`${dailyAcc.d}T23:59:00+09:00`);
    let cur = "";
    for (const p of parts) {
      if (p.length > 64) continue;
      if (cur && cur.length + 1 + p.length > 64) {
        reportEvent("daily", cur, ts);
        cur = "";
      }
      cur = cur ? `${cur};${p}` : p;
    }
    if (cur) reportEvent("daily", cur, ts);
  }
  dailyAcc = { d: today, c: {}, lat: [], st: {} };
  persistDaily();
}
/** 기능 사용 1회. key 는 짧게(hist·man·wide·pin·fb·don). */
function dailyAdd(key: string, n = 1): void {
  dailyRollover();
  dailyAcc.c[key] = (dailyAcc.c[key] ?? 0) + n;
  persistDaily();
}
/** 성공 조회 응답 시간(ms). 하루 500개까지만 담는다(중앙값만 보내니 충분). */
function dailyLat(ms: number): void {
  dailyRollover();
  if (dailyAcc.lat.length < 500 && Number.isFinite(ms) && ms >= 0) dailyAcc.lat.push(Math.round(ms));
  persistDaily();
}
/** 11-09 성공 조회의 단계별 시간(사이드카 timing) — 응답 시간이 어디서 늘었는지 가르는 근거(1.2.7 툴팁 대기 회귀) */
function dailyStages(tm?: LookupTiming | null): void {
  if (!tm) return;
  dailyRollover();
  if (!dailyAcc.st) dailyAcc.st = {};
  const st = dailyAcc.st;
  const put = (k: string, v: unknown) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return;
    if (!st[k]) st[k] = [];
    if (st[k].length < 500) st[k].push(Math.round(v));
  };
  put("lw", tm.w);
  put("lc", tm.c);
  put("lo", tm.o);
  put("lm", tm.m);
  put("la", tm.a);
  persistDaily();
}
/** 11-10 하루 중앙값으로 보낼 표본 하나(st 배열, 하루 500개까지) — rdy 시작 시간·자원 사용량 등 */
function dailySample(key: string, v: number): void {
  if (!IS_MAIN_WINDOW || !Number.isFinite(v) || v < 0) return;
  dailyRollover();
  if (!dailyAcc.st) dailyAcc.st = {};
  if (!dailyAcc.st[key]) dailyAcc.st[key] = [];
  if (dailyAcc.st[key].length < 500) dailyAcc.st[key].push(Math.round(v));
  persistDaily();
}
setStatSink(dailyAdd); // Radar 등 App 밖 컴포넌트가 하루 요약에 더할 수 있게(statBus.ts)

// 11-09 화면 오류 횟수(하루 요약 err, 하루 50번까지) — 오류 내용은 보내지 않는다. 조용한 고장을 늦게 알던 것
if (typeof window !== "undefined" && IS_MAIN_WINDOW) {
  const onErr = () => {
    if ((dailyAcc.c.err ?? 0) < 50) dailyAdd("err");
  };
  window.addEventListener("error", onErr);
  window.addEventListener("unhandledrejection", onErr);
}

// 11-09 새 설치의 첫 조회 성공까지 걸린 시간(하루 요약 fok = 초, fokf = 그 전 실패 수) — 처음 켠 PC(시작 카드 조건)만 잰다
const FIRST_RUN_KEY = "tarkov.stats.firstRun";
const FOK_DONE_KEY = "tarkov.stats.fokDone";
const PREFOK_FAILS_KEY = "tarkov.stats.preFokFails";
function markFirstRun(): void {
  try {
    if (!localStorage.getItem(FIRST_RUN_KEY)) localStorage.setItem(FIRST_RUN_KEY, String(Date.now()));
  } catch {}
}
function noteFirstOutcome(ok: boolean): void {
  if (!IS_MAIN_WINDOW) return;
  try {
    const fr = Number(localStorage.getItem(FIRST_RUN_KEY) || 0);
    if (!fr || localStorage.getItem(FOK_DONE_KEY) === "1") return;
    if (!ok) {
      localStorage.setItem(PREFOK_FAILS_KEY, String(Number(localStorage.getItem(PREFOK_FAILS_KEY) || 0) + 1));
      return;
    }
    localStorage.setItem(FOK_DONE_KEY, "1");
    dailyAdd("fok", Math.max(1, Math.min(30 * 86400, Math.round((Date.now() - fr) / 1000))));
    const f = Number(localStorage.getItem(PREFOK_FAILS_KEY) || 0);
    if (f > 0) dailyAdd("fokf", f);
  } catch {}
}

// Startup: adopt anything a previous session couldn't deliver (app closed
// before a window, or the DB was down) and put it on the next window.
// 11-07: 본 창에서만 — 캡처 미리보기 창 3개(?window=preview-*)도 같은 번들을 불러 이 모듈 최상위 코드를 실행한다.
// 예전엔 4개 창이 같은 localStorage 의 전날 하루 요약·못 보낸 큐를 각자 읽어 보내 daily 가 같은 날 4줄씩 쌓였다.
if (typeof window !== "undefined" && IS_MAIN_WINDOW) {
  loadStatsQueue();
  dailyRollover(); // 전날 요약이 남아 있으면 지금 큐에 싣는다
  if (statsQueue.length) scheduleStatsFlush();
  // Persist-only on teardown. We deliberately do NOT fire a send here: an
  // unload-time POST is an isolated, random-time DB wake, and the queue now
  // survives to the next launch anyway.
  window.addEventListener("beforeunload", persistStatsQueue);
}

// Privacy-preserving nomatch reason for telemetry — NEVER the raw OCR text,
// just a coarse category so the dashboard can tell a capture/alignment miss
// ("empty" = nothing read, "junk" = too short / no letters → region likely
// misaligned) apart from a genuine OCR misread or new item ("no_match").
const hideToTray = () => {
  invoke("hide_to_tray").catch(() => {});
};

// Mailto fallback — kept as a secondary option for users who'd rather email
// (e.g. to attach a screenshot). The primary path is now the in-app form
// that POSTs to FEEDBACK_ENDPOINT so feedback lands in the DB directly.
const sendFeedback = (lang: Lang) => {
  const t = T[lang];
  const subject = encodeURIComponent(t.feedbackSubject);
  const body = encodeURIComponent(
    t.feedbackBody.replace("{version}", APP_VERSION)
  );
  const url = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
  openUrl(url).catch((e) => {
    log(`feedback: openUrl failed — ${String(e)}`);
  });
};

// Downscale + compress an image blob to a JPEG data URL so feedback
// screenshots stay small (~100KB) for the base64-in-DB store. Caps the
// longest edge at 1280px; falls back to the original data URL if anything
// in the canvas path throws.
const MAX_IMG_EDGE = 1280;
const compressImage = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_IMG_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });

// In-app feedback → user's own backend (api.aquapado.com → Neon). Explicit
// user action, so NOT gated on stats consent. install_id is attached so the
// dev can spot duplicate reports from one user; it's an anonymous UUID.
const FEEDBACK_ENDPOINT = "https://api.aquapado.com/priceoverlay/feedback";
const submitFeedback = async (
  message: string,
  image?: string | null
): Promise<void> => {
  const res = await fetch(FEEDBACK_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      install_id: ensureInstallId(),
      version: APP_VERSION,
      message,
      ...(image ? { image } : {}),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
};


const PYTHON_API = "http://127.0.0.1:8765";
const RADAR_POLL_MS = 400; // 새 스크린샷(지도·파티 위치) 확인 주기 — 피드백 #56

// 시세 나이 배지 — 사이드카가 네트워크 대신 디스크 스냅샷을 쓰고 있거나(패치 당일 등) 카탈로그가 3시간 넘게 못 갱신됐을 때만
const STALE_PRICE_SEC = 3 * 3600;
function staleNote(result: { price_age_sec?: number | null; price_source?: string | null }, t: { priceStaleHours: string; priceStaleMinutes: string; priceStaleHint: string }) {
  const age = result.price_age_sec;
  if (age == null) return null;
  if (result.price_source !== "disk" && age < STALE_PRICE_SEC) return null;
  const text = age >= 3600
    ? t.priceStaleHours.replace("{n}", String(Math.floor(age / 3600)))
    : t.priceStaleMinutes.replace("{n}", String(Math.max(1, Math.floor(age / 60))));
  return (
    <div className="price-stale" title={t.priceStaleHint}>
      <Icon name="clock" /> {text}
    </div>
  );
}

const log = (msg: string) => {
  invoke("log_msg", { msg }).catch(() => {});
};

/** fetch with ONE retry on a pure network failure ("Failed to fetch" =
 *  connection refused). That's the window where the Python sidecar is
 *  restarting (crash recovery) or still cold-starting — a second attempt
 *  1.5s later usually lands. Abort (user timeout) is NOT retried. */
async function fetchWithRetryOnce(
  url: string,
  init: RequestInit
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    log(`fetch failed, retrying once in 1.5s: ${String(e)}`);
    await new Promise((r) => setTimeout(r, 1500));
    return fetch(url, init);
  }
}

type TraderPrice = { name: string; price: number };
type BarterRequiredItem = {
  name: string;
  short_name: string | null;
  count: number;
  // Set when the source figure was fractional and the sidecar rounded up.
  // Only ever true for barter requirements (Ref's GP coin pricing) — craft
  // counts are passed through untouched because their one fractional value
  // is a real partial-resource cost.
  approx?: boolean | null;
};
// Quest gate on a barter (tarkov.dev taskUnlock). status mirrors
// TaskRef.task_status for the lookup's game_mode; status_by_mode lets the
// badge re-project when the user flips the quest-display mode, same as
// the quest list. Older backends don't send this — keep it optional.
type TaskUnlockRef = {
  id: string;
  name: string;
  status?: "started" | "completed" | "failed" | null;
  status_by_mode?: {
    pvp: "started" | "completed" | "failed" | null;
    pve: "started" | "completed" | "failed" | null;
    season?: "started" | "completed" | "failed" | null;
  };
};

type Barter = {
  trader: string;
  level: number;
  task_unlock?: TaskUnlockRef | null;
  items: BarterRequiredItem[];
};

type TaskRef = {
  id: string | null;
  name: string;
  slug?: string | null; // 11-04 가이드 퀘스트 페이지 슬러그
  trader: string;
  min_level: number;
  count: number | null;
  fir: boolean;
  // Whether this task is on the Kappa progression. Used by the loot-tier
  // tier function — Kappa items get boosted to A even at low ₽/slot.
  kappa_required: boolean;
  // 11-05 택일 후보 수(1 = 이 아이템을 콕 집은 목표). 옛 사이드카는 없음
  alternatives?: number | null;
  // 11-06 진영 전용 퀘스트면 'BEAR'|'USEC'(factionQuests.ts 가 내 진영으로 거른다). 옛 사이드카는 없음
  faction?: string | null;
  // Filled by the backend quest tracker if it found this quest in the
  // player's EFT logs. null when the tracker is off or the quest is unseen.
  // `task_status` is for the lookup's own game_mode (back-compat); newer
  // builds also send `task_status_by_mode` so the user-picked display mode
  // can switch the card instantly without a re-capture.
  task_status: "started" | "completed" | "failed" | null;
  task_status_by_mode?: {
    pvp: "started" | "completed" | "failed" | null;
    pve: "started" | "completed" | "failed" | null;
    season?: "started" | "completed" | "failed" | null;
  };
};

type QuestModeCounts = {
  started: number;
  completed: number;
  failed: number;
};

type QuestStatus = {
  enabled: boolean;
  faction_by_mode?: Record<string, string | null>; // 11-06 설정 '진영: 자동 (USEC)' 표시용
  install_path: string | null;
  auto_detected_path: string | null;
  effective_path: string | null;
  effective_path_valid: boolean;
  quest_count: number;
  completed_count: number;
  started_count: number;
  failed_count: number;
  // Per-server quest progress. Older builds (pre per-mode tracker) won't
  // send this, so the field is optional and the UI falls back to the
  // legacy aggregate counts above.
  counts_by_mode?: { pvp: QuestModeCounts; pve: QuestModeCounts; season?: QuestModeCounts };
  // 모드별 마지막 프레스티지 감지 시각(epoch 초, 0=없음). 사이드카가 감지하면
  // 그 모드 퀘스트 기록을 그 시각부터 새로 센다(자동 와이프 리셋).
  prestige_by_mode?: Record<string, number>;
};

type HideoutCraft = {
  station: string;
  // Hideout station id — same id space as HideoutStation/hideoutLevels,
  // so we can tell whether the user's station level allows this craft.
  station_id: string;
  level: number;
  duration_sec: number;
  items: BarterRequiredItem[];
};

// 이 아이템을 재료로 쓰는 은신처 제작(피드백 #46 B). need_count는 이 아이템이
// 몇 개 들어가는지 — 제작 소수(물 필터 0.66 = 내구도 소모)는 실제 값.
type HideoutCraftUsing = {
  station: string;
  station_id: string;
  level: number;
  duration_sec: number;
  need_count?: number | null;
  rewards: BarterRequiredItem[];
};

type HideoutNeed = {
  station: string;
  station_id: string;
  station_slug?: string; // 11-04 가이드 시설 페이지 슬러그
  level: number;
  count: number;
  fir?: boolean;
};

type HideoutStation = {
  id: string;
  name: string;
  maxLevel: number;
};

type BarterUsing = {
  trader: string;
  level: number;
  task_unlock?: TaskUnlockRef | null;
  // How many of the looked-up item this barter consumes. Optional because a
  // cache written by an older sidecar has no counts — render nothing then
  // rather than a misleading ×0.
  need_count?: number | null;
  // Set when the source figure was fractional (GP coin barters) and we
  // rounded up, so the badge shows "~" instead of claiming precision.
  need_approx?: boolean | null;
  rewards: BarterRequiredItem[];
};

type BuyOffer = {
  name: string;
  price: number;
  min_level: number;
};

type LookupResult = {
  raw_text: string;
  item_id: string | null;
  timing?: LookupTiming | null; // 11-09 단계별 시간(ms): w 툴팁 대기·c 캡처·o OCR·m 매칭·a 읽은 상자 수
  tooltip_wait?: string | null; // 11-08 F2 툴팁 대기 결과(사이드카) — 'waited_none' 인데 성공 = 판정이 놓쳐 0.6초 손해
  mon?: number[] | null; // 11-10 조회 때 커서가 있는 모니터 [가로, 세로](물리 픽셀) — 상자 어긋남 통계(bxm·bxf)
  item_name: string | null;
  short_name: string | null;
  width: number | null;
  height: number | null;
  weight: number | null;
  icon: string | null;
  /** Fandom wiki page. Null for items the catalog has no page for. 가이드가 다루지 않는 아이템의 대체 링크 */
  wiki: string | null;
  is_key?: boolean; // 11-04 열쇠 → 가이드 열쇠 페이지
  guide_page?: "keys" | "items" | "usage" | null; // 11-04 가이드 목록 페이지에 이 아이템 행이 있음(사이드카 guide_index) · 11-06 usage=/guide/untradeable/
  // 11-06 거래 불가 아이템 쓰임새(사이드카 data/item_usage.json) — 한 줄마다 네 언어, 화면 언어로 고른다
  usage?: { ko: string; en: string; ru: string; zh: string }[];
  is_event?: boolean;
  flea_price: number | null;
  flea_low_24h: number | null;
  flea_high_24h: number | null;
  flea_last_low: number | null;
  flea_last_offer_count: number | null;
  flea_change_48h_pct: number | null;
  trader_price: number | null;
  sell_for: TraderPrice[];
  barters_for: Barter[];
  barters_using: BarterUsing[];
  buy_for: BuyOffer[];
  used_in_tasks: TaskRef[];
  faction_by_mode?: Record<string, string | null>; // 11-06 모드별 추정 진영(진영 전용 퀘스트 기록)
  crafts_for: HideoutCraft[];
  crafts_using?: HideoutCraftUsing[];
  needed_for_hideout: HideoutNeed[];
  // 건스미스 퀘스트에 쓰이는 부품이면(필수 부품 / 위키 예시 조립). 사이드카 gunsmith.py — 가이드 사이트 JSON 기준
  gunsmith?: { quest: string; kind: "req" | "ex"; weapon: string | null }[];
  // 이 시세가 몇 초 전 카탈로그인지 · 출처(json/graphql/disk). 디스크 복원이거나 3시간 넘으면 "N시간 전 시세" 배지
  price_age_sec?: number | null;
  // 11-04 새 아이템 대응: 플리 금지 여부(시세 없음이 '거래 불가'인지 '아직 시세 없음'인지) · 목록 재갱신 중 · 게임 업데이트 뒤 시간
  no_flea?: boolean | null;
  // 11-05 플리 수수료 계산용 — 옛 사이드카·옛 스냅샷은 없음
  base_price?: number | null;
  flea_fee_rates?: [number, number] | null;
  catalog_refreshing?: boolean;
  game_updated_hours?: number | null;
  price_source?: string | null;
  // Caliber for ammo / weapons. Drives auto-expansion of the Ammo Matrix
  // panel and pre-selects the relevant caliber. null for everything else.
  caliber: string | null;
  caliber_display: string | null;
  // Set when the lookup was an ammo PACK: the round inside it, so the
  // matrix can highlight that row. Optional — older backends omit them.
  ammo_pack_round_id?: string | null;
  ammo_pack_round_name?: string | null;
  matched_from: string | null;
  // Capture attempt that produced this response ("primary"/"mirror"/
  // "ground"/"wide"); null on override_text lookups. "wide" marks the
  // zoom-out rescue path — telemetry prefixes its nomatch category with
  // "wide_" so the dashboard can tell rescue reads from normal ones.
  attempt?: string | null;
};

type AmmoRound = {
  id: string | null;
  name: string;
  short_name: string;
  penetration: number;
  damage: number;
  fragmentation: number;
  armor_damage: number;
  accuracy_mod: number;
};
type AmmoCaliberData = { display: string; rounds: AmmoRound[] };
type AmmoData = { calibers: Record<string, AmmoCaliberData> };

async function fetchAmmo(lang: GameLang): Promise<AmmoData | null> {
  try {
    const res = await fetch(`${PYTHON_API}/ammo?lang=${lang}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

type Status = "idle" | "loading" | "success" | "error";

type Region = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  // Ground-item capture (small box under the crosshair for raid floor items).
  // Tried after primary/mirror as a fallback so F2 also works on dropped items.
  groundOffsetX: number;
  groundOffsetY: number;
  groundWidth: number;
  groundHeight: number;
  lang: Lang;
  // Game client language. Undefined means "follow UI language" — preserves
  // behavior for existing users. Lets a Korean player on the English EFT
  // client run the UI in Korean while still matching OCR against the EN
  // catalog from tarkov.dev.
  // zh UI has no zh game client: undefined then means the EN catalog (getGameLang).
  gameLang?: GameLang;
  gameMode: GameMode;
  hideDelaySec: number;
  // Master auto-hide switch. Off = the card stays up until the user hides it
  // explicitly (✕ / toggle hotkey). hideDelaySec only applies while this is on.
  autoHide: boolean;
  // Display prefs — what to show in the result card. Default minimal:
  // only flea / trader / slot price are shown.
  show24hRange: boolean;
  showLastTrade: boolean;
  // 직전 거래 가격을 플리·상인과 같은 본 가격 스타일로 강조(피드백 #50).
  // 기본 꺼짐 — 다른 사용자의 카드 모양은 그대로 둔다.
  highlightLastTrade: boolean;
  showWeight: boolean;
  showBuyFor: boolean;
  showBartersFor: boolean;
  showBartersUsing: boolean;
  showCraftsFor: boolean;
  // 이 아이템을 재료로 쓰는 제작 패널(피드백 #46 B)
  showCraftsUsing: boolean;
  showHideoutNeeds: boolean;
  showQuests: boolean;
  // What to do with quests the player has already completed (per the
  // EFT log watcher). "dim" greys them out so they're still visible but
  // de-emphasized; "hide" filters them out entirely.
  completedQuestDisplay: "dim" | "hide";
  // 11-06 PMC 진영 — "auto" = 진영 전용 퀘스트 기록으로 추정(사이드카), 직접 고르면 그 값. 반대 진영 전용 퀘스트를 카드에서 뺀다
  faction: FactionSetting;
  // Whether the optional <details> panels start expanded.
  detailsOpenDefault: boolean;
  fontSize: number;
  // Card opacity (20-100). Lets players keep the overlay readable while
  // dimming it so it doesn't compete with the game underneath. Floors at
  // 20 because 0% leaves the card invisible and the user can't find the
  // settings to undo it.
  opacity: number;
  // Card BACKGROUND opacity only (0-100). Unlike `opacity`, text/icons stay
  // fully readable — this just fades the dark panel behind them so the game
  // shows through. 0 is safe here (text remains visible).
  bgOpacity: number;
  // Loot-tier letter badge (D/C/B/A/S) next to ₽/slot. When off, the
  // slot price renders bare. Tier rules live in computeLootTier().
  showLootTier: boolean;
  // 11-05 플리 실수령(수수료 차감)·보관/판매 판정 줄
  showSellAdvice: boolean;
  // Ammo Matrix panel: auto-expands on the card when the lookup result is
  // a weapon or a round. Off entirely hides the panel even on ammo/weapon.
  showAmmoMatrix: boolean;
  // 피드백 #51: 카드 안 블록의 표시 순서. .prices 가 세로 flex 라 각 블록에
  // CSS order 를 주면 JSX 순서를 안 바꾸고도 재배치된다. 시세 줄(플리·상인)은
  // 항상 맨 위(order 0). 없는 키는 loadRegion 이 기본 순서로 채운다.
  sectionOrder: SectionKey[];
};

// 카드 블록 키(설정 '표시 순서'와 secStyle 이 같이 쓴다). 기본값 = 지금까지의 JSX 순서.
const SECTION_KEYS = [
  "buyFor",
  "bartersFor",
  "bartersUsing",
  "craftsFor",
  "craftsUsing",
  "gunsmith",
  "hideoutNeeds",
  "ammoMatrix",
  "quests",
  "slotLine",
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

const DEFAULT_REGION: Region = {
  offsetX: 10,
  offsetY: -75,
  width: 300,
  height: 70,
  groundOffsetX: -80,
  groundOffsetY: 30,
  groundWidth: 160,
  groundHeight: 30,
  lang: "ko",
  gameMode: "regular",
  hideDelaySec: 5,
  autoHide: true,
  show24hRange: true,
  showLastTrade: true,
  highlightLastTrade: false,
  showCraftsUsing: true,
  showWeight: true,
  showBuyFor: true,
  showBartersFor: true,
  showBartersUsing: true,
  showCraftsFor: true,
  showHideoutNeeds: true,
  showQuests: true,
  completedQuestDisplay: "dim",
  faction: "auto",
  detailsOpenDefault: true,
  fontSize: 13,
  opacity: 100,
  bgOpacity: 85,
  showLootTier: true,
  showSellAdvice: true,
  showAmmoMatrix: true,
  sectionOrder: [...SECTION_KEYS],
};

const STORAGE_KEY = "tarkov.captureRegion";
const POSITION_KEY = "tarkov.windowPosition";
const RADAR_ENABLED_KEY = "tarkov.radar.enabled";
const RADAR_SCAV_KEY = "tarkov.radar.showScav";
const RADAR_STORY_KEY = "tarkov.radar.story"; // 지도에 띄울 스토리 챕터 id("" = 안 띄움, "all" = 전부) — 게임이 스토리 진행을 로그에 안 남겨 사용자가 고른다
// 새 스크린샷이 이보다 오래됐으면 지도를 자동으로 띄우지 않는다(앱을 늦게 켰을 때 옛 스크린샷으로 뜨지 않게)
const RADAR_POPUP_MAX_AGE_SEC = 60;
const RADAR_MIN_OPACITY = 90;
// 지도 나란히 모드: 창을 지금 있는 모니터에 꽉 채우고 왼쪽 카드 + 오른쪽 전체 지도. 끄면 저장해 둔 위치·원래 크기로
const WIDE_KEY = "tarkov.wideMode";
const MINI_SNAP_KEY = "tarkov.radar.miniSnap"; // "0" = 미니맵 자석 끔(기본 켬, 11-12 피드백 #61)
const WIDE_PREV_POS_KEY = "tarkov.wideMode.prevPos";
// 나란히 모드 창을 사용자가 끌어서 바꾼 크기·위치(물리 px). 없으면 모니터 전체(11-04 피드백 #54)
const WIDE_RECT_KEY = "tarkov.wideMode.rect"; // 지도 표시 중 카드 전체 불투명도 하한(%)
const HOTKEY_KEY = "tarkov.hotkey";
const TOGGLE_HOTKEY_KEY = "tarkov.toggleHotkey";
// "조회 키를 게임에도 전달": RegisterHotKey 대신 키 상태만 엿들어 게임 스크린샷 키와 같은 키를 쓸 수 있게
const HOTKEY_PASSTHROUGH_KEY = "tarkov.hotkeyPassthrough";
const SOUND_KEY = "tarkov.soundOn";
const PIN_KEY = "tarkov.pinned";
// 11-07 사용자: "트레이로만 있으니 사람들이 찾기 어렵다" → 기본은 작업표시줄에 보이고, 설정에서 끄면 트레이로만(tauri.conf skipTaskbar=false)
const TASKBAR_KEY = "tarkov.showInTaskbar";
const HISTORY_KEY = "tarkov.history";
const SETTINGS_HEIGHT_KEY = "tarkov.settingsHeight";
const QUEST_DISPLAY_MODE_KEY = "tarkov.questDisplayMode";
const HIDEOUT_MGMT_LEVEL_KEY = "tarkov.hideoutMgmtLevel";
// User-overridden card width (px). null = auto (scales with fontSize).
// Set by dragging the resize handle in the card's bottom-right corner.
const CARD_WIDTH_KEY = "tarkov.cardWidth";
// User-overridden card height (px). null = auto (fits content, clamped to
// screen). Set by dragging the resize handle in the card's bottom-right corner.
const CARD_HEIGHT_KEY = "tarkov.cardHeight";
// Capture-region preview anchor mode. "center" pins the rectangles to the
// primary monitor center while the user adjusts sliders (so rectangles stay
// put for fine adjustment); "cursor" keeps the legacy cursor-following
// behavior for users who prefer to align against a real hover. Persisted
// because the user usually settles on one approach and keeps it.
const PREVIEW_ANCHOR_KEY = "tarkov.previewAnchorMode";
type PreviewAnchorMode = "center" | "cursor";
function loadPreviewAnchorMode(): PreviewAnchorMode {
  const v = localStorage.getItem(PREVIEW_ANCHOR_KEY);
  return v === "cursor" ? "cursor" : "center";
}

function loadCardWidth(): number | null {
  const raw = localStorage.getItem(CARD_WIDTH_KEY);
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(CARD_W_MIN, Math.min(CARD_W_MAX, n));
}

function loadCardHeight(): number | null {
  const raw = localStorage.getItem(CARD_HEIGHT_KEY);
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(CARD_H_MIN, n);
}

// 퀘스트 표시 서버. "follow" = 위 '게임 모드' 설정을 그대로 따른다(11-02 설정 재편: 게임 모드와 퀘스트 표시가
// 따로 있어 헷갈린다는 점검 결과). 저장값이 없으면 follow — 전엔 PVE 고정 기본값이었다.
type QuestModeSetting = "follow" | "pvp" | "pve" | "season";
function loadQuestDisplayMode(): QuestModeSetting {
  const v = localStorage.getItem(QUEST_DISPLAY_MODE_KEY);
  return v === "pvp" ? "pvp" : v === "season" ? "season" : v === "pve" ? "pve" : "follow";
}
const questModeOfGameMode = (g: GameMode): "pvp" | "pve" | "season" =>
  g === "pve" ? "pve" : g === "pvp-season" ? "season" : "pvp";
const WIN_BASE_W = 800;
// 나란히 모드 창 최소 크기(논리 px) — 이보다 작으면 시세 카드와 지도가 한 줄에 안 들어간다
const WIDE_MIN_W = 720;
const WIDE_MIN_H = 420;
const FONT_DEFAULT = 13;
// Card width drag-resize bounds (px). Min keeps the layout from collapsing;
// max stays within the 800px logical window so the card never clips at the
// right edge. Auto width (no override) is 280×fontSize/13 ≈ 280–431px.
const CARD_W_MIN = 240;
const CARD_W_MAX = 760;
// Card height drag-resize floor (px). The ceiling is the screen height
// (screenMaxH) computed at runtime. null = auto (fits content).
const CARD_H_MIN = 80;
// Overlay padding (12px top + 12px bottom) — kept in sync with .overlay in App.css.
const WIN_VPAD = 24;
// Leave a small margin from the screen edge so the OS taskbar / window chrome
// doesn't clip the bottom of the card at large font sizes.
const WIN_SCREEN_MARGIN = 40;

const screenMaxH = (): number => {
  // window.screen.availHeight is in CSS pixels which matches Tauri LogicalSize.
  const h = typeof window !== "undefined" ? window.screen?.availHeight : 0;
  return h && h > 0 ? Math.max(300, h - WIN_SCREEN_MARGIN) : 2000;
};

const DEFAULT_HOTKEY = "F2";
const DEFAULT_TOGGLE_HOTKEY = "Shift+F2";
const MAX_HISTORY = 15;

type HistoryEntry = {
  ts: number;
  raw_text: string;
  result: LookupResult;
};

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(0, MAX_HISTORY);
    }
  } catch {}
  return [];
}

function addToHistory(result: LookupResult): HistoryEntry[] {
  if (!result.item_name) return loadHistory();
  const entries = loadHistory().filter(
    (e) => e.result.item_name !== result.item_name
  );
  entries.unshift({ ts: Date.now(), raw_text: result.raw_text, result });
  const trimmed = entries.slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {}
  return trimmed;
}

function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {}
}

// Scale capture region defaults by primary-monitor width. Defaults assume
// 1920×1080; QHD (2560×1440) and 4K (3840×2160) need bigger boxes because
// EFT's hover tooltip itself scales with display resolution. Only scales up
// (never below 1.0) — sub-1080p users keep the existing defaults that fit
// in their smaller hover boxes. Primary monitor (not the window's current
// monitor) so dual-monitor setups where the overlay sits on a secondary
// screen still get sensible defaults for the gameplay monitor.
// 11-07: the tooltip follows the screen's vertical size, so ultrawide screens
// (3440×1440, 2560×1080) used to get oversized boxes from a width-only ratio
// (1.79 / 1.33 instead of 1.33 / 1.0) that picked up neighbouring text — use
// the smaller of the two ratios (captureScale). 16:9 screens get exactly the same scale as before.
function scaleRegionForMonitor(base: Region, monitorWidth: number, monitorHeight?: number): Region {
  const scale = captureScale(monitorWidth, monitorHeight);
  const r = Math.round;
  return {
    ...base,
    offsetX: r(base.offsetX * scale),
    offsetY: r(base.offsetY * scale),
    width: r(base.width * scale),
    height: r(base.height * scale),
    groundOffsetX: r(base.groundOffsetX * scale),
    groundOffsetY: r(base.groundOffsetY * scale),
    groundWidth: r(base.groundWidth * scale),
    groundHeight: r(base.groundHeight * scale),
  };
}

// Compute scaled defaults for the primary monitor. With force=false, no-op
// when a Region is already saved (used on first launch). With force=true,
// always overwrite — used by the "현재 해상도로 자동 조정" button so
// existing users with stale 1080p defaults can recover in one click.
// Returns the new Region on apply, or null when skipped/failed.
async function applyMonitorScaling(force: boolean): Promise<Region | null> {
  if (!force && localStorage.getItem(STORAGE_KEY)) return null;
  try {
    const mon = await primaryMonitor();
    if (!mon) return null;
    const scaled = scaleRegionForMonitor(DEFAULT_REGION, mon.size.width, mon.size.height);
    // Only overwrite the CAPTURE GEOMETRY. This button's job is to recompute
    // offsets/sizes for the monitor — it must never wipe the user's other
    // ~20 settings (lang, gameMode, fontSize, display toggles, autoHide,
    // bgOpacity, …), which a whole-Region overwrite silently did.
    const merged: Region = {
      ...loadRegion(),
      offsetX: scaled.offsetX,
      offsetY: scaled.offsetY,
      width: scaled.width,
      height: scaled.height,
      groundOffsetX: scaled.groundOffsetX,
      groundOffsetY: scaled.groundOffsetY,
      groundWidth: scaled.groundWidth,
      groundHeight: scaled.groundHeight,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return null;
  }
}

const getGameLang = (r: Region): GameLang => r.gameLang ?? dataLang(r.lang);

function loadRegion(): Region {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const merged: Region = { ...DEFAULT_REGION, ...JSON.parse(raw) };
      // Clamp fontSize to the supported select range (12-20).
      merged.fontSize = Math.max(12, Math.min(20, merged.fontSize));
      // Clamp opacity to safe range (20-100). 0% would hide the card with
      // no way for the user to bring it back via the settings panel.
      merged.opacity = Math.max(20, Math.min(100, merged.opacity ?? 100));
      // bgOpacity may go to 0 (text stays visible, so it's recoverable).
      merged.bgOpacity = Math.max(0, Math.min(100, merged.bgOpacity ?? 85));
      // sectionOrder: 저장된 순서를 지키되 새로 생긴 블록 키는 기본 순서대로 뒤에 붙이고, 모르는 키는 버린다.
      const saved = Array.isArray(merged.sectionOrder) ? merged.sectionOrder : [];
      const seen = new Set<string>();
      const order: SectionKey[] = [];
      for (const k of [...saved, ...SECTION_KEYS]) {
        if ((SECTION_KEYS as readonly string[]).includes(k) && !seen.has(k)) {
          seen.add(k);
          order.push(k as SectionKey);
        }
      }
      merged.sectionOrder = order;
      // 언어 값 검증: 모르는 UI 언어는 기본값, 게임 언어는 OCR 이 읽는 ko/en/ru 만(zh 는 UI 전용).
      if (!(merged.lang in T)) merged.lang = DEFAULT_REGION.lang;
      if (merged.gameLang != null && !["ko", "en", "ru"].includes(merged.gameLang)) merged.gameLang = undefined;
      return merged;
    }
  } catch {}
  return DEFAULT_REGION;
}

function loadHotkey(): string {
  return localStorage.getItem(HOTKEY_KEY) || DEFAULT_HOTKEY;
}

function loadToggleHotkey(): string {
  return localStorage.getItem(TOGGLE_HOTKEY_KEY) || DEFAULT_TOGGLE_HOTKEY;
}

function loadSoundOn(): boolean {
  const raw = localStorage.getItem(SOUND_KEY);
  return raw == null ? true : raw === "true";
}

// Synthesized "ding" via Web Audio — no asset bundling needed.
let _audioCtx: AudioContext | null = null;
function playDing(success: boolean) {
  try {
    _audioCtx ??= new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();
    const ctx = _audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = success ? 880 : 330;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {}
}

// Mouse-button hotkey helpers. The Rust side runs a 60Hz poller for these
// (tauri-plugin-global-shortcut is keyboard-only). We persist the binding
// as one of these literal strings so the same useEffect that registers
// keyboard hotkeys can branch by prefix instead of carrying a separate type.
type MouseHotkey = "MouseMiddle" | "MouseX1" | "MouseX2";

function isMouseHotkey(s: string): s is MouseHotkey {
  return s === "MouseMiddle" || s === "MouseX1" || s === "MouseX2";
}

/** Coarse classification of the lookup hotkey for anonymous telemetry — never
 *  the raw key, just whether the user is on the default F2, a custom keyboard
 *  key, or a mouse button. Powers the "are the 'never pressed F2' users just
 *  people who rebound the key?" analysis. */
function hotkeyKind(hk: string): "default" | "custom_key" | "custom_mouse" {
  if (hk === DEFAULT_HOTKEY) return "default";
  if (isMouseHotkey(hk)) return "custom_mouse";
  return "custom_key";
}

/** MouseEvent.button → our hotkey string, or null for buttons we refuse to
 *  bind. Left/right click are reserved for normal UI / game input — binding
 *  them would steal every click. */
function mouseEventToAccelerator(e: MouseEvent): MouseHotkey | null {
  switch (e.button) {
    case 1:
      return "MouseMiddle";
    case 3:
      return "MouseX1";
    case 4:
      return "MouseX2";
    default:
      return null;
  }
}

/** Pretty label for the recorded hotkey button shown in settings. Mouse
 *  bindings get a 🖱 prefix so the user instantly tells them apart from
 *  keyboard accelerators. Localized — an English UI must not show Korean
 *  labels (user-reported bug). Structural param type (not `Strings`): the
 *  ko/en literal objects aren't mutually assignable, plain strings are. */
function formatHotkeyLabel(
  s: string,
  t: { mouseMiddle: string; mouseX1: string; mouseX2: string }
): string {
  switch (s) {
    case "MouseMiddle":
      return t.mouseMiddle;
    case "MouseX1":
      return t.mouseX1;
    case "MouseX2":
      return t.mouseX2;
    default:
      return s;
  }
}

function eventToAccelerator(e: KeyboardEvent): string | null {
  let key: string | null = null;
  const c = e.code;
  if (/^F([1-9]|1[0-2])$/.test(c)) key = c;
  else if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit[0-9]$/.test(c)) key = c.slice(5);
  else if (c === "Space") key = "Space";
  else if (c === "Enter") key = "Enter";
  else if (c === "Tab") key = "Tab";
  else if (c === "Escape") return null; // reserve Escape to cancel recording
  if (!key) return null;

  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");
  if (e.metaKey) mods.push("Meta");

  // A bare modifier press shouldn't bind — require a real key.
  return mods.length ? `${mods.join("+")}+${key}` : key;
}

/** Slider + click-to-edit numeric field. Same UX as the opacity row:
 *  drag the slider for coarse adjustment, click the readout number to
 *  switch to a focused text input for precise values. Used for all eight
 *  capture-region offsets and sizes. */
function SliderField(props: {
  label: string;
  /** 숫자 클릭 툴팁 — 언어별(t.opacityClickHint). 전엔 ko/en 하드코딩이라 러시아어 UI 에 한국어가 떴다. */
  editHint: string;
  min: number;
  max: number;
  value: number;
  isEditing: boolean;
  onChange: (n: number) => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
}) {
  const { label, editHint, min, max, value, isEditing, onChange, onStartEdit, onStopEdit } = props;
  return (
    <div className="settings-row">
      <label>{label}</label>
      <div className="opacity-row">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
          className="opacity-slider"
        />
        {isEditing ? (
          <input
            type="number"
            value={value}
            autoFocus
            onChange={(e) => {
              const n = parseInt(e.target.value);
              if (!isNaN(n)) onChange(n);
            }}
            onBlur={() => {
              // Clamp on blur so the user can transiently type out-of-range
              // digits while editing without snapping mid-keystroke.
              onChange(Math.max(min, Math.min(max, value)));
              onStopEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="opacity-number"
          />
        ) : (
          <span
            className="opacity-readout"
            onClick={onStartEdit}
            title={editHint}
          >
            {value}
          </span>
        )}
      </div>
    </div>
  );
}

function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<LookupResult | null>(null);
  // F2 리스너는 한 번만 등록되는 클로저라 최신 상태를 ref 로 읽는다(키 공유 시 '조회 중' 되돌리기용, lookupOutcome.ts)
  const statusRef = useRef<Status>("idle");
  statusRef.current = status;
  const hasResultRef = useRef(false);
  hasResultRef.current = result != null;
  // 같은 키(조회 키를 게임에도 전달)로 마지막에 누른 시각 — 그 누름이 만든 스크린샷이 시세 카드를 덮지 않게(lookupOutcome.shotAction)
  const sharedPressAtRef = useRef(-1e12);
  const toggleAtRef = useRef(-1e12); // 마지막 Shift+F2(숨기기 토글) 시각 — 같은 키면 그 누름도 게임 스크린샷을 만든다
  const [error, setError] = useState<string>("");
  const [region, setRegion] = useState<Region>(loadRegion);
  // 피드백 #51: 카드 블록 CSS order (시세 줄은 order 0으로 항상 위)
  const secStyle = (k: SectionKey) => ({ order: Math.max(0, region.sectionOrder.indexOf(k)) + 1 });
  const moveSection = (k: SectionKey, dir: -1 | 1) =>
    setRegion((r) => {
      const arr = [...r.sectionOrder];
      const i = arr.indexOf(k);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return r;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...r, sectionOrder: arr };
    });
  const [showSettings, setShowSettings] = useState(false);
  const [hotkey, setHotkey] = useState<string>(loadHotkey);
  const [toggleHotkey, setToggleHotkey] =
    useState<string>(loadToggleHotkey);
  const [soundOn, setSoundOn] = useState<boolean>(loadSoundOn);
  const [recordingTarget, setRecordingTarget] = useState<
    null | "lookup" | "toggle"
  >(null);
  const recordingHotkey = recordingTarget !== null;
  // Mirror into a ref so the click-through poll (a stable [cardVisible] effect)
  // can read the current recording state without going stale — while recording
  // a hotkey we must not auto-hide the card.
  const recordingHotkeyRef = useRef(recordingHotkey);
  recordingHotkeyRef.current = recordingHotkey;
  // Brief inline error shown on the recording button when the user tries to
  // bind a mouse button that's already on the other slot. Cleared when
  // recording ends or after a short timeout so the user gets a noticeable
  // hint without a modal/toast layer.
  const [hotkeyConflict, setHotkeyConflict] = useState(false);
  // Modal-style capture-region editor. When open, renders the editor as
  // an absolute-positioned dialog over the card content and shows the
  // preview rectangles at a stable anchor (see PREVIEW_ANCHOR_KEY).
  const [captureModalOpen, setCaptureModalOpen] = useState(false);
  // 11-04 첫 설정 도움: F2 가 연달아 못 읽으면 못 찾음 카드 아래에 캡처 영역 맞추기 안내.
  // 통계상 신규 사용자 실패율 13~27%(기존 4~7%) — 대부분 캡처 영역이 아이템 이름을 못 덮는 경우.
  // mode "tip" (11-07): 평소엔 잘 읽히는데 빈 화면만 이어지면 캡처 영역이 아니라 툴팁 없는 곳(빈 칸·인벤토리 밖·툴팁 뜨기 전)에서
  // 누른 것 — 통계상 이런 사람이 '캡처 맞추기'를 수십 번 눌러도 회복 0이었다 → 그땐 툴팁 안내를 먼저 보인다
  const [captureHelp, setCaptureHelp] = useState<{ streak: number; scaled: boolean; mode: HelpMode } | null>(null);
  const failStreakRef = useRef(0);
  const recentF2Ref = useRef<boolean[]>([]); // 최근 F2 결과(true = 읽음), 최대 10개
  const recentFailKindsRef = useRef<string[]>([]); // 최근 실패 종류(empty/junk/no_match), 최대 10개
  const sessionOkRef = useRef(0); // 이번 세션 성공 수
  const helpActionsRef = useRef(0); // 상자의 캡처 맞추기·자동 조정을 누른 뒤 아직 회복 못 한 횟수
  const helpShownRef = useRef(false); // 이번 세션에 상자를 띄운 적 있음 → 다음 성공을 'recovered' 로 보고
  const trackF2Outcome = (ok: boolean, failKind?: string) => {
    noteFirstOutcome(ok);
    const recent = [...recentF2Ref.current, ok].slice(-10);
    recentF2Ref.current = recent;
    if (ok) {
      failStreakRef.current = 0;
      sessionOkRef.current += 1;
      helpActionsRef.current = 0;
      try {
        localStorage.setItem(EVER_OK_KEY, "1");
      } catch {}
      if (helpShownRef.current) {
        helpShownRef.current = false;
        reportEvent("help", "recovered");
      }
      setCaptureHelp(null);
      return;
    }
    if (failKind) recentFailKindsRef.current = [...recentFailKindsRef.current, failKind].slice(-10);
    failStreakRef.current += 1;
    const streak = failStreakRef.current;
    if (streak < 3) return;
    const everOk = localStorage.getItem(EVER_OK_KEY) === "1";
    const okRate = recent.filter(Boolean).length / recent.length;
    // 성공해 본 사람은 최근 10번 중 성공이 30% 미만일 때만(인벤토리 밖에서 누른 연타는 무시)
    if (everOk && (recent.length < 6 || okRate >= 0.3)) return;
    // 닫은 지 7일 안이면 다시 안 띄운다(한 번도 성공 못 한 사람은 예외)
    const dismissedAt = Number(localStorage.getItem(CAPTURE_HELP_DISMISS_KEY) || 0);
    if (everOk && Date.now() - dismissedAt < 7 * 86400000) return;
    const mode = chooseHelpMode(everOk, sessionOkRef.current, recentFailKindsRef.current, helpActionsRef.current);
    setCaptureHelp((h) => {
      if (!h || h.mode !== mode) {
        helpShownRef.current = true;
        reportEvent("help", `${mode === "tip" ? "shown_tip" : "shown"}:${streak}`);
      }
      return { streak, scaled: h?.scaled ?? false, mode };
    });
  };
  const [previewAnchorMode, setPreviewAnchorMode] =
    useState<PreviewAnchorMode>(loadPreviewAnchorMode);
  // Click-to-edit toggle for the opacity readout next to the slider.
  const [opacityEditing, setOpacityEditing] = useState(false);
  // Click-to-edit toggle for capture-region slider readouts. Stores the
  // currently-editing field name (e.g. "offsetX"). Null = all readouts
  // are showing as click-to-edit spans.
  const [regionEditingField, setRegionEditingField] = useState<string | null>(null);
  // Settings panel resize: CSS `resize: vertical` lets the user drag the
  // bottom-right corner. We attach a ResizeObserver to persist the chosen
  // height across sessions. The initial height is applied via ref on
  // mount (avoids fighting React state on every drag event).
  const settingsRef = useRef<HTMLDivElement | null>(null);
  // Slider bounds for capture-region offsets/sizes. Static practical
  // values: EFT inventory hover tooltips appear within ~500px of the
  // cursor and rarely exceed 1000×1000 even for large backpacks. Wider
  // ranges (full monitor extent) made the slider so coarse that small
  // drags caused huge jumps — users couldn't dial in exact placement.
  // Users who genuinely need values past these bounds can still type
  // them in the click-to-edit number input (SliderField clamps to the
  // slider min/max on blur, but the typed-while-dragging value passes
  // through to the region state for the brief moment before the slider
  // re-snaps it).
  const sliderBounds = {
    offsetMaxX: 500,
    offsetMaxY: 500,
    widthMax: 1000,
    heightMax: 1000,
  };
  // "Run as administrator" diagnostic: shown when sidecar reports we are
  // not elevated. Hidden once the user dismisses (persisted via
  // ADMIN_BANNER_DISMISS_KEY).
  const [adminInfo, setAdminInfo] = useState<Diagnostics | null>(null);
  const [adminDismissed, setAdminDismissed] = useState<boolean>(
    () => localStorage.getItem(ADMIN_BANNER_DISMISS_KEY) === "true"
  );
  // Server-driven announcement to show on launch (null = nothing to show).
  const [remoteAnnounce, setRemoteAnnounce] =
    useState<RemoteAnnouncement | null>(null);
  // Anonymous stats are opt-out: enabled by default, with a one-time
  // informational notice (not a blocking consent gate).
  const [statsEnabled, setStatsEnabled] = useState<boolean>(loadStatsEnabled);
  // 11-07 시작 카드 — 처음 켠 PC(기록 없음·끝낸 적 없음)에만. 기록이 있으면 조용히 끝난 것으로 적어 둔다(업데이트한 기존 사용자에게 안 뜨게)
  const [startCard, setStartCard] = useState<boolean>(() => {
    try {
      if (localStorage.getItem(START_DONE_KEY) === "1") return false;
      if (loadHistory().length > 0) {
        localStorage.setItem(START_DONE_KEY, "1");
        return false;
      }
    } catch {}
    markFirstRun();
    return true;
  });
  const startCardRef = useRef(startCard);
  startCardRef.current = startCard;
  const markStartDone = (why: "got_it" | "done") => {
    if (!startCardRef.current) return;
    try {
      localStorage.setItem(START_DONE_KEY, "1");
    } catch {}
    setStartCard(false);
    reportEvent("help", `start:${why}`);
  };
  const markStartDoneRef = useRef(markStartDone);
  markStartDoneRef.current = markStartDone;
  // 둘러보기: null = 꺼짐, 0..8 = 단계. 처음 PC(시작 카드 조건)에서 한 번 자동으로
  const [tourStep, setTourStep] = useState<number | null>(() => {
    try {
      return startCard && localStorage.getItem(TOUR_DONE_KEY) !== "1" ? 0 : null;
    } catch {
      return null;
    }
  });
  const tourStepRef = useRef(tourStep);
  tourStepRef.current = tourStep;
  const scheduleHideRef = useRef<(() => void) | null>(null); // 아래 scheduleHide 를 둘러보기 끝에서 부르려고
  const endTour = (why: string) => {
    if (tourStepRef.current === null) return;
    try {
      localStorage.setItem(TOUR_DONE_KEY, "1");
    } catch {}
    reportEvent("help", `tour:${why}`);
    tourStepRef.current = null;
    setTourStep(null);
    scheduleHideRef.current?.();
  };
  const endTourRef = useRef(endTour);
  endTourRef.current = endTour;
  const tourOpenedRef = useRef({ map: false, wide: false }); // 둘러보기가 연 화면(끝나거나 다른 단계로 가면 이것만 닫는다)
  useEffect(() => {
    if (tourStep === 0 && startCard) reportEvent("help", "tour:shown");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (startCard) reportEvent("help", "start:shown");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [statsNoticeShown, setStatsNoticeShown] = useState<boolean>(
    loadStatsNoticeShown
  );
  // True when the running exe was launched from a portable ZIP (detected
  // via the `_portable.marker` file dropped by portable.ps1). Portable
  // users see a "open downloads page" link instead of the in-app NSIS
  // installer flow, which would install a second copy elsewhere.
  const [isPortable, setIsPortable] = useState<boolean>(false);
  const isPortableRef = useRef(false);
  // 1.2.7 포터블 → 설치판 전환. installedCopy = 포터블로 켰는데 이 PC 에 설치판이 있음(작업 표시줄에 고정한 옛 포터블 대책).
  // switchedFrom = 설치판 첫 실행에서 읽은 옛 포터블 폴더 — '지워도 돼요' 안내를 닫을 때까지 남긴다.
  const [installedCopy, setInstalledCopy] = useState<string | null>(null);
  const [installedCopyDismissed, setInstalledCopyDismissed] = useState(false);
  const [switchedFrom, setSwitchedFrom] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PORTABLE_SWITCHED_KEY);
    } catch {
      return null;
    }
  });
  const [hideoutLevels, setHideoutLevels] = useState<Record<string, number>>(
    () => {
      try {
        return JSON.parse(localStorage.getItem(HIDEOUT_LEVELS_KEY) ?? "{}");
      } catch {
        return {};
      }
    }
  );
  // 11-05 은신처 관리 스킬 레벨(0~51) — 정보 센터 3단계의 플리 수수료 할인(-30%)을 레벨당 1%씩 키운다
  const [hideoutMgmtLevel, setHideoutMgmtLevel] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(HIDEOUT_MGMT_LEVEL_KEY) ?? "0");
      return Number.isFinite(v) ? Math.max(0, Math.min(51, Math.floor(v))) : 0;
    } catch {
      return 0;
    }
  });
  const updateHideoutMgmtLevel = (v: number) => {
    const n = Math.max(0, Math.min(51, Math.floor(v)));
    setHideoutMgmtLevel(n);
    try {
      localStorage.setItem(HIDEOUT_MGMT_LEVEL_KEY, String(n));
    } catch {
      /* 저장 실패는 이번 실행에만 반영 */
    }
  };
  const [manualQuestDone, setManualQuestDone] = useState<Record<string, string[]>>(
    () => {
      try {
        return JSON.parse(localStorage.getItem(MANUAL_QUEST_DONE_KEY) ?? "{}");
      } catch {
        return {};
      }
    }
  );
  const [hideoutStations, setHideoutStations] = useState<HideoutStation[]>([]);
  // Ammo matrix data is fetched once per language on mount/lang-change.
  // Null while loading; {calibers: {}} after a failed fetch (we still treat
  // both as "no matrix" for rendering).
  const [ammoData, setAmmoData] = useState<AmmoData | null>(null);
  const [cardVisible, setCardVisible] = useState(true);
  // 토글 핫키가 '지금 보이는지'를 상태 업데이터 밖에서 읽기 위한 거울(업데이터 안에서 타이머를 거는 부작용을 없앤다)
  const cardVisibleRef = useRef(cardVisible);
  cardVisibleRef.current = cardVisible;
  // Pin: locks window move (drag region off), resize (handle hidden) and the
  // ✕ button so a mid-raid misclick can't displace or close the overlay.
  // Unpinning stays available in settings.
  const [showInTaskbar, setShowInTaskbar] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TASKBAR_KEY) !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TASKBAR_KEY, showInTaskbar ? "1" : "0");
    } catch {}
    invoke("set_show_in_taskbar", { show: showInTaskbar }).catch((e) => log(`set_show_in_taskbar failed: ${String(e)}`));
  }, [showInTaskbar]);
  const [pinned, setPinned] = useState<boolean>(
    () => localStorage.getItem(PIN_KEY) === "true"
  );
  useEffect(() => {
    localStorage.setItem(PIN_KEY, String(pinned));
  }, [pinned]);
  // User-dragged card width override (px). null = auto (scales with fontSize).
  const [cardWidth, setCardWidth] = useState<number | null>(loadCardWidth);
  // User-dragged card height override (px). null = auto (fits content).
  const [cardHeight, setCardHeight] = useState<number | null>(loadCardHeight);
  // Mirror of cardHeight for the ResizeObserver callback (closures capture a
  // stale state value; the observer must read the current override).
  const cardHeightRef = useRef<number | null>(cardHeight);
  cardHeightRef.current = cardHeight;
  // Mirrors for the window-resize observer (its closure is created once on
  // mount with [] deps, so it must read refs to see current values rather
  // than stale captures).
  const showSettingsRef = useRef<boolean>(showSettings);
  showSettingsRef.current = showSettings;
  const captureModalOpenRef = useRef<boolean>(captureModalOpen);
  captureModalOpenRef.current = captureModalOpen;
  // The card-height override applies ONLY to the plain price-card view. The
  // settings panel and the capture modal each render full-height content
  // with their own sizing, so the override must yield to them — otherwise
  // the card box stays locked to the dragged height while the window sizes
  // to the sub-panel's content, leaving an empty gap or clipping it.
  // 지도도 마찬가지 — 크기 슬라이더가 패널 크기를 정하므로 끌어 놓은 카드 높이에 갇히면 안 된다.
  const cardHeightOverrideForResize = (): number | null =>
    showSettingsRef.current || captureModalOpenRef.current || radarActiveRef.current
      ? null
      : cardHeightRef.current;
  // True while the bottom-right resize handle is being dragged. Keeps the
  // click-through poll from re-enabling pass-through when the cursor briefly
  // leaves the card rect mid-drag (the window would otherwise eat the drag).
  const resizingRef = useRef(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  // ── 지도(미니맵) — 게임 스크린샷을 찍으면 그 위치 기준으로 띄운다(Radar.tsx, radar.py)
  const [radarActive, setRadarActive] = useState(false);
  // 지도 자료 보내기(선택·기본 꺼짐) — 켰을 때만 하루 한 번쯤 스크린샷 좌표를 보낸다(MapShare.tsx·map_share.py)
  const [mapShareOn, setMapShareOn] = useState<boolean>(loadMapShareOn);
  useEffect(() => {
    try {
      localStorage.setItem(MAP_SHARE_KEY, mapShareOn ? "1" : "0");
    } catch {}
  }, [mapShareOn]);
  // 11-11 서버 닫힘(받기 멈춤) — null = 확인 중. 실행 때 한 번, 아직 안 물었거나 켜 둔 사람만 Cloudflare /status 를 본다(그 밖엔 부르지 않음)
  const [mapShareClosed, setMapShareClosed] = useState<boolean | null>(() => (!loadMapShareAsked() || loadMapShareOn() ? null : false));
  useEffect(() => {
    if (mapShareClosed !== null) return;
    let alive = true;
    fetchMapShareClosed().then((c) => alive && setMapShareClosed(c));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useMapShareAuto(mapShareOn, (closed, first) => {
    if (first) reportEvent("help", "mapshare:closed_seen"); // 11-11 통계: 닫힘 응답을 이 PC 가 처음 받음
    setMapShareClosed(closed);
  });
  // 앱을 켜면 카드 맨 위에서 한 번 묻기 — 답하면 다시 안 물음(설정 체크로 변경). 둘러보기 중엔 묻지 않는다. 서버가 닫혔으면 묻지 않음(다시 열리면 다시 물음)
  const [mapShareAsked, setMapShareAsked] = useState<boolean>(loadMapShareAsked);
  const answerMapShare = (yes: boolean) => {
    reportEvent("help", yes ? "mapshare:yes" : "mapshare:no"); // 11-10 통계: 동의 창 응답(싫어요 비율)
    setMapShareOn(yes);
    setMapShareAsked(true);
    try {
      localStorage.setItem(MAP_SHARE_ASKED_KEY, "1");
    } catch {}
  };
  const mapShareShownRef = useRef(false);
  useEffect(() => {
    // 11-10 통계: 동의 창이 실제로 뜬 횟수(실행당 한 번) — 응답(yes/no)과 함께 보면 무시·나중 응답 비율이 나온다
    if (mapShareAsked || tourStep != null || mapShareClosed !== false || mapShareShownRef.current) return;
    mapShareShownRef.current = true;
    reportEvent("help", "mapshare:shown");
  }, [mapShareAsked, tourStep, mapShareClosed]);
  const mapShareSkipRef = useRef(false);
  useEffect(() => {
    // 11-11 통계: 서버 닫힘이라 묻는 창을 띄우지 않음(실행당 한 번)
    if (mapShareAsked || mapShareClosed !== true || mapShareSkipRef.current) return;
    mapShareSkipRef.current = true;
    reportEvent("help", "mapshare:ask_skipped_closed");
  }, [mapShareAsked, mapShareClosed]);
  const radarActiveRef = useRef(false); // 창 크기 계산 클로저용(아래 cardHeightOverrideForResize)
  radarActiveRef.current = radarActive;
  const [radarData, setRadarData] = useState<RadarState | null>(null);
  const radarDataRef = useRef<RadarState | null>(null); // 폴링 클로저용(넓게 보기에서 아직 못 받았으면 다시 받기)
  radarDataRef.current = radarData;
  useEffect(() => {
    sendShotRef.current(false);
  }, [radarData?.shot?.id, radarData?.map?.id]);
  const [radarLoading, setRadarLoading] = useState(false);
  // ── 파티 방(친구 위치 공유, 11-05) — 스크린샷을 찍을 때마다 내 위치를 방으로(party.ts, ops/party-worker) ──
  const sendShotRef = useRef<(force: boolean) => void>(() => {});
  const party = useParty({ onCount: (k) => dailyAdd(k), onHello: () => sendShotRef.current(true) });
  const partyRef = useRef(party);
  partyRef.current = party;
  const partySentRef = useRef<string | null>(null); // 이미 보낸 스크린샷 id(같은 위치 두 번 안 보냄)
  sendShotRef.current = (force: boolean) => {
    const d = radarDataRef.current;
    const p = partyRef.current;
    if (!p.code || !d?.shot || !d.map) return;
    // 새 스크린샷은 2분 안의 것만(앱을 늦게 켠 옛 스크린샷 제외), 방에 막 들어왔을 땐 30분 안의 마지막 위치
    if (d.shot.age > (force ? 1800 : 120)) return;
    if (!force && partySentRef.current === d.shot.id) return;
    const yaw = d.shot.heading == null ? 0 : (d.shot.heading * Math.PI) / 180; // 방위(도) → 라디안
    if (p.sendPos(d.map.id, d.shot.x, d.shot.z, yaw, Date.now() - d.shot.age * 1000)) partySentRef.current = d.shot.id;
  };
  const [radarEnabled, setRadarEnabled] = useState<boolean>(() => localStorage.getItem(RADAR_ENABLED_KEY) !== "false");
  // 시세로 조회한 아이템이 열쇠면, 지금 맵에서 그 열쇠로 여는 문·트렁크(사이드카 /radar/keylocks) — 카드 한 줄 + 지도 강조
  type KeyLocks = { map: { id: string; name: string } | null; locks: { p: [number, number, number]; type: string; dist: number | null; rel: number | null; dy: number | null }[] };
  const [keyLocks, setKeyLocks] = useState<KeyLocks | null>(null);
  useEffect(() => {
    const id = status === "success" ? result?.item_id : null;
    if (!id || !radarEnabled) {
      setKeyLocks(null);
      return;
    }
    let dead = false;
    fetch(`${PYTHON_API}/radar/keylocks?item_id=${encodeURIComponent(id)}&lang=${encodeURIComponent(dataLang(region.lang))}&game_mode=${encodeURIComponent(region.gameMode)}`)
      .then((r) => (r.ok ? (r.json() as Promise<KeyLocks>) : null))
      .then((d) => {
        if (!dead) setKeyLocks(d && d.map && d.locks.length ? d : null);
      })
      .catch(() => {
        if (!dead) setKeyLocks(null);
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, result?.item_id, radarEnabled]);
  // 지도가 보는 스크린샷 폴더(사이드카가 기억; 자동 탐색 또는 사용자 지정)
  const [radarFolder, setRadarFolder] = useState<{ folder: string | null; source: "auto" | "manual"; auto: string | null; ok: boolean; prune_keep: number | null } | null>(null);
  const [radarFolderMsg, setRadarFolderMsg] = useState("");
  const [hotkeyPassthrough, setHotkeyPassthrough] = useState<boolean>(() => localStorage.getItem(HOTKEY_PASSTHROUGH_KEY) === "true");
  const hotkeyPassthroughRef = useRef(hotkeyPassthrough);
  hotkeyPassthroughRef.current = hotkeyPassthrough;
  const [radarShowScav, setRadarShowScav] = useState<boolean>(() => localStorage.getItem(RADAR_SCAV_KEY) === "true");
  // 지도 높이(px). 패널 슬라이더로 바꾸고, 열려 있는 동안 카드 폭을 여기에 맞춘다(Radar.tsx)
  const [radarSize, setRadarSize] = useState<number>(loadRadarSize);
  // 미니맵 모드(11-05 피드백): 카드 머리글·목록·칩 없이 정사각형 지도만 — 크기·지도 불투명도는 따로 저장
  const [radarMini, setRadarMini] = useState<boolean>(() => localStorage.getItem(RADAR_MINI_KEY) === "1");
  const [miniSize, setMiniSize] = useState<number>(loadMiniSize);
  const [mapAlpha, setMapAlpha] = useState<number>(loadMapAlpha);
  // 11-12 피드백 #61: 미니맵을 끌어 화면 모서리·가장자리 가까이 놓으면 자석처럼 붙는다(기본 켬, 설정에서 끄면 자유 이동)
  const [miniSnap, setMiniSnap] = useState<boolean>(() => localStorage.getItem(MINI_SNAP_KEY) !== "0");
  const miniSnapRef = useRef(miniSnap);
  miniSnapRef.current = miniSnap;
  const pickRadarMini = (v: boolean) => {
    dailyAdd(v ? "mmn" : "mmf"); // 11-10 통계: 미니 지도로 줄임·다시 펼침
    if (!v) miniReturnRef.current = false;
    setRadarMini(v);
    try {
      localStorage.setItem(RADAR_MINI_KEY, v ? "1" : "0");
    } catch {}
  };
  const pickMiniSize = (px: number) => {
    setMiniSize(px);
    try {
      localStorage.setItem(RADAR_MINI_SIZE_KEY, String(px));
    } catch {}
  };
  const pickMapAlpha = (v: number) => {
    setMapAlpha(v);
    try {
      localStorage.setItem(RADAR_MAP_ALPHA_KEY, String(v));
    } catch {}
  };
  const [wideMode, setWideMode] = useState<boolean>(() => localStorage.getItem(WIDE_KEY) === "1");
  const [wideMapSide, setWideMapSide] = useState<WideMapSide>(() => loadWideMapSide(localStorage));
  const wideModeRef = useRef(wideMode);
  wideModeRef.current = wideMode;
  // PiP(11-05 피드백 '진짜 아무것도 안 뜨고 미니맵만 게임 위에'): 미니맵일 때 창 자체를 지도 크기로 줄여 화면 오른쪽에.
  // 창은 평소 폭 800 고정(높이만 카드에 맞춤)이라 카드만 줄여서는 '창이 안 줄어든다'. F2 조회로 지도가 닫히면 저절로 풀리고
  // 원래 자리에 시세 카드가 뜬다(다음 스크린샷으로 지도가 다시 열리면 다시 PiP).
  // 11-06 사용자 결정: 미니맵 모드와 PiP 를 하나로 — 미니맵 모드를 켜면 늘 이 방식(창 = 지도 크기, 따로 둔 자리, 자동으로 안 숨김).
  // F2 조회 땐 원래 카드 자리·크기로 시세를 보여 주고, 카드 숨김 시간이 지나면 작은 지도로 돌아온다(miniReturnRef).
  const pipActive = radarMini && radarActive && !showSettings && !wideMode;
  const pipActiveRef = useRef(pipActive);
  pipActiveRef.current = pipActive;
  const pipPrevRef = useRef<{ x: number; y: number } | null>(null); // PiP 들어가기 전 창 위치(물리 px)
  const pipMoveArmedAtRef = useRef(0); // 이 시각 전의 창 이동은 PiP 가 옮긴 것 — 사용자 위치로 저장하지 않는다
  const radarMiniRef = useRef(radarMini);
  radarMiniRef.current = radarMini;
  // 미니맵(작은 지도)이 떠 있을 때 누른 F2 → 시세 카드를 다 보면(숨김 시간) 작은 지도로 돌아간다
  const miniReturnRef = useRef(false);
  useEffect(() => {
    if (pipActive) miniReturnRef.current = false; // 작은 지도로 돌아옴(또는 스크린샷으로 다시 열림)
  }, [pipActive]);
  const paneRef = useRef<HTMLDivElement>(null);
  const wideResizeRef = useRef<HTMLDivElement>(null);
  // 세로 모니터(높이 > 폭)에서 나란히 모드 = 카드 위·지도 아래 전체 폭·목록은 지도 밑(11-04 피드백 "세로 서브모니터에서 공간 활용이 아쉽다")
  const [portrait, setPortrait] = useState(false);
  const [sideH, setSideH] = useState(0); // 세로 배치에서 대상 목록에 주는 높이(px)
  const [paneSize, setPaneSize] = useState(400); // 오른쪽 지도 패널의 지도 높이(패널 높이에서 머리글·칩·안내 줄을 뺀 값)
  // 맵 수동 선택은 이번 실행 동안만(다음 레이드는 로그로 다시 감지)
  const radarMapRef = useRef<string | null>(null);
  const [radarStory, setRadarStory] = useState<string>(() => {
    try {
      return localStorage.getItem(RADAR_STORY_KEY) ?? "auto"; // 기본 = 로그 추정(자동)
    } catch {
      return "auto";
    }
  });
  const radarStoryRef = useRef<string>(radarStory);
  const radarLastShotRef = useRef<string | null | undefined>(undefined); // undefined = 아직 첫 확인 전
  const radarLoadingTsRef = useRef<number | null>(null); // 11-08 마지막으로 본 맵 로딩 시각(로그) — 바뀌면 새 레이드
  const radarPollBusyRef = useRef(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [autoCheckUpdate, setAutoCheckUpdate] = useState<boolean>(
    loadAutoCheckUpdate
  );
  const [autoInstallUpdate, setAutoInstallUpdate] = useState<boolean>(loadAutoInstallUpdate);
  // 4시간 주기 재확인 클로저가 현재 값을 읽도록 ref 로도 든다
  const autoInstallRef = useRef(loadAutoInstallUpdate());
  useEffect(() => {
    autoInstallRef.current = autoInstallUpdate;
  }, [autoInstallUpdate]);
  // 서버 공지의 min_version 보다 낮은 버전이면 차단 화면(11-03 최소 버전 레버)
  const [forcedMinVersion, setForcedMinVersion] = useState<string | null>(null);
  // update_check 텔레메트리 중복 방지 — 같은 결과는 세션에 한 번만
  const updateCheckReportedRef = useRef<string | null>(null);
  const updateBannerSeenRef = useRef<string | null>(null); // 11-11 banner_shown 은 버전당 세션 1번
  // 11-11 받아 둔 업데이트 표시: 이미 그 버전(이상)으로 켜졌으면 지운다 — 다음 실행 설치가 끝났거나 다른 길로 업데이트됨
  useEffect(() => {
    const v = readPendingUpdate();
    if (v && cmpVersion(APP_VERSION, v) >= 0) {
      try {
        localStorage.removeItem(UPDATE_PENDING_KEY);
      } catch {}
      log(`update: pending ${v} cleared — running ${APP_VERSION}`);
    }
  }, []);
  const [questStatus, setQuestStatus] = useState<QuestStatus | null>(null);
  const questCfgReportedRef = useRef(false);
  const [questPathInput, setQuestPathInput] = useState<string>("");
  const [questDisplayModeSetting, setQuestDisplayModeSetting] = useState<QuestModeSetting>(
    loadQuestDisplayMode
  );
  // 실제로 카드·배지가 쓰는 서버 — follow 면 게임 모드에서 파생
  const questDisplayMode: "pvp" | "pve" | "season" =
    questDisplayModeSetting === "follow" ? questModeOfGameMode(region.gameMode) : questDisplayModeSetting;
  // 와이프 리셋 대상(설정 › 퀘스트). 버튼 4개 나열 대신 선택 + 버튼 하나(11-02 설정 재편)
  const [wipeScope, setWipeScope] = useState<"pvp" | "pve" | "season" | "all">(() => questDisplayMode);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null);
  // 11-04 포터블은 스스로 업데이트되지 않아 배너가 유일한 통로다. 닫아도(메모리에만 기억 — 재시작하면 다시 뜸)
  // 트레이에 며칠씩 켜 두면 계속 숨어 있었다 → 포터블에 한해 닫은 지 5일이 지나면 다시 띄운다.
  const dismissedAtRef = useRef(0);
  const dismissUpdate = (version: string) => {
    dismissedAtRef.current = Date.now();
    setDismissedUpdate(version);
    reportEvent("update_apply", "banner_dismiss"); // 11-11 계측: 배너를 닫은 횟수
  };
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (!isPortableRef.current || !dismissedAtRef.current) return;
      if (Date.now() - dismissedAtRef.current < PORTABLE_RENAG_MS) return;
      dismissedAtRef.current = 0;
      setDismissedUpdate(null);
      log("update: portable banner re-shown (5 days since dismiss)");
      reportEvent("update_apply", "portable_renag");
    }, 60 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);
  const [updateChecking, setUpdateChecking] = useState<boolean>(false);
  const [updateCheckedAt, setUpdateCheckedAt] = useState<number | null>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>("idle");
  const [updateProgress, setUpdateProgress] = useState<number>(0);
  const [updateError, setUpdateError] = useState<string | null>(null);
  // Hold the Update handle returned by check() so the Install button can
  // call downloadAndInstall on the same object the user just saw. We keep
  // it in a ref (not state) because mutating it shouldn't trigger renders
  // and it's not part of the rendered UI.
  const pendingUpdateRef = useRef<Update | null>(null);
  // In-app feedback form (posts to the DB). Mutually exclusive with the
  // donate panel so the two don't stack.
  const [showFeedback, setShowFeedback] = useState(false);
  const [devReplies, setDevReplies] = useState<DevReply[]>([]);
  const ackDevReply = (n: number) => {
    try {
      const seen: number[] = JSON.parse(localStorage.getItem(REPLIES_SEEN_KEY) || "[]");
      localStorage.setItem(REPLIES_SEEN_KEY, JSON.stringify([...seen.filter((x) => x !== n), n].slice(-50)));
    } catch {}
    setDevReplies((rs) => rs.filter((r) => r.n !== n));
  };
  const [feedbackText, setFeedbackText] = useState("");
  // Attached screenshot as a compressed JPEG data URL (null = none).
  const [feedbackImage, setFeedbackImage] = useState<string | null>(null);
  // 1.3.1 사이드카에 지금 쓰는 (게임 언어, 모드)를 알린다 — 그 조합만 10분마다 시세 목록 갱신(예전 9개 전부).
  // 사이드카가 막 켜지는 중이면 2초 간격으로 몇 번 더 시도.
  const activeLang = getGameLang(region);
  useEffect(() => {
    let dead = false;
    (async () => {
      // 11-09 검토: 첫 실행은 OCR 모델 로딩+백신 검사로 시세 엔진이 1분 넘게 걸릴 수 있어 60초 상한이면 알림이 유실됐다 → 5분
      for (let i = 0; i < 150 && !dead; i++) {
        try {
          const r = await fetch(`${PYTHON_API}/catalog/active`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lang: activeLang, game_mode: region.gameMode }),
          });
          if (r.ok) return;
        } catch {}
        await new Promise((res) => setTimeout(res, 2000));
      }
    })();
    return () => {
      dead = true;
    };
  }, [activeLang, region.gameMode]);
  // 11-06 진단 정보 함께 보내기 — 11-07 인게임 메모: "기본으로 체크돼 있는 건 별로" → 기본 꺼짐, 마지막 선택 기억
  const [feedbackDiag, setFeedbackDiag] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FEEDBACK_DIAG_KEY) === "1";
    } catch {
      return false;
    }
  });
  // 진단 덩어리: 버전·설정·모니터·창·게임 화면 모드 + 최근 사건(diagLog). 남은 글자(room)에 맞춰 자른다
  const buildDiag = async (room: number): Promise<string> => {
    const head: string[] = [`앱 ${APP_VERSION} · ${navigator.userAgent.match(/Windows NT [\d.]+/)?.[0] ?? ""}`];
    try {
      head.push("설정 " + Object.entries(region).filter(([, v]) => typeof v !== "object").map(([k, v]) => `${k}=${v}`).join(",").slice(0, 700));
    } catch {}
    head.push(`단축키=${hotkey} 공유=${hotkeyPassthrough ? 1 : 0} 나란히=${wideMode ? 1 : 0} 미니맵=${radarMini ? 1 : 0} 지도열림=${radarActive ? 1 : 0}`);
    try {
      const mons = await availableMonitors();
      head.push("모니터 " + mons.map((m) => `${m.size.width}x${m.size.height}@${Math.round(m.scaleFactor * 100)}%(${m.position.x},${m.position.y})`).join(" "));
      const win = getCurrentWindow();
      const [p, z, sf] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()]);
      head.push(`창 ${z.width}x${z.height}@${Math.round(sf * 100)}%(${p.x},${p.y})`);
    } catch {}
    try {
      const ctl = new AbortController();
      const tm = window.setTimeout(() => ctl.abort(), 2000);
      const env = await (await fetch(`${PYTHON_API}/diag/env`, { signal: ctl.signal })).json();
      window.clearTimeout(tm);
      const d = env.eft_display;
      head.push(`OS ${env.os ?? "?"} · 게임 화면 ` + (d ? `mode=${d.fullscreen_mode}(0전체·1테두리없음·2최대화·3창) ${d.resolution?.Width}x${d.resolution?.Height} 모니터#${d.display}` : env.eft_display_error ?? "?"));
    } catch {
      head.push("게임 화면 설정: 사이드카 응답 없음");
    }
    return diagBlock(head, Math.max(200, room));
  };
  // "empty" = 내용 없이 보내기를 눌렀을 때(전송 실패와 다른 안내 — t.feedbackEmpty)
  const [feedbackStatus, setFeedbackStatus] = useState<
    "idle" | "sending" | "sent" | "error" | "empty"
  >("idle");
  const [showDonate, setShowDonate] = useState(false);
  // Default donate tab follows the user's UI language (Korean → KakaoPay first,
  // others → PayPal first). They can flip with the tabs.
  const [donateTab, setDonateTab] = useState<"kakao" | "paypal">(
    region.lang === "ko" ? "kakao" : "paypal"
  );
  const [donateCopied, setDonateCopied] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  // Lookup generation counter + in-flight flag. The counter lets a late
  // response (e.g. the 1.5s network retry losing a race against a newer F2
  // press) detect it's stale and skip setResult/setHistory — without it the
  // retry could overwrite a fresher result. The flag keeps auto-hide from
  // firing mid-lookup (a settings-close used to schedule a hide DURING a
  // slow OCR fetch and the result arrived on a hidden card).
  const lookupSeqRef = useRef(0);
  const lookupInFlightRef = useRef(false);
  // Abort handle of the lookup in flight. A new press ABORTS the old request
  // (not just ignores its result): without this, spamming F2 stacked real
  // concurrent OCR passes in the sidecar's threadpool — measured 383ms →
  // 1078ms per pass at 4-way concurrency, exactly when the user is in-game
  // and CPU-sensitive. The seq token still guards against stragglers.
  const lookupAbortRef = useRef<AbortController | null>(null);
  // Set when Rust gives up restarting the sidecar (budget exhausted). From
  // then on "auto-recovering, try again" would be a LIE — connection errors
  // switch to an honest "restart the app" instruction instead.
  const sidecarDeadRef = useRef(false);
  // 11-08 통계 후속: 사이드카 실행 파일이 없음(백신 격리 추정) — 다시 실행해도 소용없으니 복원·예외·재설치 안내
  const sidecarMissingRef = useRef(false);
  const connFailRef = useRef(0); // 연결 실패 연속 횟수(조회 성공하면 0)
  useEffect(() => {
    const un = listen<string>("sidecar-dead", (e) => {
      log("React: sidecar-dead received — restart budget exhausted");
      sidecarDeadRef.current = true;
      // 이유(spawn failed: … / unexpected exit code=…)를 짧은 태그로. 경로·개인정보 없음.
      const why = String(e.payload ?? "").toLowerCase().replace(/[^a-z0-9_:=\-]+/g, "_").slice(0, 50);
      reportEvent("sidecar_fail", `dead:${why || "unknown"}`);
    });
    const onMissing = async () => {
      if (sidecarMissingRef.current) return;
      log("React: sidecar-missing — tarkov-server.exe not found (AV quarantine?)");
      sidecarMissingRef.current = true;
      // F2 를 기다리지 않고 바로 카드로 알린다
      try {
        if (!(await getCurrentWindow().isVisible())) await invoke("show_overlay_passive");
      } catch {}
      showCard();
      setShowSettings(false);
      setRadarActive(false);
      setError(T[loadRegion().lang].sidecarMissing);
      setStatus("error");
    };
    const unMissing = listen("sidecar-missing", () => void onMissing());
    const unRestart = listen("sidecar-restart", () => dailyAdd("sr")); // 11-09 조용한 재시작 횟수(하루 요약 sr)
    // 사이드카는 웹뷰가 듣기 전에 띄우므로 첫 실패 이벤트는 지나간다 → 뜰 때 한 번, 잠시 뒤 한 번 더 묻는다
    const ask = () =>
      invoke<boolean>("sidecar_missing_state")
        .then((m) => {
          if (m) void onMissing();
        })
        .catch(() => {});
    ask();
    const again = window.setTimeout(ask, 3000);
    return () => {
      un.then((fn) => fn());
      unMissing.then((fn) => fn());
      unRestart.then((fn) => fn());
      window.clearTimeout(again);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hideDelayRef = useRef(region.hideDelaySec);
  useEffect(() => {
    hideDelayRef.current = region.hideDelaySec;
  }, [region.hideDelaySec]);

  /** 설정 패널이 지금 가질 수 있는 최대 높이(px) = 창이 커질 수 있는 한계(화면 아래 여백까지) − 오버레이 여백 −
   *  패널을 뺀 카드 내용(헤더·배너·카드 안쪽 여백). 이 값 이하면 카드는 스크롤되지 않고 패널만 스크롤된다.
   *  나란히 모드는 창이 모니터 크기로 고정이라 창 높이 자체가 한계. */
  const settingsMaxH = (): number => {
    const el = settingsRef.current;
    const cardEl = cardRef.current;
    if (!el || !cardEl) return 2000;
    const others = cardEl.scrollHeight + (cardEl.offsetHeight - cardEl.clientHeight) - el.offsetHeight; // 카드 테두리 포함
    const limit = wideModeRef.current ? window.innerHeight : maxWinHRef.current;
    return Math.max(200, Math.min(2000, Math.floor(limit - WIN_VPAD - others)));
  };
  // Settings panel: restore user's last-chosen height from localStorage
  // (CSS `resize: vertical`). Effect runs whenever the panel mounts (i.e.
  // every time showSettings flips to true). A ResizeObserver writes the
  // height back to storage on each drag — and ALSO triggers the card's
  // window-resize logic, because the card's own ResizeObserver doesn't
  // fire when an inner element's height changes via inline style (the
  // card's box stays capped at max-height, so its observed box never
  // changes, but the natural content grew).
  useEffect(() => {
    if (!showSettings) return;
    const el = settingsRef.current;
    const cardEl = cardRef.current;
    if (!el || !cardEl) return;
    // 저장된 높이는 '원하는 높이'일 뿐 — 지금 화면에 들어가는 높이로 잘라 넣는다. 넓은 모니터·나란히 모드에서
    // 키워 둔 값(예: 1,600px)을 작은 창에서 그대로 쓰면 카드도 스크롤되고 패널도 스크롤돼 막대가 둘 보였다(11-02 제보)
    const stored = localStorage.getItem(SETTINGS_HEIGHT_KEY);
    const n = stored ? parseInt(stored) : NaN;
    const want = !isNaN(n) && n >= 200 && n <= 2000 ? n : el.offsetHeight;
    el.style.height = `${Math.min(want, settingsMaxH())}px`;
    const ro = new ResizeObserver(() => {
      // 높이 저장은 사용자가 손잡이를 끌었을 때(onResizeHandleDown 의 onUp)만 — 여기서 저장하면 화면에 맞춰
      // 잘린 값이 '원하는 높이'를 덮어써 큰 화면으로 돌아가도 작은 패널로 남는다
      // 지도 나란히 모드: 창은 모니터 크기 그대로(여기서 800×내용 높이로 되돌리면 패널이 카드를 눌러 버린다)
      if (wideModeRef.current) return;
      // 카드 크기 맞춤과 같은 함수로(11-07 2차: 여기서 따로 LogicalSize 로 setSize 하던 것이 카드 쪽 apply 와 다른 값을 넣어
      // 125% 에서 732↔734 무한 왕복 — 1px 넘침 → 카드 스크롤 막대 → 패널 폭 변화 → 이 감시 → 다른 높이 요청)
      applySizeRef.current?.();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [showSettings]);

  // Esc closes the capture-region modal. Doesn't interfere with hotkey
  // recording (that uses key recording handlers attached only while
  // recordingTarget != null) or other modals.
  useEffect(() => {
    if (!captureModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setCaptureModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [captureModalOpen]);

  // First-launch: scale capture-region defaults to the primary monitor.
  // 1080p users get the original defaults (scale=1.0). QHD/4K users get
  // proportionally larger boxes so the inventory hover tooltip lands
  // inside the capture area. No-op on subsequent launches.
  useEffect(() => {
    let cancelled = false;
    applyMonitorScaling(false).then((r) => {
      if (r && !cancelled) setRegion(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Anonymous launch ping. Opt-out: fires by default, suppressed only if the
  // user previously turned stats off. reportEvent rechecks at call-time, so
  // toggling off mid-session also stops future pings.
  useEffect(() => {
    // Resolve the machine-wide install id FIRST so a reinstalled PC reports its
    // original id instead of a fresh localStorage one (see initInstallId).
    void (async () => {
      await initInstallId();
      reportEvent("launch");
      // Hotkey binding at session start (default / custom_key / custom_mouse).
      // Read straight from storage so it reflects the persisted choice, not a
      // mid-session edit. Lets the dashboard split the "never looked up" cohort
      // into "rebound the key" vs. a true activation gap.
      reportEvent("hotkey", hotkeyKind(loadHotkey()));
      // 11-03 화면 해상도·배율(물리 픽셀): 빈 캡처·오독 실패가 특정 환경에 몰리는지 보기 위해
      try {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round((window.screen?.width ?? 0) * dpr);
        const h = Math.round((window.screen?.height ?? 0) * dpr);
        if (w > 0 && h > 0) reportEvent("display", `${w}x${h}@${Math.round(dpr * 100)}`);
      } catch {}
      // 11-03 설정 한 줄: 언어·게임 언어·모드·지도·나란히·단축키·키 공유·자동 숨김·퀘스트 표시(≤64자)
      try {
        const r = loadRegion();
        reportEvent(
          "config",
          [
            `l=${r.lang}`,
            `g=${r.gameLang ?? "-"}`,
            `m=${r.gameMode}`,
            `map=${localStorage.getItem(RADAR_ENABLED_KEY) !== "false" ? 1 : 0}`,
            `w=${localStorage.getItem(WIDE_KEY) === "1" ? 1 : 0}`,
            `hk=${hotkeyKind(loadHotkey())}`,
            `s=${localStorage.getItem(HOTKEY_PASSTHROUGH_KEY) === "true" ? 1 : 0}`,
            `ah=${r.autoHide ? 1 : 0}`,
            `q=${r.showQuests ? 1 : 0}`,
          ].join(";").slice(0, 64)
        );
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-shot check on mount: is this exe the portable distribution?
  // Cached for the session — the marker file doesn't move while the app
  // runs. Result drives the update-banner UI (Install vs Open page).
  useEffect(() => {
    invoke<boolean>("is_portable_install")
      .then((v) => {
        setIsPortable(v);
        isPortableRef.current = v;
        log(`portable: ${v}`);
        reportEvent("install_mode", v ? "portable" : "installer");
        if (v) {
          invoke<string | null>("find_installed_copy")
            .then((p) => {
              if (p) {
                log(`portable: installed copy found — ${p}`);
                setInstalledCopy(p);
              }
            })
            .catch(() => {});
        } else {
          // 설치판 첫 실행: 포터블에서 전환해 왔는지(표시 파일은 Rust 가 읽고 바로 지운다 — 한 번만)
          invoke<{ portable_dir?: string; from_version?: string; start_menu_shortcut?: boolean; desktop_shortcut?: boolean } | null>(
            "take_portable_switch"
          )
            .then((m) => {
              if (!m) return;
              log(
                `portable switch: from v${m.from_version ?? "?"} (${m.portable_dir ?? "?"}) — shortcuts start_menu=${m.start_menu_shortcut} desktop=${m.desktop_shortcut}`
              );
              reportEvent("update_apply", m.start_menu_shortcut ? "portable_switched" : "portable_switched_nolnk");
              if (m.portable_dir) {
                try {
                  localStorage.setItem(PORTABLE_SWITCHED_KEY, m.portable_dir);
                } catch {}
                setSwitchedFrom(m.portable_dir);
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  // Fetch the server-driven announcement on launch. Show it at most once per
  // local day, and again whenever the content (id = updated_at) changes —
  // even same day. Marking it seen the moment we decide to show it means a
  // same-day relaunch won't repeat it. Silent on any failure.
  useEffect(() => {
    fetch(ANNOUNCEMENT_ENDPOINT)
      .then((r) => r.json())
      .then((a) => {
        if (!a) return;
        // 11-03 최소 버전 레버: 공지가 꺼져 있어도 min_version 은 내려온다.
        if (typeof a.min_version === "string" && /^\d+(\.\d+)*$/.test(a.min_version)
            && cmpVersion(APP_VERSION, a.min_version) < 0) {
          setForcedMinVersion(a.min_version);
          log(`update: forced — ${APP_VERSION} < min ${a.min_version}`);
          reportEvent("update_apply", `blocked:${a.min_version.slice(0, 16)}`);
        }
        // 11-08 개인 답장은 공지가 꺼져 있어도 온다
        if (a.replies) {
          openDevReplies(a.replies)
            .then((rs) => {
              if (rs.length) {
                setDevReplies(rs);
                log(`reply: ${rs.length} new`);
              }
            })
            .catch(() => {});
        }
        if (!a.active || (!a.ko && !a.en && !a.ru && !a.zh)) return;
        const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
        let seen: { id?: number; date?: string } = {};
        try {
          seen = JSON.parse(localStorage.getItem(ANNOUNCE_SEEN_KEY) || "{}");
        } catch {}
        if (seen.id === a.id && seen.date === today) return; // already shown today
        localStorage.setItem(
          ANNOUNCE_SEEN_KEY,
          JSON.stringify({ id: a.id, date: today })
        );
        setRemoteAnnounce({ id: a.id, ko: a.ko ?? "", en: a.en ?? "", ru: a.ru ?? "", zh: a.zh ?? "" });
      })
      .catch(() => {});
  }, []);

  // Live capture-region preview: while the user is editing offsets, two
  // small transparent windows (red = primary, yellow = ground) show on the
  // screen so it's visually obvious where each capture box will land.
  //
  // Two anchor modes (see PREVIEW_ANCHOR_KEY):
  //   "center" (default) — rectangles pin to the primary monitor center,
  //     regardless of cursor movement. Lets the user freely move the mouse
  //     to reach sliders or look at game UI without the preview jumping.
  //   "cursor" (legacy) — rectangles track the cursor when it's over the
  //     game, freezing only when the cursor enters the card. Useful for
  //     aligning against a real inventory hover.
  const previewRefRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    // Hide if settings closed, modal not open, OR the card itself is
    // invisible (auto-hide). Otherwise the rectangles linger on screen
    // with no UI to dismiss them. Modal open is the new gate — the old
    // inline `showCaptureRegion` toggle is no longer the trigger.
    if (!showSettings || !captureModalOpen || !cardVisible) {
      previewRefRef.current = null;
      invoke("hide_preview_rect", { label: "preview-primary" }).catch(() => {});
      invoke("hide_preview_rect", { label: "preview-ground" }).catch(() => {});
      invoke("hide_preview_rect", { label: "preview-anchor" }).catch(() => {});
      return;
    }
    let cancelled = false;
    // Crosshair marker dimension — must match the preview-anchor window
    // declared in tauri.conf.json. Centered on the reference point so the
    // dot in its middle sits exactly at the simulated cursor pixel.
    const ANCHOR_SIZE = 24;
    // Anchor-center path: pin the reference to the primary monitor center
    // once and show the rectangles + the crosshair marker. No polling
    // needed — re-positions only when slider values change via deps.
    if (previewAnchorMode === "center") {
      (async () => {
        try {
          const mon = await primaryMonitor();
          if (cancelled || !mon) return;
          const ref = {
            x: mon.position.x + Math.floor(mon.size.width / 2),
            y: mon.position.y + Math.floor(mon.size.height / 2),
          };
          previewRefRef.current = ref;
          await invoke("show_preview_rect", {
            label: "preview-anchor",
            x: ref.x - Math.floor(ANCHOR_SIZE / 2),
            y: ref.y - Math.floor(ANCHOR_SIZE / 2),
            width: ANCHOR_SIZE,
            height: ANCHOR_SIZE,
          });
          await invoke("show_preview_rect", {
            label: "preview-primary",
            x: ref.x + region.offsetX,
            y: ref.y + region.offsetY,
            width: region.width,
            height: region.height,
          });
          await invoke("show_preview_rect", {
            label: "preview-ground",
            x: ref.x + region.groundOffsetX,
            y: ref.y + region.groundOffsetY,
            width: region.groundWidth,
            height: region.groundHeight,
          });
        } catch {}
      })();
      return () => {
        cancelled = true;
        invoke("hide_preview_rect", { label: "preview-primary" }).catch(() => {});
        invoke("hide_preview_rect", { label: "preview-ground" }).catch(() => {});
        invoke("hide_preview_rect", { label: "preview-anchor" }).catch(() => {});
      };
    }
    // Anchor-cursor path: keep the legacy poll loop.
    const tick = async () => {
      try {
        // Defensive: bail out if the main overlay was hidden (X button,
        // Alt+F4, tray Exit, etc.) while polling is still active. The
        // useEffect cleanup also handles this, but state updates can
        // race with mid-flight invokes — checking here guarantees we
        // never call show_preview_rect after the windows were hidden
        // natively.
        const win = getCurrentWindow();
        const visible = await win.isVisible();
        if (cancelled || !visible) {
          invoke("hide_preview_rect", { label: "preview-primary" }).catch(() => {});
          invoke("hide_preview_rect", { label: "preview-ground" }).catch(() => {});
          return;
        }
        const pos = await invoke<{ x: number; y: number }>(
          "get_cursor_position"
        );
        if (cancelled) return;
        // Check whether the cursor is over the visible CARD specifically,
        // not the whole 800×600 overlay window. The window is mostly
        // transparent / click-through; using its bounds treats invisible
        // empty area as "inside overlay" and freezes the preview when the
        // user is actually pointing at the game. Use the card element's
        // bounding rect translated to screen coordinates, accounting for
        // DPI (getBoundingClientRect is in CSS px, cursor pos is in
        // physical px).
        const wp = await win.outerPosition();
        const cardEl = cardRef.current;
        let inside = false;
        if (cardEl) {
          const rect = cardEl.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const cx = wp.x + Math.floor(rect.left * dpr);
          const cy = wp.y + Math.floor(rect.top * dpr);
          const cw = Math.ceil(rect.width * dpr);
          const ch = Math.ceil(rect.height * dpr);
          inside =
            pos.x >= cx && pos.x < cx + cw &&
            pos.y >= cy && pos.y < cy + ch;
        }
        if (!inside) {
          previewRefRef.current = pos;
        }
        // First-tick fallback: if the user just clicked "Edit" their cursor
        // is on the overlay itself, so `pos` is over our own UI and the
        // boxes would render behind the settings panel — invisible. Use
        // the primary monitor's center as a discoverable initial location
        // until the user moves the cursor to the game.
        let ref = previewRefRef.current;
        if (!ref) {
          if (inside) {
            try {
              const mon = await primaryMonitor();
              if (mon) {
                ref = {
                  x: Math.floor(mon.size.width / 2),
                  y: Math.floor(mon.size.height / 2),
                };
              }
            } catch {}
          }
          ref = ref ?? pos;
        }
        if (cancelled) return;
        await invoke("show_preview_rect", {
          label: "preview-anchor",
          x: ref.x - Math.floor(ANCHOR_SIZE / 2),
          y: ref.y - Math.floor(ANCHOR_SIZE / 2),
          width: ANCHOR_SIZE,
          height: ANCHOR_SIZE,
        });
        await invoke("show_preview_rect", {
          label: "preview-primary",
          x: ref.x + region.offsetX,
          y: ref.y + region.offsetY,
          width: region.width,
          height: region.height,
        });
        await invoke("show_preview_rect", {
          label: "preview-ground",
          x: ref.x + region.groundOffsetX,
          y: ref.y + region.groundOffsetY,
          width: region.groundWidth,
          height: region.groundHeight,
        });
      } catch {}
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      invoke("hide_preview_rect", { label: "preview-primary" }).catch(() => {});
      invoke("hide_preview_rect", { label: "preview-ground" }).catch(() => {});
      invoke("hide_preview_rect", { label: "preview-anchor" }).catch(() => {});
    };
  }, [
    showSettings,
    captureModalOpen,
    previewAnchorMode,
    cardVisible,
    region.offsetX,
    region.offsetY,
    region.width,
    region.height,
    region.groundOffsetX,
    region.groundOffsetY,
    region.groundWidth,
    region.groundHeight,
  ]);

  const cardRef = useRef<HTMLDivElement | null>(null);
  // Window-height ceiling for the card's current on-screen position, and a
  // handle to the resize-recompute fn so the move listener can refresh it when
  // the window is dragged (see the window-resize effect + id20 fix).
  const maxWinHRef = useRef<number>(screenMaxH());
  const applyRef = useRef<(() => void) | null>(null);
  // 11-07 창 높이 맞춤 함수(apply) 자체 — 설정 패널 쪽도 같은 규칙(3px 여유·실제 픽셀 올림)을 쓰게. 따로 setSize 하면 두 경로가 732/733/916px 로 싸웠다
  const applySizeRef = useRef<(() => void) | null>(null);
  // 11-09 창을 옮기는 중·배율이 바뀌는 중(마지막 이벤트 뒤 0.2초까지)엔 창 크기를 맞추지 않는다 — 아래 move/배율 감시가 켜고 끈다
  const windowSettlingRef = useRef(false);
  // 11-09 배율이 다른 두 모니터에 걸친 창: 폭 800(논리)을 맞추면 덮는 넓이가 뒤집혀 배율이 또 바뀌는 무한 왕복 → 감지하면 멈춤(옮기면 풀림)
  const dprFlipsRef = useRef<number[]>([]);
  const lastDprRef = useRef<number>(window.devicePixelRatio || 1);
  const dprHoldRef = useRef<{ x: number; y: number } | null>(null);
  // Mirrors showSettings into a ref so scheduleHide can check the latest
  // value without re-creating the callback on every render. While settings
  // is open the user is actively interacting with controls (sliders,
  // toggles) and auto-hide would yank the panel + capture-region preview
  // boxes out from under them.
  const settingsOpenRef = useRef(false);
  // Tracks whether the cursor is currently inside the card rect, so we
  // can decide whether to schedule auto-hide when settings closes. If
  // the cursor is still on the card, the existing mouseleave handler
  // will take over the moment it leaves; scheduling here would only
  // wrongly hide while the user is still hovering.
  const mouseOverCardRef = useRef(false);
  const [hoverDodge, setHoverDodge] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HOVER_DODGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const hoverDodgeRef = useRef(hoverDodge);
  hoverDodgeRef.current = hoverDodge;
  useEffect(() => {
    try {
      localStorage.setItem(HOVER_DODGE_KEY, hoverDodge ? "1" : "0");
    } catch {}
  }, [hoverDodge]);
  const [hoverDodgeMod, setHoverDodgeMod] = useState<string>(() => {
    try {
      const v = localStorage.getItem(HOVER_DODGE_MOD_KEY) || "ctrl";
      return v in DODGE_MOD_BIT ? v : "ctrl";
    } catch {
      return "ctrl";
    }
  });
  const hoverDodgeModRef = useRef(hoverDodgeMod);
  hoverDodgeModRef.current = hoverDodgeMod;
  useEffect(() => {
    try {
      localStorage.setItem(HOVER_DODGE_MOD_KEY, hoverDodgeMod);
    } catch {}
  }, [hoverDodgeMod]);
  const modsRef = useRef(0); // 마지막 커서 폴링 때 누르고 있던 수정 키(Ctrl 1 · Shift 2 · Alt 4)
  const [dodging, setDodging] = useState(false);
  const dodgingRef = useRef(false);
  const fgKindRef = useRef(""); // 앞 창 종류(game·overlay·other·none) — 진단 기록용 0.7초 폴링이 채운다
  const holdRef = useRef<HoldState>(HOLD_START); // 카드 위에서 누른 채 끄는 중인가(cursorHold.ts)
  // 커서가 지금 카드(지도 나란히 패널 포함) 위인가 — 물리 px 로 비교. 클릭 투과 폴링과 숨김 직전 확인이 같이 쓴다.
  // CSS→물리 변환은 창의 scaleFactor(카드가 실제로 있는 모니터 배율)로 한다 — devicePixelRatio 는 모니터를 옮기면
  // 늦게 바뀌거나 주 모니터 값을 돌려줘 카드 위 커서를 '밖'으로 읽었다(id20). EDGE_PAD 는 125% 같은 분수 배율에서
  // 테두리에 걸친 커서가 안/밖을 오가지 않게 하는 여유. 카드가 없거나 크기가 0 이면 false.
  // 11-08: 클릭 투과 폴링(40ms)용 창 위치·배율 캐시 — 매 틱 IPC 2번을 줄인다. 창이 움직이거나 배율이 바뀌면 비워서 바로 새로 읽고,
  // 그 밖엔 1초마다 새로. 숨김 직전 확인(armHide)은 캐시를 안 쓴다.
  const winGeomRef = useRef<{ x: number; y: number; sf: number; at: number } | null>(null);
  const cursorOverCard = async (cached = false): Promise<boolean> => {
    const cardEl = cardRef.current;
    if (!cardEl) return false;
    const rect = cardEl.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return false;
    const paneRect = paneRef.current?.getBoundingClientRect() ?? null; // 지도 나란히 패널도 클릭을 받아야 한다
    const resizeRect = wideResizeRef.current?.getBoundingClientRect() ?? null;
    const g = winGeomRef.current;
    let winPos: { x: number; y: number };
    let winScale: number;
    if (cached && g && performance.now() - g.at < 1000) {
      winPos = g;
      winScale = g.sf;
    } else {
      const win = getCurrentWindow();
      const [p, sc] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
      winPos = p;
      winScale = sc;
      winGeomRef.current = { x: p.x, y: p.y, sf: sc, at: performance.now() };
    }
    const cursor = await invoke<{ x: number; y: number; left?: boolean; mods?: number }>("get_cursor_position");
    modsRef.current = cursor.mods ?? 0;
    const dpr = winScale || window.devicePixelRatio || 1;
    const EDGE_PAD = 6;
    const hit = (r: DOMRect) =>
      cursor.x >= winPos.x + Math.floor(r.left * dpr) - EDGE_PAD &&
      cursor.x < winPos.x + Math.ceil((r.left + r.width) * dpr) + EDGE_PAD &&
      cursor.y >= winPos.y + Math.floor(r.top * dpr) - EDGE_PAD &&
      cursor.y < winPos.y + Math.ceil((r.top + r.height) * dpr) + EDGE_PAD;
    const over = hit(rect) ||
      (!!paneRect && paneRect.width > 0 && hit(paneRect)) ||
      (!!resizeRect && resizeRect.width > 0 && hit(resizeRect));
    // 카드 위에서 누른 채 끄는 중이면 판정이 잠깐 '밖'으로 흔들려도 카드 위로 본다(11-05 모니터 넘겨 끌 때 창이 사라지던 것)
    holdRef.current = holdStep(holdRef.current, over, !!cursor.left);
    return holdRef.current.over;
  };
  useEffect(() => {
    const wasOpen = settingsOpenRef.current;
    settingsOpenRef.current = showSettings;
    if (showSettings) {
      cancelHideTimer();
    } else if (wasOpen && !mouseOverCardRef.current) {
      // Settings just closed AND the cursor isn't hovering the card —
      // restart the auto-hide timer so the card eventually fades.
      // Otherwise it would stay visible forever after a settings close
      // until the user moves the mouse over and off the card.
      scheduleHide();
    }
  }, [showSettings]);
  const cancelHideTimer = () => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };
  // Master auto-hide switch, mirrored into a ref for the stable callbacks.
  // Turning it off mid-countdown also cancels the pending timer.
  const autoHideRef = useRef(region.autoHide);
  useEffect(() => {
    autoHideRef.current = region.autoHide;
    if (!region.autoHide) cancelHideTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region.autoHide]);
  const scheduleHide = () => {
    cancelHideTimer();
    // Auto-hide disabled: the card stays until hidden explicitly. (작은 지도로 돌아가기는 자동 숨김이 꺼져 있어도 같은 시간 뒤에)
    if (!autoHideRef.current && !miniReturnRef.current) return;
    // 지도 나란히 모드 = 모니터 하나를 통째로 쓰는 상태라 숨기지 않는다
    if (wideModeRef.current) return;
    if (pipActiveRef.current) return; // 미니맵(작은 지도)은 계속 떠 있어야 한다
    // Don't auto-hide while settings is open — the user is mid-interaction.
    if (settingsOpenRef.current) return;
    if (tourStepRef.current !== null) return; // 11-08 둘러보기를 읽는 중(처음 사용자) — 카드가 사라지면 안 된다
    // Cursor parked on the card keeps it alive. Without this, any
    // scheduleHide fired while the user is ALREADY hovering (lookup
    // finally, tray-show, hotkey-recording end) starts a countdown that
    // nothing cancels — the poll/DOM enter handlers only cancel on an
    // enter *transition*, which already happened — so the card vanished
    // under the cursor. mouseleave/the poll restart the countdown when
    // the cursor actually leaves.
    if (mouseOverCardRef.current) return;
    // Don't start the countdown while a lookup is still in flight — the
    // result would land on an already-hidden card (the lookup's own finally
    // schedules the hide once it completes).
    if (lookupInFlightRef.current) return;
    armHide(Math.max(1, hideDelayRef.current) * 1000);
  };
  scheduleHideRef.current = scheduleHide;
  // 숨김 타이머. 숨기기 **직전에 커서를 직접 다시 본다** — 커서가 카드(·나란히 패널) 위면 숨기지 않고 같은 간격으로
  // 다시 잰다. 2026-11-04 제보 'Shift+F2 로 숨겼다 띄운 뒤 마우스를 올리면 카드가 사라짐': 실제 앱에서 토글로 띄울 때
  // 걸린 타이머를 커서 폴링이 끝내 취소하지 못하고 커서 아래에서 카드가 사라지는 것을 재현했다(폴링의 진입 판정이
  // 놓친 정확한 경로는 못 박지 못함). 어느 경로로 타이머가 남든 '커서 아래에서 사라짐'은 여기서 막는다.
  const armHide = (ms: number) => {
    const handle = window.setTimeout(async () => {
      let on = false;
      try {
        on = await cursorOverCard();
      } catch {}
      if (hideTimerRef.current !== handle) return; // 그 사이 취소되거나 새 타이머로 바뀜
      if ((!autoHideRef.current && !miniReturnRef.current) || wideModeRef.current || settingsOpenRef.current || lookupInFlightRef.current || tourStepRef.current !== null) {
        hideTimerRef.current = null; // 그 사이 숨기면 안 되는 상태가 됨 — 각자 끝날 때 다시 건다
        return;
      }
      if (on) {
        armHide(ms); // 커서가 카드 위 — 떠난 뒤에 숨긴다
        return;
      }
      hideTimerRef.current = null;
      if (miniReturnRef.current && radarMiniRef.current) {
        diag("mini:return");
        // 시세 카드를 다 봄 → 숨기는 대신 작은 지도로(원래 자리에서 따로 둔 지도 자리로 창이 옮겨 간다)
        miniReturnRef.current = false;
        setRadarActive(true);
        void loadRadar();
        return;
      }
      diag("hide:timer");
      setCardVisible(false);
    }, ms);
    hideTimerRef.current = handle;
  };
  const showCard = () => {
    cancelHideTimer();
    setCardVisible(true);
  };

  // ── 지도 ───────────────────────────────────────────────────────────
  const radarUrl = (full: boolean) => {
    const q = new URLSearchParams({ lang: dataLang(region.lang), game_mode: region.gameMode, glang: getGameLang(region) }); // glang = 탈출구 목록 OCR 언어(11-09)
    if (full) q.set("full", "true");
    if (radarMapRef.current) q.set("map", radarMapRef.current);
    if (radarStoryRef.current) q.set("story", radarStoryRef.current);
    return `${PYTHON_API}/radar?${q.toString()}`;
  };
  // 스크린샷 폴더 설정(사이드카에 저장) — 설정 패널을 열 때 읽고, 선택/초기화 때 보낸다
  const loadRadarFolder = async () => {
    try {
      const res = await fetch(`${PYTHON_API}/radar/folder`);
      if (res.ok) setRadarFolder(await res.json());
    } catch {}
  };
  const setRadarFolderPath = async (path: string) => {
    setRadarFolderMsg("");
    try {
      const res = await fetch(`${PYTHON_API}/radar/folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setRadarFolderMsg(t.radarFolderInvalid + (d?.detail ? ` (${d.detail})` : ""));
        return;
      }
      setRadarFolder(await res.json());
      radarLastShotRef.current = undefined; // 새 폴더의 옛 스크린샷으로 지도가 튀지 않게 기준 다시 잡기
      log(`radar: folder set to "${path || "(auto)"}"`);
    } catch (e) {
      setRadarFolderMsg(t.radarFolderInvalid);
      log(`radar: folder set failed ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const setRadarPrune = async (keep: number) => {
    try {
      const res = await fetch(`${PYTHON_API}/radar/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep }),
      });
      if (res.ok) {
        const d = (await res.json()) as { prune_keep: number | null };
        setRadarFolder((f) => (f ? { ...f, prune_keep: d.prune_keep } : f));
        log(`radar: prune keep = ${d.prune_keep ?? "off"}`);
      }
    } catch (e) {
      log(`radar: prune set failed ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const pickRadarFolder = async () => {
    try {
      const picked = await openFolderDialog({ directory: true, multiple: false, defaultPath: radarFolder?.folder ?? undefined, title: t.radarFolderPick });
      if (typeof picked === "string" && picked) await setRadarFolderPath(picked);
    } catch (e) {
      log(`radar: folder dialog failed ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  useEffect(() => {
    if (showSettings) void loadRadarFolder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);
  const loadRadar = async () => {
    setRadarLoading(true);
    try {
      const res = await fetch(radarUrl(true));
      if (res.ok) setRadarData((await res.json()) as RadarState);
    } catch (e) {
      log(`radar: load failed ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRadarLoading(false);
    }
  };
  // 카드 위에 지도를 띄운다 — F2 카드와 같은 방식(포커스 안 뺏기, 자동 숨김)
  // report=false: 같은 키 + 못 읽음으로 여는 경우 — 그 누름의 스크린샷이 감지될 때 radar_shot 이 한 번 따로 집계되므로 중복 보고하지 않는다
  const openRadar = async (fromScreenshot: boolean, report = true) => {
    try {
      const win = getCurrentWindow();
      if (!(await win.isVisible())) await invoke("show_overlay_passive");
    } catch {}
    showCard();
    setShowSettings(false);
    setHistoryVisible(false);
    setRadarActive(true);
    if (report) reportEvent(fromScreenshot ? "radar_shot" : "radar_open");
    await loadRadar();
    if (fromScreenshot) scheduleHide();
  };
  // F2 리스너는 한 번만 등록되는 클로저라, 같은 키 + 못 읽음일 때 지도를 여는 건 최신 openRadar 를 ref 로 부른다
  const openRadarRef = useRef(openRadar);
  openRadarRef.current = openRadar;
  // 둘러보기 단계 바뀜 → 그 단계에 필요한 화면(지도·나란히)을 열고, 짚을 요소를 찾아 반짝임(늦게 그려지면 3초까지 다시)
  useEffect(() => {
    const clear = () => document.querySelectorAll(".tour-hl").forEach((el) => el.classList.remove("tour-hl"));
    clear();
    const st = tourStep !== null ? TOUR[tourStep] : null;
    const opened = tourOpenedRef.current;
    if (st?.open !== "wide" && opened.wide) {
      opened.wide = false;
      if (wideModeRef.current) setWideMode(false); // 11-09 검토: 둘러보기가 연 것은 저장(WIDE_KEY)하지 않는다 — 중간에 끄면 다음 실행이 나란히로 시작하던 것
    }
    if (st?.open !== "map" && opened.map) {
      opened.map = false;
      setRadarActive(false);
    }
    if (!st || showSettings) return clear;
    if (st.open === "wide" && !wideModeRef.current) {
      opened.wide = true;
      setWideMode(true); // 저장 없이(위 참고)
    }
    if (st.open === "map" && !radarActiveRef.current) {
      opened.map = true;
      void openRadar(false, false);
    }
    if (!st.sel) return clear;
    let tries = 0;
    let timer = 0;
    const find = () => {
      // 지도에 아직 데이터가 없으면(스크린샷 전) 칩·도구가 안 그려진다 → 3초 뒤엔 지도 머리라도 짚는다
      let el: Element | null = null;
      for (const one of (st.sel as string).split("||")) {
        el = document.querySelector(one);
        if (el) break;
      }
      el = el ?? (tries >= 14 && st.open === "map" ? document.querySelector(".radar-head") : null);
      if (el) {
        el.classList.add("tour-hl");
        try {
          el.scrollIntoView({ block: "nearest" });
        } catch {}
      } else if (++tries < 15) timer = window.setTimeout(find, 200);
    };
    find();
    return () => {
      window.clearTimeout(timer);
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourStep, showSettings]);
  // ── PiP 창: 켜면 지금 위치를 기억하고 창을 미니맵 크기로 줄여 화면 오른쪽(또는 끌어 둔 자리)에, 끄면 원래 위치·내용 크기로 ──
  useEffect(() => {
    const win = getCurrentWindow();
    let dead = false;
    (async () => {
      try {
        if (pipActive) {
          const entering = !pipPrevRef.current;
          const [pos, size, sf] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()]);
          if (dead) return;
          if (entering) pipPrevRef.current = { x: pos.x, y: pos.y };
          const wpx = Math.round(miniSize * sf);
          pipMoveArmedAtRef.current = Date.now() + 800;
          await win.setSize(new LogicalSize(miniSize, miniSize));
          let target: { x: number; y: number } | null = null;
          if (entering) {
            // 끌어 둔 자리가 지금 연결된 모니터 안이면 거기, 아니면 지금 모니터 오른쪽 위쪽
            try {
              const r = JSON.parse(localStorage.getItem(RADAR_PIP_POS_KEY) || "null");
              const mons = await availableMonitors();
              if (r && Number.isFinite(r.x) && Number.isFinite(r.y) && mons.some((m) => r.x >= m.position.x && r.x < m.position.x + m.size.width && r.y >= m.position.y && r.y < m.position.y + m.size.height)) target = r;
            } catch {}
            if (!target) {
              const mon = await currentMonitor();
              if (mon) target = { x: mon.position.x + mon.size.width - wpx - Math.round(16 * sf), y: mon.position.y + Math.round(mon.size.height * 0.12) };
            }
          } else {
            target = { x: pos.x + size.width - wpx, y: pos.y }; // 크기만 바뀜 — 오른쪽 끝을 그대로
          }
          if (dead) return;
          if (target) await win.setPosition(new PhysicalPosition(target.x, target.y));
          log(`pip: ${entering ? "on" : "resize"} ${miniSize}px @ ${target?.x},${target?.y}`);
        } else if (pipPrevRef.current) {
          const p = pipPrevRef.current;
          pipPrevRef.current = null;
          pipMoveArmedAtRef.current = Date.now() + 800;
          dprHoldRef.current = null; // 배율 왕복 멈춤이 남아 있으면 내용 크기로 못 돌아간다
          dprFlipsRef.current = [];
          applyRef.current?.(); // 폭 800·내용 높이로
          await win.setPosition(new PhysicalPosition(p.x, p.y));
          log("pip: off");
        }
      } catch (e) {
        log(`pip: failed ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipActive, miniSize]);
  // 지도 나란히 모드 — 켜면 지금 있는 모니터에 창을 꽉 채우고(위치는 저장), 끄면 저장한 위치·내용 크기로
  useEffect(() => {
    const win = getCurrentWindow();
    let dead = false;
    (async () => {
      try {
        if (wideMode) {
          showCard(); // 숨김 타이머가 걸려 있었어도 취소
          setRadarActive(false); // 카드 안 지도가 열려 있었으면 닫는다 — 지도는 오른쪽 패널 몫, 왼쪽은 시세
          // 고정(나란히) 상태에선 시세 카드가 비어 있지 않게 — 앱을 다시 켰거나 아직 조회 전이면 최근 검색 1건을 그대로 보여 준다
          if (status === "idle" && history.length > 0) {
            setResult(history[0].result);
            setStatus("success");
          }
          const pos = await win.outerPosition();
          if (dead) return;
          // 돌아갈 위치 = 이미 저장된 값 > 사용자가 쓰던 창 위치(POSITION_KEY, 앱 시작 직후엔 창이 아직 기본 자리라 outerPosition 은 틀림) > 지금 위치
          let prevRaw = localStorage.getItem(WIDE_PREV_POS_KEY);
          if (!prevRaw) {
            prevRaw = localStorage.getItem(POSITION_KEY) || JSON.stringify({ x: pos.x, y: pos.y });
            localStorage.setItem(WIDE_PREV_POS_KEY, prevRaw);
          }
          // 채울 모니터 = 그 위치가 들어 있는 모니터(두 번째 모니터에 두고 쓰던 사람은 그 모니터를 통째로)
          let mon = null as Awaited<ReturnType<typeof currentMonitor>>;
          try {
            const pt = JSON.parse(prevRaw) as { x: number; y: number };
            const mons = await availableMonitors();
            mon = mons.find((m) => pt.x >= m.position.x && pt.x < m.position.x + m.size.width && pt.y >= m.position.y && pt.y < m.position.y + m.size.height) ?? null;
          } catch {}
          if (!mon) mon = await currentMonitor();
          if (dead) return;
          wideSaveArmedAtRef.current = Date.now() + 1500; // 켜는 순간의 이동·크기 변경은 '사용자가 바꾼 크기'가 아니다
          await win.setMinSize(new LogicalSize(WIDE_MIN_W, WIDE_MIN_H)).catch(() => {});
          // 11-07 나란히에서만 최대화 허용 — 모니터 위로 끌어 올리는 Windows 스냅이 '모니터 채우기'가 된다(아래 save 가 받음).
          // 보통 모드는 tauri.conf maximizable=false(최대화되면 내용 높이 로직이 되돌려 커졌다 줄어드는 현상)
          await win.setMaximizable(true).catch(() => {});
          const saved = await savedWideRect();
          if (dead) return;
          if (saved) {
            await win.setPosition(new PhysicalPosition(saved.x, saved.y));
            await win.setSize(new PhysicalSize(saved.w, saved.h));
            log(`wide: on (saved ${saved.w}x${saved.h} @ ${saved.x},${saved.y})`);
          } else {
            if (mon) {
              await win.setPosition(new PhysicalPosition(mon.position.x, mon.position.y));
              await win.setSize(new PhysicalSize(mon.size.width, mon.size.height));
            }
            log(`wide: on (monitor ${mon?.name ?? "?"} ${mon?.size.width}x${mon?.size.height})`);
          }
          void loadRadar();
        } else {
          const raw = localStorage.getItem(WIDE_PREV_POS_KEY);
          localStorage.removeItem(WIDE_PREV_POS_KEY);
          await win.setMinSize(null).catch(() => {}); // 일반 카드 창은 내용 높이(100px~)까지 줄어든다
          await win.setMaximizable(false).catch(() => {});
          dprHoldRef.current = null; // 배율 왕복 멈춤이 남아 있으면 내용 크기로 못 돌아간다
          dprFlipsRef.current = [];
          applyRef.current?.(); // 내용 크기로 되돌린다
          if (raw) {
            const { x, y } = JSON.parse(raw);
            if (Number.isFinite(x) && Number.isFinite(y)) await win.setPosition(new PhysicalPosition(x, y));
          }
          log("wide: off");
        }
      } catch (e) {
        log(`wide: failed ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wideMode]);
  // ── 나란히 모드 창 크기·위치(피드백 #54) ─────────────────────────────
  // 모니터 전체가 기본. 패널 오른쪽 아래 모서리를 끌면 크기, 시세 카드 머리글을 끌면 위치가 바뀌고 그 값을 기억한다
  // (다음에 켤 때 그대로). 모서리를 두 번 누르면 지금 모니터 전체로 되돌리고 기억도 지운다.
  // 저장값의 왼쪽 위가 지금 연결된 어느 모니터에도 없으면(모니터를 뺐을 때) 무시하고 모니터 전체로.
  const wideSaveArmedAtRef = useRef(0);
  const savedWideRect = async (): Promise<{ x: number; y: number; w: number; h: number } | null> => {
    try {
      const r = JSON.parse(localStorage.getItem(WIDE_RECT_KEY) || "null");
      if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w < 200 || r.h < 150) return null;
      const mons = await availableMonitors();
      const m = mons.find((m) => r.x >= m.position.x && r.x < m.position.x + m.size.width && r.y >= m.position.y && r.y < m.position.y + m.size.height);
      if (!m) return null;
      // 그 모니터의 작업 영역(작업표시줄 제외) 안으로 맞춘다 — 창을 모니터 끝 너머로 끌어 저장하면(11-05 실측: 1920 모니터에 폭 1951)
      // 오른쪽 아래 크기 손잡이가 화면 밖으로 나가 다시 줄일 방법이 없었다
      const wa = m.workArea ?? { position: m.position, size: m.size };
      const ax = wa.position.x, ay = wa.position.y, aw = wa.size.width, ah = wa.size.height;
      const x = Math.max(ax, Math.min(r.x, ax + aw - 200));
      const y = Math.max(ay, Math.min(r.y, ay + ah - 150));
      const w = Math.max(200, Math.min(r.w, ax + aw - x));
      const h = Math.max(150, Math.min(r.h, ay + ah - y));
      if (x !== r.x || y !== r.y || w !== r.w || h !== r.h) {
        log(`wide: saved rect ${r.w}x${r.h} @ ${r.x},${r.y} → clamped ${w}x${h} @ ${x},${y}`);
        localStorage.setItem(WIDE_RECT_KEY, JSON.stringify({ x, y, w, h }));
      }
      return { x, y, w, h };
    } catch {
      return null;
    }
  };
  useEffect(() => {
    if (!wideMode) return;
    const win = getCurrentWindow();
    let timer = 0;
    const save = () => {
      if (Date.now() < wideSaveArmedAtRef.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        resizingRef.current = false; // 모서리 끌기가 끝났다(크기 변경 이벤트가 0.4초 멈춤)
        if (!wideModeRef.current || Date.now() < wideSaveArmedAtRef.current) return;
        try {
          // 11-07 사용자: 모니터 맨 위로 끌어 최대화하면 커졌다 바로 줄어듦 → 최대화는 '이 모니터 채우기'로 받고 최대화 상태는 푼다
          if (await win.isMaximized().catch(() => false)) {
            log("wide: maximized → fill monitor");
            await win.unmaximize().catch(() => {});
            await resetWideRect();
            return;
          }
          const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
          localStorage.setItem(WIDE_RECT_KEY, JSON.stringify({ x: pos.x, y: pos.y, w: size.width, h: size.height }));
          // 모니터 작업 영역 밖으로 늘리거나 옮겼으면 바로 안쪽으로(손잡이가 화면 밖으로 나가지 않게)
          const c = await savedWideRect();
          if (c && (c.x !== pos.x || c.y !== pos.y || c.w !== size.width || c.h !== size.height)) {
            wideSaveArmedAtRef.current = Date.now() + 1500;
            await win.setPosition(new PhysicalPosition(c.x, c.y));
            await win.setSize(new PhysicalSize(c.w, c.h));
          }
        } catch {}
      }, 400);
    };
    const unMoved = win.onMoved(save);
    const unResized = win.onResized(save);
    return () => {
      window.clearTimeout(timer);
      unMoved.then((f) => f()).catch(() => {});
      unResized.then((f) => f()).catch(() => {});
    };
  }, [wideMode]);
  const onWideResizeDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // 끄는 동안 클릭 투과를 켜지 않게(커서가 잠깐 패널 밖으로 빠져도) — 크기 변경이 멈추면 save 가 푼다
    resizingRef.current = true;
    window.setTimeout(() => {
      resizingRef.current = false;
    }, 15000); // 안전장치: 끌기 이벤트가 전혀 안 오면
    getCurrentWindow()
      .startResizeDragging("SouthEast")
      .catch((err) => {
        resizingRef.current = false;
        log(`wide: resize drag failed ${String(err)}`);
      });
  };
  const resetWideRect = async () => {
    localStorage.removeItem(WIDE_RECT_KEY);
    wideSaveArmedAtRef.current = Date.now() + 1500;
    try {
      const win = getCurrentWindow();
      const mon = await currentMonitor();
      if (mon) {
        await win.setPosition(new PhysicalPosition(mon.position.x, mon.position.y));
        await win.setSize(new PhysicalSize(mon.size.width, mon.size.height));
        log(`wide: reset to monitor ${mon.size.width}x${mon.size.height}`);
      }
    } catch {}
  };
  // 오른쪽 패널 높이 → 지도 높이(머리글·칩·맵 선택·안내 줄 몫을 뺀다)
  useEffect(() => {
    const el = paneRef.current;
    if (!wideMode || !el) return;
    const read = () => {
      const p = window.innerHeight > window.innerWidth * 1.05;
      // 세로: 오른쪽 열(조작부+목록)이 지도 밑으로 — 11-05 조작부를 이 열로 옮겨 목록 몫이 줄어 0.28·360 → 0.33·520
      const side = p ? Math.round(Math.min(window.innerHeight * 0.33, 520)) : 0;
      setPortrait(p);
      setSideH(side);
      // 210 → 150(11-05): 맵 선택·고정·불투명도·파티 등 조작부를 오른쪽 열로 옮겨 지도 아래엔 칩·층 줄만 남았다.
      // 실측(2048×1152): 머리글+경고 1줄 65px + 칩·층 34px + 여백 ≈ 110px → 경고 줄 2개가 더 생겨도 넘치지 않게 150
      setPaneSize(Math.max(200, el.clientHeight - 150 - (p ? side + 12 : 0))); // 세로면 목록 몫(+간격)을 지도 높이에서 뺀다
    };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, [wideMode]);
  const toggleWide = () => {
    setWideMode((v) => {
      try {
        localStorage.setItem(WIDE_KEY, v ? "0" : "1");
      } catch {}
      if (!v) dailyAdd("wide"); // 켠 횟수만
      return !v;
    });
  };
  // 새 스크린샷 감지: 0.4초마다 가벼운 확인(사이드카가 폴더 수정 시각이 같으면 다시 훑지 않음).
  // 11-07 피드백 #56 '스크린샷 → 지도 업데이트가 살짝 느림': 실측 가벼운 확인 0.015초·전체 지도 0.02~0.045초라 지연은 거의
  // 이 주기(1초 → 평균 0.5초 대기)였다 → 0.4초(평균 0.2초). 나머지는 게임이 PNG 를 쓰는 시간이라 앱이 줄일 수 없다.
  useEffect(() => {
    if (!radarEnabled) return;
    const iv = window.setInterval(async () => {
      if (radarPollBusyRef.current) return;
      radarPollBusyRef.current = true;
      try {
        const res = await fetch(radarUrl(false));
        if (!res.ok) return;
        const d = (await res.json()) as RadarState;
        // 지도 나란히 모드로 켜진 채 시작하면 사이드카가 뜨기 전에 첫 loadRadar 가 실패한다 → 응답이 오기 시작하면 한 번 받아 둔다
        if (wideModeRef.current && !radarDataRef.current && !radarLoading) void loadRadar();
        // 11-08 사용자 '맵 로딩할 때 어떤 맵인지 알아서 미리': 게임은 로딩 화면 시작(레이드 1~2분 전)에 맵을 로그에 쓴다.
        // 마지막 스크린샷 뒤의 새 로딩이 보이면 그 맵 지도를 미리 받아 그려 두고 지도 데이터만 조용히 바꾼다(창은 안 띄움).
        // 첫 스크린샷 전엔 사이드카가 지난 레이드 스크린샷을 빼고 맵·탈출구·퀘스트 위치만 준다(pre_raid).
        const lt = d.loading?.ts ?? null;
        if (lt != null && lt !== radarLoadingTsRef.current) {
          radarLoadingTsRef.current = lt;
          radarMapRef.current = null; // 새 레이드 — 수동 선택은 풀고 로그 맵으로
          log(`radar: map loading ${d.loading!.map}`);
          prefetchMap(d.loading!.map, region.lang);
          dailyAdd("lp"); // 11-10 통계: 로딩 화면에서 맵을 미리 알아내 지도를 받아 둠(1.3.1 기능)
          void loadRadar();
        }
        const id = d.shot?.id ?? null;
        const first = radarLastShotRef.current === undefined;
        if (id !== radarLastShotRef.current) {
          radarLastShotRef.current = id;
          // 앱을 켠 직후의 첫 확인은 기준만 잡는다 — 지난 스크린샷으로 지도가 튀어나오지 않게
          if (!first && d.shot && d.shot.age <= RADAR_POPUP_MAX_AGE_SEC) {
            radarMapRef.current = null; // 새 레이드일 수 있으니 수동 선택은 풀고 로그로 다시 감지
            log(`radar: new screenshot ${id}`);
            const act = shotAction({
              wideMode: wideModeRef.current,
              passthrough: hotkeyPassthroughRef.current,
              lookupInFlight: lookupInFlightRef.current,
              msSincePress: performance.now() - sharedPressAtRef.current,
              msSinceToggle: performance.now() - toggleAtRef.current,
            });
            if (act === "quiet") {
              // 방금 Shift+F2 로 숨기거나 띄운 누름이 만든 스크린샷 — 화면은 그대로, 지도 데이터만
              void loadRadar();
            } else if (act === "refresh") {
              // 나란히 모드(지도가 오른쪽에 늘 있음) 또는 같은 키로 방금 누른 스크린샷(조회 결과가 화면을 정함) — 데이터만 갱신
              if (wideModeRef.current) showCard();
              reportEvent("radar_shot");
              void loadRadar();
            } else {
              void openRadar(true);
            }
          }
        }
      } catch {
        // 사이드카가 아직 안 떴거나 재시작 중 — 다음 틱에 다시
      } finally {
        radarPollBusyRef.current = false;
      }
    }, RADAR_POLL_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarEnabled, region.lang, region.gameMode]);

  // 11-06 진단 기록(diagLog.ts): 카드 보임/숨김 · 오버레이 포커스 · 앞 창 종류(game/overlay/other) 바뀜
  useEffect(() => {
    diag(cardVisible ? "card:show" : "card:hide");
  }, [cardVisible]);
  useEffect(() => {
    const win = getCurrentWindow();
    const unFocus = win.onFocusChanged(({ payload }) => diag(payload ? "focus:on" : "focus:off"));
    let lastFg = "";
    const iv = window.setInterval(() => {
      invoke<string>("get_foreground_kind")
        .then((k) => {
          fgKindRef.current = k;
          if (k !== lastFg) {
            lastFg = k;
            diag("fg:" + k);
          }
        })
        .catch(() => {});
    }, 700);
    return () => {
      window.clearInterval(iv);
      unFocus.then((f) => f()).catch(() => {});
    };
  }, []);
  // 11-09 사용 시간(하루 요약 up = 앱이 켜져 있던 분, gm = 그중 게임이 맨 앞이던 분) — 본 창만, 1분마다 1
  useEffect(() => {
    if (!IS_MAIN_WINDOW) return;
    const iv = window.setInterval(() => {
      dailyAdd("up");
      if (fgKindRef.current === "game") dailyAdd("gm");
    }, 60_000);
    return () => window.clearInterval(iv);
  }, []);
  // 11-10 통계: 가만히 있을 때(카드 숨김) 자원 사용량 — 1분 간격 두 번 읽어 CPU(코어 하나 = 1000)·메모리(MB) 표본.
  // cpa·mma = 화면(앱+웹뷰), cps·mms = 시세 엔진. 켠 지 10분 뒤 한 번, 이후 30분마다. 숫자만(프로세스 이름·경로 안 보냄)
  useEffect(() => {
    if (!IS_MAIN_WINDOW) return;
    type U = { app_cpu_ms?: number; app_mem_mb?: number; sc_cpu_ms?: number; sc_mem_mb?: number };
    let stop = false;
    let pending: number | undefined;
    const sample = async () => {
      if (stop || cardVisibleRef.current) return;
      try {
        const a = await invoke<U>("proc_usage");
        pending = window.setTimeout(async () => {
          if (stop || cardVisibleRef.current) return; // 그사이 카드를 띄웠으면 '가만히'가 아님
          try {
            const b = await invoke<U>("proc_usage");
            if (a.app_cpu_ms != null && b.app_cpu_ms != null) dailySample("cpa", ((b.app_cpu_ms - a.app_cpu_ms) / 60_000) * 1000);
            if (a.sc_cpu_ms != null && b.sc_cpu_ms != null) dailySample("cps", ((b.sc_cpu_ms - a.sc_cpu_ms) / 60_000) * 1000);
            if (b.app_mem_mb != null) dailySample("mma", b.app_mem_mb);
            if (b.sc_mem_mb != null) dailySample("mms", b.sc_mem_mb);
          } catch {}
        }, 60_000);
      } catch {}
    };
    const first = window.setTimeout(sample, 10 * 60_000);
    const iv = window.setInterval(sample, 30 * 60_000);
    return () => {
      stop = true;
      window.clearTimeout(first);
      window.clearInterval(iv);
      if (pending) window.clearTimeout(pending);
    };
  }, []);
  // 11-09 기능 사용: 설정·캡처 영역 설정을 연 횟수(set·cap)
  useEffect(() => {
    if (showSettings) dailyAdd("set");
  }, [showSettings]);
  useEffect(() => {
    if (captureModalOpen) dailyAdd("cap");
  }, [captureModalOpen]);
  // Region-based click-through: while the card is visible, poll cursor
  // position and only capture clicks when the cursor is over the card's
  // screen rect. Outside the card (rest of the 800x600 invisible window)
  // clicks pass through to whatever's underneath (the game).
  useEffect(() => {
    // 11-06: 클릭 투과는 tao 의 setIgnoreCursorEvents 대신 Rust set_click_through(활성화 없이 스타일 비트만) — 마우스를
    // 카드에 올리면 오버레이가 활성 창이 돼 게임이 포커스를 잃던 것(#55). tao 가 다른 일로 스타일을 다시 계산하면 비트가
    // 되돌려질 수 있어 매번 다시 맞춘다(Rust 쪽은 이미 같으면 아무것도 안 함).
    const clickThrough = (v: boolean) => invoke("set_click_through", { ignore: v }).catch(() => {});
    if (!cardVisible) {
      // Hidden: full pass-through. 숨긴 동안에도 0.5초마다 다시 맞춘다 — 보이지 않는 창이 게임 클릭을 가로채면 안 된다
      clickThrough(true);
      const keep = window.setInterval(() => clickThrough(true), 500);
      // The poll is stopped, so the ref can't refresh — clear it. A stale
      // `true` here would make scheduleHide() skip the countdown on the
      // next show even when the cursor is nowhere near the card, leaving
      // the card up forever.
      mouseOverCardRef.current = false;
      holdRef.current = HOLD_START;
      if (dodgingRef.current) {
        dodgingRef.current = false;
        setDodging(false);
      }
      return () => window.clearInterval(keep);
    }

    let cancelled = false;
    // 11-08: 예전엔 폴링(40ms)마다 불렀다(같은 값이면 Rust 가 아무것도 안 함). 값이 바뀔 때 + 0.2초(5틱)마다만 — tao 가 비트를
    // 되돌린 경우도 0.2초 안에 다시 맞춘다. 창 위치·배율은 cursorOverCard(true) 의 캐시를 쓰고, 움직이면 비운다.
    let lastIgnore: boolean | null = null;
    let sinceAssert = 0;
    const setIgnore = (v: boolean) => {
      sinceAssert++;
      if (v !== lastIgnore || sinceAssert >= 5) {
        lastIgnore = v;
        sinceAssert = 0;
        clickThrough(v);
      }
    };
    const geomWin = getCurrentWindow();
    const unMoved = geomWin.onMoved(() => {
      winGeomRef.current = null;
    });
    const unScale = geomWin.onScaleChanged(() => {
      winGeomRef.current = null;
    });
    // Start in pass-through; the first poll will flip it if cursor is on card.
    setIgnore(true);
    // Assume cursor-off-card until the first poll proves otherwise, so a
    // cursor that's already resting on the card when it appears is seen as a
    // clean enter-transition that cancels the auto-hide.
    mouseOverCardRef.current = false;
    // 안/밖 판정(테두리 여유 EDGE_PAD·창 배율 변환 포함)은 cursorOverCard 한 곳에서 한다

    const poll = async () => {
      if (cancelled) return;
      // While dragging the resize handle, keep capturing cursor events even
      // if the pointer slips outside the (shrinking) card rect.
      if (resizingRef.current) {
        setIgnore(false);
        if (!cancelled) setTimeout(poll, 40);
        return;
      }
      try {
        const inside = await cursorOverCard(true);
        // 이 폴링이 속한 효과가 끝났으면(카드를 숨김 등) 여기서 멈춘다. 늦게 돌아온 이전 폴링이 숨김 효과 뒤에
        // 클릭 투과를 끄거나(숨긴 창이 게임 마우스를 가로챔) 커서 상태를 덮어쓰던 경쟁을 막는다(11-04).
        if (cancelled) return;
        // #58 비켜 주기: 게임이 앞일 때만(오버레이·다른 창이 앞이면 평소대로 만질 수 있게). 설정 중·크기 조절 중·나란히 모드(보통 다른 모니터)는 제외
        const dodge =
          inside &&
          hoverDodgeRef.current &&
          // 개발 시험용: localStorage tarkov.dodgeAnyWindow=1 이면 게임이 앞에 없어도(게임 없이 확인)
          (fgKindRef.current === "game" || localStorage.getItem("tarkov.dodgeAnyWindow") === "1") &&
          !settingsOpenRef.current &&
          !wideModeRef.current && // 장비창 아이템을 누른 채 끌면 holdStep 이 '위'를 유지해 끄는 동안 계속 투명
          !(modsRef.current & (DODGE_MOD_BIT[hoverDodgeModRef.current] ?? 0)); // 예외 키를 누른 채면 비키지 않는다(오버레이를 누르려고)
        if (dodge !== dodgingRef.current) {
          dodgingRef.current = dodge;
          setDodging(dodge);
          diag(dodge ? "dodge:on" : "dodge:off");
        }
        setIgnore(!inside || dodge);
        // Drive auto-hide from the poll — the single source of truth for
        // "cursor on card". The card's DOM mouseenter/mouseleave fire
        // unreliably because the window is click-through most of the time,
        // so a cursor that lands on the card and stops never cancelled the
        // hide (the original bug: hovering didn't keep the card alive).
        // Edge-triggered so the timer isn't restarted every 40ms.
        if (inside !== mouseOverCardRef.current) {
          mouseOverCardRef.current = inside;
          diag(inside ? "cursor:in" : "cursor:out");
          if (inside) {
            cancelHideTimer();
          } else if (!recordingHotkeyRef.current) {
            scheduleHide();
          }
        } else if (inside && hideTimerRef.current !== null) {
          // 커서가 카드 위인데 타이머가 살아 있으면(진입 순간을 놓친 경우) 매 틱 취소 — 커서 아래에서 사라지지 않게
          cancelHideTimer();
        }
      } catch {}
      if (!cancelled) setTimeout(poll, 40);
    };
    poll();
    return () => {
      cancelled = true;
      unMoved.then((f) => f()).catch(() => {});
      unScale.then((f) => f()).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardVisible]);

  const t = T[region.lang];
  const announcementText = remoteAnnounce
    ? getRemoteAnnouncementText(region.lang, remoteAnnounce)
    : "";

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(region));
  }, [region]);

  // 11-09 통계 hotkey_fail(14일 4명): 다른 프로그램이 같은 키를 쥐고 있으면 등록이 조용히 실패해 F2 를 눌러도 아무 일이 없었다
  // (기록·통계에만 남음). 카드에 알려 설정에서 다른 키로 바꾸게 한다.
  const notifyHotkeyFail = (key: string) => {
    void (async () => {
      try {
        if (!(await getCurrentWindow().isVisible())) await invoke("show_overlay_passive");
      } catch {}
      showCard();
      setShowSettings(false);
      setError(T[loadRegion().lang].hotkeyRegisterFailed.replace("{key}", key));
      setStatus("error");
    })();
  };
  useEffect(() => {
    localStorage.setItem(HOTKEY_KEY, hotkey);
    // Either the keyboard or the mouse slot is active per binding — clear
    // the other one so a stale registration from a previous binding doesn't
    // keep firing alongside the new one.
    if (isMouseHotkey(hotkey)) {
      invoke("register_lookup_hotkey", { accelerator: "" }).catch(() => {});
      invoke("register_lookup_mouse", { button: hotkey })
        .then(() => log(`React: lookup hotkey = ${hotkey} (mouse)`))
        .catch((e) => {
          log(`React: lookup mouse FAILED (${hotkey}): ${e}`);
          // A binding that won't register silently does nothing — the user
          // presses their key and nothing happens, which is indistinguishable
          // from "never tried" in the funnel. Surface it.
          reportEvent("hotkey_fail", hotkey);
          notifyHotkeyFail(hotkey);
        });
    } else {
      invoke("register_lookup_mouse", { button: "" }).catch(() => {});
      invoke("register_lookup_hotkey", { accelerator: hotkey })
        .then(() => log(`React: lookup hotkey = ${hotkey}`))
        .catch((e) => {
          log(`React: lookup hotkey FAILED (${hotkey}): ${e}`);
          reportEvent("hotkey_fail", hotkey);
          notifyHotkeyFail(hotkey);
        });
    }
  }, [hotkey]);

  // 엿듣기 모드 토글: Rust 플래그를 먼저 바꾼 뒤 키보드 바인딩을 다시 등록해 방식을 전환한다
  useEffect(() => {
    localStorage.setItem(HOTKEY_PASSTHROUGH_KEY, String(hotkeyPassthrough));
    (async () => {
      try {
        await invoke("set_hotkey_passthrough", { enabled: hotkeyPassthrough });
        if (!isMouseHotkey(hotkey)) await invoke("register_lookup_hotkey", { accelerator: hotkey });
        if (!isMouseHotkey(toggleHotkey)) await invoke("register_toggle_hotkey", { accelerator: toggleHotkey });
        log(`React: hotkey passthrough = ${hotkeyPassthrough}`);
      } catch (e) {
        log(`React: hotkey passthrough apply failed: ${e}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkeyPassthrough]);

  useEffect(() => {
    localStorage.setItem(TOGGLE_HOTKEY_KEY, toggleHotkey);
    if (isMouseHotkey(toggleHotkey)) {
      invoke("register_toggle_hotkey", { accelerator: "" }).catch(() => {});
      invoke("register_toggle_mouse", { button: toggleHotkey })
        .then(() => log(`React: toggle hotkey = ${toggleHotkey} (mouse)`))
        .catch((e) =>
          log(`React: toggle mouse FAILED (${toggleHotkey}): ${e}`)
        );
    } else {
      invoke("register_toggle_mouse", { button: "" }).catch(() => {});
      invoke("register_toggle_hotkey", { accelerator: toggleHotkey })
        .then(() => log(`React: toggle hotkey = ${toggleHotkey}`))
        .catch((e) =>
          log(`React: toggle hotkey FAILED (${toggleHotkey}): ${e}`)
        );
    }
  }, [toggleHotkey]);

  useEffect(() => {
    localStorage.setItem(SOUND_KEY, String(soundOn));
  }, [soundOn]);

  useEffect(() => {
    localStorage.setItem(UPDATE_CHECK_KEY, String(autoCheckUpdate));
  }, [autoCheckUpdate]);
  useEffect(() => {
    localStorage.setItem(UPDATE_AUTO_INSTALL_KEY, String(autoInstallUpdate));
  }, [autoInstallUpdate]);

  // Probe sidecar diagnostics on mount, retrying until it answers (the sidecar
  // can take >3s on a cold start while it loads OCR models). Drives the admin-
  // rights banner and the elevation telemetry.
  const adminReportedRef = useRef(false);
  const sidecarReadyReportedRef = useRef(false);
  useEffect(() => {
    let mounted = true;
    let tries = 0;
    let timer: number | undefined;
    const probe = async () => {
      const info = await fetchDiagnostics();
      if (!mounted) return;
      if (info) {
        // 11-10 통계: 앱 실행부터 시세 엔진 첫 응답까지(ms) — 1.3.0 에서 늘어난 사이드카 시작 실패(14.6%)가 '늦게 뜸'인지 가르기
        if (!sidecarReadyReportedRef.current) {
          sidecarReadyReportedRef.current = true;
          dailySample("rdy", Date.now() - APP_STARTED_AT);
        }
        setAdminInfo(info);
        // Elevation telemetry (once/session): tag a launch event with the
        // admin status so the dashboard can measure how many users — and
        // especially the "never looked up" cohort — run non-elevated. That's
        // the prime suspect for F2 silently failing against admin-elevated
        // Tarkov (Windows UIPI). Harmless launch double-count: every funnel /
        // DAU metric counts DISTINCT install_id, so it's unaffected.
        if (!adminReportedRef.current && info.is_admin != null) {
          adminReportedRef.current = true;
          reportEvent("launch", info.is_admin ? "admin" : "user");
        }
        return; // got a result — stop retrying
      }
      // Sidecar not ready yet: a cold start loads the OCR models first and can
      // take well over 3s. Retry (every 2s, ~24s cap) so the admin-rights
      // banner and the elevation telemetry don't silently miss on cold boots.
      if (++tries < 12) timer = window.setTimeout(probe, 2000);
      else reportEvent("sidecar_fail", `probe_${lastDiagErr || "unknown"}`); // ~24초 안에 못 뜸
    };
    probe();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Load the ammo dataset once per language. The sidecar caches it server-
  // side; we cache it in component state so the matrix opens without a
  // network round-trip when the user looks up a weapon/round.
  useEffect(() => {
    let mounted = true;
    fetchAmmo(getGameLang(region)).then((d) => {
      if (mounted && d) setAmmoData(d);
    });
    return () => {
      mounted = false;
    };
  }, [region.lang, region.gameLang]);

  // Re-fetch the ammo dataset when a lookup returns a caliber we don't have
  // cached. Game patches add new calibers (e.g. .338 LM in 0.16) and without
  // this, users would have to restart the app to see the matrix for those
  // weapons/rounds. Guarded by the cache check so we don't refetch on every
  // lookup.
  useEffect(() => {
    if (!result?.caliber) return;
    if (ammoData?.calibers[result.caliber]) return;
    let mounted = true;
    fetchAmmo(getGameLang(region)).then((d) => {
      if (mounted && d) setAmmoData(d);
    });
    return () => {
      mounted = false;
    };
  }, [result?.caliber]);

  // Update check + install. Uses Tauri's updater plugin: it fetches
  // latest.json from the configured endpoint, verifies the embedded
  // ed25519 signature against the pubkey baked into the app, and
  // returns an Update handle whose downloadAndInstall() streams the
  // signed installer to disk and launches it.
  // Refs for the periodic re-check: its interval closure is created once on
  // mount, so it must read CURRENT state via refs — and it must never fire
  // mid-download (a tick during "downloading" reset the phase to idle,
  // killing the progress bar and re-arming the install button).
  const updateCheckingRef = useRef(false);
  const updatePhaseRef = useRef<UpdatePhase>("idle");
  useEffect(() => {
    updatePhaseRef.current = updatePhase;
  }, [updatePhase]);
  const checkForUpdate = async () => {
    // Block only while an install is genuinely in progress. "error" must
    // NOT block: otherwise one failed download froze update checks forever
    // (4h ticks + the manual button all silently no-oped until restart).
    if (
      updateCheckingRef.current ||
      updatePhaseRef.current === "downloading" ||
      updatePhaseRef.current === "downloaded" || // 받아 둔 게 있으면 닫을 때 설치 — 다시 확인하지 않는다
      updatePhaseRef.current === "ready"
    )
      return;
    updateCheckingRef.current = true;
    setUpdateChecking(true);
    setUpdateError(null);
    // If we're re-checking after a prior install failure, drop the stale
    // "error" phase now. Otherwise the banner keeps rendering the error branch
    // ("⚠ update error: ") with an empty message for the whole network
    // round-trip, since we just cleared updateError but not the phase.
    if (updatePhaseRef.current === "error") setUpdatePhase("idle");
    try {
      const update = await checkForAppUpdate();
      setUpdateCheckedAt(Date.now());
      if (update) {
        pendingUpdateRef.current = update;
        setUpdateInfo({ version: update.version, notes: update.body ?? null });
        setUpdatePhase("idle");
        log(`update: ${APP_VERSION} -> ${update.version} available`);
        reportUpdateCheck(`available:${update.version.slice(0, 16)}`);
        // 조용한 자동 업데이트(설치판만): 지금 받아 두고 트레이 '종료'·'지금 적용'·다음 실행 때 설치한다.
        // 포터블은 exe 교체가 안 되니 기존대로 배너에서 페이지로 보낸다.
        if (autoInstallRef.current && !isPortableRef.current) {
          // 지난번에 받아 두고 설치 못 한 그 버전 + 켠 직후 + 게임이 꺼져 있음 → 지금 설치(모르면 게임 중으로 보고 미룬다)
          const nextLaunch =
            readPendingUpdate() === update.version &&
            Date.now() - APP_STARTED_AT < NEXT_LAUNCH_WINDOW_MS &&
            !(await invoke<boolean>("game_running").catch(() => true));
          if (nextLaunch) {
            log(`update: installing ${update.version} on launch (downloaded last session)`);
            void runInstall(false, true);
          } else {
            void downloadUpdateQuietly(update);
          }
        }
      } else {
        pendingUpdateRef.current = null;
        setUpdateInfo(null);
        log(`update: up to date (${APP_VERSION})`);
        reportUpdateCheck("none");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`update: check failed — ${msg}`);
      reportUpdateCheck("error");
      setUpdateError(msg);
      // Keep any previously-seen updateInfo: a transient network failure on
      // a periodic re-check must not erase a valid update banner for 4h.
    } finally {
      updateCheckingRef.current = false;
      setUpdateChecking(false);
    }
  };

  const reportUpdateCheck = (detail: string) => {
    if (updateCheckReportedRef.current === detail) return;
    updateCheckReportedRef.current = detail;
    reportEvent("update_check", detail);
  };

  // 11-03 조용한 자동 업데이트 1단계: 서명 검증까지 끝낸 설치 파일을 받아만 둔다.
  // 설치는 트레이 '종료' 때(아래 tray-exit 리스너) 또는 배너 '지금 적용'.
  const downloadUpdateQuietly = async (update: Update) => {
    setUpdatePhase("downloading");
    setUpdateProgress(0);
    setUpdateError(null);
    let downloaded = 0;
    let total = 0;
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) setUpdateProgress(Math.min(100, Math.round((downloaded / total) * 100)));
        } else if (event.event === "Finished") {
          setUpdateProgress(100);
        }
      });
      setUpdatePhase("downloaded");
      log(`update: ${update.version} downloaded — installs on tray quit, Apply now, or next launch`);
      reportEvent("update_apply", "downloaded");
      try {
        localStorage.setItem(UPDATE_PENDING_KEY, JSON.stringify({ v: update.version, at: Date.now() }));
      } catch {}
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`update: background download failed — ${msg}`);
      setUpdateError(msg);
      setUpdatePhase("error");
      reportEvent("update_apply", "error");
    }
  };

  // 받아 둔 업데이트를 지금 설치(앱 종료 → 설치 프로그램).
  const applyDownloadedUpdate = async () => {
    const update = pendingUpdateRef.current;
    if (!update) return;
    await message(t.updateStartGuide, { title: t.updateStartTitle, kind: "info" });
    setUpdatePhase("ready");
    reportEvent("update_apply", "install_now");
    try {
      await invoke("prepare_quit").catch(() => {});
      await update.install();
      await relaunch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`update: install failed — ${msg}`);
      setUpdateError(msg);
      setUpdatePhase("error");
      reportEvent("update_apply", "error");
    }
  };

  // onClick 에 바로 넘기는 installUpdate 는 인자 없음. 포터블 전환은 runInstall(true) 로 같은 흐름을 탄다
  const installUpdate = () => runInstall(false);
  // nextLaunch = 지난번에 받아 둔 업데이트를 이번 실행 직후 설치(확인 창 없이 — 배너 진행률·설치 창만)
  const runInstall = async (portableSwitch: boolean, nextLaunch = false) => {
    const update = pendingUpdateRef.current;
    if (!update) return;
    if (updatePhaseRef.current === "downloaded") return applyDownloadedUpdate();
    if (updatePhaseRef.current === "downloading") return; // 자동 다운로드가 받는 중 — 겹치지 않게
    if (nextLaunch) {
      reportEvent("update_apply", "install_next_launch");
    } else if (!portableSwitch) {
      reportEvent("update_apply", "install_now");
      // Tell the user what's about to happen: the app closes and the installer
      // downloads + launches with a gap before the setup window appears. Without
      // this, that silent gap reads like the update stalled. (t is the active
      // language strings.) 포터블 전환은 확인 창에 같은 안내가 들어 있어 생략.
      await message(t.updateStartGuide, { title: t.updateStartTitle, kind: "info" });
    }
    setUpdatePhase("downloading");
    setUpdateProgress(0);
    setUpdateError(null);
    let downloaded = 0;
    let total = 0;
    try {
      await update.downloadAndInstall((event) => {
        // Plugin emits three event kinds: Started (total size known),
        // Progress (chunk bytes), Finished (download+verify done; NSIS
        // about to spawn). We translate to a 0–100 percent so the
        // banner can render a progress bar without remembering bytes.
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            setUpdateProgress(Math.min(100, Math.round((downloaded / total) * 100)));
          }
        } else if (event.event === "Finished") {
          setUpdateProgress(100);
        }
      });
      setUpdatePhase("ready");
      log(`update: installed ${update.version}, relaunching`);
      await relaunch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`update: install failed — ${msg}`);
      setUpdateError(msg);
      setUpdatePhase("error");
      reportEvent("update_apply", portableSwitch ? "portable_switch_error" : "error");
      // 다음 실행 설치가 실패했으면 표시를 지운다 — 켤 때마다 같은 실패를 되풀이하지 않게(배너 '지금 설치'는 그대로)
      if (nextLaunch) {
        try {
          localStorage.removeItem(UPDATE_PENDING_KEY);
        } catch {}
      }
    }
  };

  // 1.2.7 포터블 → 설치판 원클릭 전환: 동의를 받은 뒤에만 받는다(포터블은 자동 다운로드 안 함).
  // 같은 설치 파일·같은 진행률 UI 를 쓰고, 설치 직전에 표시 파일을 남겨 설치 훅이 바로가기를 만들게 한다.
  const startPortableSwitch = async () => {
    const update = pendingUpdateRef.current;
    if (!update) return;
    if (updatePhaseRef.current === "downloading" || updatePhaseRef.current === "ready") return;
    const yes = await ask(t.portableSwitchConfirm.replace("{ver}", update.version), {
      title: t.portableSwitchTitle,
      kind: "info",
      okLabel: t.portableSwitchOk,
      cancelLabel: t.portableSwitchCancel,
    }).catch(() => false);
    if (!yes) {
      log("portable switch: cancelled");
      return;
    }
    reportEvent("update_apply", "portable_switch_click");
    try {
      const at = await invoke<string>("mark_portable_switch", { fromVersion: APP_VERSION });
      log(`portable switch: marker written — ${at}`);
    } catch (e) {
      // 표시 파일을 못 남겨도 설치는 된다(바로가기만 안 생김) — 막지 않고 기록만
      log(`portable switch: marker failed — ${String(e)}`);
      reportEvent("update_apply", "portable_switch_error");
    }
    await runInstall(true);
  };

  // 트레이 '종료': Rust 가 바로 끝내지 않고 이 이벤트를 먼저 보낸다(8초 안에 exit_app 이
  // 안 오면 Rust 쪽 안전장치가 강제 종료). 받아 둔 업데이트가 있으면 여기서 설치한다 —
  // 설치 프로그램이 앱·사이드카를 정리하고(installer-hooks.nsh) 프로세스를 끝낸다.
  useEffect(() => {
    const un = listen("tray-exit", async () => {
      const update = pendingUpdateRef.current;
      if (update && updatePhaseRef.current === "downloaded") {
        log(`update: installing ${update.version} on quit`);
        reportEvent("update_apply", "install_quit");
        try {
          await invoke("prepare_quit").catch(() => {});
          await update.install();
        } catch (e) {
          log(`update: install on quit failed — ${String(e)}`);
        }
      }
      invoke("exit_app").catch(() => {});
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Auto-check shortly after mount, then every 4h while running. The overlay
  // is tray-resident and often stays up for DAYS — a single startup check
  // meant long-running sessions never learned about new releases, which is
  // why update adoption lagged. Periodic re-checks close that gap.
  useEffect(() => {
    // deps on the toggle: turning auto-check OFF mid-session must actually
    // stop the 4h interval (with [] deps the mount-time closure kept firing
    // until restart — meaningful for a tray-resident app).
    if (!autoCheckUpdate) return;
    const t = window.setTimeout(() => {
      checkForUpdate();
    }, 3000);
    const iv = window.setInterval(() => {
      checkForUpdate();
    }, 4 * 60 * 60 * 1000);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheckUpdate]);

  // 가이드 사이트를 진행도와 함께 연다. 사이트의 sync.js 가 주소 해시(#sync=base64 JSON)를 읽어 완료 퀘스트를
  // 반영하므로, 브라우저가 127.0.0.1 접근을 막는 환경에서도 연동이 된다. 실패하면 그냥 가이드만 연다.
  const openGuideWithProgress = async () => {
    // 11-04: 진행도를 못 읽으면 #sync-fail=<이유> 로 열어 사이트가 GA4(sync_fail_hash)로 센다 — 전엔 그냥 열려 실패가 안 보였다
    let hash = "#sync-fail=sidecar";
    try {
      const r = await fetch(`${PYTHON_API}/progress?game_mode=${encodeURIComponent(questDisplayMode)}`);
      if (r.ok) {
        const p = await r.json();
        // 11-06: 진영(faction·faction_source)도 넘긴다 — 사이트 필요 아이템·'받을 수 있는 것만'이 반대 진영 판을 뺀다
        const payload = { mode: p.mode, completed: p.completed ?? [], started: p.started ?? [], hideout: p.hideout ?? {}, quest_count: p.quest_count ?? 0, log_ok: p.log_ok, faction: p.faction ?? null, faction_source: p.faction_source ?? null };
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        // 윈도우 명령줄(브라우저 실행) 한도 32,767자 아래로 — 넘으면 사이트의 직접 읽기(버튼)로 연동하게 둔다
        hash = b64.length < 30000 ? `#sync=${encodeURIComponent(b64)}` : "#sync-fail=too_long";
      } else {
        hash = `#sync-fail=http_${r.status}`;
      }
    } catch {
      // 사이드카가 없으면 진행도 없이 연다(hash = sidecar)
    }
    // UI 언어별 가이드(en/ru 앱이 한국어 가이드를 열던 것, 11-04) + src=app 표식
    stat("gd");
    openUrl(`${guideBase(region.lang)}items/?src=app${hash}`).catch((e) => {
      log(`guide: openUrl failed — ${String(e)}`);
    });
  };

  // 가이드 사이트 연동: 은신처 단계를 사이드카에 올려 두면 같은 PC의 tarkov.aquapado.com/guide 가
  // /progress 로 읽어 "이미 지은 단계의 재료"를 필요 아이템에서 뺀다. 사이드카가 아직 안 떴으면 몇 번 다시 시도.
  useEffect(() => {
    let tries = 0;
    let timer: number | null = null;
    const push = () => {
      fetch(`${PYTHON_API}/sync/hideout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // mode = 앱이 지금 쓰는 퀘스트 서버 → 가이드 사이트 첫 연동이 사이트 기본값(PVP) 대신 이걸 따른다
        // faction = 설정에서 직접 고른 진영 → 가이드 /progress faction 도 따른다('auto' 면 기록 추정)
        body: JSON.stringify({ levels: hideoutLevels, mode: questDisplayMode, faction: region.faction }),
      }).catch(() => {
        if (++tries < 4) timer = window.setTimeout(push, 15000);
      });
    };
    push();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [hideoutLevels, questDisplayMode, region.faction]);

  // Hideout levels helpers
  const updateHideoutLevel = (stationId: string, level: number) => {
    setHideoutLevels((prev) => {
      const next = { ...prev, [stationId]: level };
      localStorage.setItem(HIDEOUT_LEVELS_KEY, JSON.stringify(next));
      return next;
    });
  };
  const resetHideoutLevels = () => {
    localStorage.removeItem(HIDEOUT_LEVELS_KEY);
    setHideoutLevels({});
  };
  // 피드백 #49-②: 카드의 은신처 줄을 눌러 그 레벨 달성/해제. 설정의 은신처
  // 레벨과 같은 값을 고치므로 두 화면이 항상 일치한다.
  const toggleHideoutNeedDone = (stationId: string, level: number, done: boolean) => {
    if (!stationId) return;
    updateHideoutLevel(stationId, done ? Math.max(0, level - 1) : level);
  };
  // 피드백 #49-②: 퀘스트를 카드에서 직접 '달성' 표시(로그 동기화와 별개, 서버별).
  // 깰 생각이 없는 퀘스트를 목록에서 정리하는 용도.
  const toggleManualQuestDone = (mode: "pvp" | "pve" | "season", questId: string) => {
    setManualQuestDone((prev) => {
      const cur = new Set(prev[mode] ?? []);
      if (cur.has(questId)) cur.delete(questId);
      else cur.add(questId);
      const next = { ...prev, [mode]: [...cur] };
      try {
        localStorage.setItem(MANUAL_QUEST_DONE_KEY, JSON.stringify(next));
      } catch {
        // 저장 실패해도 이번 실행 동안은 표시가 유지된다
      }
      return next;
    });
  };
  const clearManualQuestDone = (mode?: "pvp" | "pve" | "season") => {
    setManualQuestDone((prev) => {
      const next = mode ? { ...prev, [mode]: [] } : {};
      try {
        localStorage.setItem(MANUAL_QUEST_DONE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };
  const fetchHideoutStations = async (lang: Lang) => {
    try {
      const res = await fetch(`${PYTHON_API}/hideout/stations?lang=${dataLang(lang)}`);
      if (res.ok) setHideoutStations(await res.json());
    } catch {
      // non-fatal; stations list shows as empty
    }
  };

  // 사이드카가 새 프레스티지를 감지하면: 그 모드의 수동 달성 표시를 비우고,
  // 최근(3일 이내) 프레스티지면 은신처 레벨 초기화도 묻는다(은신처는 모드 공용이라
  // 자동으로 지우지 않는다). 오래전 프레스티지는 조용히 '본 것'으로만 기록.
  const handlePrestige = async (pres?: Record<string, number>) => {
    if (!pres) return;
    let seen: Record<string, number> = {};
    try {
      seen = JSON.parse(localStorage.getItem(PRESTIGE_SEEN_KEY) ?? "{}");
    } catch {
      seen = {};
    }
    const fresh = (["pvp", "pve", "season"] as const).filter(
      (m) => (pres[m] ?? 0) > (seen[m] ?? 0)
    );
    if (fresh.length === 0) return;
    try {
      localStorage.setItem(PRESTIGE_SEEN_KEY, JSON.stringify({ ...seen, ...pres }));
    } catch {
      // ignore
    }
    fresh.forEach((m) => clearManualQuestDone(m));
    const recent = fresh.some(
      (m) => Date.now() / 1000 - (pres[m] ?? 0) < 3 * 86400
    );
    let hasHideout = false;
    try {
      hasHideout =
        Object.keys(JSON.parse(localStorage.getItem(HIDEOUT_LEVELS_KEY) ?? "{}"))
          .length > 0;
    } catch {
      hasHideout = false;
    }
    if (recent && hasHideout) {
      const yes = await ask(t.prestigeHideoutAsk, {
        title: t.prestigeDetected,
        kind: "info",
      });
      if (yes) resetHideoutLevels();
    }
  };

  // Quest tracker helpers — talk to the localhost FastAPI server.
  const fetchQuestStatus = async (): Promise<boolean> => {
    try {
      const res = await fetch(`${PYTHON_API}/quests/status`);
      if (!res.ok) return false;
      const data: QuestStatus = await res.json();
      setQuestStatus(data);
      // 11-03 퀘스트 연동 켬 여부·경로 유효·퀘스트 수(세션당 1회) — 실제로 켜는 사람 수를 처음 재는 것
      if (!questCfgReportedRef.current) {
        questCfgReportedRef.current = true;
        // 11-11 ac=업데이트 자동 확인·ai=자동 설치(받아 두기) — 받아 둔 업데이트가 설치 안 되는 원인이 설정 탓인지 가르려고
        // 11-12 ws=지도 나란히 보기 0(꺼짐)·L/R(지도 왼쪽/오른쪽, 외부 PR #2) — 켠 사람 수와 왼쪽을 고르는 비율
        const ws = localStorage.getItem(WIDE_KEY) === "1" ? (loadWideMapSide(localStorage) === "left" ? "L" : "R") : "0";
        reportEvent("config", `qs=${data.enabled ? 1 : 0};qp=${data.effective_path_valid ? 1 : 0};qn=${Number(data.quest_count) || 0};ac=${loadAutoCheckUpdate() ? 1 : 0};ai=${autoInstallRef.current ? 1 : 0};ws=${ws};msn=${localStorage.getItem(MINI_SNAP_KEY) === "0" ? 0 : 1}`);
      }
      // Keep the user-set path field in sync with the server's view.
      setQuestPathInput(data.install_path ?? "");
      void handlePrestige(data.prestige_by_mode);
      return true;
    } catch (e) {
      log(`quest: status fetch failed — ${String(e)}`);
      return false;
    }
  };
  const setQuestEnabled = async (enabled: boolean) => {
    try {
      const res = await fetch(`${PYTHON_API}/quests/enabled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) setQuestStatus(await res.json());
    } catch (e) {
      log(`quest: enabled toggle failed — ${String(e)}`);
    }
  };
  const submitQuestPath = async (path: string) => {
    try {
      const res = await fetch(`${PYTHON_API}/quests/path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) setQuestStatus(await res.json());
    } catch (e) {
      log(`quest: path set failed — ${String(e)}`);
    }
  };
  const resetQuestState = async (gameMode?: "pvp" | "pve" | "season", fromNow = false) => {
    // Optional gameMode wipes just one server's state (used to clear the
    // fake data the legacy migration copied into both modes for single-mode
    // players). Omit to wipe everything and re-scan.
    // fromNow=true is the WIPE RESET: sets a watermark so pre-existing log
    // events are ignored — for EFT wipes/season resets where old logs would
    // otherwise resurrect last season's progress. A plain reset undoes it.
    try {
      const res = await fetch(`${PYTHON_API}/quests/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(gameMode ? { game_mode: gameMode } : {}),
          from_now: fromNow,
        }),
      });
      if (res.ok) setQuestStatus(await res.json());
    } catch (e) {
      log(`quest: reset failed — ${String(e)}`);
    }
  };
  const wipeResetQuests = async (gameMode?: "pvp" | "pve" | "season") => {
    // Destructive-ish (recoverable via plain reset) → native yes/no first.
    const scope = gameMode === "season" ? t.gameModeSeason : gameMode ? gameMode.toUpperCase() : t.questSyncResetBtn;
    const yes = await ask(`${t.questWipeResetConfirm}\n\n(${scope})`, {
      title: t.questWipeReset,
      kind: "warning",
    });
    if (yes) {
      await resetQuestState(gameMode, true);
      // 와이프·프레스티지로 새로 시작하면 카드에서 직접 찍은 달성 표시도 함께 비운다.
      clearManualQuestDone(gameMode);
    }
  };

  // Pull the quest tracker status on mount. The Python sidecar warms up
  // EasyOCR models for several seconds before it answers HTTP, so the first
  // fetch usually fails — back off and retry until we get a response.
  // Settings open also re-fetches so counts stay current after gameplay.
  useEffect(() => {
    let cancelled = false;
    const delays = [800, 2000, 4000, 8000, 15000, 30000];
    const tryOnce = async (i: number) => {
      if (cancelled) return;
      const ok = await fetchQuestStatus();
      // Hideout stations ride the same retry cadence — they need the sidecar
      // to be up too, and both are cheap single GET calls.
      fetchHideoutStations(region.lang);
      if (ok || cancelled) return;
      if (i < delays.length) {
        window.setTimeout(() => tryOnce(i + 1), delays[i]);
      }
    };
    tryOnce(0);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const currentUiLang = region.lang;
  useEffect(() => {
    if (showSettings) {
      fetchQuestStatus();
      fetchHideoutStations(currentUiLang);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings, currentUiLang]);

  useEffect(() => {
    // Initial state: card shown briefly so user can position it, then auto-hide.
    showCard();
    scheduleHide();
    return cancelHideTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep card visible while user is actively recording a hotkey.
  useEffect(() => {
    if (recordingHotkey) {
      showCard();
    } else if (cardVisible) {
      scheduleHide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingHotkey]);

  useEffect(() => {
    if (recordingTarget === null) {
      // Recording ended (success or Esc) — clear any stale conflict marker.
      setHotkeyConflict(false);
      return;
    }
    setHotkeyConflict(false);
    // Release the OS-level grab so the chosen key actually reaches the page.
    // unregister_all_hotkeys clears both keyboard and mouse bindings, so
    // mouse X1/X2 also stop firing while the user is recording a new one.
    invoke("unregister_all_hotkeys").catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setRecordingTarget(null);
        return;
      }
      const accel = eventToAccelerator(e);
      if (accel) {
        // Cross-slot guard (same as the mouse path below): recording the
        // SAME key into both slots doesn't error at the OS level — the
        // re-register sequence silently dead-ends one binding instead
        // (unregister-all wipes both, then the duplicate register fails and
        // that slot is simply gone until changed). Refuse and show the
        // conflict hint; recording stays active.
        const otherKeySlot =
          recordingTarget === "lookup" ? toggleHotkey : hotkey;
        if (accel === otherKeySlot) {
          log(`hotkey ${accel} already bound to the other slot — ignoring`);
          setHotkeyConflict(true);
          return;
        }
        setHotkeyConflict(false);
        if (recordingTarget === "lookup") setHotkey(accel);
        else if (recordingTarget === "toggle") setToggleHotkey(accel);
        setRecordingTarget(null);
      }
    };
    const onMouse = (e: MouseEvent) => {
      const accel = mouseEventToAccelerator(e);
      if (!accel) return; // ignore left/right click — those are UI input
      // X1/X2 trigger browser back/forward by default; we always swallow.
      e.preventDefault();
      e.stopPropagation();
      // Conflict guard: same mouse button can't drive both slots. The Rust
      // poller's if/else if order would silently dead-end the second slot
      // (lookup wins, toggle never fires). Keyboard accelerators are
      // protected by the OS rejecting duplicate registrations; mouse has no
      // such guard, so we enforce it here. Recording stays active so the
      // user just picks a different button.
      const otherSlot =
        recordingTarget === "lookup" ? toggleHotkey : hotkey;
      if (accel === otherSlot) {
        log(
          `mouse hotkey ${accel} already bound to other slot — ignoring`
        );
        setHotkeyConflict(true);
        return;
      }
      setHotkeyConflict(false);
      if (recordingTarget === "lookup") setHotkey(accel);
      else if (recordingTarget === "toggle") setToggleHotkey(accel);
      setRecordingTarget(null);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onMouse, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouse, true);
      // Restore both grabs. If a hotkey changed, its useEffect will also fire
      // and re-register — duplicate registration is idempotent (each command
      // unregisters its previous accelerator first). Branch by binding type
      // so we don't try to register a "MouseX1" string as a keyboard accel.
      if (isMouseHotkey(hotkey)) {
        invoke("register_lookup_mouse", { button: hotkey }).catch(() => {});
      } else {
        invoke("register_lookup_hotkey", { accelerator: hotkey }).catch(
          () => {}
        );
      }
      if (isMouseHotkey(toggleHotkey)) {
        invoke("register_toggle_mouse", { button: toggleHotkey }).catch(
          () => {}
        );
      } else {
        invoke("register_toggle_hotkey", { accelerator: toggleHotkey }).catch(
          () => {}
        );
      }
    };
  }, [recordingTarget]);

  useEffect(() => {
    const win = getCurrentWindow();
    // Restore saved position, but only if it still lands on a connected
    // monitor. Users running a dual-monitor setup can save the overlay on
    // their secondary display and later boot with only the primary —
    // without this check, the window stays at the off-screen coordinates
    // forever (invisible, no way to reach it via the OS since the window
    // is skipTaskbar). Snap to the primary monitor's top-left in that
    // case so the user always gets a visible overlay on next launch.
    (async () => {
      try {
        if (wideModeRef.current) return; // 지도 나란히 모드로 시작하면 창은 모니터 원점으로 간다(wide 효과가 처리)
        const raw = localStorage.getItem(POSITION_KEY);
        if (!raw) return;
        const { x, y } = JSON.parse(raw);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        let onScreen = false;
        try {
          const mons = await availableMonitors();
          // Use a small margin so a window with just its top-edge visible
          // (and the rest below the screen) doesn't count as on-screen.
          const M = 32;
          for (const m of mons) {
            if (
              x >= m.position.x - M &&
              x < m.position.x + m.size.width - M &&
              y >= m.position.y - M &&
              y < m.position.y + m.size.height - M
            ) {
              onScreen = true;
              break;
            }
          }
        } catch {
          // If we can't enumerate monitors, fall back to trusting the
          // saved coords — better than wiping the user's preference.
          onScreen = true;
        }
        if (onScreen) {
          await win.setPosition(new PhysicalPosition(x, y));
          return;
        }
        // Off-screen recovery: snap to primary monitor top-left and rewrite
        // the persisted position so the next launch starts clean too.
        log(
          `position recover: saved (${x},${y}) is off-screen — snapping to primary`
        );
        const primary = await primaryMonitor();
        if (primary) {
          const nx = primary.position.x + 40;
          const ny = primary.position.y + 40;
          await win.setPosition(new PhysicalPosition(nx, ny));
          localStorage.setItem(
            POSITION_KEY,
            JSON.stringify({ x: nx, y: ny })
          );
        }
      } catch {}
    })();

    let moveSettleTimer = 0;
    let pipSnapTimer = 0;
    // 미니맵 끌기가 멈추면(0.25초, 마우스 버튼을 놓은 뒤) 자리 저장 — 자석이 켜져 있으면 작업 영역 가장자리 48px 안이면 붙인다
    const settlePip = async () => {
      try {
        const cur = await invoke<{ left?: boolean }>("get_cursor_position").catch(() => ({ left: false }));
        if (cur.left) {
          pipSnapTimer = window.setTimeout(() => void settlePip(), 250); // 아직 끄는 중(버튼 누른 채 멈춤)
          return;
        }
        const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
        const p = miniSnapRef.current ? snapToWorkArea(pos, size, await availableMonitors()) : { x: pos.x, y: pos.y };
        if (p.x !== pos.x || p.y !== pos.y) {
          pipMoveArmedAtRef.current = Date.now() + 400; // 붙이는 이동은 다시 받지 않는다
          await win.setPosition(new PhysicalPosition(p.x, p.y));
          dailyAdd("msn"); // 11-12 통계: 미니맵이 모서리·가장자리에 붙은 횟수
        }
        localStorage.setItem(RADAR_PIP_POS_KEY, JSON.stringify(p));
      } catch {}
    };
    const unlistenPromise = win.listen("tauri://move", () => {
      if (wideModeRef.current) return; // 모니터 원점으로 옮긴 건 사용자 위치가 아니다
      if (pipActiveRef.current) {
        // PiP 창을 끌어 옮긴 위치는 따로 기억(카드 자리 POSITION_KEY 는 그대로 둬야 끌 때 돌아간다)
        if (Date.now() < pipMoveArmedAtRef.current) return;
        window.clearTimeout(pipSnapTimer);
        pipSnapTimer = window.setTimeout(() => void settlePip(), 250);
        return;
      }
      if (Date.now() < pipMoveArmedAtRef.current) return; // PiP 를 끄며 원래 자리로 되돌린 이동
      // 11-07 '설정을 연 채 창을 끌면 글자가 엄청 떨린다': 이동 이벤트마다 높이 한계를 다시 재고 창 크기·설정 패널 높이를
      // 맞췄더니 실측 3초 끌기에 창 크기 설정 153회·창 높이 89번 변경(931→936→930…, 엇갈린 setSize 가 커졌다 작아졌다)이 났다.
      // → 끄는 동안엔 손대지 않고 이동이 멈춘 뒤 0.2초에 한 번만 위치 저장 + 높이 한계 다시 계산.
      settleAfterMove(true);
    });
    // 11-09 '창을 옮기니 앱이 왔다갔다·글자가 떨어졌다 붙으며 흔들렸다'(125%↔100% 모니터): 경계를 넘는 순간 Windows 가 창을 새 배율
    // 크기로 바꾸는데 devicePixelRatio 는 아직 옛 값이라, 카드 감시 → apply 가 옛 배율로 setSize(100% 모니터에 1000px 폭)를 끼워 넣어
    // Windows 와 반대로 당겼다(실측: 640x438@1.25 → setSize 1000x682 → 800x546 두 번). 이동 중 억제가 위치 저장에만 걸려 있었던 것.
    // → 옮기는 중·배율 바뀌는 중엔 apply 를 통째로 쉬고, 마지막 이벤트 0.2초 뒤 한계 재계산 + 크기 맞춤을 한 번만
    const settleAfterMove = (savePos: boolean) => {
      windowSettlingRef.current = true;
      window.clearTimeout(moveSettleTimer);
      moveSettleTimer = window.setTimeout(() => {
        windowSettlingRef.current = false;
        if (!savePos) {
          // Window moved → its top edge changed → recompute the height ceiling so
          // settings stay reachable wherever the user parks the overlay (id20).
          applyRef.current?.();
          return;
        }
        win.outerPosition().then((pos) => {
          localStorage.setItem(
            POSITION_KEY,
            JSON.stringify({ x: pos.x, y: pos.y })
          );
          // 배율 왕복으로 멈춰 있었으면: 사용자가 실제로 옮겼을 때만(8px 넘게) 푼다. 왕복 중 Windows 가 보내는 제자리 이동으론 안 풂
          const hold = dprHoldRef.current;
          if (hold && Number.isFinite(hold.x) && !(Math.abs(pos.x - hold.x) <= 8 && Math.abs(pos.y - hold.y) <= 8)) {
            dprHoldRef.current = null;
            dprFlipsRef.current = [];
          }
          applyRef.current?.();
        }).catch(() => applyRef.current?.());
      }, 200);
    };
    const unScalePromise = win.onScaleChanged(() => {
      if (wideModeRef.current || pipActiveRef.current) return; // 이 두 모드는 창 크기를 apply 가 정하지 않는다
      settleAfterMove(false);
    });
    return () => {
      window.clearTimeout(moveSettleTimer);
      window.clearTimeout(pipSnapTimer);
      windowSettlingRef.current = false;
      unlistenPromise.then((fn) => fn());
      unScalePromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // Resize the window to match the card's actual rendered height.
  // ResizeObserver fires whenever the card's content changes — settings open/close,
  // donate panel toggle, font size change, history panel, update banner, etc.
  // Uses scrollHeight (the *natural* content height, ignoring the card's
  // max-height: calc(100vh - 24px) cap). Using getBoundingClientRect would
  // create a feedback loop: small initial card → small window → small vh →
  // even smaller card max-height → window stuck at ~100px forever.
  // Clamped to the space BELOW the window's top edge so the card scrolls
  // inside itself when content exceeds what fits on-screen from there.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    let raf = 0;
    const apply = () => {
      // 창을 옮기는 중·배율이 바뀌는 중엔 쉰다 — 멈춘 뒤 0.2초에 move/배율 감시가 recompute → apply 를 한 번 부른다
      if (windowSettlingRef.current) return;
      // 배율 왕복 차단: 2초 안에 배율이 3번 바뀌면(크기를 맞출 때마다 Windows 가 창을 다른 모니터 것으로 본다) 그 자리에선 더 맞추지 않는다.
      // 실측(경계에 걸친 x=2110): 3초에 setSize 390회, 1000x562@1 ↔ 800x450@1.25 왕복. 사용자가 창을 옮기면 move 감시가 푼다
      const dpr = window.devicePixelRatio || 1;
      if (dpr !== lastDprRef.current) {
        lastDprRef.current = dpr;
        const now = Date.now();
        dprFlipsRef.current = [...dprFlipsRef.current.filter((t) => now - t < 2000), now];
        if (dprFlipsRef.current.length >= 3 && !dprHoldRef.current) {
          dprHoldRef.current = { x: NaN, y: NaN };
          getCurrentWindow().outerPosition().then((p) => {
            if (dprHoldRef.current) dprHoldRef.current = { x: p.x, y: p.y };
          }).catch(() => {});
          log("window: 배율 왕복 감지(두 모니터 경계에 걸침) — 창을 옮길 때까지 크기 맞춤 멈춤");
        }
      }
      if (dprHoldRef.current) return;
      // 설정 패널이 열려 있으면 먼저 화면에 들어가는 높이로 잘라 둔다 — 창을 아래로 옮기거나(한계가 줄어듦)
      // 배너가 생겨 나머지 내용이 커졌을 때도 카드 스크롤(두 번째 막대)이 생기지 않게
      const se = settingsRef.current;
      if (se && showSettingsRef.current && !resizingRef.current) {
        // 목표 = min(저장된 선호 높이, 지금 들어가는 높이). 줄이기만 하면 작은 창에서 잘린 높이가 나란히 모드로
        // 커진 뒤에도 그대로 남는다(11-02 확인) — 공간이 생기면 선호 높이까지 다시 편다. 끄는 중엔 손잡이가 우선
        const m = settingsMaxH();
        const pref = parseInt(localStorage.getItem(SETTINGS_HEIGHT_KEY) ?? "", 10) || se.offsetHeight;
        const target = Math.max(200, Math.min(pref, m));
        if (Math.abs(se.offsetHeight - target) > 1) se.style.height = `${target}px`;
      }
      if (wideModeRef.current) return; // 지도 나란히: 창은 모니터 크기 그대로
      if (pipActiveRef.current) return; // PiP: 창 = 지도 크기(PiP 효과가 정한다)
      // When the user has dragged an explicit card height (price-card view
      // only — settings mode returns null), size the window to that override
      // instead of the content's scrollHeight. Otherwise the window stays at
      // content height and clips the dragged-taller card, making vertical
      // resize appear to do nothing.
      const override = cardHeightOverrideForResize();
      // scrollHeight 엔 카드 테두리(위아래 1px씩)가 빠져 있다 — 그대로 쓰면 창이 늘 2px 모자라 내용이 꽉 찰 때마다
      // 카드에 스크롤 막대가 생겼다(11-02 '스크롤이 두 개' 제보의 나머지 절반). offsetHeight−clientHeight = 테두리
      const contentH =
        override != null ? override : Math.ceil(el.scrollHeight + (el.offsetHeight - el.clientHeight));
      const h = contentH + WIN_VPAD;
      const clamped = Math.min(Math.max(h, 100), maxWinHRef.current);
      // 11-07 '설정창 글자가 계속 떨린다'(멈춘 상태): 125% 배율에서 요청한 높이(929)가 물리 픽셀 반올림으로 928/930 이 되고,
      // 카드 scrollHeight(내용이 칸보다 작으면 칸 높이)가 따라 바뀌어 setSize 가 초당 60번 928↔930 을 왕복했다(실측 3초 193회).
      // 창이 필요한 것보다 3px 이내로만 크면 그대로 둔다(조금 큰 건 스크롤 막대도 안 생겨 무해). 모자라거나 크게 줄 때만 맞춘다.
      const cur = window.innerHeight;
      if (clamped <= cur && cur - clamped <= 3) return;
      // 11-07 2차: 논리 높이로 요청하면 125% 에서 733 → 916.25px 처럼 만들 수 없는 높이가 되어 반올림으로 732 가 되고,
      // '1px 모자람' → 다시 요청을 끝없이 반복했다(실측 멈춘 상태 3초 123회, 732↔734). 실제 픽셀로 올림해 요청하면
      // 요청한 높이 이상이 항상 만들어져 다음 계산에서 멈춘다.
      const sf = window.devicePixelRatio || 1;
      getCurrentWindow()
        .setSize(new PhysicalSize(Math.round(WIN_BASE_W * sf), Math.ceil(clamped * sf)))
        .catch(() => {});
    };
    // Recompute the window-height ceiling for the window's CURRENT position.
    // The old code capped at the full screen height regardless of where the
    // window sat, so a window placed low on screen grew past the bottom edge
    // and its lower settings became unreachable (1.1.4 user report). We cap at
    // the space from the window's top to the bottom of the monitor it's on —
    // computed per-monitor so it's correct on multi-monitor / DPI-scaled
    // setups (top relative to the window's own monitor, logical px).
    const recompute = async () => {
      try {
        const win = getCurrentWindow();
        const [pos, mon] = await Promise.all([
          win.outerPosition(),
          currentMonitor(),
        ]);
        if (mon) {
          const scale = mon.scaleFactor || 1;
          const relTopLogical = (pos.y - mon.position.y) / scale;
          const monHLogical = mon.size.height / scale;
          const availBelow = monHLogical - relTopLogical - WIN_SCREEN_MARGIN;
          maxWinHRef.current = Math.max(300, Math.min(screenMaxH(), availBelow));
        } else {
          maxWinHRef.current = screenMaxH();
        }
      } catch {
        maxWinHRef.current = screenMaxH();
      }
      apply();
    };
    // Let the move listener trigger a recompute when the user drags the window.
    applyRef.current = recompute;
    applySizeRef.current = apply;
    const ro = new ResizeObserver(() => {
      // Coalesce bursts of resize events to one frame.
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    });
    ro.observe(el);
    // Also observe children — scrollHeight changes when descendants resize
    // (e.g. an image loading) but ResizeObserver on the card itself only
    // fires when the card's *own* box changes. A MutationObserver on the
    // subtree catches content additions that don't immediately reflect in
    // the card's box.
    const mo = new MutationObserver(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    recompute();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      applyRef.current = null;
    };
  }, []);

  // Tray icon events: left-click or "Show" menu item brings the card up.
  // "Settings" menu item brings the card up AND opens the settings panel.
  useEffect(() => {
    const unlistenShow = listen("tray-show", () => {
      log("React: tray-show event");
      showCard();
      setShowDonate(false);
      // Window size is driven by the ResizeObserver on the card; just trigger
      // re-show and let it converge once the card content settles.
      scheduleHide();
    });
    const unlistenSettings = listen("tray-settings", () => {
      log("React: tray-settings event");
      showCard();
      setShowSettings(true);
      scheduleHide();
    });
    return () => {
      unlistenShow.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    log("React: subscribing to hotkey-lookup");
    const unlistenPromise = listen<{ x: number; y: number }>(
      "hotkey-lookup",
      async (event) => {
        const r = loadRegion();
        log(`React: got hotkey-lookup payload=${JSON.stringify(event.payload)} region=${JSON.stringify(r)}`);
        // Ensure the OS window is visible — the user may have hidden it via
        // the X button (which calls hide_to_tray → window.hide()), in which
        // case flipping React state alone leaves the card invisible.
        const win = getCurrentWindow();
        const reveal = async () => {
          try {
            if (!(await win.isVisible())) {
              // Passive reveal: show WITHOUT taking focus, so ESC/Tab keep going
              // to the game. A plain show()+setFocus() stole focus — after the
              // card auto-hid, the next F2 made the overlay swallow the keypress
              // until you clicked back in-game (reported on 1.1.1/1.1.2).
              await invoke("show_overlay_passive");
            }
          } catch {}
          showCard(); // bring card up + cancel any in-flight hide
          setShowSettings(false);
        };
        // F2는 시세 카드로. 단, 게임 스크린샷 키와 공유 중이면 지도를 띄워 둔 채 조회한다 —
        // 인벤토리 밖에서 누른 F2는 '스크린샷+지도 갱신'이 목적이라 빈 조회로 지도를 덮지 않게.
        // 11-07: 공유 중이면 누르는 순간 '조회 중'·숨은 카드 띄우기도 안 한다(lookupOutcome.pressView) — 읽었을 때만 카드
        const atPress = pressView({ passthrough: hotkeyPassthroughRef.current, mapShown: radarActiveRef.current, wideMode: wideModeRef.current });
        if (atPress.reveal) await reveal();
        diag("f2");
        if (pipActiveRef.current) miniReturnRef.current = true; // 작은 지도에서 누른 조회 — 카드를 다 보면 작은 지도로
        if (!hotkeyPassthroughRef.current) setRadarActive(false);
        else sharedPressAtRef.current = performance.now();
        const prevStatus = statusRef.current; // 키 공유로 결과를 숨기게 되면 이 상태로 되돌린다
        if (atPress.loading) {
          setStatus("loading");
          setError("");
        }
        // New lookup generation: invalidates any still-running older lookup
        // so its late (retried) response can't overwrite this one.
        const seq = ++lookupSeqRef.current;
        lookupInFlightRef.current = true;
        const body = JSON.stringify({
          x: event.payload.x + r.offsetX,
          y: event.payload.y + r.offsetY,
          width: r.width,
          height: r.height,
          lang: getGameLang(r),
          game_mode: r.gameMode,
          mirror_x: event.payload.x - r.offsetX - r.width,
          cursor_x: event.payload.x,
          cursor_y: event.payload.y,
          ground_x: event.payload.x + r.groundOffsetX,
          ground_y: event.payload.y + r.groundOffsetY,
          ground_width: r.groundWidth,
          ground_height: r.groundHeight,
          // Per-press counter so the sidecar can supersede this lookup's OCR
          // if a newer F2 arrives mid-flight (server keys ordering on this,
          // not a ticket it assigns after its own cursor/clamp work).
          client_seq: seq,
          // 11-08 스크린샷 키와 공유 중인 누름 — 툴팁·바닥 이름표가 없으면 사이드카가 OCR 을 건너뛴다(레이드 중 프레임 드랍)
          shared: hotkeyPassthroughRef.current,
        });
        // Abort the previous in-flight request so its catch sees AbortError +
        // stale seq → no-op (frees the client-side wait). Aborting alone does
        // NOT stop the sidecar's OCR — /lookup is a sync handler that runs to
        // completion regardless. The actual concurrent-OCR cap on rapid F2 is
        // the server-side supersession ticket (main.py _lookup_superseded),
        // which makes a stale worker bail before its next capture.
        lookupAbortRef.current?.abort();
        const controller = new AbortController();
        lookupAbortRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), 120000);
        const t0 = performance.now(); // 응답 시간(하루 요약의 lat 중앙값)
        try {
          const res = await fetchWithRetryOnce(`${PYTHON_API}/lookup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data: LookupResult = await res.json();
          connFailRef.current = 0;
          sidecarMissingRef.current = false; // 11-09 검토: 첫 시도만 '파일 없음'(백신 검사 중)이고 재시도로 뜬 경우 안내가 영구히 남던 것
          if (seq !== lookupSeqRef.current) {
            log("React: stale lookup result discarded (newer press in flight)");
            return;
          }
          log(`React: result item_name=${data.item_name} raw="${data.raw_text}"`);
          // 화면 결정(lookupOutcome.viewAfterLookup): 읽었거나 키가 따로면 결과 카드. 같은 키 + 못 읽음(인벤토리 밖
          // 스크린샷용 누름)이면 보통 모드는 지도, 나란히 모드는 화면 그대로 — 둘 다 상태는 조회 직전으로 되돌린다
          // (11-03: 예전엔 "loading" 에 남아 '조회 중…'이 멈췄고, 보통 모드는 스크린샷 감지 속도에 따라 지도·못 찾음이 갈렸다).
          if (data.item_name != null) {
            if (!atPress.reveal) {
              await reveal(); // 공유 키로 읽은 아이템 — 이제 카드를 띄운다
              if (seq !== lookupSeqRef.current) return;
            }
            setRadarActive(false);
          }
          const view = viewAfterLookup({
            passthrough: hotkeyPassthroughRef.current,
            matched: data.item_name != null,
            wideMode: wideModeRef.current,
            prev: prevStatus,
            hasResult: hasResultRef.current,
          });
          if (view.kind === "result") {
            setResult(data);
            setStatus("success");
            if (data.item_name != null) {
              markStartDoneRef.current("done");
              endTourRef.current("lookup");
            }
          } else {
            setStatus(view.status);
            if (view.kind === "map") void openRadarRef.current(true, false);
          }
          // Wide-rescue matches stay OUT of history: the enlarged box can
          // read static UI captions ("BODY ARMOR", trader names…) that the
          // match chain resolves to real-looking items — letting those into
          // the recent list would push out genuine entries and a re-click
          // would "confirm" the wrong item forever.
          if (data.attempt !== "wide") {
            setHistory(addToHistory(data));
          }
          // 공유 키로 못 읽은 누름(인벤토리 밖 스크린샷)은 실패음도 안 낸다 — 스크린샷마다 '실패' 소리가 났다
          if (loadSoundOn() && (data.item_name != null || !hotkeyPassthroughRef.current)) playDing(data.item_name != null);
          // Outcome telemetry (breakage detection): classify the lookup.
          // "wide_" prefix = the zoom-out rescue produced this read; without
          // it, rescue-read text silently migrates capture-miss events from
          // "empty" into "no_match" and the misread-vs-misaligned split on
          // the dashboard stops meaning anything.
          // 11-10 상자 어긋남(하루 요약): 저장된 캡처 상자가 지금 게임 모니터에 맞는지 · 어긋난 조회의 실패 수 — 4K@150 실패 가설
          // 판정용(상자는 첫 실행 때 주 모니터 바탕화면 기준). 공유 키 누름은 인벤토리 밖이 대부분이라 뺀다.
          if (!hotkeyPassthroughRef.current && Array.isArray(data.mon) && data.mon.length === 2) {
            const fail = data.item_name == null;
            dailyAdd("bxn");
            if (fail) dailyAdd("bxe");
            if (boxMismatch(r.height, data.mon[0], data.mon[1])) {
              dailyAdd("bxm");
              if (fail) dailyAdd("bxf");
            }
            dailySample("mh", data.mon[1]);
            dailySample("bxh", r.height);
          }
          if (data.item_name == null) {
            // "share_" = 게임 스크린샷 키와 공유 중인 누름 — 인벤토리 밖에서 누른 게 대부분이라
            // 대시보드의 '캡처 영역 빗나감(empty)' 비율에 섞이지 않게 따로 표시
            const pfx = (hotkeyPassthroughRef.current ? "share_" : "") + (data.attempt === "wide" ? "wide_" : "");
            reportEvent("lookup_nomatch", pfx + nomatchCategory(data.raw_text));
            // 스크린샷 키 공유 중엔 인벤토리 밖 누름이 대부분이라 도움 판단에서 뺀다
            if (!hotkeyPassthroughRef.current) trackF2Outcome(false, nomatchCategory(data.raw_text));
          } else if (data.flea_price == null && data.trader_price == null) {
            // Matched but untradeable / no market price — send the public
            // catalog id so the dashboard shows WHICH items (e.g. new patch
            // items) are surfacing as priceless.
            reportEvent("lookup_noprice", data.item_id ?? undefined);
            trackF2Outcome(true); // 아이템은 읽었다(시세만 없음)
          } else {
            trackF2Outcome(true);
            // Tag wide-rescue successes too: without it the rescue's hit
            // rate (and its false positives) hide inside plain "lookup" and
            // the rescue's precision can never be measured post-release.
            // 11-03: 성공 조회에 공개 카탈로그 아이템 id 를 붙인다 → 콘솔 '가장 많이 찾는 아이템'.
            // OCR 원문은 여전히 안 보낸다. 확대 재시도 성공은 "wide:<id>" 로 구분 유지.
            const okId = typeof data.item_id === "string" ? data.item_id.slice(0, 32) : "";
            reportEvent(
              "lookup",
              data.attempt === "wide" ? (okId ? `wide:${okId}` : "wide") : okId || undefined
            );
            dailyLat(performance.now() - t0);
            dailyStages(data.timing);
            if (data.tooltip_wait === "waited_none") dailyAdd("twn"); // 툴팁이 떠 있었는데 판정이 놓쳐 끝까지 기다린 성공 조회
            if (data.tooltip_wait === "off") dailyAdd("two"); // 11-09 이 PC 에선 판정이 계속 빗나가 대기를 끈 상태의 성공 조회(자가 보정)
          }
        } catch (e) {
          const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          log(`React: fetch ERROR ${msg}`);
          if (seq !== lookupSeqRef.current) return; // stale failure — ignore
          if (!atPress.reveal) await reveal(); // 사이드카 오류는 공유 키여도 알린다
          // Human messages for the two known cases; raw error only for the
          // unexpected rest. "TypeError: Failed to fetch" terrified users —
          // it's just the sidecar (re)starting.
          if (e instanceof TypeError) connFailRef.current++;
          setError(
            e instanceof Error && e.name === "AbortError"
              ? T[r.lang].timeout
              : e instanceof TypeError
                ? sidecarErrorText(T[r.lang], sidecarDeadRef.current, sidecarMissingRef.current, connFailRef.current)
                : msg
          );
          setStatus("error");
          if (loadSoundOn()) playDing(false);
          // Tag transport failures so they don't inflate the SUCCESS count:
          // before this, cp949-500s and connection errors were reported as
          // plain "lookup" and the dashboard's ok/fail split was wrong.
          reportEvent("lookup", "fetch_error");
        } finally {
          clearTimeout(timeoutId);
          // Only the CURRENT generation may end the in-flight state and
          // start the auto-hide countdown — a stale lookup's finally must
          // not hide the card under the newer lookup still running.
          if (seq === lookupSeqRef.current) {
            lookupInFlightRef.current = false;
            scheduleHide();
          }
        }
      }
    );
    return () => {
      unlistenPromise.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle hotkey: show last result if hidden, hide if shown.
  useEffect(() => {
    const unlisten = listen("hotkey-toggle", async () => {
      log("React: hotkey-toggle");
      toggleAtRef.current = performance.now();
      const win = getCurrentWindow();
      try {
        const visible = await win.isVisible();
        if (!visible) {
          // Passive reveal (no focus steal) — same reason as the F2 path.
          await invoke("show_overlay_passive");
        }
      } catch {}
      // Internal card visibility flip. 업데이터 함수 안에서 타이머를 걸지 않는다(React 가 업데이터를 다시 부를 수
      // 있어 부작용이 두 번 날 수 있다) — 거울 ref 로 다음 값을 정하고 ref 도 바로 바꿔 연타도 한 번씩 뒤집힌다.
      const show = !cardVisibleRef.current;
      diag(show ? "toggle:show" : "toggle:hide");
      cardVisibleRef.current = show;
      cancelHideTimer();
      setCardVisible(show);
      if (show) scheduleHide(); // 커서가 카드 위면 폴링이 곧 취소하고, 못 해도 숨기기 직전 확인이 막는다
    });
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (n: number | null | undefined) =>
    n == null ? "—" : n.toLocaleString() + " ₽";

  const fmtSlot = (price: number | null, w: number | null, h: number | null) => {
    if (price == null || !w || !h) return null;
    const slots = w * h;
    if (slots <= 1) return null; // 1x1: per-slot is identical, skip
    return Math.round(price / slots).toLocaleString() + " " + t.perSlotUnit;
  };

  const fmtDuration = (sec: number): string => {
    if (!sec || sec <= 0) return "";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${Math.max(1, m)}m`;
  };

  const trendPct = (pct: number | null | undefined) => {
    if (pct == null) return null;
    const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "•";
    const sign = pct > 0 ? "+" : "";
    return { arrow, text: `${arrow} ${sign}${pct.toFixed(1)}%`, sign: pct };
  };

  const updateRegion = <K extends keyof Region>(key: K, value: Region[K]) =>
    setRegion((r) => ({ ...r, [key]: value }));

  // Direct-name lookup (skips capture+OCR). Used by recent-history re-lookup.
  const lookupByName = async (name: string, itemId?: string | null) => {
    const r = loadRegion();
    showCard();
    setStatus("loading");
    setError("");
    // Same generation/in-flight discipline as the F2 path, plus a 30s abort:
    // no OCR happens here, so a hung half-open socket (not refused — just
    // silent) would otherwise pin the card on "loading" forever.
    const seq = ++lookupSeqRef.current;
    lookupInFlightRef.current = true;
    lookupAbortRef.current?.abort(); // cancel any in-flight lookup (see F2 path)
    const controller = new AbortController();
    lookupAbortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const body = JSON.stringify({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      lang: getGameLang(r),
      game_mode: r.gameMode,
      override_text: name,
      // 11-08: 게임 언어를 바꾼 뒤 예전 기록을 누르면 그 이름이 지금 목록에 없다 — 사이드카가 id 로 지금 언어 이름을 찾게
      item_id: itemId ?? null,
      // Bump the server's seen-seq too, so a manual/history re-lookup
      // supersedes any F2 capture still running in the sidecar.
      client_seq: seq,
    });
    dailyAdd("man"); // 직접 입력·기록 재조회 횟수(하루 요약)
    try {
      const res = await fetchWithRetryOnce(`${PYTHON_API}/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      connFailRef.current = 0;
      sidecarMissingRef.current = false; // 11-09 검토: 첫 시도만 '파일 없음'(백신 검사 중)이고 재시도로 뜬 경우 안내가 영구히 남던 것
      const data: LookupResult = await res.json();
      if (seq !== lookupSeqRef.current) return; // stale — a newer lookup won
      setResult(data);
      setStatus("success");
      setHistory(addToHistory(data));
      if (loadSoundOn()) playDing(data.item_name != null);
      // Same outcome telemetry as the F2 path — manual ("직접 입력") and
      // history re-lookups were previously invisible to the dashboard, which
      // under-counted real lookup volume. (Doesn't affect the activation
      // funnel: reaching this path requires a prior F2 result anyway.)
      // "manual_" prefix: a manual-input typo is NOT an OCR misread signal —
      // mixing them into the same buckets polluted the failure diagnostics.
      if (data.item_name == null) {
        reportEvent("lookup_nomatch", "manual_" + nomatchCategory(data.raw_text));
      } else if (data.flea_price == null && data.trader_price == null) {
        reportEvent("lookup_noprice", data.item_id ?? undefined);
      } else {
        // "manual:<id>" — 콘솔이 F2 와 수동을 나눠 세고, 아이템 순위에도 같이 들어간다
        reportEvent("lookup", typeof data.item_id === "string" ? `manual:${data.item_id.slice(0, 32)}` : "manual");
      }
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (seq !== lookupSeqRef.current) return; // stale failure — ignore
      // Same human-readable mapping as the F2 path (raw "Failed to fetch"
      // reads like a crash; it's just the sidecar restarting). AbortError here
      // is the 30s timer (a supersession-abort would have hit the stale-seq
      // return above), so use the 30s copy — not the 120s F2 message.
      if (e instanceof TypeError) connFailRef.current++;
      setError(
        e instanceof Error && e.name === "AbortError"
          ? t.timeoutShort
          : e instanceof TypeError
            ? sidecarErrorText(t, sidecarDeadRef.current, sidecarMissingRef.current, connFailRef.current)
            : msg
      );
      setStatus("error");
      if (loadSoundOn()) playDing(false);
      reportEvent("lookup", "fetch_error");
    } finally {
      clearTimeout(timeoutId);
      if (seq === lookupSeqRef.current) {
        lookupInFlightRef.current = false;
        scheduleHide();
      }
    }
  };

  // Unified bottom-right resize handle. Horizontal always resizes the card
  // width. Vertical is context-aware: in settings mode it resizes the
  // settings scroll panel (folding in what used to be a separate ns-resize
  // bar under the panel), otherwise it resizes the card height. This is the
  // single resize affordance for every view. Double-click resets.
  const onResizeHandleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const inSettings = showSettings && !captureModalOpen;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = cardRef.current?.getBoundingClientRect();
    const startW =
      rect?.width ?? Math.round((280 * region.fontSize) / FONT_DEFAULT);
    const startH = rect?.height ?? 200;
    const settingsEl = settingsRef.current;
    const startSettingsH = settingsEl?.offsetHeight ?? 400;
    const maxH = screenMaxH() - WIN_VPAD;
    const clampW = (raw: number) =>
      Math.max(CARD_W_MIN, Math.min(CARD_W_MAX, Math.round(raw)));
    const clampH = (raw: number) =>
      Math.max(CARD_H_MIN, Math.min(maxH, Math.round(raw)));
    // Settings panel bounds: 200px ~ 화면에 들어가는 높이(settingsMaxH, 최대 2000). 끌기 시작할 때 한 번 잰다.
    const settingsMax = settingsMaxH();
    const clampSettingsH = (raw: number) =>
      Math.max(200, Math.min(settingsMax, Math.round(raw)));
    resizingRef.current = true;
    cancelHideTimer();
    document.body.style.cursor = "nwse-resize";
    // rAF-throttle the updates: pointermove can fire far faster than the
    // display refresh (gaming mice poll at 500–1000 Hz). Coalescing to one
    // update per frame keeps the drag smooth instead of flooding React /
    // layout with redundant work.
    let pendingX = startX;
    let pendingY = startY;
    let moveRaf = 0;
    const flushMove = () => {
      moveRaf = 0;
      setCardWidth(clampW(startW + (pendingX - startX)));
      if (inSettings) {
        // Resize the settings scroll box directly; its ResizeObserver
        // persists the height and grows/shrinks the window to match.
        if (settingsEl)
          settingsEl.style.height = `${clampSettingsH(
            startSettingsH + (pendingY - startY)
          )}px`;
      } else {
        setCardHeight(clampH(startH + (pendingY - startY)));
      }
    };
    const onMove = (ev: PointerEvent) => {
      pendingX = ev.clientX;
      pendingY = ev.clientY;
      if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moveRaf) cancelAnimationFrame(moveRaf);
      resizingRef.current = false;
      document.body.style.cursor = "";
      // Apply final exact values synchronously (the last rAF may not have
      // flushed the very last move before pointerup).
      const finalW = clampW(startW + (ev.clientX - startX));
      setCardWidth(finalW);
      try {
        localStorage.setItem(CARD_WIDTH_KEY, String(finalW));
      } catch {}
      if (inSettings) {
        const finalSH = clampSettingsH(startSettingsH + (ev.clientY - startY));
        if (settingsEl) settingsEl.style.height = `${finalSH}px`;
        try {
          localStorage.setItem(SETTINGS_HEIGHT_KEY, String(finalSH));
        } catch {}
      } else {
        const finalH = clampH(startH + (ev.clientY - startY));
        setCardHeight(finalH);
        try {
          localStorage.setItem(CARD_HEIGHT_KEY, String(finalH));
        } catch {}
      }
      scheduleHide();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // 11-07 머리글 끌기를 직접 처리. Tauri 의 data-tauri-drag-region(drag.js)은 mousedown detail===2(더블클릭)에
  // internal_toggle_maximize 를 걸고, 그 명령은 resizable 이면 maximizable 과 무관하게 창을 최대화한다 → 나란히 모드에서
  // 머리글을 두 번 누르면 창이 모니터 크기로 커졌다가(최대화) 크기 기억 로직·복원에 되돌아와 '커졌다 바로 줄어드는' 현상.
  // 첫 클릭(detail 1)만 끌기, 더블클릭은 아무것도 안 함. 머리글 안 버튼·입력칸은 제외.
  const onHeaderDown = (e: React.MouseEvent) => {
    if (pinned || e.button !== 0) return;
    if ((e.target as Element).closest("button, input, select, a, textarea")) return;
    if (e.detail === 2) {
      // 더블클릭: 나란히 = 이 모니터 채우기(모서리 더블클릭과 같음) / 보통 = 카드 크기 초기화
      if (wideModeRef.current) void resetWideRect();
      else resetCardSize();
      return;
    }
    if (e.detail !== 1) return;
    getCurrentWindow()
      .startDragging()
      .catch((err) => log(`header drag failed: ${String(err)}`));
  };
  const resetCardSize = () => {
    // Width resets in every mode (the handle drives width everywhere).
    setCardWidth(null);
    try {
      localStorage.removeItem(CARD_WIDTH_KEY);
    } catch {}
    if (showSettings && !captureModalOpen) {
      // Settings mode: the vertical axis controls the settings panel, so
      // reset that back to its CSS default (clear inline height + key).
      if (settingsRef.current) settingsRef.current.style.height = "";
      try {
        localStorage.removeItem(SETTINGS_HEIGHT_KEY);
      } catch {}
    } else {
      setCardHeight(null);
      try {
        localStorage.removeItem(CARD_HEIGHT_KEY);
      } catch {}
    }
  };

  // Full-name hover tooltip. The native `title` attribute renders the label at
  // the OS cursor hotspot, so the cursor itself covered the name (1.1.4 user
  // report). This replaces it with a fixed-position label offset UP-right of
  // the cursor. It must live OUTSIDE .card: .card's `backdrop-filter` makes it
  // a containing block AND clips via overflow, which would trap/clip a fixed
  // child. Driven by event delegation — any descendant carrying data-fullname
  // shows its value.
  const [hoverTip, setHoverTip] = useState<
    { text: string; x: number; y: number } | null
  >(null);
  const hoverElRef = useRef<HTMLElement | null>(null);
  const onCardMouseMove = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement)?.closest?.(
      "[data-fullname]"
    ) as HTMLElement | null;
    // Anchor to the hovered element (not the cursor): only re-render when the
    // target changes, and the label sits ABOVE the name so the cursor never
    // covers it. getBoundingClientRect is viewport-relative = fixed coords.
    if (el === hoverElRef.current) return;
    hoverElRef.current = el;
    const text = el?.dataset.fullname;
    if (el && text) {
      const r = el.getBoundingClientRect();
      setHoverTip({ text, x: r.left, y: r.top });
    } else {
      setHoverTip(null);
    }
  };

  const miniOn = radarMini && radarActive && !showSettings && !wideMode; // 미니맵 모드가 실제로 보이는 조건(나란히·설정 중엔 아님)
  return (
    <div className={`overlay${wideMode ? " wide" : ""}${wideMode && wideMapSide === "left" ? " map-left" : ""}${wideMode && portrait ? " portrait" : ""}${pipActive ? " pip" : ""}${dodging ? " dodge" : ""}`}>
      {hoverTip && (
        <div
          className="hover-fullname"
          style={{
            left: Math.max(4, Math.min(hoverTip.x, window.innerWidth - 228)),
            top: Math.max(4, hoverTip.y - 26),
          }}
        >
          {hoverTip.text}
        </div>
      )}
      <div
        ref={cardRef}
        className={`card${cardVisible ? "" : " card-hidden"}${pinned ? " card-pinned" : ""}${miniOn ? " card-mini" : ""}`}
        style={{
          "--card-fs": `${region.fontSize}px`,
          // 지도가 열려 있으면 카드 폭을 지도 크기 + 카드 안쪽 여백(14×2 + 테두리 2)에 맞춰 넓힌다(사용자가 더 넓혔으면 그대로)
          // 설정이 열려 있으면 최소 360px — 긴 라벨·셀렉트·버튼 묶음이 좁은 카드에서 서로 밀어내지 않게(11-02 점검)
          // 미니맵 모드는 지도 크기 그대로(카드 기본 폭·사용자가 넓힌 폭 무시 — '어느 선 이하로 안 줄어든다' 피드백)
          width: miniOn ? `${miniSize}px` : `${Math.min(CARD_W_MAX, Math.max(cardWidth ?? Math.round((280 * region.fontSize) / FONT_DEFAULT), radarActive && !showSettings ? radarSize + 30 : 0, showSettings ? 360 : 0))}px`,
          // Explicit height only when the user dragged one AND we're in the
          // plain price-card view; otherwise auto (content height, capped by
          // max-height in CSS). Settings/capture-modal must not inherit the
          // card-height override — they size themselves and the window-resize
          // observer ignores the override in those modes too (kept in sync).
          ...(cardHeight != null && !showSettings && !captureModalOpen && !radarActive
            ? { height: `${cardHeight}px`, maxHeight: `${cardHeight}px` }
            : {}),
          // Auto-hide already handles the full 0→opacity transition via
          // .card-hidden. We only dim while visible so the fade-out can
          // still drop to 0 without fighting the user's preference.
          // 지도가 열려 있으면 최소 90% — 점·이름표가 게임 화면에 묻히지 않게(사용자 설정은 그대로 둔다)
          // 미니맵 모드는 하한 없이 사용자 설정 그대로(게임 화면 위에 얹는 용도) — 지도 그림만 따로 '지도 불투명도'로 조절
          // 11-05: 카드 전체 opacity 대신 줄마다(--card-op, App.css) — 부모가 투명하면 자식을 더 진하게 못 해서,
          // 설정 버튼·설정의 두 불투명도 줄은 최소 50% 로 남겨 다시 찾을 수 있게(사용자 요청). 숨김(.card-hidden)은 카드 전체 opacity 0 그대로
          ["--card-op" as string]: String((radarActive && !miniOn ? Math.max(region.opacity, RADAR_MIN_OPACITY) : region.opacity) / 100),
          // Background-only opacity: fades the dark panel behind the text
          // (consumed by .card's background rgba), text/icons stay opaque.
          ["--card-bg-alpha" as string]: String(region.bgOpacity / 100),
        } as React.CSSProperties}
        onMouseEnter={() => {
          mouseOverCardRef.current = true;
          cancelHideTimer();
        }}
        onMouseMove={onCardMouseMove}
        onMouseLeave={() => {
          mouseOverCardRef.current = false;
          hoverElRef.current = null;
          setHoverTip(null);
          if (!recordingHotkey) scheduleHide();
        }}
      >
        {/* 머리글 끌기 = onHeaderDown(첫 클릭만). 고정이면 안 끌림. data-tauri-drag-region 은 더블클릭 최대화 때문에 안 쓴다(11-07) */}
        <div className={`header${startCard ? " header-labels" : ""}`} onMouseDown={onHeaderDown}>
          <span className="title" data-tour="drag">{t.title}</span>
          <div className="header-actions">
            <span className="hotkey" data-tour="f2">
              {/* 키보드 바인딩은 키보드, 마우스 바인딩(휠·X1·X2)은 마우스 아이콘 — 전엔 i18n 문구에 🖱 가 들어 있었다 */}
              <span className="hotkey-icon" aria-hidden="true">
                <Icon name={isMouseHotkey(hotkey) ? "mouse" : "keyboard"} />
              </span>
              <span className="hotkey-key">{formatHotkeyLabel(hotkey, t)}</span>
            </span>
            <button
              className="settings-btn"
              onClick={() => {
                setHistoryVisible((v) => {
                  // Opening history closes settings (and the donate panel
                  // beneath it) so the panels never stack.
                  if (!v) {
                    setShowSettings(false);
                    setShowDonate(false);
                    dailyAdd("hist");
                  }
                  return !v;
                });
              }}
              title={t.history}
              data-tour="hist"
            >
              <Icon name="clock" />
              {startCard && <span className="hdr-lbl">{t.hdrHistory}</span>}
            </button>
            {/* 지도 나란히 모드에선 오른쪽 패널이 이미 지도라 카드 안 지도 버튼은 뺀다
                (눌리면 왼쪽 시세 카드까지 지도로 덮였다 — 11-02 제보) */}
            {!wideMode && (
              <button
                className={`settings-btn${radarActive ? " active" : ""}`}
                onClick={() => {
                  if (radarActive) setRadarActive(false);
                  else void openRadar(false);
                }}
                title={t.radarOpen}
                data-tour="map"
              >
                <Icon name="map" />
                {startCard && <span className="hdr-lbl">{t.hdrMap}</span>}
              </button>
            )}
            <button
              className={`settings-btn${wideMode ? " active" : ""}`}
              onClick={toggleWide}
              title={t.wideModeBtn}
              data-tour="wide"
            >
              <Icon name="wideMap" />
              {startCard && <span className="hdr-lbl">{t.hdrWide}</span>}
            </button>
            <button
              className="settings-btn settings-gear"
              onClick={() => setShowSettings((s) => {
                if (s) {
                  setShowDonate(false);
                } else {
                  // Opening settings closes history so settings appears at
                  // the top of the card instead of being pushed down.
                  setHistoryVisible(false);
                }
                return !s;
              })}
              title={t.settings}
              data-tour="gear"
            >
              <Icon name="gear" />
              {startCard && <span className="hdr-lbl">{t.hdrSettings}</span>}
            </button>
            {pinned ? (
              // Pinned: replace ✕ with an inert 📌 badge so a misclick can't
              // hide the overlay. Unpin via settings (the ⚙ stays active).
              <span
                className="settings-btn pinned-badge"
                title={t.pinnedBadgeTitle}
                aria-label={t.pinnedBadgeTitle}
              >
                <Icon name="pin" />
              </span>
            ) : (
              <button
                className="settings-btn"
                aria-label={t.hideToTrayTitle}
                onClick={() => {
                  // Tear down React state before invoking the native hide so
                  // the preview-rect polling loop (which checks cardVisible
                  // & showSettings on every tick) stops *before* the Rust
                  // side hides its windows. Otherwise an in-flight tick can
                  // call show_preview_rect right after Rust hid them and the
                  // rectangles pop back into view. Reset showSettings too so
                  // a future re-show doesn't land in mid-edit state.
                  setCardVisible(false);
                  setShowSettings(false);
                  setCaptureModalOpen(false);
                  hideToTray();
                }}
                title={t.hideToTrayTitle}
                data-tour="hide"
              >
                {/* 창 내리기(트레이) — 빨간 ✕ 는 '종료'로 읽혀서 최소화 기호 + 다른 버튼과 같은 금색으로(11-02 사용자 요청) */}
                <Icon name="minimize" />
              </button>
            )}
          </div>
        </div>

        {/* 11-03 최소 버전 레버: 공지 API 의 min_version 보다 낮으면 카드 전체를 덮는다(닫기 없음).
            시세 API 가 바뀌어 구버전이 깨졌을 때만 서버에서 올리는 용도 */}
        {forcedMinVersion && (
          <div className="forced-update" role="dialog" aria-modal="true">
            <div className="forced-update-title"><Icon name="update" /> {t.forcedUpdateTitle}</div>
            <div className="forced-update-body">
              {t.forcedUpdateBody.replace("{cur}", APP_VERSION).replace("{min}", forcedMinVersion)}
            </div>
            <div className="forced-update-actions">
              {!updateInfo ? (
                <button
                  className="reset-btn update-btn"
                  onClick={() => openUrl(RELEASES_PAGE_URL).catch((e) => log(`update: open releases page failed — ${String(e)}`))}
                >
                  {t.updateOpenPage}
                </button>
              ) : isPortable && (updatePhase === "idle" || updatePhase === "error") ? (
                <>
                  <button className="reset-btn update-btn" onClick={startPortableSwitch}>{t.portableSwitchBtn}</button>
                  <button
                    className="reset-btn"
                    onClick={() => openUrl(RELEASES_PAGE_URL).catch((e) => log(`update: open releases page failed — ${String(e)}`))}
                  >
                    {t.updateOpenPage}
                  </button>
                </>
              ) : updatePhase === "downloaded" ? (
                <button className="reset-btn update-btn" onClick={applyDownloadedUpdate}>{t.updateApplyNow}</button>
              ) : updatePhase === "downloading" ? (
                <span>{t.updateDownloading} {updateProgress}%</span>
              ) : updatePhase === "ready" ? (
                <span>{t.updateRestarting}</span>
              ) : (
                <button className="reset-btn update-btn" onClick={installUpdate}>{t.updateInstall}</button>
              )}
            </div>
          </div>
        )}

        {/* 배너는 한 번에 하나만(11-02 점검): 통계 안내 > 업데이트 > 관리자 권한 > 서버 공지.
            첫 실행에 넷이 같이 떠 카드가 배너로 가득 차던 것 — 하나를 닫으면 다음 것이 보인다 */}
        {(() => {
          const banner = !statsNoticeShown
            ? "consent"
            : isPortable && installedCopy && !installedCopyDismissed
              ? "installed"
              : !isPortable && switchedFrom
                ? "switched"
            : updateInfo && updateInfo.version !== dismissedUpdate
              ? "update"
              : adminInfo && adminInfo.is_admin === false && !adminDismissed
                ? "admin"
                : announcementText
                  ? "announce"
                  : null;
          return (
        <>
        {banner === "consent" && (
          <div className="consent-banner">
            <div className="consent-opensource">{t.statsConsentOpenSource}</div>
            <div className="consent-text">{t.statsConsentBody}</div>
            <div className="consent-actions">
              <button
                className="reset-btn consent-btn-accept"
                onClick={() => {
                  // "Got it" — dismiss the one-time notice; stats stay on.
                  localStorage.setItem(STATS_NOTICE_KEY, "true");
                  setStatsNoticeShown(true);
                }}
              >
                {t.statsConsentAccept}
              </button>
              {/* 11-04: 안내에서 바로 끄는 버튼은 뺌(사용자 결정) — 끄기는 설정의 스위치로만. 안내 자체는 유지 */}
            </div>
          </div>
        )}

        {banner === "installed" && (
          <div className="update-banner">
            <span className="update-text">
              <Icon name="update" /> {t.portableInstalledFound}
            </span>
            <button
              className="reset-btn update-btn"
              onClick={() => {
                reportEvent("update_apply", "portable_open_installed");
                invoke("launch_installed_copy").catch((e) => log(`portable: launch installed failed — ${String(e)}`));
              }}
            >
              {t.portableOpenInstalled}
            </button>
            <button className="settings-btn" onClick={() => setInstalledCopyDismissed(true)} title={t.updateLater}>
              <Icon name="x" />
            </button>
          </div>
        )}

        {banner === "switched" && switchedFrom && (
          <div className="update-banner">
            <span className="update-text">
              <Icon name="check" /> {t.portableSwitchedDone}
            </span>
            <button
              className="reset-btn"
              onClick={() => invoke("open_folder", { path: switchedFrom }).catch((e) => log(`portable: open folder failed — ${String(e)}`))}
              title={switchedFrom}
            >
              {t.portableOpenFolder}
            </button>
            <button
              className="settings-btn"
              onClick={() => {
                try {
                  localStorage.removeItem(PORTABLE_SWITCHED_KEY);
                } catch {}
                setSwitchedFrom(null);
              }}
              title={t.dismiss}
            >
              <Icon name="x" />
            </button>
          </div>
        )}

        {banner === "update" && updateInfo && (
          <div
            className="update-banner"
            ref={(el) => {
              // 11-11 계측: 카드가 보일 때 업데이트 배너가 떠 있었나(버전당 세션 1번) — 노출 → 닫기(banner_dismiss)·설치로 이어지는지
              if (el && cardVisible && updateBannerSeenRef.current !== updateInfo.version) {
                updateBannerSeenRef.current = updateInfo.version;
                reportEvent("update_apply", "banner_shown");
              }
            }}
          >
            {updatePhase === "idle" && (
              <>
                <span className="update-text">
                  <Icon name="update" /> {t.updateAvailable} <strong>v{updateInfo.version}</strong>
                  {/* One-line release notes: seeing WHAT the update brings is
                      the cheapest adoption nudge there is. */}
                  {updateInfo.notes && (
                    <span className="update-notes">
                      {" "}— {updateInfo.notes.split("\n")[0].slice(0, 120)}
                    </span>
                  )}
                  {isPortable && (
                    <span className="update-portable-hint">
                      {" "}— {t.updatePortableHint}
                    </span>
                  )}
                </span>
                {isPortable ? (
                  // 1.2.7: 포터블도 같은 설치 파일로 '설치판으로 전환'(동의 후). 포터블 폴더는 그대로 남고
                  // 설정·진행은 이어진다. 새 포터블 ZIP 을 직접 받고 싶은 사람을 위해 페이지 버튼도 남긴다.
                  <>
                    <button className="reset-btn update-btn" onClick={startPortableSwitch} title={t.updatePortableHint}>
                      {t.portableSwitchBtn}
                    </button>
                    <button
                      className="reset-btn"
                      onClick={() =>
                        openUrl(RELEASES_PAGE_URL).catch((e) =>
                          log(`update: open releases page failed — ${String(e)}`)
                        )
                      }
                    >
                      {t.updateOpenPage}
                    </button>
                  </>
                ) : (
                  <button
                    className="reset-btn update-btn"
                    onClick={installUpdate}
                  >
                    {t.updateInstall}
                  </button>
                )}
                <button
                  className="settings-btn"
                  onClick={() => dismissUpdate(updateInfo.version)}
                  title={t.updateLater}
                >
                  <Icon name="x" />
                </button>
              </>
            )}
            {updatePhase === "downloading" && (
              <span className="update-text update-progress-wrap">
                <Icon name="download" /> {t.updateDownloading} {updateProgress}%
                <span className="update-progress-track" aria-hidden="true">
                  <span
                    className="update-progress-fill"
                    style={{ width: `${updateProgress}%` }}
                  />
                </span>
              </span>
            )}
            {updatePhase === "downloaded" && (
              <>
                <span className="update-text">
                  <Icon name="check" /> <strong>v{updateInfo.version}</strong> {t.updateDownloaded}
                </span>
                <button className="reset-btn update-btn" onClick={applyDownloadedUpdate}>
                  {t.updateApplyNow}
                </button>
                <button
                  className="settings-btn"
                  onClick={() => dismissUpdate(updateInfo.version)}
                  title={t.updateLater}
                >
                  <Icon name="x" />
                </button>
              </>
            )}
            {updatePhase === "ready" && (
              <span className="update-text"><Icon name="check" /> {t.updateRestarting}</span>
            )}
            {updatePhase === "error" && (
              <>
                <span className="update-text">
                  <Icon name="warn" /> {t.updateError}: {updateError}
                </span>
                <button
                  className="reset-btn update-btn"
                  onClick={isPortable ? startPortableSwitch : installUpdate}
                >
                  {t.updateRetry}
                </button>
                <button
                  className="settings-btn"
                  onClick={() => {
                    // Dismissable error: reset to idle so periodic checks
                    // resume, and mute this version's banner.
                    setUpdatePhase("idle");
                    setUpdateError(null);
                    dismissUpdate(updateInfo.version);
                  }}
                  title={t.updateLater}
                >
                  <Icon name="x" />
                </button>
              </>
            )}
          </div>
        )}

        {/* 지도 자료 보내기 — 답할 때까지 카드 맨 위(공지·관리자 안내보다 위). 둘러보기 중엔 안 띄움 */}
        {!mapShareAsked && mapShareClosed === false && tourStep == null && <MapShareAsk t={t} onAnswer={answerMapShare} />}
        {banner === "admin" && (
          <div className="admin-banner">
            <span className="admin-text">
              <Icon name="warn" /> {t.adminWarning}
            </span>
            <button
              className="settings-btn"
              onClick={() => {
                invoke("relaunch_as_admin").catch((e) =>
                  log(`relaunch_as_admin failed: ${e}`)
                );
              }}
              title={t.relaunchAsAdmin}
            >
              <Icon name="key" /> {t.relaunchAsAdmin}
            </button>
            <button
              className="settings-btn"
              onClick={() => {
                localStorage.setItem(ADMIN_BANNER_DISMISS_KEY, "true");
                setAdminDismissed(true);
              }}
              title={t.adminDismiss}
            >
              <Icon name="x" />
            </button>
          </div>
        )}

        {devReplies.length > 0 && (
          <div className="announce-banner reply-banner">
            <div className="reply-body">
              <div className="reply-title">{t.devReplyTitle}</div>
              {devReplies[0].msg && <div className="reply-about">{t.devReplyAbout.replace("{msg}", devReplies[0].msg)}</div>}
              <div className="reply-text">{devReplies[0].text}</div>
            </div>
            <button className="reset-btn reply-ok" onClick={() => ackDevReply(devReplies[0].n)}>
              {t.devReplyOk}
            </button>
          </div>
        )}
        {banner === "announce" && announcementText && (
            <div className="announce-banner">
              <span className="announce-text">
                {/* 11-07 공지 안의 우리 사이트 주소(tarkov.aquapado.com)만 누르면 기본 브라우저로 연다 — 패치 날 '바뀐 퀘스트 공략' 링크용.
                    다른 주소는 글자 그대로(원격 문구로 아무 사이트나 열리지 않게) */}
                {announcementText.split(/(https:\/\/tarkov\.aquapado\.com\/[^\s]*)/).map((part, i) =>
                  /^https:\/\/tarkov\.aquapado\.com\//.test(part) ? (
                    <button
                      key={i}
                      className="announce-link"
                      data-href={part}
                      onClick={() => openUrl(part).catch((e) => log(`announce: openUrl failed — ${String(e)}`))}
                    >
                      {t.announceOpenLink}
                    </button>
                  ) : (
                    <span key={i}>{part}</span>
                  )
                )}
              </span>
              <button
                className="settings-btn"
                onClick={() => setRemoteAnnounce(null)}
                title={t.dismiss}
              >
                <Icon name="x" />
              </button>
            </div>
          )}
        </>
          );
        })()}

        {historyVisible && (
          <div className="history-panel">
            <div className="history-header">
              <span>{t.history} ({history.length})</span>
              {history.length > 0 && (
                <button
                  className="reset-btn"
                  onClick={() => {
                    clearHistory();
                    setHistory([]);
                  }}
                  title={t.clearHistory}
                >
                  {t.clear}
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <div className="history-empty">{t.historyEmpty}</div>
            ) : (
              <div className="history-list">
                {history.map((entry) => (
                  <button
                    key={`${entry.ts}-${entry.result.item_name}`}
                    className="history-row"
                    onClick={() => {
                      if (entry.result.item_name) {
                        lookupByName(entry.result.item_name, entry.result.item_id);
                      }
                      setHistoryVisible(false);
                    }}
                    title={entry.result.item_name ?? entry.raw_text}
                  >
                    <span className="history-name">
                      {entry.result.short_name ??
                        entry.result.item_name ??
                        entry.raw_text}
                    </span>
                    <span className="history-price">
                      {fmt(
                        entry.result.flea_price ?? entry.result.trader_price
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {showSettings && !captureModalOpen && (
          <div className="settings" ref={settingsRef}>
            <button
              className="reset-btn manual-btn"
              title={t.manualHint}
              onClick={() => {
                reportEvent("help", "manual:settings");
                openGuide(region.lang, "manual/");
              }}
            >
              <Icon name="book" /> {t.manualBtn}
            </button>
            <button
              className="reset-btn manual-btn"
              onClick={() => {
                reportEvent("help", "tour:replay");
                setShowSettings(false);
                setRadarActive(false);
                setTourStep(0);
              }}
            >
              {t.tourReplay}
            </button>
            <div className="support-note">{t.supportNote}</div>
            <div className="settings-row settings-feedback-row">
              <button
                className="reset-btn feedback-btn"
                onClick={() => {
                  if (!showFeedback) dailyAdd("fb");
                  setShowFeedback((s) => !s);
                  setFeedbackStatus("idle");
                  setShowDonate(false);
                }}
              >
                <Icon name="mail" /> {t.feedback}
              </button>
              <button
                className="reset-btn status-btn"
                onClick={() => openStatusPage(region.lang)}
                title={t.statusPageHint}
              >
                <Icon name="globe" /> {t.statusPage}
              </button>
              <button
                className="reset-btn donate-btn"
                onClick={() => {
                  if (!showDonate) {
                    dailyAdd("don");
                    // 11-06 후원 창 사용 횟수: 열 때 기본 탭까지(금액·결제 정보는 없음)
                    reportEvent("donate", `open:${donateTab}`);
                  }
                  setShowDonate((s) => !s);
                  setDonateCopied(false);
                  setShowFeedback(false);
                }}
                title={t.donateTitle}
              >
                <Icon name="heart" /> {t.donate}
              </button>
            </div>
            {showFeedback && (
              <div className="feedback-panel">
                <textarea
                  className="feedback-textarea"
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  onPaste={(e) => {
                    // Pasting a screenshot (Win+Shift+S → Ctrl+V) attaches it.
                    const item = Array.from(e.clipboardData.items).find((it) =>
                      it.type.startsWith("image/")
                    );
                    const blob = item?.getAsFile();
                    if (blob) {
                      e.preventDefault();
                      compressImage(blob)
                        .then(setFeedbackImage)
                        .catch((err) =>
                          log(`feedback: image paste failed — ${String(err)}`)
                        );
                    }
                  }}
                  placeholder={t.feedbackPlaceholder}
                  rows={4}
                  maxLength={4000}
                  disabled={feedbackStatus === "sending"}
                />
                <div className="feedback-attach-row">
                  {feedbackImage ? (
                    <div className="feedback-thumb">
                      <img src={feedbackImage} alt="" />
                      <button
                        className="feedback-thumb-x"
                        title={t.feedbackImageRemove}
                        onClick={() => setFeedbackImage(null)}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <label className="feedback-attach-label">
                      <Icon name="paperclip" /> {t.feedbackAttachImage}
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f)
                            compressImage(f)
                              .then(setFeedbackImage)
                              .catch((err) =>
                                log(`feedback: image pick failed — ${String(err)}`)
                              );
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  <label className="feedback-attach-label" title={t.feedbackDiagHint}>
                    <input
                      type="checkbox"
                      checked={feedbackDiag}
                      onChange={(e) => {
                        setFeedbackDiag(e.target.checked);
                        try {
                          localStorage.setItem(FEEDBACK_DIAG_KEY, e.target.checked ? "1" : "0");
                        } catch {}
                      }}
                    />{" "}
                    {t.feedbackDiag}
                  </label>
                </div>
                <div className="feedback-diag-note">{t.feedbackDiagNote}</div>
                <div className="feedback-actions">
                  <span
                    className={`feedback-status${
                      feedbackStatus === "error" || feedbackStatus === "empty" ? " error" : ""
                    }${feedbackStatus === "sent" ? " sent" : ""}`}
                  >
                    {feedbackStatus === "sending" && t.feedbackSending}
                    {feedbackStatus === "sent" && <><Icon name="check" /> {t.feedbackSuccess}</>}
                    {feedbackStatus === "error" && t.feedbackError}
                    {feedbackStatus === "empty" && t.feedbackEmpty}
                  </span>
                  <button
                    className="reset-btn feedback-send-btn"
                    disabled={feedbackStatus === "sending"}
                    onClick={async () => {
                      const msg = feedbackText.trim();
                      if (!msg) {
                        setFeedbackStatus("empty");
                        return;
                      }
                      setFeedbackStatus("sending");
                      try {
                        await submitFeedback(feedbackDiag ? msg + "\n\n" + (await buildDiag(3990 - msg.length)) : msg, feedbackImage);
                        // 11-10 통계: 보낸 피드백 중 진단 정보·스크린샷을 붙인 비율(fbs 보냄 · fbd 진단 · fbi 사진)
                        dailyAdd("fbs");
                        if (feedbackDiag) dailyAdd("fbd");
                        if (feedbackImage) dailyAdd("fbi");
                        setFeedbackStatus("sent");
                        setFeedbackText("");
                        setFeedbackImage(null);
                        // Auto-close shortly after a successful send.
                        window.setTimeout(() => {
                          setShowFeedback(false);
                          setFeedbackStatus("idle");
                        }, 1500);
                      } catch (err) {
                        log(`feedback: submit failed — ${String(err)}`);
                        setFeedbackStatus("error");
                      }
                    }}
                  >
                    {t.feedbackSend}
                  </button>
                </div>
                <button
                  className="feedback-mail-link"
                  onClick={() => sendFeedback(region.lang)}
                  title={`mailto:${FEEDBACK_EMAIL}`}
                >
                  {t.feedbackOr} {t.feedbackAltMail}
                </button>
              </div>
            )}
            {showDonate && (() => {
              const activeUrl = donateTab === "kakao" ? KAKAOPAY_URL : PAYPAL_URL;
              const activeHint =
                donateTab === "kakao" ? t.donateScanHint : t.donatePaypalHint;
              return (
                <div className="donate-panel">
                  <div className="donate-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={donateTab === "kakao"}
                      className={`donate-tab${donateTab === "kakao" ? " active" : ""}`}
                      onClick={() => {
                        if (donateTab !== "kakao") reportEvent("donate", "tab:kakao");
                        setDonateTab("kakao");
                        setDonateCopied(false);
                      }}
                    >
                      {t.donateTabKakao}
                    </button>
                    <button
                      role="tab"
                      aria-selected={donateTab === "paypal"}
                      className={`donate-tab${donateTab === "paypal" ? " active" : ""}`}
                      onClick={() => {
                        if (donateTab !== "paypal") reportEvent("donate", "tab:paypal");
                        setDonateTab("paypal");
                        setDonateCopied(false);
                      }}
                    >
                      {t.donateTabPaypal}
                    </button>
                  </div>
                  <div className="donate-hint">{activeHint}</div>
                  <div className="donate-qr">
                    <QRCodeSVG
                      value={activeUrl}
                      size={140}
                      bgColor="#ffffff"
                      fgColor="#000000"
                      level="M"
                      includeMargin
                    />
                  </div>
                  <div className="donate-url">{activeUrl}</div>
                  <div className="donate-actions">
                    {donateTab === "paypal" && (
                      <button
                        className="reset-btn"
                        onClick={() => {
                          reportEvent("donate", "paypal_open");
                          openUrl(activeUrl).catch((e) =>
                            log(`donate: openUrl failed — ${String(e)}`)
                          );
                        }}
                      >
                        {t.donateOpen}
                      </button>
                    )}
                    <button
                      className="reset-btn"
                      onClick={() => {
                        reportEvent("donate", `copy:${donateTab}`);
                        navigator.clipboard
                          .writeText(activeUrl)
                          .then(() => {
                            setDonateCopied(true);
                            window.setTimeout(() => setDonateCopied(false), 1500);
                          })
                          .catch((e) =>
                            log(`donate: clipboard failed — ${String(e)}`)
                          );
                      }}
                    >
                      {donateCopied ? t.donateCopied : t.donateCopyUrl}
                    </button>
                    <button
                      className="reset-btn"
                      onClick={() => setShowDonate(false)}
                    >
                      {t.donateClose}
                    </button>
                  </div>
                </div>
              );
            })()}
            <div className="settings-section-header">
              {t.generalSection}
            </div>
            <div className="settings-row">
              <label>{t.language}</label>
              <select
                value={region.lang}
                onChange={(e) => updateRegion("lang", e.target.value as Lang)}
              >
                <option value="ko">한국어</option>
                <option value="en">English</option>
                <option value="ru">Русский</option>
                <option value="zh">简体中文</option>
              </select>
            </div>
            <div className="settings-row" title={t.gameLanguageHint}>
              <label>{t.gameLanguage}</label>
              <select
                value={getGameLang(region)}
                onChange={(e) => updateRegion("gameLang", e.target.value as GameLang)}
              >
                <option value="ko">한국어</option>
                <option value="en">English</option>
                <option value="ru">Русский</option>
              </select>
            </div>
            <div className="settings-sub">{t.subGameLanguage}</div>
            <div className="settings-row">
              <label>{t.gameMode}</label>
              <select
                value={region.gameMode}
                onChange={(e) => updateRegion("gameMode", e.target.value as GameMode)}
              >
                <option value="regular">{t.gameModePvp}</option>
                <option value="pve">{t.gameModePve}</option>
                <option value="pvp-season">{t.gameModeSeason}</option>
              </select>
            </div>
            <div className="settings-row">
              <label>{t.sound}</label>
              <input
                type="checkbox"
                checked={soundOn}
                onChange={(e) => setSoundOn(e.target.checked)}
              />
            </div>
            <div className="settings-row" title={t.autoHideHint}>
              <label>{t.autoHideToggle}</label>
              <input
                type="checkbox"
                checked={region.autoHide}
                onChange={(e) => updateRegion("autoHide", e.target.checked)}
              />
            </div>
            <div className="settings-sub">{t.subAutoHide}</div>
            <div className="settings-row" title={t.hoverDodgeHint}>
              <label>{t.hoverDodge}</label>
              <input type="checkbox" checked={hoverDodge} onChange={(e) => setHoverDodge(e.target.checked)} />
            </div>
            <div className="settings-sub">{t.subHoverDodge}</div>
            {hoverDodge && (
              <div className="settings-row" title={t.hoverDodgeModHint}>
                <label>{t.hoverDodgeMod}</label>
                <select value={hoverDodgeMod} onChange={(e) => setHoverDodgeMod(e.target.value)}>
                  <option value="ctrl">Ctrl</option>
                  <option value="shift">Shift</option>
                  <option value="alt">Alt</option>
                  <option value="none">{t.hoverDodgeModNone}</option>
                </select>
              </div>
            )}
            <div className="settings-row">
              <label>{t.hideDelay}</label>
              <input
                type="number"
                min="1"
                max="60"
                disabled={!region.autoHide}
                value={region.hideDelaySec}
                onChange={(e) =>
                  updateRegion(
                    "hideDelaySec",
                    Math.max(1, Math.min(60, parseInt(e.target.value) || 1))
                  )
                }
              />
            </div>
            <div className="settings-row" title={t.pinHint}>
              <label><Icon name="pin" /> {t.pinWindow}</label>
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => {
                  setPinned(e.target.checked);
                  if (e.target.checked) dailyAdd("pin");
                }}
              />
            </div>
            <div className="settings-row" title={t.showInTaskbarHint}>
              <label>{t.showInTaskbar}</label>
              <input type="checkbox" checked={showInTaskbar} onChange={(e) => setShowInTaskbar(e.target.checked)} />
            </div>
            <div className="settings-section-header">
              {t.inputSection}
            </div>
            <div className="settings-row">
              <label>{t.hotkey}</label>
              <button
                className="reset-btn hotkey-rec-btn"
                onClick={() =>
                  setRecordingTarget((r) => (r === "lookup" ? null : "lookup"))
                }
                title={t.hotkeyHint}
              >
                {recordingTarget === "lookup"
                  ? hotkeyConflict
                    ? t.hotkeyConflict
                    : t.recordingHotkey
                  : <>{isMouseHotkey(hotkey) && <Icon name="mouse" />} {formatHotkeyLabel(hotkey, t)}</>}
              </button>
            </div>
            <div className="settings-row">
              <label>{t.toggleHotkey}</label>
              <button
                className="reset-btn hotkey-rec-btn"
                onClick={() =>
                  setRecordingTarget((r) => (r === "toggle" ? null : "toggle"))
                }
                title={t.toggleHotkeyHint}
              >
                {recordingTarget === "toggle"
                  ? hotkeyConflict
                    ? t.hotkeyConflict
                    : t.recordingHotkey
                  : <>{isMouseHotkey(toggleHotkey) && <Icon name="mouse" />} {formatHotkeyLabel(toggleHotkey, t)}</>}
              </button>
            </div>
            <div className="settings-row" title={t.hotkeyPassthroughHint}>
              <label>{t.hotkeyPassthrough}</label>
              <input
                type="checkbox"
                checked={hotkeyPassthrough}
                onChange={(e) => setHotkeyPassthrough(e.target.checked)}
              />
            </div>
            <div className="settings-hint">
              {hotkeyPassthrough ? t.hotkeyPassthroughOn.replace("{key}", formatHotkeyLabel(hotkey, t)) : t.hotkeyPassthroughHint}
            </div>
            <div className="settings-section-header">
              {t.mapSection}
            </div>
            <div className="settings-row" title={t.wideModeHint}>
              <label>{t.wideMode}</label>
              <input type="checkbox" checked={wideMode} onChange={toggleWide} />
            </div>
            <div className="settings-sub">{t.subWideMode}</div>
            <div className="settings-row" title={t.wideMapSideHint}>
              <label htmlFor="wide-map-side">{t.wideMapSide}</label>
              <select
                id="wide-map-side"
                value={wideMapSide}
                onChange={(e) => {
                  const side = e.target.value === "left" ? "left" : "right";
                  setWideMapSide(side);
                  saveWideMapSide(localStorage, side);
                }}
              >
                <option value="left">{t.wideMapSideLeft}</option>
                <option value="right">{t.wideMapSideRight}</option>
              </select>
            </div>
            <div className="settings-sub">{t.wideMapSideHint}</div>
            <div className="settings-row" title={t.radarMiniSnapHint}>
              <label htmlFor="mini-snap">{t.radarMiniSnap}</label>
              <input
                id="mini-snap"
                type="checkbox"
                checked={miniSnap}
                onChange={(e) => {
                  setMiniSnap(e.target.checked);
                  try {
                    localStorage.setItem(MINI_SNAP_KEY, e.target.checked ? "1" : "0");
                  } catch {}
                }}
              />
            </div>
            <div className="settings-sub">{t.radarMiniSnapHint}</div>
            <div className="settings-row" title={t.radarSettingHint}>
              <label>{t.radarSettingLabel}</label>
              <input
                type="checkbox"
                checked={radarEnabled}
                onChange={(e) => {
                  setRadarEnabled(e.target.checked);
                  localStorage.setItem(RADAR_ENABLED_KEY, String(e.target.checked));
                  if (!e.target.checked) radarLastShotRef.current = undefined;
                }}
              />
            </div>
            <div className="settings-sub">{t.subRadarSetting}</div>
            <div className="settings-row" title={t.radarFolderHint}>
              <label>{t.radarFolderLabel}</label>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button className="reset-btn" onClick={() => void pickRadarFolder()}>{t.radarFolderPick}</button>
                {radarFolder?.folder && (
                  <button
                    className="reset-btn"
                    title={radarFolder.folder}
                    onClick={() => {
                      fetch(`${PYTHON_API}/radar/folder/open`, { method: "POST" }).catch((e) => log(`radar: open folder failed ${String(e)}`));
                    }}
                  >
                    {t.radarFolderOpen}
                  </button>
                )}
                {radarFolder?.source === "manual" && (
                  <button className="reset-btn" onClick={() => void setRadarFolderPath("")}>{t.radarFolderAuto}</button>
                )}
              </span>
            </div>
            <div className="settings-hint" style={{ wordBreak: "break-all" }}>
              {radarFolderMsg ||
                (radarFolder
                  ? radarFolder.folder
                    ? `${radarFolder.source === "manual" ? t.radarFolderManualTag : t.radarFolderAutoTag} ${radarFolder.folder}`
                    : t.radarNoFolder
                  : "")}
            </div>
            <div className="settings-row" title={t.radarPruneHint}>
              <label>{t.radarPruneLabel}</label>
              <select
                value={String(radarFolder?.prune_keep ?? 0)}
                onChange={(e) => void setRadarPrune(Number(e.target.value))}
              >
                <option value="0">{t.radarPruneOff}</option>
                {[20, 50, 100, 300].map((n) => (
                  <option key={n} value={String(n)}>{t.radarPruneKeep.replace("{n}", String(n))}</option>
                ))}
              </select>
            </div>
            <div className="settings-hint">{t.radarPruneHint}</div>
            <MapShareSettings
              t={t}
              on={mapShareOn}
              closed={mapShareClosed === true}
              onToggle={(v) => {
                reportEvent("help", v ? "mapshare:on" : "mapshare:off"); // 11-10 통계: 설정에서 바꾼 것
                setMapShareOn(v);
              }}
            />
            <div className="settings-section-header">
              {t.displaySection}
            </div>
            <div className="settings-row">
              <label>{t.fontSize}</label>
              <select
                value={region.fontSize}
                onChange={(e) => {
                  updateRegion("fontSize", parseInt(e.target.value));
                }}
                className="font-size-select"
              >
                {Array.from({ length: 9 }, (_, i) => i + 12).map((s) => (
                  <option key={s} value={s}>{s}px</option>
                ))}
              </select>
            </div>
            <div className="settings-row op-row">
              <label title={t.opacityHint}>{t.opacity}</label>
              <div className="opacity-row">
                <input
                  type="range"
                  min="20"
                  max="100"
                  step="1"
                  value={region.opacity}
                  onChange={(e) =>
                    updateRegion("opacity", parseInt(e.target.value))
                  }
                  className="opacity-slider"
                />
                {opacityEditing ? (
                  <input
                    type="number"
                    min="20"
                    max="100"
                    value={region.opacity}
                    autoFocus
                    onChange={(e) => {
                      // Allow free typing; clamp on blur/Enter so the user can
                      // delete digits while editing without snapping to 20.
                      const n = parseInt(e.target.value);
                      if (!isNaN(n)) updateRegion("opacity", n);
                    }}
                    onBlur={() => {
                      updateRegion(
                        "opacity",
                        Math.max(20, Math.min(100, region.opacity || 100))
                      );
                      setOpacityEditing(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="opacity-number"
                  />
                ) : (
                  <span
                    className="opacity-readout"
                    title={t.opacityClickHint}
                    onClick={() => setOpacityEditing(true)}
                  >
                    {region.opacity}%
                  </span>
                )}
              </div>
            </div>
            <div className="settings-row op-row">
              <label title={t.bgOpacityHint}>{t.bgOpacity}</label>
              <div className="opacity-row">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={region.bgOpacity}
                  onChange={(e) =>
                    updateRegion("bgOpacity", parseInt(e.target.value))
                  }
                  className="opacity-slider"
                />
                <span className="opacity-readout">{region.bgOpacity}%</span>
              </div>
            </div>
            <div className="settings-row">
              <label title={t.detailsOpenHint}>{t.detailsOpenDefault}</label>
              <input
                type="checkbox"
                checked={region.detailsOpenDefault}
                onChange={(e) =>
                  updateRegion("detailsOpenDefault", e.target.checked)
                }
              />
            </div>
            {/* 시세 줄 안의 보조 항목(순서 없음) */}
            {(
              [
                ["show24hRange", "displayRange24"],
                ["showLastTrade", "displayLastTrade"],
                ["highlightLastTrade", "displayHighlightLastTrade"],
                ["showLootTier", "displayLootTier"],
                ["showSellAdvice", "displaySellAdvice"],
                ["showWeight", "displayWeight"],
              ] as const
            ).map(([key, labelKey]) => (
              <div key={key} className="settings-row">
                <label>{t[labelKey]}</label>
                <input
                  type="checkbox"
                  checked={region[key]}
                  onChange={(e) => updateRegion(key, e.target.checked)}
                />
              </div>
            ))}
            {/* 카드 블록: 체크(표시 여부) + ▲▼(순서)를 한 목록으로 — 전엔 체크 13줄 + 순서 10줄이 같은 대상을 두 번 나열했다(11-02 설정 재편).
                건스미스는 '퀘스트에 필요'와 같이 켜지고(showQuests), 칸당 가격 줄은 위 루팅 등급·무게 체크가 정한다 → 체크 없음 */}
            {(() => {
              const secLabel: Record<SectionKey, string> = {
                buyFor: t.displayBuyFor,
                bartersFor: t.displayBartersFor,
                bartersUsing: t.displayBartersUsing,
                craftsFor: t.displayCraftsFor,
                craftsUsing: t.displayCraftsUsing,
                gunsmith: t.gunsmithTitle,
                hideoutNeeds: t.displayHideoutNeeds,
                ammoMatrix: t.displayAmmoMatrix,
                quests: t.displayQuests,
                slotLine: t.secSlotLine,
              };
              const secToggle: Partial<Record<SectionKey, keyof Region>> = {
                buyFor: "showBuyFor",
                bartersFor: "showBartersFor",
                bartersUsing: "showBartersUsing",
                craftsFor: "showCraftsFor",
                craftsUsing: "showCraftsUsing",
                hideoutNeeds: "showHideoutNeeds",
                ammoMatrix: "showAmmoMatrix",
                quests: "showQuests",
              };
              return (
                <div className="settings-row settings-row-stack">
                  <label title={t.displayOrderHint}>{t.displayOrderSection}</label>
                  <div className="settings-hint">{t.displayOrderHint}</div>
                  {region.sectionOrder.map((k, i) => {
                    const tk = secToggle[k];
                    return (
                      <div key={k} className="order-row">
                        {tk ? (
                          <input
                            type="checkbox"
                            checked={region[tk] as boolean}
                            onChange={(e) => updateRegion(tk, e.target.checked as Region[typeof tk])}
                            aria-label={secLabel[k]}
                          />
                        ) : (
                          <span className="order-nocheck" aria-hidden="true" />
                        )}
                        <span className="order-label" title={k === "gunsmith" ? t.blockWithQuests : undefined}>
                          {secLabel[k]}
                          {k === "gunsmith" && <span className="settings-hint-inline"> · {t.blockWithQuests}</span>}
                        </span>
                        <button type="button" disabled={i === 0} title={t.moveUp} onClick={() => moveSection(k, -1)}>▲</button>
                        <button
                          type="button"
                          disabled={i === region.sectionOrder.length - 1}
                          title={t.moveDown}
                          onClick={() => moveSection(k, 1)}
                        >
                          ▼
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            <div className="settings-section-header">
              {t.questSyncSection}
            </div>
            {/* 가장 영향이 큰 선택(어느 서버 진행도로 보일지)을 맨 위로. 기본은 게임 모드 따라가기 */}
            <div className="settings-row">
              <label title={t.questDisplayModeHint}>
                {t.questDisplayMode}
              </label>
              <select
                value={questDisplayModeSetting}
                onChange={(e) => {
                  const raw = e.target.value;
                  const v: QuestModeSetting = raw === "pvp" ? "pvp" : raw === "season" ? "season" : raw === "pve" ? "pve" : "follow";
                  setQuestDisplayModeSetting(v);
                  localStorage.setItem(QUEST_DISPLAY_MODE_KEY, v);
                }}
              >
                <option value="follow">{t.questDisplayModeFollow} ({questModeOfGameMode(region.gameMode) === "season" ? t.gameModeSeason : questModeOfGameMode(region.gameMode).toUpperCase()})</option>
                <option value="pve">PVE</option>
                <option value="pvp">PVP</option>
                <option value="season">{t.gameModeSeason}</option>
              </select>
            </div>
            <div className="settings-row">
              <label title={t.questSyncEnableHint}>{t.questSyncEnable}</label>
              <input
                type="checkbox"
                checked={questStatus?.enabled ?? true}
                disabled={questStatus == null}
                onChange={(e) => setQuestEnabled(e.target.checked)}
              />
            </div>
            <div className="settings-sub">{t.subQuestSync}</div>
            {/* 11-06 진영은 퀘스트 로그 연동을 꺼도 직접 고를 수 있어야 해서 연동 상태(questStatus)와 상관없이 보인다 */}
            <div className="settings-row">
              <label title={t.factionHint}>{t.factionLabel}</label>
              <select
                value={region.faction}
                onChange={(e) => updateRegion("faction", e.target.value as FactionSetting)}
              >
                <option value="auto">
                  {(() => {
                    const d = questStatus?.faction_by_mode?.[questDisplayMode];
                    return d ? t.factionAutoDetected.replace("{f}", d) : t.factionAutoUnknown;
                  })()}
                </option>
                <option value="BEAR">BEAR</option>
                <option value="USEC">USEC</option>
              </select>
            </div>
            <div className="settings-sub">{t.subFaction}</div>
            {questStatus == null && (
              <div className="settings-row">
                <label>{t.questSyncStatus}</label>
                <span className="quest-sync-warn">{t.questSyncLoading}</span>
              </div>
            )}
            {questStatus && (
              <>
                <div className="settings-row">
                  <label>{t.questSyncStatus}</label>
                  <span
                    className={
                      questStatus.effective_path_valid
                        ? "quest-sync-ok"
                        : "quest-sync-warn"
                    }
                  >
                    <Icon name={questStatus.effective_path_valid ? "check" : "warn"} />{" "}
                    {questStatus.effective_path_valid
                      ? questStatus.counts_by_mode
                        ? `PVP ${questStatus.counts_by_mode.pvp.completed}${t.questSyncCountCompletedShort}·${questStatus.counts_by_mode.pvp.started}${t.questSyncCountStartedShort} / PVE ${questStatus.counts_by_mode.pve.completed}${t.questSyncCountCompletedShort}·${questStatus.counts_by_mode.pve.started}${t.questSyncCountStartedShort}${questStatus.counts_by_mode.season && questStatus.counts_by_mode.season.completed + questStatus.counts_by_mode.season.started > 0 ? ` / ${t.gameModeSeason} ${questStatus.counts_by_mode.season.completed}${t.questSyncCountCompletedShort}·${questStatus.counts_by_mode.season.started}${t.questSyncCountStartedShort}` : ""}`
                        : `${questStatus.completed_count} ${t.questSyncCompleted} / ${questStatus.started_count} ${t.questSyncStarted}`
                      : t.questSyncPathMissing}
                  </span>
                </div>
                <div className="settings-row">
                  <label title={t.guideOpenHint}>{t.guideOpen}</label>
                  <button type="button" className="reset-btn" onClick={() => void openGuideWithProgress()} title={t.guideOpenHint}>
                    {t.guideOpenBtn}
                  </button>
                </div>
                <div className="settings-sub">{t.subGuideOpen}</div>
                <div className="settings-row settings-row-stack">
                  <label title={t.questSyncPathHint}>{t.questSyncPath}</label>
                  <div className="quest-path-row">
                    <input
                      type="text"
                      className="quest-path-input"
                      placeholder={
                        questStatus.auto_detected_path ?? t.questSyncPathAuto
                      }
                      value={questPathInput}
                      onChange={(e) => setQuestPathInput(e.target.value)}
                      onBlur={() => {
                        // Commit on blur so the user can type freely without
                        // every keystroke triggering a backend call.
                        if (questPathInput !== (questStatus.install_path ?? "")) {
                          submitQuestPath(questPathInput);
                        }
                      }}
                    />
                    <button
                      className="reset-btn"
                      onClick={() => {
                        setQuestPathInput("");
                        submitQuestPath("");
                      }}
                      title={t.questSyncPathAutoHint}
                    >
                      {t.questSyncPathAutoBtn}
                    </button>
                    <button
                      className="reset-btn"
                      onClick={async () => {
                        const picked = await openFolderDialog({
                          directory: true,
                          multiple: false,
                          title: t.questSyncPath,
                          defaultPath:
                            questPathInput ||
                            questStatus.install_path ||
                            questStatus.auto_detected_path ||
                            undefined,
                        });
                        // openFolderDialog returns null on cancel — leave the
                        // input untouched in that case so the user doesn't
                        // accidentally wipe a working path by escaping.
                        if (typeof picked === "string" && picked) {
                          setQuestPathInput(picked);
                          submitQuestPath(picked);
                        }
                      }}
                      title={t.questSyncPathBrowseHint}
                    >
                      {t.questSyncPathBrowseBtn}
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <label title={t.questCompletedDisplayHint}>
                    {t.questCompletedDisplay}
                  </label>
                  <select
                    value={region.completedQuestDisplay}
                    onChange={(e) =>
                      updateRegion(
                        "completedQuestDisplay",
                        e.target.value as "dim" | "hide"
                      )
                    }
                  >
                    <option value="dim">{t.questCompletedDim}</option>
                    <option value="hide">{t.questCompletedHide}</option>
                  </select>
                </div>
                <div className="settings-row">
                  <label title={t.questSyncResetHint}>{t.questSyncReset}</label>
                  <div className="quest-path-row">
                    <button
                      className="reset-btn"
                      onClick={() => resetQuestState("pvp")}
                      title={t.questSyncResetPvpHint}
                    >
                      {t.questSyncResetPvpBtn}
                    </button>
                    <button
                      className="reset-btn"
                      onClick={() => resetQuestState("pve")}
                      title={t.questSyncResetPveHint}
                    >
                      {t.questSyncResetPveBtn}
                    </button>
                    <button
                      className="reset-btn"
                      onClick={() => resetQuestState("season")}
                      title={t.questSyncResetSeasonHint}
                    >
                      {t.questSyncResetSeasonBtn}
                    </button>
                    <button
                      className="reset-btn"
                      onClick={() => resetQuestState()}
                      title={t.questSyncResetAllHint}
                    >
                      {t.questSyncResetBtn}
                    </button>
                  </div>
                </div>
                {/* 와이프 리셋: 파괴적이라 '수동 동기화'와 같은 글자의 버튼 4개를 나란히 두지 않고, 대상 선택 + 경고색 버튼 하나(확인창은 그대로) */}
                <div className="settings-row">
                  <label title={t.questWipeResetHint}>{t.questWipeReset}</label>
                  <div className="quest-path-row">
                    <select value={wipeScope} onChange={(e) => setWipeScope(e.target.value as typeof wipeScope)} aria-label={t.questWipeReset}>
                      <option value="pvp">{t.questSyncResetPvpBtn}</option>
                      <option value="pve">{t.questSyncResetPveBtn}</option>
                      <option value="season">{t.questSyncResetSeasonBtn}</option>
                      <option value="all">{t.questSyncResetBtn}</option>
                    </select>
                    <button
                      className="reset-btn exit-btn"
                      onClick={() => wipeResetQuests(wipeScope === "all" ? undefined : wipeScope)}
                      title={t.questWipeResetHint}
                    >
                      <Icon name="warn" /> {t.questWipeResetBtn}
                    </button>
                  </div>
                </div>
              </>
            )}

            <details className="hideout-level-details" open>
              <summary className="settings-section-header hideout-level-summary">
                {t.hideoutLevelSection}
              </summary>
              <div className="settings-hint" style={{ color: "var(--text-muted)", marginBottom: 4 }}>
                {t.hideoutLevelHint}
              </div>
              {hideoutStations.length === 0 ? (
                <div className="settings-row">
                  <span style={{ color: "var(--text-muted)", fontSize: "var(--card-fs-xs)" }}>
                    {t.hideoutStationsLoading}
                  </span>
                </div>
              ) : (
                <>
                  <div className="hideout-level-grid">
                    {hideoutStations.map((s) => {
                      const cur = hideoutLevels[s.id] ?? 0;
                      return (
                        <div key={s.id} className="hideout-level-row">
                          <span
                            className="hideout-level-name"
                            title={s.name}
                            style={cur >= s.maxLevel ? { color: "var(--text-disabled)", textDecoration: "line-through" } : undefined}
                          >
                            {s.name}
                          </span>
                          <button
                            className="hd-step-btn"
                            disabled={cur <= 0}
                            onClick={() => updateHideoutLevel(s.id, Math.max(0, cur - 1))}
                          >−</button>
                          <span className="hideout-level-val">{cur}/{s.maxLevel}</span>
                          <button
                            className="hd-step-btn"
                            disabled={cur >= s.maxLevel}
                            onClick={() => updateHideoutLevel(s.id, Math.min(s.maxLevel, cur + 1))}
                          >+</button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="hideout-level-row" title={t.hideoutMgmtHint}>
                    <span className="hideout-level-name">{t.hideoutMgmtLevel}</span>
                    <button
                      className="hd-step-btn"
                      disabled={hideoutMgmtLevel <= 0}
                      onClick={() => updateHideoutMgmtLevel(hideoutMgmtLevel - 1)}
                    >−</button>
                    <input
                      className="hideout-mgmt-input"
                      type="number"
                      min={0}
                      max={51}
                      value={hideoutMgmtLevel}
                      onChange={(e) => updateHideoutMgmtLevel(Number(e.target.value) || 0)}
                    />
                    <button
                      className="hd-step-btn"
                      disabled={hideoutMgmtLevel >= 51}
                      onClick={() => updateHideoutMgmtLevel(hideoutMgmtLevel + 1)}
                    >+</button>
                  </div>
                  <div className="settings-hint" style={{ color: "var(--text-muted)" }}>{t.hideoutMgmtHint}</div>
                  <div className="settings-row" style={{ marginTop: 4 }}>
                    <label></label>
                    <button className="reset-btn" onClick={resetHideoutLevels}>
                      {t.hideoutLevelReset}
                    </button>
                  </div>
                </>
              )}
            </details>

            <div className="settings-section-header">
              {t.captureSection}
            </div>
            <div className="settings-row">
              <label>{t.captureRegion}</label>
              <button
                className="reset-btn hotkey-rec-btn"
                onClick={() => setCaptureModalOpen(true)}
                title={t.captureRegionConfigureHint}
              >
                {t.captureRegionConfigure}
              </button>
            </div>
            <div className="settings-row">
              <label title={t.windowRecoverHint}>{t.windowRecover}</label>
              <button
                className="reset-btn"
                onClick={async () => {
                  // Snap the overlay to the primary monitor's top-left
                  // area. Works as a panic-button when a previously-saved
                  // position lands on a disconnected secondary display.
                  try {
                    const mon = await primaryMonitor();
                    if (!mon) return;
                    const win = getCurrentWindow();
                    const x = mon.position.x + 40;
                    const y = mon.position.y + 40;
                    await win.setPosition(new PhysicalPosition(x, y));
                    localStorage.setItem(
                      POSITION_KEY,
                      JSON.stringify({ x, y })
                    );
                    await win.show();
                    await win.setFocus();
                  } catch (e) {
                    log(`recover position failed: ${String(e)}`);
                  }
                }}
              >
                {t.windowRecoverBtn}
              </button>
            </div>
            <div className="settings-section-header">
              {t.infoSection}
            </div>
            <div className="settings-row" title={t.statsToggleHint}>
              <label>{t.statsToggle}</label>
              <input
                type="checkbox"
                checked={statsEnabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  localStorage.setItem(
                    STATS_CONSENT_KEY,
                    enabled ? "true" : "false"
                  );
                  setStatsEnabled(enabled);
                }}
              />
            </div>
            <div className="settings-row">
              <label>{t.autoCheckUpdate}</label>
              <input
                type="checkbox"
                checked={autoCheckUpdate}
                onChange={(e) => setAutoCheckUpdate(e.target.checked)}
              />
            </div>
            {!isPortable && (
              <div className="settings-row">
                <label>
                  {t.autoInstallUpdate}
                  <span className="settings-hint-inline"> {t.autoInstallUpdateHint}</span>
                </label>
                <input
                  type="checkbox"
                  checked={autoInstallUpdate}
                  onChange={(e) => setAutoInstallUpdate(e.target.checked)}
                />
              </div>
            )}
            <div className="settings-row">
              <label>
                {t.update}
                <span className="settings-hint-inline">
                  {" "}
                  v{APP_VERSION}
                </span>
              </label>
              <button
                className="reset-btn"
                onClick={() => {
                  // Clear any earlier dismissal: a user who hid an update and
                  // then explicitly clicks "check" wants to SEE it again —
                  // otherwise the banner stays muted (updateInfo.version ===
                  // dismissedUpdate) and the click looks like it did nothing.
                  setDismissedUpdate(null);
                  checkForUpdate();
                }}
                disabled={updateChecking}
              >
                {updateChecking
                  ? t.updateChecking
                  : updateCheckedAt && !updateInfo
                    ? <><Icon name="check" /> {t.updateUpToDate}</>
                    : t.updateCheckNow}
              </button>
            </div>
            <div className="copyright">
              <div className="copyright-line">{t.copyright}</div>
              <div className="copyright-line copyright-sub">{t.copyrightLine2}</div>
              <div className="copyright-line copyright-sub">{t.copyrightLine3}</div>
            </div>
          </div>
        )}
        {captureModalOpen && (
          /* Modal-style capture-region editor. Rendered inside the card so
             the existing region-based click-through behavior naturally
             gives the modal pointer events while the rest of the overlay
             stays click-through. Anchor mode controls whether the on-screen
             preview rectangles pin to monitor center (stable) or follow
             the cursor (legacy "find a real hover" behavior). */
          <div className="capture-modal-backdrop">
            <div
              className="capture-modal"
              role="dialog"
              aria-labelledby="capture-modal-title"
            >
              <div className="capture-modal-header">
                <span id="capture-modal-title" className="capture-modal-title">
                  <Icon name="crop" /> {t.captureRegionTitle}
                </span>
                <button
                  className="settings-btn"
                  onClick={() => setCaptureModalOpen(false)}
                  title={t.captureRegionCloseHint}
                >
                  <Icon name="x" />
                </button>
              </div>
              <div className="capture-modal-body">
                <div className="settings-row" title={t.previewAnchorHint}>
                  <label>{t.previewAnchor}</label>
                  <select
                    value={previewAnchorMode}
                    onChange={(e) => {
                      const v =
                        e.target.value === "cursor" ? "cursor" : "center";
                      setPreviewAnchorMode(v);
                      localStorage.setItem(PREVIEW_ANCHOR_KEY, v);
                    }}
                  >
                    <option value="center">{t.previewAnchorCenter}</option>
                    <option value="cursor">{t.previewAnchorCursor}</option>
                  </select>
                </div>
                <div className="capture-legend">
                  <div className="capture-legend-row">
                    {/* 색 견본 = 미리보기 창(main.tsx)의 실제 색: 청록 십자선·빨강 캡처 박스·노랑 땅바닥 박스 */}
                    <span className="legend-swatch" style={{ background: "#00e5ff" }} aria-hidden="true" />
                    <span>{t.legendAnchor}</span>
                  </div>
                  <div className="capture-legend-row">
                    <span className="legend-swatch" style={{ background: "#ff4040" }} aria-hidden="true" />
                    <span>{t.legendPrimary}</span>
                  </div>
                  <div className="capture-legend-row">
                    <span className="legend-swatch" style={{ background: "#ffc040" }} aria-hidden="true" />
                    <span>{t.legendGround}</span>
                  </div>
                  <div className="capture-legend-note">
                    {previewAnchorMode === "center"
                      ? t.legendNoteCenter
                      : t.legendNoteCursor}
                  </div>
                </div>
                <div className="capture-modal-section-title">
                  {t.captureRegion}
                </div>
                {(
                  [
                    [
                      "offsetX",
                      t.offsetX,
                      -sliderBounds.offsetMaxX,
                      sliderBounds.offsetMaxX,
                    ],
                    [
                      "offsetY",
                      t.offsetY,
                      -sliderBounds.offsetMaxY,
                      sliderBounds.offsetMaxY,
                    ],
                    ["width", t.width, 50, sliderBounds.widthMax],
                    ["height", t.height, 20, sliderBounds.heightMax],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <SliderField
                    key={key}
                    label={label}
                    editHint={t.opacityClickHint}
                    min={min}
                    max={max}
                    value={region[key] as number}
                    isEditing={regionEditingField === key}
                    onChange={(n) => updateRegion(key, n)}
                    onStartEdit={() => setRegionEditingField(key)}
                    onStopEdit={() => setRegionEditingField(null)}
                  />
                ))}
                <div className="settings-hint">{t.captureHint}</div>
                <div className="capture-modal-actions">
                  <button
                    className="reset-btn"
                    onClick={() =>
                      setRegion((r) => ({
                        ...r,
                        offsetX: DEFAULT_REGION.offsetX,
                        offsetY: DEFAULT_REGION.offsetY,
                        width: DEFAULT_REGION.width,
                        height: DEFAULT_REGION.height,
                      }))
                    }
                  >
                    {t.reset}
                  </button>
                  <button
                    className="reset-btn"
                    onClick={async () => {
                      const r = await applyMonitorScaling(true);
                      if (r) setRegion(r);
                    }}
                    title={t.autoScaleHint}
                  >
                    {t.autoScaleToMonitor}
                  </button>
                </div>
                <div className="capture-modal-section-title">
                  {t.groundCaptureRegion}
                </div>
                {(
                  [
                    [
                      "groundOffsetX",
                      t.groundOffsetX,
                      -sliderBounds.offsetMaxX,
                      sliderBounds.offsetMaxX,
                    ],
                    [
                      "groundOffsetY",
                      t.groundOffsetY,
                      -sliderBounds.offsetMaxY,
                      sliderBounds.offsetMaxY,
                    ],
                    ["groundWidth", t.groundWidth, 50, sliderBounds.widthMax],
                    [
                      "groundHeight",
                      t.groundHeight,
                      20,
                      sliderBounds.heightMax,
                    ],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <SliderField
                    key={key}
                    label={label}
                    editHint={t.opacityClickHint}
                    min={min}
                    max={max}
                    value={region[key] as number}
                    isEditing={regionEditingField === key}
                    onChange={(n) => updateRegion(key, n)}
                    onStartEdit={() => setRegionEditingField(key)}
                    onStopEdit={() => setRegionEditingField(null)}
                  />
                ))}
                <div className="settings-hint">{t.groundCaptureHint}</div>
                <div className="capture-modal-actions">
                  <button
                    className="reset-btn"
                    onClick={() =>
                      setRegion((r) => ({
                        ...r,
                        groundOffsetX: DEFAULT_REGION.groundOffsetX,
                        groundOffsetY: DEFAULT_REGION.groundOffsetY,
                        groundWidth: DEFAULT_REGION.groundWidth,
                        groundHeight: DEFAULT_REGION.groundHeight,
                      }))
                    }
                  >
                    {t.reset}
                  </button>
                </div>
                <div className="capture-modal-footer">
                  <button
                    className="reset-btn"
                    onClick={() => setCaptureModalOpen(false)}
                  >
                    {t.captureRegionDone}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* The settings panel's old dedicated ns-resize bar was removed —
            the card's bottom-right corner handle now resizes the settings
            panel vertically (see onResizeHandleDown's `inSettings` branch). */}

        {!showSettings && tourStep !== null && (() => {
          const last = TOUR.length - 1;
          const sid = TOUR[tourStep].id;
          const key = formatHotkeyLabel(hotkey, t);
          const title = ((t as Record<string, string>)[`tourT_${sid}`] ?? "").split("{key}").join(key);
          const body = ((t as Record<string, string>)[`tourB_${sid}`] ?? "").split("{key}").join(key);
          return (
            <div className="tour" role="dialog" aria-live="polite">
              <div className="tour-top">
                <span className="tour-count">
                  {tourStep + 1} / {last + 1}
                </span>
                <button className="tour-skip" onClick={() => endTour(`skip:${tourStep}`)}>
                  {t.tourSkip}
                </button>
              </div>
              {TOUR[tourStep].sel && <div className="tour-arrow">{TOUR[tourStep].open ? "▼" : "▲"} {TOUR[tourStep].open ? t.tourLookBelow : t.tourLook}</div>}
              <div className="tour-title">{title}</div>
              <div className="tour-body">{body}</div>
              <div className="tour-actions">
                {tourStep > 0 && (
                  <button className="reset-btn" onClick={() => setTourStep(tourStep - 1)}>
                    {t.tourPrev}
                  </button>
                )}
                {tourStep === last && (
                  <button
                    className="reset-btn tour-manual"
                    onClick={() => {
                      reportEvent("help", "tour:manual");
                      openGuide(region.lang, "manual/");
                    }}
                  >
                    <Icon name="book" /> {t.startManual}
                  </button>
                )}
                <button
                  className="reset-btn tour-next"
                  onClick={() => (tourStep === last ? endTour("done") : setTourStep(tourStep + 1))}
                >
                  {tourStep === 0 ? t.tourStart : tourStep === last ? t.tourFinish : t.tourNext}
                </button>
              </div>
            </div>
          );
        })()}
        {!showSettings && radarActive && (
          <RadarPanel
            party={party}
            data={radarData}
            loading={radarLoading}
            t={t}
            lang={region.lang}
            showScav={radarShowScav}
            onToggleScav={(v) => {
              setRadarShowScav(v);
              localStorage.setItem(RADAR_SCAV_KEY, String(v));
            }}
            onPickMap={(id) => {
              radarMapRef.current = id;
              void loadRadar();
            }}
            story={radarStory}
            onPickStory={(id) => {
              radarStoryRef.current = id;
              setRadarStory(id);
              try {
                localStorage.setItem(RADAR_STORY_KEY, id);
              } catch {}
              void loadRadar();
            }}
            onClose={() => setRadarActive(false)}
            size={radarSize}
            mini={miniOn}
            onMini={pickRadarMini}
            miniSize={miniSize}
            onMiniSize={pickMiniSize}
            mapAlpha={mapAlpha}
            onMapAlpha={pickMapAlpha}
            dragRegion={!pinned}
            highlightKey={keyLocks ? result?.item_id ?? null : null}
            onSize={(px) => {
              setRadarSize(px);
              try {
                localStorage.setItem(RADAR_SIZE_KEY, String(px));
              } catch {}
            }}
          />
        )}
        {!showSettings && !radarActive && tourStep === null && status === "idle" && !startCard && <div className="hint">{t.hintIdle}</div>}
        {!showSettings && !radarActive && tourStep === null && status === "idle" && startCard && (
          <div className="start-card">
            <div className="start-title">{t.startTitle}</div>
            <div className="start-row"><span className="start-key">{formatHotkeyLabel(hotkey, t)}</span><span>{t.startF2}</span></div>
            <div className="start-row"><span className="start-key">PrtScn</span><span>{t.startShot}</span></div>
            <div className="start-row"><span className="start-key"><Icon name="gear" /></span><span>{t.startSettings}</span></div>
            <div className="start-actions">
              <button
                className="reset-btn start-manual"
                onClick={() => {
                  reportEvent("help", "start:manual");
                  openGuide(region.lang, "manual/");
                }}
              >
                <Icon name="book" /> {t.startManual}
              </button>
              <button className="reset-btn start-gotit" onClick={() => markStartDone("got_it")}>{t.startGotIt}</button>
            </div>
          </div>
        )}
        {!showSettings && !radarActive && tourStep === null && status === "loading" && (
          <div className="hint loading-hint">
            <span className="loading-spinner" aria-hidden="true" />
            <span>{t.hintLoading}</span>
            <div className="hint-sub">{t.hintFirstLoad}</div>
          </div>
        )}
        {!showSettings && !radarActive && tourStep === null && status === "error" && (
          <div className="error">
            <Icon name="warn" /> {error}{" "}
            {(error === t.sidecarMissing || error === t.sidecarDead || error.startsWith(t.connError)) && (
              <button className="status-link" onClick={() => openGuide(region.lang, "manual/#trouble")}>
                {t.troubleHelp}
              </button>
            )}
            <button
              className="status-link"
              onClick={() => openStatusPage(region.lang)}
              title={t.statusPageHint}
            >
              {t.statusPageCheck}
            </button>
          </div>
        )}
        {!showSettings && !radarActive && tourStep === null && status === "success" && result && (
          <div className="result">
            <div className="item-row">
              {result.icon && (
                <img
                  className="item-icon"
                  src={result.icon}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display =
                      "none";
                  }}
                />
              )}
              <div className="item-name" data-fullname={result.item_name ?? undefined}>
                {result.item_name ??
                  (result.raw_text.trim()
                    ? `(${t.noMatch}) "${result.raw_text}"`
                    : `(${t.noMatch})`)}
              </div>
              {/* Wiki shortcut (asked for twice via in-app feedback). Opens in
                  the default browser — never inside the overlay, which is a
                  transparent always-on-top window. Only rendered when the
                  catalog actually has a page for this item. */}
              {(() => {
                // 11-04: 위키 대신 우리 가이드로. 가이드에 아이템별 페이지는 없으므로 아이템을 다루는 목록
                // 페이지로 보내고 검색칸을 채운다(?q= — 한글·영문 이름 모두 걸림). 가이드가 다루지 않는
                // 아이템만 위키로 남긴다.
                if (!result.item_name) return null;
                // 원본 번역에 제어 문자가 섞인 이름이 있다(예: "CPU \bfan 쿨러") — 가이드 검색이 안 걸리므로 빼고 넘긴다
                const q = encodeURIComponent(result.item_name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim());
                // 가이드가 빌드 때 내보낸 '행이 있는 아이템' 목록(item-pages.json)으로만 판단한다 —
                // 필요 아이템 페이지는 택일 목표를 빼고 모으므로 퀘스트에 쓰인다고 다 있지 않다(11-04 실측: 이스크라)
                const guidePath =
                  result.guide_page === "keys" ? `keys/?q=${q}`
                  : result.guide_page === "items" ? `items/?q=${q}`
                  : result.guide_page === "usage" && result.item_id ? `untradeable/#u-${result.item_id}`
                  : null;
                if (guidePath) {
                  return (
                    <button
                      className="wiki-btn"
                      data-href={guideUrl(region.lang, guidePath)}
                      title={t.guideLink}
                      aria-label={t.guideLink}
                      onClick={() => openGuide(region.lang, guidePath)}
                    >
                      <Icon name="book" />
                    </button>
                  );
                }
                return result.wiki ? (
                  <button
                    className="wiki-btn"
                    data-href={result.wiki!}
                    title={t.wikiLink}
                    aria-label={t.wikiLink}
                    onClick={() =>
                      (stat("wk"), openUrl(result.wiki!)).catch((e) =>
                        log(`wiki: openUrl failed — ${String(e)}`)
                      )
                    }
                  >
                    <Icon name="book" />
                  </button>
                ) : null;
              })()}
            </div>
            {/* Capture-box-missed guidance. Two shapes of the same problem,
                with DIFFERENT copy so the message never contradicts the line
                above it:
                (a) nothing read at all → "read no text" hint.
                (b) the WIDE rescue read some text but still didn't match →
                    "widened and retried" hint. (The old code showed the
                    "read NOTHING" copy here too, directly under a card that
                    was quoting the text it just read.)
                Both point at the capture region, not a bare "no match". */}
            {!result.item_name && !result.raw_text.trim() && (
              <div className="hint">{t.emptyCaptureHint}</div>
            )}
            {!result.item_name &&
              result.raw_text.trim() &&
              result.attempt === "wide" && (
                <div className="hint">{t.wideCaptureHint}</div>
              )}
            {/* 11-06 인게임: 글자는 읽었는데 못 찾으면(「183/218」처럼) 안내가 하나도 없거나, 아무 글자에나 '목록 받는 중'만 떴다
                → 흔한 원인(이름이 뜨기 전·빈 곳)을 먼저 알리고, 목록 재갱신 중이면 '처음·새 아이템이면 목록 받는 중'을 덧붙인다 */}
            {!result.item_name && result.raw_text.trim() && result.attempt !== "wide" && (
              <div className="hint">{t.noMatchHint}</div>
            )}
            {/* 11-04 새 아이템: 못 찾으면 사이드카가 목록을 바로 다시 받는다 · 게임 업데이트 직후면 그 사실을 알린다 */}
            {!result.item_name && result.catalog_refreshing && (
              <div className="hint">{t.catalogRefreshingHint}</div>
            )}
            {!result.item_name && result.raw_text.trim() && result.game_updated_hours != null && (
              <div className="hint">{t.recentPatchHint.replace("{h}", String(result.game_updated_hours))}</div>
            )}
            {/* 11-04 첫 설정 도움 — 연달아 못 읽을 때만(조건은 trackF2Outcome) */}
            {!result.item_name && captureHelp && (
              <div className="capture-help" role="status">
                <div className="capture-help-title"><Icon name="warn" /> {captureHelp.mode === "tip" ? t.tipHelpTitle : t.captureHelpTitle}</div>
                <div className="capture-help-body">
                  {captureHelp.mode === "tip"
                    ? t.tipHelpBody
                    : t.captureHelpBody.replace(
                        "{res}",
                        `${Math.round((window.screen?.width ?? 0) * (window.devicePixelRatio || 1))}×${Math.round((window.screen?.height ?? 0) * (window.devicePixelRatio || 1))} · ${Math.round((window.devicePixelRatio || 1) * 100)}%`
                      )}
                </div>
                {captureHelp.scaled && <div className="capture-help-done">{t.captureHelpScaled}</div>}
                <div className="capture-help-actions">
                  <button
                    className="reset-btn update-btn"
                    onClick={() => {
                      reportEvent("help", "capture");
                      helpActionsRef.current += 1;
                      setShowSettings(true);
                      setCaptureModalOpen(true);
                    }}
                  >
                    {t.captureHelpOpen}
                  </button>
                  <button
                    className="reset-btn"
                    onClick={async () => {
                      reportEvent("help", "autoscale");
                      helpActionsRef.current += 1;
                      const r = await applyMonitorScaling(true);
                      if (r) setRegion(r);
                      setCaptureHelp((h) => (h ? { ...h, scaled: true } : h));
                    }}
                    title={t.autoScaleHint}
                  >
                    {t.autoScaleToMonitor}
                  </button>
                  <button
                    className="settings-btn"
                    onClick={() => {
                      reportEvent("help", "dismiss");
                      try {
                        localStorage.setItem(CAPTURE_HELP_DISMISS_KEY, String(Date.now()));
                      } catch {}
                      setCaptureHelp(null);
                    }}
                    title={t.dismiss}
                  >
                    <Icon name="x" />
                  </button>
                </div>
              </div>
            )}
            {/* 조회한 아이템이 열쇠고 지금 맵에서 여는 문이 있으면 — 몇 곳·가장 가까운 거리, 지도에서 금색으로 강조 */}
            {keyLocks && keyLocks.map && (
              <div className="key-locks">
                <span>
                  <Icon name="map" /> {t.keyLocksLine.replace("{map}", keyLocks.map.name).replace("{n}", String(keyLocks.locks.length))}
                  {keyLocks.locks[0]?.dist != null && ` · ${t.keyLocksNearest.replace("{d}", String(Math.round(keyLocks.locks[0].dist)))}`}
                </span>
                {!wideMode && !radarActive && (
                  <button
                    className="link-btn"
                    onClick={() => void openRadar(false)}
                  >
                    {t.keyLocksShow}
                  </button>
                )}
              </div>
            )}
            {result.item_name && (() => {
              const trend = trendPct(result.flea_change_48h_pct);
              const slot = fmtSlot(
                result.flea_price ?? result.trader_price,
                result.width,
                result.height
              );
              // Compute the raw ₽/slot too (fmtSlot returns a string for
              // display, but tier rules need the number). Mirror the same
              // price fallback chain — flea first, then top trader.
              const rawPrice =
                result.flea_price ?? result.trader_price ?? null;
              const slots =
                (result.width ?? 0) * (result.height ?? 0);
              const rubPerSlot =
                rawPrice && slots > 0 ? rawPrice / slots : null;
              // 11-05: 고른 서버 기준으로 끝낸(완료·실패, 카드에서 직접 달성 찍은 것 포함) 퀘스트와
              // 이미 지은 은신처 단계는 등급 가산·보관 판정에서 뺀다 — 전엔 다 쓴 퀘스트템이 계속 C 이상이었다.
              // 상태를 모르는 퀘스트(연동 꺼짐)·은신처 레벨 미입력은 예전처럼 아직 필요로 본다.
              const doneManual = new Set(manualQuestDone[questDisplayMode] ?? []);
              // 11-06 진영: 내 진영이 아닌 진영 전용 퀘스트는 빼고, 진영을 모르면 같은 두 판을 한 줄로(factionQuests.ts)
              const factionRows = filterFactionQuests(
                result.used_in_tasks ?? [],
                effectiveFaction(region.faction, result.faction_by_mode?.[questDisplayMode])
              );
              const adviceQuests: AdviceQuest[] = factionRows.map((q) => {
                const st = q.task_status_by_mode ? q.task_status_by_mode[questDisplayMode] ?? null : q.task_status;
                return {
                  name: q.name,
                  count: q.count,
                  fir: q.fir,
                  kappa: q.kappa_required,
                  alternatives: q.alternatives ?? null,
                  status: q.id && doneManual.has(q.id) ? "completed" : st,
                };
              });
              const adviceHideout: AdviceHideout[] = (result.needed_for_hideout ?? []).map((n) => ({
                station: n.station,
                station_id: n.station_id,
                level: n.level,
                count: n.count,
              }));
              const need = stillNeeded(adviceQuests, adviceHideout, hideoutLevels);
              // 판매 판단(11-06 인게임): 실수령은 플리 줄 바로 밑(상인 밑이라 헷갈렸다), 판정 한 줄(플리↔상인 비교)은 빼고
              // 보관 안내는 퀘스트만(은신처는 필요한 곳이 너무 많아 안내가 안 보였다 — sellAdvice.ts)
              const sellAdv = region.showSellAdvice
                ? sellAdvice({
                    basePrice: result.base_price,
                    fleaPrice: result.flea_price,
                    noFlea: result.no_flea,
                    rates: result.flea_fee_rates,
                    traders: (result.sell_for ?? []).map((s) => ({ name: s.name, price: s.price })),
                    quests: adviceQuests,
                    hideoutLevels,
                    hideoutMgmtLevel,
                  })
                : null;
              const hasKappa = need.kappa;
              const hasQuestOrHideout = need.any;
              const lootTier =
                rubPerSlot != null
                  ? computeLootTier(rubPerSlot, hasQuestOrHideout, hasKappa, false)
                  : null;
              const bestTraderName =
                result.sell_for[0]?.name ?? null;
              // Untradeable item (e.g. new quest keycards/items from a patch):
              // no flea AND no trader price. Show a clear notice instead of
              // two empty "—" rows that read like a malfunction.
              const noMarketPrice =
                result.flea_price == null &&
                result.trader_price == null &&
                (result.sell_for?.length ?? 0) === 0;
              return (
                <div className="prices">
                  {staleNote(result, t)}
                  {noMarketPrice ? (
                    <div className="no-market-note">
                      {/* 플리 금지가 아닌데 시세가 비었으면 새 아이템이거나 거래가 적은 것 — '거래 불가'로 단정하지 않는다 */}
                      {result.no_flea === false ? t.noPriceYet : t.noMarketPrice}
                      {result.is_event && <span className="usage-event">{t.usageEvent}</span>}
                      {result.no_flea === false && result.game_updated_hours != null && (
                        <div>{t.recentPatchHint.replace("{h}", String(result.game_updated_hours))}</div>
                      )}
                      {(() => {
                        // 11-06 시세 없음 카드에도 '어디에 쓰는지' 한두 줄. 순서 = 진행 중 퀘스트 제출 > 아직 안 한 퀘스트 >
                        // 은신처 필요 > 상인 교환 재료 > 제작 재료 > 손글 쓰임새 표(위키 확인, 사이드카 item_usage).
                        // 시세 없음이면 상인 판매가는 원래 없다. 자세한 목록은 아래 각 섹션이 그대로 보여 준다.
                        const lines: string[] = [];
                        const open = adviceQuests
                          .map((q, i) => ({ q, i }))
                          .filter(({ q }) => q.status !== "completed" && q.status !== "failed" && !((q.alternatives ?? 1) > WEAK_ALTERNATIVES));
                        open.sort((a, b) => (a.q.status === "started" ? 0 : 1) - (b.q.status === "started" ? 0 : 1) || a.i - b.i);
                        if (open[0]) {
                          const q = open[0].q;
                          lines.push(t.usageQuest.replace("{name}", q.name) + (q.count ? ` ×${q.count}` : "") + (q.fir ? " · FiR" : "") +
                            (open.length > 1 ? ` (+${open.length - 1})` : ""));
                        }
                        const hasLv = Object.keys(hideoutLevels).length > 0;
                        const hOpen = adviceHideout.filter((h) => !hasLv || (hideoutLevels[h.station_id] ?? 0) < h.level);
                        if (hOpen[0]) {
                          lines.push(t.usageHideout.replace("{station}", hOpen[0].station).replace("{level}", String(hOpen[0].level)) +
                            ` ×${hOpen[0].count}` + (hOpen.length > 1 ? ` (+${hOpen.length - 1})` : ""));
                        }
                        const bu = result.barters_using?.[0];
                        if (bu) {
                          lines.push(t.usageBarter.replace("{trader}", `${bu.trader} LL${bu.level}`)
                            .replace("{reward}", bu.rewards.map((r) => r.short_name ?? r.name).join(", ")));
                        }
                        const cu = result.crafts_using?.[0];
                        if (cu) {
                          lines.push(t.usageCraft.replace("{station}", `${cu.station} ${cu.level}`)
                            .replace("{reward}", cu.rewards.map((r) => r.short_name ?? r.name).join(", ")));
                        }
                        for (const u of result.usage ?? []) {
                          lines.push((u as Record<string, string>)[region.lang] || u.en);
                        }
                        if (lines.length === 0) return null;
                        return (
                          <ul className="usage-lines">
                            {lines.slice(0, 2).map((l, i) => <li key={i}>{l}</li>)}
                          </ul>
                        );
                      })()}
                    </div>
                  ) : (
                    <>
                  <div className="price">
                    <span className="label">
                      {t.flea}
                      {trend && (
                        <span
                          className="trend"
                          style={{
                            color:
                              trend.sign > 0
                                ? "var(--success-dim)"
                                : trend.sign < 0
                                  ? "var(--danger)"
                                  : "var(--text-disabled)",
                          }}
                        >
                          {" "}
                          {trend.text}
                        </span>
                      )}
                    </span>
                    <span className="value">{fmt(result.flea_price)}</span>
                  </div>
                  {sellAdv?.fleaNet != null && (
                    <div
                      className="price sub-price"
                      title={`${t.fleaFee} ${fmt(sellAdv.fee)}${sellAdv.discount > 0 ? ` (−${Math.round(sellAdv.discount * 100)}%)` : ""}
${t.fleaFeeHint}`}
                    >
                      <span className="label">
                        {t.fleaNet}
                        {/* 좁은 카드(ru)에서 두 줄로 꺾여 금액만 — '수수료'·할인율은 마우스를 올리면 */}
                        <span className="vendor-name"> (−{fmt(sellAdv.fee)})</span>
                      </span>
                      <span className="value sub-value">{fmt(sellAdv.fleaNet)}</span>
                    </div>
                  )}
                  {region.show24hRange &&
                    (result.flea_low_24h != null ||
                      result.flea_high_24h != null) && (
                      <div className="price sub-price">
                        <span className="label">{t.fleaRange24}</span>
                        <span className="value sub-value">
                          {fmt(result.flea_low_24h)} ~{" "}
                          {fmt(result.flea_high_24h)}
                        </span>
                      </div>
                    )}
                  {region.showLastTrade && result.flea_last_low != null && (
                    <div
                      className={
                        region.highlightLastTrade ? "price" : "price sub-price"
                      }
                    >
                      <span className="label">
                        {t.fleaLastLow}
                        {result.flea_last_offer_count != null && (
                          <span className="vendor-name">
                            {" "}
                            ({result.flea_last_offer_count}{t.fleaOffersUnit})
                          </span>
                        )}
                      </span>
                      <span
                        className={
                          region.highlightLastTrade
                            ? "value"
                            : "value sub-value"
                        }
                      >
                        {fmt(result.flea_last_low)}
                      </span>
                    </div>
                  )}
                  <div className="price">
                    <span className="label">
                      {t.trader}
                      {bestTraderName && (
                        <span className="vendor-name"> ({bestTraderName})</span>
                      )}
                    </span>
                    <span className="value">{fmt(result.trader_price)}</span>
                  </div>
                  {sellAdv?.keep && (
                    <div className="sell-advice sell-advice-keep">
                      {sellAdv.keep.kind === "quest"
                        ? (sellAdv.keep.started ? t.sellKeepQuestStarted : t.sellKeepQuest).replace("{name}", sellAdv.keep.name) + (sellAdv.keep.fir ? " · " + t.sellFir : "")
                        : sellAdv.keep.kind === "kappa"
                          ? t.sellKeepKappa.replace("{name}", sellAdv.keep.name)
                          : ""}
                    </div>
                  )}
                    </>
                  )}
                  {region.showBuyFor &&
                    result.buy_for &&
                    result.buy_for.length > 0 && (
                    <details className="all-traders" open={region.detailsOpenDefault} style={secStyle("buyFor")}>
                      <summary>
                        <Icon name="store" /> {t.buyFor} ({result.buy_for.length})
                      </summary>
                      <div className="trader-list">
                        {result.buy_for.map((bo) => (
                          <div
                            key={bo.name + bo.min_level}
                            className="price sub-price"
                          >
                            <span className="label">
                              {bo.name}
                              <span className="vendor-name"> Lv{bo.min_level}</span>
                            </span>
                            <span className="value sub-value">{fmt(bo.price)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {region.showBartersFor &&
                    result.barters_for &&
                    result.barters_for.length > 0 && (
                    <details className="all-traders barters" open={region.detailsOpenDefault} style={secStyle("bartersFor")}>
                      <summary><Icon name="exchange" /> {t.barterFor} ({result.barters_for.length})</summary>
                      <div className="trader-list">
                        {result.barters_for.map((b, idx) => (
                          <div key={idx} className="barter-row">
                            <div className="barter-trader">
                              {b.trader} <span className="barter-level">Lv{b.level}</span>
                              {(() => {
                                const tu = b.task_unlock;
                                if (!tu) return null;
                                const st = tu.status_by_mode
                                  ? tu.status_by_mode[questDisplayMode] ?? null
                                  : tu.status ?? null;
                                const done = st === "completed";
                                return (
                                  <span
                                    className={`barter-quest-lock${done ? " unlocked" : ""}`}
                                    title={done ? t.barterQuestUnlockedHint : t.barterQuestLockHint}
                                  >
                                    <Icon name={done ? "check" : "lock"} /> {tu.name}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="barter-items">
                              {b.items.map((it, i) => (
                                <span key={i} className="barter-item" data-fullname={it.name}>
                                  {i > 0 && <span className="barter-plus"> + </span>}
                                  {it.short_name ?? it.name}
                                  <span
                                    className="barter-count"
                                    title={it.approx ? t.barterNeedApproxHint : undefined}
                                  >
                                    ×{it.approx ? "~" : ""}
                                    {it.count}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {region.showBartersUsing &&
                    result.barters_using &&
                    result.barters_using.length > 0 && (
                    <details className="all-traders barters" open={region.detailsOpenDefault} style={secStyle("bartersUsing")}>
                      <summary>
                        <Icon name="send" /> {t.barterUsing} ({result.barters_using.length})
                      </summary>
                      <div className="trader-list">
                        {result.barters_using.map((u, idx) => (
                          <div key={idx} className="barter-row">
                            <div className="barter-trader">
                              {u.trader}{" "}
                              <span className="barter-level">Lv{u.level}</span>
                              {(() => {
                                const tu = u.task_unlock;
                                if (!tu) return null;
                                const st = tu.status_by_mode
                                  ? tu.status_by_mode[questDisplayMode] ?? null
                                  : tu.status ?? null;
                                const done = st === "completed";
                                return (
                                  <span
                                    className={`barter-quest-lock${done ? " unlocked" : ""}`}
                                    title={done ? t.barterQuestUnlockedHint : t.barterQuestLockHint}
                                  >
                                    <Icon name={done ? "check" : "lock"} /> {tu.name}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="barter-items">
                              {u.need_count != null && (
                                <span
                                  className="barter-need"
                                  title={
                                    u.need_approx
                                      ? t.barterNeedApproxHint
                                      : t.barterNeedHint
                                  }
                                >
                                  ×{u.need_approx ? "~" : ""}
                                  {u.need_count}
                                </span>
                              )}{" "}
                              {t.barterUsingArrow}{" "}
                              {u.rewards.map((it, i) => (
                                <span key={i} className="barter-item" data-fullname={it.name}>
                                  {i > 0 && (
                                    <span className="barter-plus">, </span>
                                  )}
                                  {it.short_name ?? it.name}
                                  <span className="barter-count">
                                    ×{it.count}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {region.showCraftsFor &&
                    result.crafts_for &&
                    result.crafts_for.length > 0 && (() => {
                      // Same convention as needed_for_hideout: when the user
                      // hasn't set any station levels we treat everything as
                      // available instead of locking the whole list.
                      const hasLevels = Object.keys(hideoutLevels).length > 0;
                      return (
                        <details className="all-traders barters" open={region.detailsOpenDefault} style={secStyle("craftsFor")}>
                          <summary>
                            <Icon name="hammer" /> {t.craftFor} ({result.crafts_for.length})
                          </summary>
                          <div className="trader-list">
                            {result.crafts_for.map((c, idx) => {
                              const locked =
                                hasLevels &&
                                !!c.station_id &&
                                (hideoutLevels[c.station_id] ?? 0) < c.level;
                              return (
                                <div
                                  key={idx}
                                  className={`barter-row${locked ? " craft-locked" : ""}`}
                                >
                                  <div className="barter-trader">
                                    {c.station}{" "}
                                    <span className="barter-level">
                                      Lv{c.level} · {fmtDuration(c.duration_sec)}
                                    </span>
                                    {locked && (
                                      <span
                                        className="craft-lock-badge"
                                        title={t.craftLockedHint}
                                      >
                                        <Icon name="lock" /> Lv{c.level} {t.craftLockedBadge}
                                      </span>
                                    )}
                                  </div>
                                  <div className="barter-items">
                                    {c.items.map((it, i) => (
                                      <span key={i} className="barter-item" data-fullname={it.name}>
                                        {i > 0 && (
                                          <span className="barter-plus"> + </span>
                                        )}
                                        {it.short_name ?? it.name}
                                        <span className="barter-count">
                                          ×{it.count}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      );
                    })()
                  }
                  {region.showCraftsUsing &&
                    result.crafts_using &&
                    result.crafts_using.length > 0 && (() => {
                      // 피드백 #46 B: 이 아이템이 재료로 들어가는 제작.
                      // 잠금 표시는 위 '은신처 제작' 패널과 같은 규칙.
                      const hasLevels = Object.keys(hideoutLevels).length > 0;
                      const craftsUsing = result.crafts_using;
                      return (
                        <details className="all-traders barters" open={region.detailsOpenDefault} style={secStyle("craftsUsing")}>
                          <summary>
                            <Icon name="flask" /> {t.craftUsing} ({craftsUsing.length})
                          </summary>
                          <div className="trader-list">
                            {craftsUsing.map((c, idx) => {
                              const locked =
                                hasLevels &&
                                !!c.station_id &&
                                (hideoutLevels[c.station_id] ?? 0) < c.level;
                              return (
                                <div
                                  key={idx}
                                  className={`barter-row${locked ? " craft-locked" : ""}`}
                                >
                                  <div className="barter-trader">
                                    {c.station}{" "}
                                    <span className="barter-level">
                                      Lv{c.level} · {fmtDuration(c.duration_sec)}
                                    </span>
                                    {locked && (
                                      <span
                                        className="craft-lock-badge"
                                        title={t.craftLockedHint}
                                      >
                                        <Icon name="lock" /> Lv{c.level} {t.craftLockedBadge}
                                      </span>
                                    )}
                                  </div>
                                  <div className="barter-items">
                                    {c.need_count != null && (
                                      <span
                                        className="barter-need"
                                        title={t.craftUsingNeedHint}
                                      >
                                        ×{c.need_count}
                                      </span>
                                    )}{" "}
                                    {t.barterUsingArrow}{" "}
                                    {c.rewards.map((it, i) => (
                                      <span key={i} className="barter-item" data-fullname={it.name}>
                                        {i > 0 && (
                                          <span className="barter-plus">, </span>
                                        )}
                                        {it.short_name ?? it.name}
                                        <span className="barter-count">
                                          ×{it.count}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      );
                    })()
                  }
                  {region.showQuests && result.gunsmith && result.gunsmith.length > 0 && (
                    <div className="quest-warning gunsmith" title={t.gunsmithHint} style={secStyle("gunsmith")}>
                      <Icon name="wrench" /> {t.gunsmithTitle} ({result.gunsmith.length})
                      <div className="quest-list">
                        {result.gunsmith.map((g, i) => (
                          <div key={`${g.quest}-${g.kind}-${i}`} className="quest-row">
                            <span className="quest-trader">{g.kind === "req" ? t.gunsmithReq : t.gunsmithEx}</span>
                            <span className="quest-name">
                              {g.quest}
                              {g.weapon ? <span className="quest-sub"> · {g.weapon}</span> : null}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {region.showHideoutNeeds &&
                    result.needed_for_hideout &&
                    result.needed_for_hideout.length > 0 && (() => {
                      const hasLevels = Object.keys(hideoutLevels).length > 0;
                      const neededCount = hasLevels
                        ? result.needed_for_hideout.filter(
                            (n) => (hideoutLevels[n.station_id] ?? 0) < n.level
                          ).length
                        : result.needed_for_hideout.length;
                      const total = result.needed_for_hideout.length;
                      const countLabel = hasLevels
                        ? `${neededCount}/${total}`
                        : `${total}`;
                      return (
                        <details className="all-traders barters" open={region.detailsOpenDefault} style={secStyle("hideoutNeeds")}>
                          <summary>
                            <Icon name="hideout" /> {t.hideoutNeed} ({countLabel})
                          </summary>
                          <div className="trader-list">
                            {result.needed_for_hideout.map((n, idx) => {
                              const done =
                                hasLevels &&
                                (hideoutLevels[n.station_id] ?? 0) >= n.level;
                              const togglable = !!n.station_id;
                              return (
                                <div
                                  key={idx}
                                  className={`hideout-need-row${done ? " done" : ""}${togglable ? " toggleable" : ""}`}
                                  title={
                                    togglable
                                      ? done
                                        ? t.hideoutNeedUndoHint
                                        : t.hideoutNeedDoneHint
                                      : undefined
                                  }
                                  onClick={
                                    togglable
                                      ? () =>
                                          toggleHideoutNeedDone(
                                            n.station_id,
                                            n.level,
                                            done
                                          )
                                      : undefined
                                  }
                                >
                                  <span className="hideout-need-station">{n.station}</span>
                                  <span className="hideout-need-level">Lv{n.level}</span>
                                  {n.station_slug && (
                                    <button
                                      className="guide-link-btn"
                                      data-href={guideUrl(region.lang, `hideout/${n.station_slug}/#lv${n.level}`)}
                                      title={t.guideHideoutLink}
                                      aria-label={t.guideHideoutLink}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openGuide(region.lang, `hideout/${n.station_slug}/#lv${n.level}`);
                                      }}
                                    >
                                      <Icon name="book" />
                                    </button>
                                  )}
                                  <span className="hideout-need-count">×{n.count}</span>
                                  {n.fir && (
                                    <span
                                      className="quest-fir"
                                      title={t.questFirHint}
                                    >
                                      <Icon name="lock" /> {t.questFirBadge}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      );
                    })()
                  }
                  {region.showAmmoMatrix &&
                    result.caliber &&
                    ammoData?.calibers[result.caliber] && (() => {
                      const slot = ammoData.calibers[result.caliber];
                      const display =
                        result.caliber_display ?? slot.display;
                      // Highlight the current round when the lookup IS a
                      // round (name match) or an ammo PACK (the round it
                      // contains — id match first, localized-name fallback
                      // for stale caches without the id). Weapon lookups
                      // match no row, so no highlight.
                      const packRoundId = result.ammo_pack_round_id ?? null;
                      const packRoundName = result.ammo_pack_round_name ?? null;
                      return (
                        // Always open — the ammo matrix is the headline
                        // feature for weapon/round lookups, not a secondary
                        // detail panel. Hiding it behind detailsOpenDefault
                        // (regression since v1.0.7) made users assume the
                        // panel "didn't show up" when their result was a
                        // weapon or ammo. Other details (barters/crafts/
                        // quests) stay user-controlled because they're
                        // auxiliary info.
                        <details className="all-traders barters" open style={secStyle("ammoMatrix")}>
                          <summary>
                            <Icon name="target" /> {t.ammoCompare} · {display} ({slot.rounds.length})
                          </summary>
                          <div className="ammo-matrix">
                            <div className="ammo-row ammo-row-head">
                              <span className="ammo-name">{t.ammoName}</span>
                              <span className="ammo-pen" title={t.ammoPenHint}>{t.ammoColPen}</span>
                              <span className="ammo-dmg" title={t.ammoDmgHint}>{t.ammoColDmg}</span>
                              <span className="ammo-ac-head" title={t.ammoAcHint}>{t.ammoColAc}</span>
                            </div>
                            {slot.rounds.map((r) => {
                              const isCurrent = !!(
                                r.name === result.item_name ||
                                (packRoundId
                                  ? r.id === packRoundId
                                  : packRoundName && r.name === packRoundName)
                              );
                              return (
                                <div
                                  key={r.id ?? r.name}
                                  className={`ammo-row${isCurrent ? " ammo-row-current" : ""}`}
                                >
                                  <span className="ammo-name" data-fullname={r.name}>{r.short_name}</span>
                                  <span className="ammo-pen">{r.penetration}</span>
                                  <span className="ammo-dmg">{r.damage}</span>
                                  <span className="ammo-ac">
                                    {[1, 2, 3, 4, 5, 6].map((ac) => {
                                      // Simple heuristic for the AC cell
                                      // color: pen >= ac*10 → reliable, pen
                                      // >= ac*7 → variable, else → unlikely.
                                      // EFT's real penetration formula is
                                      // probabilistic by durability — close
                                      // enough for at-a-glance scanning.
                                      const cls =
                                        r.penetration >= ac * 10
                                          ? "ac-pass"
                                          : r.penetration >= ac * 7
                                            ? "ac-mid"
                                            : "ac-fail";
                                      return (
                                        <span
                                          key={ac}
                                          className={`ac-cell ${cls}`}
                                          title={`AC${ac}`}
                                        >
                                          {cls === "ac-pass"
                                            ? "●"
                                            : cls === "ac-mid"
                                              ? "◐"
                                              : "○"}
                                        </span>
                                      );
                                    })}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      );
                    })()}
                  {region.showQuests &&
                    factionRows.length > 0 && (() => {
                      // Reproject each task's status to the user's chosen
                      // quest-display mode. The backend sends
                      // task_status_by_mode so we don't need a re-capture
                      // when the user flips the dropdown — the same lookup
                      // payload renders correctly for either server.
                      // Older backends only send task_status (no by_mode
                      // dict), so we fall through to the original value.
                      // 피드백 #49-②: 카드에서 직접 '달성' 찍은 퀘스트는
                      // 이 서버 기준 completed로 본다(로그 동기화와 별개).
                      const manualSet = new Set(
                        manualQuestDone[questDisplayMode] ?? []
                      );
                      const projected = factionRows.map((q) => {
                        const base = q.task_status_by_mode
                          ? {
                              ...q,
                              task_status:
                                q.task_status_by_mode[questDisplayMode] ?? null,
                            }
                          : q;
                        const manual =
                          !!q.id &&
                          manualSet.has(q.id) &&
                          base.task_status !== "completed";
                        return manual
                          ? { ...base, task_status: "completed" as const, manual }
                          : { ...base, manual: false };
                      });
                      // Filter out completed quests entirely if the user
                      // chose "hide" — otherwise we keep them and just
                      // grey them in the list. Started/failed/unknown
                      // quests are always shown. 직접 찍은 것은 숨기지 않는다
                      // — 숨기면 다시 눌러 해제할 방법이 없어진다.
                      const visibleQuests =
                        region.completedQuestDisplay === "hide"
                          ? projected.filter(
                              (q) => q.task_status !== "completed" || q.manual
                            )
                          : projected;
                      if (visibleQuests.length === 0) return null;
                      // Item-count total only sums quests the player still
                      // needs (not completed ones), so the header reflects
                      // what the player actually has to grind out.
                      const remainingCount = visibleQuests.reduce(
                        (acc, q) =>
                          acc +
                          (q.task_status === "completed" ? 0 : q.count ?? 0),
                        0
                      );
                      const completedShown = visibleQuests.filter(
                        (q) => q.task_status === "completed"
                      ).length;
                      return (
                        <div className="quest-warning" style={secStyle("quests")}>
                          <Icon name="quests" /> {t.usedInTasks} ({visibleQuests.length})
                          {remainingCount > 0 && (
                            <span className="quest-total">
                              {" "}
                              · {t.questTotal} <strong>{remainingCount}</strong>
                            </span>
                          )}
                          {completedShown > 0 && (
                            <span
                              className="quest-completed-badge"
                              title={t.questCompletedHint}
                            >
                              {" "}
                              · <Icon name="check" /> {completedShown}
                            </span>
                          )}
                          <div className="quest-list">
                            {visibleQuests.map((q, idx) => {
                              const statusClass =
                                q.task_status === "completed"
                                  ? " completed"
                                  : q.task_status === "started"
                                    ? " started"
                                    : "";
                              // 로그가 완료라고 한 퀘스트는 수동 토글 대상이
                              // 아니다(진짜 진행도를 덮지 않도록).
                              const togglable =
                                !!q.id &&
                                (q.manual || q.task_status !== "completed");
                              return (
                                <div
                                  key={q.id ?? idx}
                                  className={`quest-row${statusClass}${togglable ? " toggleable" : ""}`}
                                  title={
                                    togglable
                                      ? q.manual
                                        ? t.questManualUndoHint
                                        : t.questManualDoneHint
                                      : undefined
                                  }
                                  onClick={
                                    togglable
                                      ? () =>
                                          toggleManualQuestDone(
                                            questDisplayMode,
                                            q.id as string
                                          )
                                      : undefined
                                  }
                                >
                                  <span className="quest-trader">{q.trader}</span>
                                  <span className="quest-name">{q.name}</span>
                                  {/* 진영을 모를 때, 두 진영 요구량이 달라 따로 남은 줄에만 진영 표시(같아서 합친 줄은 어느 진영이든 맞으니 표시 안 함).
                                      이름 칸 밖이라 긴 이름에 잘리지 않는다 */}
                                  {(q.factionTag === "BEAR" || q.factionTag === "USEC") && (
                                    <span className="quest-faction" title={t.factionTagHint}>
                                      {q.factionTag}
                                    </span>
                                  )}
                                  {q.slug && (
                                    <button
                                      className="guide-link-btn"
                                      data-href={guideUrl(region.lang, `quest/${q.slug}/`)}
                                      title={t.guideQuestLink}
                                      aria-label={t.guideQuestLink}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openGuide(region.lang, `quest/${q.slug}/`);
                                      }}
                                    >
                                      {/* 11-07 회색 70%라 잘 안 보였다 → 금색 테두리 아이콘(App.css .quest-row .guide-link-btn).
                                          '공략' 글자도 붙여 봤으나 좁은 카드(280px)에서 퀘스트 이름이 '방'처럼 잘려 뺐다 */}
                                      <Icon name="book" />
                                    </button>
                                  )}
                                  <span className="quest-count">
                                    {q.task_status === "completed" && (
                                      <span
                                        className="quest-status-icon completed"
                                        title={t.questCompletedHint}
                                      >
                                        <Icon name="check" />
                                      </span>
                                    )}
                                    {q.task_status === "started" && (
                                      <span
                                        className="quest-status-icon started"
                                        title={t.questInProgressHint}
                                      >
                                        <Icon name="play" />
                                      </span>
                                    )}
                                    {q.count != null && (
                                      <span className="quest-count-num">
                                        ×{q.count}
                                      </span>
                                    )}
                                    {q.fir ? (
                                      <span
                                        className="quest-fir"
                                        title={t.questFirHint}
                                      >
                                        <Icon name="lock" /> {t.questFirBadge}
                                      </span>
                                    ) : (
                                      q.count != null && (
                                        <span
                                          className="quest-anyitem"
                                          title={t.questAnyHint}
                                        >
                                          <Icon name="check" /> {t.questAnyBadge}
                                        </span>
                                      )
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  {(() => {
                    // `<= 1` (not `=== 1`) so items with missing width/height
                    // metadata (rare — usually quest/special items where
                    // tarkov.dev hasn't filled the size props) still render
                    // the price/tier line. Without this guard, slots=0 fell
                    // through both branches and the 📦 row vanished entirely.
                    const isSingleSlot = slots <= 1;
                    const showTierBadge = region.showLootTier && lootTier;
                    const showWeightLine =
                      region.showWeight &&
                      result.weight != null &&
                      result.weight > 0;
                    // Single-slot items show "📦 N ₽ [tier]" (size omitted
                    // since 1×1 is implicit). Multi-slot items show the
                    // full "📦 W×H → N ₽/slot [tier]" line.
                    const showSlotLine =
                      slot || (isSingleSlot && (showTierBadge || rawPrice != null));
                    return (
                      (showSlotLine || showWeightLine) && (
                        <div className="slot-price" style={secStyle("slotLine")}>
                          {showSlotLine && (
                            <span>
                              <Icon name="box" />{" "}
                              {isSingleSlot ? (
                                rawPrice != null && (
                                  <strong>{fmt(rawPrice)}</strong>
                                )
                              ) : (
                                <>
                                  {result.width}×{result.height}
                                  {slot && (
                                    <>
                                      {" → "}
                                      <strong>{slot}</strong>
                                    </>
                                  )}
                                </>
                              )}
                              {showTierBadge && (
                                <span
                                  className={`loot-tier loot-tier-${lootTier}`}
                                  title={t.lootTierHint}
                                >
                                  {lootTier}
                                </span>
                              )}
                            </span>
                          )}
                          {showWeightLine && (
                            <span className="weight-info">
                              {slot || isSingleSlot ? " · " : ""}<Icon name="scale" /> {result.weight!.toFixed(2)}kg
                              {result.flea_price != null &&
                                result.weight! >= 0.05 && (
                                  <span className="weight-per">
                                    {" "}
                                    ({Math.round(
                                      result.flea_price / result.weight!
                                    ).toLocaleString()}{" "}
                                    {t.perKgUnit})
                                  </span>
                                )}
                            </span>
                          )}
                        </div>
                      )
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        )}
        {/* Bottom-right handle: drag to widen/narrow the card; double-click
            resets to auto width. Hidden while the capture modal is open so it
            doesn't overlap the modal's own controls. */}
        {/* Pin hides the handle to block accidental resizes — EXCEPT while
            settings is open: the user is deliberately interacting there and
            this handle is the only way to size the settings panel. */}
        {cardVisible && !captureModalOpen && (!pinned || showSettings) && (
          <div
            className="card-resize-handle"
            title={t.cardResizeHint}
            onPointerDown={onResizeHandleDown}
            onDoubleClick={resetCardSize}
          />
        )}
      </div>
      {wideMode && (
        <div
          ref={paneRef}
          className={`card wide-pane${cardVisible ? "" : " card-hidden"}`} // 카드를 숨기면(토글·트레이) 패널도 함께
          style={{
            "--card-fs": `${region.fontSize}px`,
            // 숨김(.card-hidden = opacity 0)을 인라인 값이 덮지 않게 — 시세 카드와 같은 방식(11-04 'Shift+F2 로 숨기면 지도만 남음')
            opacity: cardVisible ? Math.max(region.opacity, RADAR_MIN_OPACITY) / 100 : undefined,
            ["--card-bg-alpha" as string]: String(region.bgOpacity / 100),
            ["--side-h" as string]: sideH ? `${sideH}px` : undefined,
          } as React.CSSProperties}
        >
          <RadarPanel
            party={party}
            data={radarData}
            loading={radarLoading}
            mapAlpha={mapAlpha}
            onMapAlpha={pickMapAlpha}
            t={t}
            lang={region.lang}
            showScav={radarShowScav}
            onToggleScav={(v) => {
              setRadarShowScav(v);
              localStorage.setItem(RADAR_SCAV_KEY, String(v));
            }}
            onPickMap={(id) => {
              radarMapRef.current = id;
              void loadRadar();
            }}
            story={radarStory}
            onPickStory={(id) => {
              radarStoryRef.current = id;
              setRadarStory(id);
              try {
                localStorage.setItem(RADAR_STORY_KEY, id);
              } catch {}
              void loadRadar();
            }}
            onClose={toggleWide}
            size={paneSize}
            highlightKey={keyLocks ? result?.item_id ?? null : null}
            onSize={() => {}}
            fill
          />
        </div>
      )}
      {wideMode && cardVisible && !pinned && (
        <div
          ref={wideResizeRef}
          className="card-resize-handle wide-resize-handle"
          title={t.wideResizeHint}
          onPointerDown={onWideResizeDown}
          onDoubleClick={() => void resetWideRect()}
        />
      )}
    </div>
  );
}

export default App;
