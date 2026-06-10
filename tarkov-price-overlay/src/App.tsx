import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition, LogicalSize, primaryMonitor, availableMonitors } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check as checkForAppUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as openFolderDialog, message } from "@tauri-apps/plugin-dialog";
import { QRCodeSVG } from "qrcode.react";
import { T, type Lang, type GameMode } from "./i18n";
import "./App.css";

declare const __APP_VERSION__: string;
const APP_VERSION = __APP_VERSION__;
const UPDATE_CHECK_KEY = "tarkov.autoCheckUpdate";
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

function loadAutoCheckUpdate(): boolean {
  const v = localStorage.getItem(UPDATE_CHECK_KEY);
  return v == null ? true : v === "true";
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

async function fetchDiagnostics(): Promise<Diagnostics | null> {
  try {
    const res = await fetch(`${PYTHON_API}/diagnostics`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
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
type UpdatePhase = "idle" | "downloading" | "ready" | "error";
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

// Public downloads page. Portable users get sent here from the update
// banner instead of going through `update.downloadAndInstall()`, which
// silently installs a *second* copy at the default NSIS path and leaves
// the portable folder's exe pinned at the old version.
const RELEASES_PAGE_URL =
  "https://github.com/pado8/tarkov-price-overlay-releases/releases/latest";

// Generate-once anonymous device identifier. Persists in localStorage so a
// re-install (which wipes localStorage) re-generates a new ID — that's the
// intended DAU-counting semantic, not a stable user ID across reinstalls.
const ensureInstallId = (): string => {
  let id = localStorage.getItem(INSTALL_ID_KEY);
  if (!id) {
    // crypto.randomUUID is available in WebView2 / Tauri's webview.
    id = crypto.randomUUID();
    localStorage.setItem(INSTALL_ID_KEY, id);
  }
  return id;
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
// The last two are post-patch breakage signals: a spike after a game update
// surfaces new/unrecognized items in the dashboard before users report it.
// (ad_impression/ad_click still accepted server-side for old clients.)
type StatsEvent = "launch" | "lookup" | "lookup_nomatch" | "lookup_noprice";
const reportEvent = (eventType: StatsEvent, detail?: string) => {
  if (!loadStatsEnabled()) return;
  fetch(STATS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      install_id: ensureInstallId(),
      event_type: eventType,
      version: APP_VERSION,
      ...(detail ? { detail } : {}),
    }),
    keepalive: true,
  }).catch(() => {});
};

// Privacy-preserving nomatch reason for telemetry — NEVER the raw OCR text,
// just a coarse category so the dashboard can tell a capture/alignment miss
// ("empty" = nothing read, "junk" = too short / no letters → region likely
// misaligned) apart from a genuine OCR misread or new item ("no_match").
function nomatchCategory(raw?: string | null): string {
  const t = (raw || "").trim();
  if (!t) return "empty";
  if (t.length < 3 || !/[a-zA-Z가-힣]/.test(t)) return "junk";
  return "no_match";
}

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
};
type Barter = {
  trader: string;
  level: number;
  items: BarterRequiredItem[];
};

type TaskRef = {
  id: string | null;
  name: string;
  trader: string;
  min_level: number;
  count: number | null;
  fir: boolean;
  // Whether this task is on the Kappa progression. Used by the loot-tier
  // tier function — Kappa items get boosted to A even at low ₽/slot.
  kappa_required: boolean;
  // Filled by the backend quest tracker if it found this quest in the
  // player's EFT logs. null when the tracker is off or the quest is unseen.
  // `task_status` is for the lookup's own game_mode (back-compat); newer
  // builds also send `task_status_by_mode` so the user-picked display mode
  // can switch the card instantly without a re-capture.
  task_status: "started" | "completed" | "failed" | null;
  task_status_by_mode?: {
    pvp: "started" | "completed" | "failed" | null;
    pve: "started" | "completed" | "failed" | null;
  };
};

type QuestModeCounts = {
  started: number;
  completed: number;
  failed: number;
};

type QuestStatus = {
  enabled: boolean;
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
  counts_by_mode?: { pvp: QuestModeCounts; pve: QuestModeCounts };
};

type HideoutCraft = {
  station: string;
  level: number;
  duration_sec: number;
  items: BarterRequiredItem[];
};

type HideoutNeed = {
  station: string;
  station_id: string;
  level: number;
  count: number;
};

type HideoutStation = {
  id: string;
  name: string;
  maxLevel: number;
};

type BarterUsing = {
  trader: string;
  level: number;
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
  item_name: string | null;
  short_name: string | null;
  width: number | null;
  height: number | null;
  weight: number | null;
  icon: string | null;
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
  crafts_for: HideoutCraft[];
  needed_for_hideout: HideoutNeed[];
  // Caliber for ammo / weapons. Drives auto-expansion of the Ammo Matrix
  // panel and pre-selects the relevant caliber. null for everything else.
  caliber: string | null;
  caliber_display: string | null;
  matched_from: string | null;
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

async function fetchAmmo(lang: Lang): Promise<AmmoData | null> {
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
  gameLang?: Lang;
  gameMode: GameMode;
  hideDelaySec: number;
  // Master auto-hide switch. Off = the card stays up until the user hides it
  // explicitly (✕ / toggle hotkey). hideDelaySec only applies while this is on.
  autoHide: boolean;
  // Display prefs — what to show in the result card. Default minimal:
  // only flea / trader / slot price are shown.
  show24hRange: boolean;
  showLastTrade: boolean;
  showWeight: boolean;
  showBuyFor: boolean;
  showBartersFor: boolean;
  showBartersUsing: boolean;
  showCraftsFor: boolean;
  showHideoutNeeds: boolean;
  showQuests: boolean;
  // What to do with quests the player has already completed (per the
  // EFT log watcher). "dim" greys them out so they're still visible but
  // de-emphasized; "hide" filters them out entirely.
  completedQuestDisplay: "dim" | "hide";
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
  // Ammo Matrix panel: auto-expands on the card when the lookup result is
  // a weapon or a round. Off entirely hides the panel even on ammo/weapon.
  showAmmoMatrix: boolean;
};

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
  showWeight: true,
  showBuyFor: true,
  showBartersFor: true,
  showBartersUsing: true,
  showCraftsFor: true,
  showHideoutNeeds: true,
  showQuests: true,
  completedQuestDisplay: "dim",
  detailsOpenDefault: true,
  fontSize: 13,
  opacity: 100,
  bgOpacity: 85,
  showLootTier: true,
  showAmmoMatrix: true,
};

const STORAGE_KEY = "tarkov.captureRegion";
const POSITION_KEY = "tarkov.windowPosition";
const HOTKEY_KEY = "tarkov.hotkey";
const TOGGLE_HOTKEY_KEY = "tarkov.toggleHotkey";
const SOUND_KEY = "tarkov.soundOn";
const PIN_KEY = "tarkov.pinned";
const HISTORY_KEY = "tarkov.history";
const CORRECTIONS_KEY = "tarkov.ocrCorrections";
const ADVANCED_KEY = "tarkov.advancedMode";
const SETTINGS_HEIGHT_KEY = "tarkov.settingsHeight";
const QUEST_DISPLAY_MODE_KEY = "tarkov.questDisplayMode";
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

function loadAdvanced(): boolean {
  return localStorage.getItem(ADVANCED_KEY) === "true";
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

function loadQuestDisplayMode(): "pvp" | "pve" {
  // Default PVE — most current players run PVE-only, and matches the
  // historical legacy migration default for single-mode users.
  const v = localStorage.getItem(QUEST_DISPLAY_MODE_KEY);
  return v === "pvp" ? "pvp" : "pve";
}
const WIN_BASE_W = 800;
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

function loadCorrections(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CORRECTIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {}
  return {};
}

function saveCorrection(rawText: string, correctedName: string) {
  if (!rawText.trim() || !correctedName.trim()) return;
  const c = loadCorrections();
  c[rawText.trim().toLowerCase()] = correctedName.trim();
  try {
    localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(c));
  } catch {}
}

function removeCorrection(rawText: string) {
  const c = loadCorrections();
  delete c[rawText.trim().toLowerCase()];
  try {
    localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(c));
  } catch {}
}

// Scale capture region defaults by primary-monitor width. Defaults assume
// 1920×1080; QHD (2560×1440) and 4K (3840×2160) need bigger boxes because
// EFT's hover tooltip itself scales with display resolution. Only scales up
// (never below 1.0) — sub-1080p users keep the existing defaults that fit
// in their smaller hover boxes. Primary monitor (not the window's current
// monitor) so dual-monitor setups where the overlay sits on a secondary
// screen still get sensible defaults for the gameplay monitor.
function scaleRegionForMonitor(base: Region, monitorWidth: number): Region {
  const scale = Math.max(monitorWidth / 1920, 1.0);
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
    const scaled = scaleRegionForMonitor(DEFAULT_REGION, mon.size.width);
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

const getGameLang = (r: Region): Lang => r.gameLang ?? r.lang;

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
  min: number;
  max: number;
  value: number;
  isEditing: boolean;
  onChange: (n: number) => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
}) {
  const { label, min, max, value, isEditing, onChange, onStartEdit, onStopEdit } = props;
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
            title="클릭해서 직접 입력 / Click to type"
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
  const [error, setError] = useState<string>("");
  const [region, setRegion] = useState<Region>(loadRegion);
  const [showSettings, setShowSettings] = useState(false);
  const [hotkey, setHotkey] = useState<string>(loadHotkey);
  const [toggleHotkey, setToggleHotkey] =
    useState<string>(loadToggleHotkey);
  const [soundOn, setSoundOn] = useState<boolean>(loadSoundOn);
  const [recordingTarget, setRecordingTarget] = useState<
    null | "lookup" | "toggle"
  >(null);
  const recordingHotkey = recordingTarget !== null;
  // Brief inline error shown on the recording button when the user tries to
  // bind a mouse button that's already on the other slot. Cleared when
  // recording ends or after a short timeout so the user gets a noticeable
  // hint without a modal/toast layer.
  const [hotkeyConflict, setHotkeyConflict] = useState(false);
  // Modal-style capture-region editor. When open, renders the editor as
  // an absolute-positioned dialog over the card content and shows the
  // preview rectangles at a stable anchor (see PREVIEW_ANCHOR_KEY).
  const [captureModalOpen, setCaptureModalOpen] = useState(false);
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
  const [remoteAnnounce, setRemoteAnnounce] = useState<
    { id: number; ko: string; en: string } | null
  >(null);
  // Anonymous stats are opt-out: enabled by default, with a one-time
  // informational notice (not a blocking consent gate).
  const [statsEnabled, setStatsEnabled] = useState<boolean>(loadStatsEnabled);
  const [statsNoticeShown, setStatsNoticeShown] = useState<boolean>(
    loadStatsNoticeShown
  );
  // True when the running exe was launched from a portable ZIP (detected
  // via the `_portable.marker` file dropped by portable.ps1). Portable
  // users see a "open downloads page" link instead of the in-app NSIS
  // installer flow, which would install a second copy elsewhere.
  const [isPortable, setIsPortable] = useState<boolean>(false);
  const [hideoutLevels, setHideoutLevels] = useState<Record<string, number>>(
    () => {
      try {
        return JSON.parse(localStorage.getItem(HIDEOUT_LEVELS_KEY) ?? "{}");
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
  // Pin: locks window move (drag region off), resize (handle hidden) and the
  // ✕ button so a mid-raid misclick can't displace or close the overlay.
  // Unpinning stays available in settings.
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
  const cardHeightOverrideForResize = (): number | null =>
    showSettingsRef.current || captureModalOpenRef.current
      ? null
      : cardHeightRef.current;
  // True while the bottom-right resize handle is being dragged. Keeps the
  // click-through poll from re-enabling pass-through when the cursor briefly
  // leaves the card rect mid-drag (the window would otherwise eat the drag).
  const resizingRef = useRef(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [correctionInput, setCorrectionInput] = useState<string>("");
  const [correcting, setCorrecting] = useState<boolean>(false);
  const [autoCheckUpdate, setAutoCheckUpdate] = useState<boolean>(
    loadAutoCheckUpdate
  );
  const [advancedMode, setAdvancedMode] = useState<boolean>(loadAdvanced);
  const [questStatus, setQuestStatus] = useState<QuestStatus | null>(null);
  const [questPathInput, setQuestPathInput] = useState<string>("");
  const [questDisplayMode, setQuestDisplayMode] = useState<"pvp" | "pve">(
    loadQuestDisplayMode
  );
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null);
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
  const [feedbackText, setFeedbackText] = useState("");
  // Attached screenshot as a compressed JPEG data URL (null = none).
  const [feedbackImage, setFeedbackImage] = useState<string | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState<
    "idle" | "sending" | "sent" | "error"
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
  const hideDelayRef = useRef(region.hideDelaySec);
  useEffect(() => {
    hideDelayRef.current = region.hideDelaySec;
  }, [region.hideDelaySec]);

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
    const stored = localStorage.getItem(SETTINGS_HEIGHT_KEY);
    if (stored) {
      const n = parseInt(stored);
      if (!isNaN(n) && n >= 200 && n <= 2000) el.style.height = `${n}px`;
    }
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h >= 200) localStorage.setItem(SETTINGS_HEIGHT_KEY, String(h));
      // Re-measure the card and resize the window to match the new
      // natural content height. Uses the same formula as the card's
      // observer so the two paths agree.
      const ch = Math.ceil(cardEl.scrollHeight) + WIN_VPAD;
      const clamped = Math.min(Math.max(ch, 100), screenMaxH());
      getCurrentWindow()
        .setSize(new LogicalSize(WIN_BASE_W, clamped))
        .catch(() => {});
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
    reportEvent("launch");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-shot check on mount: is this exe the portable distribution?
  // Cached for the session — the marker file doesn't move while the app
  // runs. Result drives the update-banner UI (Install vs Open page).
  useEffect(() => {
    invoke<boolean>("is_portable_install")
      .then((v) => {
        setIsPortable(v);
        log(`portable: ${v}`);
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
        if (!a || !a.active || (!a.ko && !a.en)) return;
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
        setRemoteAnnounce({ id: a.id, ko: a.ko ?? "", en: a.en ?? "" });
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
    // Auto-hide disabled: the card stays until hidden explicitly.
    if (!autoHideRef.current) return;
    // Don't auto-hide while settings is open — the user is mid-interaction.
    if (settingsOpenRef.current) return;
    // Don't start the countdown while a lookup is still in flight — the
    // result would land on an already-hidden card (the lookup's own finally
    // schedules the hide once it completes).
    if (lookupInFlightRef.current) return;
    const ms = Math.max(1, hideDelayRef.current) * 1000;
    hideTimerRef.current = window.setTimeout(() => {
      setCardVisible(false);
      hideTimerRef.current = null;
    }, ms);
  };
  const showCard = () => {
    cancelHideTimer();
    setCardVisible(true);
  };

  // Region-based click-through: while the card is visible, poll cursor
  // position and only capture clicks when the cursor is over the card's
  // screen rect. Outside the card (rest of the 800x600 invisible window)
  // clicks pass through to whatever's underneath (the game).
  useEffect(() => {
    const win = getCurrentWindow();
    if (!cardVisible) {
      // Hidden: full pass-through.
      win.setIgnoreCursorEvents(true).catch(() => {});
      return;
    }

    let cancelled = false;
    let currentlyIgnoring: boolean | null = null;
    const setIgnore = (v: boolean) => {
      if (currentlyIgnoring === v) return;
      currentlyIgnoring = v;
      win.setIgnoreCursorEvents(v).catch(() => {});
    };
    // Start in pass-through; the first poll will flip it if cursor is on card.
    setIgnore(true);

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
        const cardEl = cardRef.current;
        if (cardEl) {
          const rect = cardEl.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const winPos = await win.outerPosition();
            const dpr = window.devicePixelRatio || 1;
            const left = winPos.x + rect.left * dpr;
            const top = winPos.y + rect.top * dpr;
            const right = left + rect.width * dpr;
            const bottom = top + rect.height * dpr;
            const cursor = await invoke<{ x: number; y: number }>(
              "get_cursor_position"
            );
            const inside =
              cursor.x >= left &&
              cursor.x < right &&
              cursor.y >= top &&
              cursor.y < bottom;
            setIgnore(!inside);
          }
        }
      } catch {}
      if (!cancelled) setTimeout(poll, 40);
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [cardVisible]);

  const t = T[region.lang];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(region));
  }, [region]);

  useEffect(() => {
    localStorage.setItem(HOTKEY_KEY, hotkey);
    // Either the keyboard or the mouse slot is active per binding — clear
    // the other one so a stale registration from a previous binding doesn't
    // keep firing alongside the new one.
    if (isMouseHotkey(hotkey)) {
      invoke("register_lookup_hotkey", { accelerator: "" }).catch(() => {});
      invoke("register_lookup_mouse", { button: hotkey })
        .then(() => log(`React: lookup hotkey = ${hotkey} (mouse)`))
        .catch((e) => log(`React: lookup mouse FAILED (${hotkey}): ${e}`));
    } else {
      invoke("register_lookup_mouse", { button: "" }).catch(() => {});
      invoke("register_lookup_hotkey", { accelerator: hotkey })
        .then(() => log(`React: lookup hotkey = ${hotkey}`))
        .catch((e) => log(`React: lookup hotkey FAILED (${hotkey}): ${e}`));
    }
  }, [hotkey]);

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
    localStorage.setItem(ADVANCED_KEY, String(advancedMode));
  }, [advancedMode]);

  // Probe sidecar diagnostics on mount, retrying until it answers (the sidecar
  // can take >3s on a cold start while it loads OCR models). Drives the admin-
  // rights banner and the elevation telemetry.
  const adminReportedRef = useRef(false);
  useEffect(() => {
    let mounted = true;
    let tries = 0;
    let timer: number | undefined;
    const probe = async () => {
      const info = await fetchDiagnostics();
      if (!mounted) return;
      if (info) {
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
  const checkForUpdate = async () => {
    setUpdateChecking(true);
    setUpdateError(null);
    try {
      const update = await checkForAppUpdate();
      setUpdateCheckedAt(Date.now());
      if (update) {
        pendingUpdateRef.current = update;
        setUpdateInfo({ version: update.version, notes: update.body ?? null });
        setUpdatePhase("idle");
        log(`update: ${APP_VERSION} -> ${update.version} available`);
      } else {
        pendingUpdateRef.current = null;
        setUpdateInfo(null);
        log(`update: up to date (${APP_VERSION})`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`update: check failed — ${msg}`);
      setUpdateError(msg);
      setUpdateInfo(null);
    } finally {
      setUpdateChecking(false);
    }
  };

  const installUpdate = async () => {
    const update = pendingUpdateRef.current;
    if (!update) return;
    // Tell the user what's about to happen: the app closes and the installer
    // downloads + launches with a gap before the setup window appears. Without
    // this, that silent gap reads like the update stalled. (t is the active
    // language strings.)
    await message(t.updateStartGuide, { title: t.updateStartTitle, kind: "info" });
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
    }
  };

  // Auto-check shortly after mount, then every 4h while running. The overlay
  // is tray-resident and often stays up for DAYS — a single startup check
  // meant long-running sessions never learned about new releases, which is
  // why update adoption lagged. Periodic re-checks close that gap.
  useEffect(() => {
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
  }, []);

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
  const fetchHideoutStations = async (lang: string) => {
    try {
      const res = await fetch(`${PYTHON_API}/hideout/stations?lang=${lang}`);
      if (res.ok) setHideoutStations(await res.json());
    } catch {
      // non-fatal; stations list shows as empty
    }
  };

  // Quest tracker helpers — talk to the localhost FastAPI server.
  const fetchQuestStatus = async (): Promise<boolean> => {
    try {
      const res = await fetch(`${PYTHON_API}/quests/status`);
      if (!res.ok) return false;
      const data: QuestStatus = await res.json();
      setQuestStatus(data);
      // Keep the user-set path field in sync with the server's view.
      setQuestPathInput(data.install_path ?? "");
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
  const resetQuestState = async (gameMode?: "pvp" | "pve") => {
    // Optional gameMode wipes just one server's state (used to clear the
    // fake data the legacy migration copied into both modes for single-mode
    // players). Omit to wipe everything and re-scan.
    try {
      const res = await fetch(`${PYTHON_API}/quests/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gameMode ? { game_mode: gameMode } : {}),
      });
      if (res.ok) setQuestStatus(await res.json());
    } catch (e) {
      log(`quest: reset failed — ${String(e)}`);
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

    const unlistenPromise = win.listen("tauri://move", () => {
      win.outerPosition().then((pos) => {
        localStorage.setItem(
          POSITION_KEY,
          JSON.stringify({ x: pos.x, y: pos.y })
        );
      }).catch(() => {});
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  // Resize the window to match the card's actual rendered height.
  // ResizeObserver fires whenever the card's content changes — settings open/close,
  // donate panel toggle, font size change, history panel, update banner, etc.
  // Uses scrollHeight (the *natural* content height, ignoring the card's
  // max-height: calc(100vh - 24px) cap). Using getBoundingClientRect would
  // create a feedback loop: small initial card → small window → small vh →
  // even smaller card max-height → window stuck at ~100px forever.
  // Clamped to screen available height so the card scrolls inside itself when
  // content genuinely exceeds the screen.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    let raf = 0;
    const apply = () => {
      // When the user has dragged an explicit card height (price-card view
      // only — settings mode returns null), size the window to that override
      // instead of the content's scrollHeight. Otherwise the window stays at
      // content height and clips the dragged-taller card, making vertical
      // resize appear to do nothing.
      const override = cardHeightOverrideForResize();
      const contentH =
        override != null ? override : Math.ceil(el.scrollHeight);
      const h = contentH + WIN_VPAD;
      const clamped = Math.min(Math.max(h, 100), screenMaxH());
      getCurrentWindow()
        .setSize(new LogicalSize(WIN_BASE_W, clamped))
        .catch(() => {});
    };
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
    apply();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
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
        try {
          if (!(await win.isVisible())) {
            await win.show();
            await win.setFocus();
          }
        } catch {}
        showCard(); // bring card up + cancel any in-flight hide
        setShowSettings(false);
        setStatus("loading");
        setError("");
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
          corrections: loadCorrections(),
        });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);
        try {
          const res = await fetchWithRetryOnce(`${PYTHON_API}/lookup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data: LookupResult = await res.json();
          if (seq !== lookupSeqRef.current) {
            log("React: stale lookup result discarded (newer press in flight)");
            return;
          }
          log(`React: result item_name=${data.item_name} raw="${data.raw_text}"`);
          setResult(data);
          setStatus("success");
          setHistory(addToHistory(data));
          setCorrecting(false);
          if (loadSoundOn()) playDing(data.item_name != null);
          // Outcome telemetry (breakage detection): classify the lookup.
          if (data.item_name == null) {
            reportEvent("lookup_nomatch", nomatchCategory(data.raw_text));
          } else if (data.flea_price == null && data.trader_price == null) {
            // Matched but untradeable / no market price — send the public
            // catalog id so the dashboard shows WHICH items (e.g. new patch
            // items) are surfacing as priceless.
            reportEvent("lookup_noprice", data.item_id ?? undefined);
          } else {
            reportEvent("lookup");
          }
        } catch (e) {
          const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          log(`React: fetch ERROR ${msg}`);
          if (seq !== lookupSeqRef.current) return; // stale failure — ignore
          // Human messages for the two known cases; raw error only for the
          // unexpected rest. "TypeError: Failed to fetch" terrified users —
          // it's just the sidecar (re)starting.
          setError(
            e instanceof Error && e.name === "AbortError"
              ? T[r.lang].timeout
              : e instanceof TypeError
                ? T[r.lang].connError
                : msg
          );
          setStatus("error");
          if (loadSoundOn()) playDing(false);
          // Network/abort error — count it as a generic lookup attempt.
          reportEvent("lookup");
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
      const win = getCurrentWindow();
      try {
        const visible = await win.isVisible();
        if (!visible) {
          await win.show();
          await win.setFocus();
        }
      } catch {}
      // Internal card visibility flip.
      setCardVisible((v) => {
        if (v) {
          // Hide now: cancel any pending auto-hide and clear state next tick.
          cancelHideTimer();
          return false;
        }
        // Show: bring card up, schedule a fresh auto-hide.
        cancelHideTimer();
        scheduleHide();
        return true;
      });
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

  // Direct-name lookup (skips capture+OCR). Used by recent-history click and
  // by "직접 입력" correction submit.
  const lookupByName = async (name: string, rememberAsCorrection?: string) => {
    const r = loadRegion();
    showCard();
    setStatus("loading");
    setError("");
    if (rememberAsCorrection) saveCorrection(rememberAsCorrection, name);
    // Same generation/in-flight discipline as the F2 path, plus a 30s abort:
    // no OCR happens here, so a hung half-open socket (not refused — just
    // silent) would otherwise pin the card on "loading" forever.
    const seq = ++lookupSeqRef.current;
    lookupInFlightRef.current = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const body = JSON.stringify({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      lang: getGameLang(r),
      game_mode: r.gameMode,
      override_text: name,
      corrections: loadCorrections(),
    });
    try {
      const res = await fetchWithRetryOnce(`${PYTHON_API}/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: LookupResult = await res.json();
      if (seq !== lookupSeqRef.current) return; // stale — a newer lookup won
      setResult(data);
      setStatus("success");
      setHistory(addToHistory(data));
      setCorrecting(false);
      if (loadSoundOn()) playDing(data.item_name != null);
      // Same outcome telemetry as the F2 path — manual ("직접 입력") and
      // history re-lookups were previously invisible to the dashboard, which
      // under-counted real lookup volume. (Doesn't affect the activation
      // funnel: reaching this path requires a prior F2 result anyway.)
      if (data.item_name == null) {
        reportEvent("lookup_nomatch", nomatchCategory(data.raw_text));
      } else if (data.flea_price == null && data.trader_price == null) {
        reportEvent("lookup_noprice", data.item_id ?? undefined);
      } else {
        reportEvent("lookup");
      }
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (seq !== lookupSeqRef.current) return; // stale failure — ignore
      // Same human-readable mapping as the F2 path (raw "Failed to fetch"
      // reads like a crash; it's just the sidecar restarting).
      setError(
        e instanceof Error && e.name === "AbortError"
          ? t.timeout
          : e instanceof TypeError
            ? t.connError
            : msg
      );
      setStatus("error");
      if (loadSoundOn()) playDing(false);
      reportEvent("lookup");
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
    // Settings panel bounds match the old dedicated drag-bar (200–2000px).
    const clampSettingsH = (raw: number) =>
      Math.max(200, Math.min(2000, Math.round(raw)));
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

  const submitCorrection = () => {
    const trimmed = correctionInput.trim();
    if (!trimmed || !result) return;
    const rawKey = result.raw_text || result.item_name || "";
    if (!rawKey) return;
    setCorrectionInput("");
    setCorrecting(false);
    lookupByName(trimmed, rawKey);
  };

  return (
    <div className="overlay">
      <div
        ref={cardRef}
        className={`card${cardVisible ? "" : " card-hidden"}${pinned ? " card-pinned" : ""}`}
        style={{
          "--card-fs": `${region.fontSize}px`,
          width: `${cardWidth ?? Math.round((280 * region.fontSize) / FONT_DEFAULT)}px`,
          // Explicit height only when the user dragged one AND we're in the
          // plain price-card view; otherwise auto (content height, capped by
          // max-height in CSS). Settings/capture-modal must not inherit the
          // card-height override — they size themselves and the window-resize
          // observer ignores the override in those modes too (kept in sync).
          ...(cardHeight != null && !showSettings && !captureModalOpen
            ? { height: `${cardHeight}px`, maxHeight: `${cardHeight}px` }
            : {}),
          // Auto-hide already handles the full 0→opacity transition via
          // .card-hidden. We only dim while visible so the fade-out can
          // still drop to 0 without fighting the user's preference.
          opacity: cardVisible ? region.opacity / 100 : undefined,
          // Background-only opacity: fades the dark panel behind the text
          // (consumed by .card's background rgba), text/icons stay opaque.
          ["--card-bg-alpha" as string]: String(region.bgOpacity / 100),
        } as React.CSSProperties}
        onMouseEnter={() => {
          mouseOverCardRef.current = true;
          cancelHideTimer();
        }}
        onMouseLeave={() => {
          mouseOverCardRef.current = false;
          if (!recordingHotkey) scheduleHide();
        }}
      >
        {/* Pinned: drop the drag-region attributes so the OS can't move the
            window via the header — that's the only move affordance in a
            borderless window. */}
        <div className="header" data-tauri-drag-region={pinned ? undefined : true}>
          <span className="title" data-tauri-drag-region={pinned ? undefined : true}>{t.title}</span>
          <div className="header-actions">
            <span className="hotkey" data-tauri-drag-region={pinned ? undefined : true}>
              {/* Mouse bindings carry their own 🖱 prefix from
                  formatHotkeyLabel — the fixed ⌨︎ would read as
                  "⌨︎ : 🖱 휠클릭". Only show it for keyboard binds. */}
              {!isMouseHotkey(hotkey) && (
                <span className="hotkey-icon" aria-hidden="true">⌨︎</span>
              )}
              <span className="hotkey-sep">:</span>
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
                  }
                  return !v;
                });
              }}
              title={t.history}
            >
              🕒
            </button>
            <button
              className="settings-btn"
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
            >
              ⚙
            </button>
            {pinned ? (
              // Pinned: replace ✕ with an inert 📌 badge so a misclick can't
              // hide the overlay. Unpin via settings (the ⚙ stays active).
              <span
                className="settings-btn pinned-badge"
                title={t.pinnedBadgeTitle}
                aria-label={t.pinnedBadgeTitle}
              >
                📌
              </span>
            ) : (
              <button
                className="settings-btn exit-btn"
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
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {!statsNoticeShown && (
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
              <button
                className="reset-btn"
                onClick={() => {
                  // Turn stats off and dismiss the notice in one click.
                  localStorage.setItem(STATS_CONSENT_KEY, "false");
                  localStorage.setItem(STATS_NOTICE_KEY, "true");
                  setStatsEnabled(false);
                  setStatsNoticeShown(true);
                }}
              >
                {t.statsConsentDecline}
              </button>
            </div>
          </div>
        )}

        {updateInfo && updateInfo.version !== dismissedUpdate && (
          <div className="update-banner">
            {updatePhase === "idle" && (
              <>
                <span className="update-text">
                  🆕 {t.updateAvailable} <strong>v{updateInfo.version}</strong>
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
                  // Portable users: send them to the downloads page rather
                  // than firing downloadAndInstall(), which would install a
                  // second copy at the default NSIS path and leave the
                  // portable folder untouched.
                  <button
                    className="reset-btn update-btn"
                    onClick={() =>
                      openUrl(RELEASES_PAGE_URL).catch((e) =>
                        log(`update: open releases page failed — ${String(e)}`)
                      )
                    }
                    title={t.updatePortableHint}
                  >
                    {t.updateOpenPage}
                  </button>
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
                  onClick={() => setDismissedUpdate(updateInfo.version)}
                  title={t.updateLater}
                >
                  ✕
                </button>
              </>
            )}
            {updatePhase === "downloading" && (
              <span className="update-text update-progress-wrap">
                ⬇ {t.updateDownloading} {updateProgress}%
                <span className="update-progress-track" aria-hidden="true">
                  <span
                    className="update-progress-fill"
                    style={{ width: `${updateProgress}%` }}
                  />
                </span>
              </span>
            )}
            {updatePhase === "ready" && (
              <span className="update-text">✓ {t.updateRestarting}</span>
            )}
            {updatePhase === "error" && (
              <>
                <span className="update-text">
                  ⚠ {t.updateError}: {updateError}
                </span>
                <button
                  className="reset-btn update-btn"
                  onClick={installUpdate}
                >
                  {t.updateRetry}
                </button>
              </>
            )}
          </div>
        )}

        {adminInfo &&
          adminInfo.is_admin === false &&
          !adminDismissed && (
          <div className="admin-banner">
            <span className="admin-text">
              ⚠ {t.adminWarning}
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
              🔑 {t.relaunchAsAdmin}
            </button>
            <button
              className="settings-btn"
              onClick={() => {
                localStorage.setItem(ADMIN_BANNER_DISMISS_KEY, "true");
                setAdminDismissed(true);
              }}
              title={t.adminDismiss}
            >
              ✕
            </button>
          </div>
        )}

        {remoteAnnounce &&
          (region.lang === "ko"
            ? remoteAnnounce.ko || remoteAnnounce.en
            : remoteAnnounce.en || remoteAnnounce.ko) && (
            <div className="announce-banner">
              <span className="announce-text">
                {region.lang === "ko"
                  ? remoteAnnounce.ko || remoteAnnounce.en
                  : remoteAnnounce.en || remoteAnnounce.ko}
              </span>
              <button
                className="settings-btn"
                onClick={() => setRemoteAnnounce(null)}
                title={t.dismiss}
              >
                ✕
              </button>
            </div>
          )}

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
                        lookupByName(entry.result.item_name);
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
            <div className="support-note">{t.supportNote}</div>
            <div className="settings-row settings-feedback-row">
              <button
                className="reset-btn feedback-btn"
                onClick={() => {
                  setShowFeedback((s) => !s);
                  setFeedbackStatus("idle");
                  setShowDonate(false);
                }}
              >
                ✉ {t.feedback}
              </button>
              <button
                className="reset-btn donate-btn"
                onClick={() => {
                  setShowDonate((s) => !s);
                  setDonateCopied(false);
                  setShowFeedback(false);
                }}
                title={t.donateTitle}
              >
                💝 {t.donate}
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
                      📎 {t.feedbackAttachImage}
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
                </div>
                <div className="feedback-actions">
                  <span
                    className={`feedback-status${
                      feedbackStatus === "error" ? " error" : ""
                    }${feedbackStatus === "sent" ? " sent" : ""}`}
                  >
                    {feedbackStatus === "sending" && t.feedbackSending}
                    {feedbackStatus === "sent" && t.feedbackSuccess}
                    {feedbackStatus === "error" && t.feedbackError}
                  </span>
                  <button
                    className="reset-btn feedback-send-btn"
                    disabled={feedbackStatus === "sending"}
                    onClick={async () => {
                      const msg = feedbackText.trim();
                      if (!msg) {
                        setFeedbackStatus("error");
                        return;
                      }
                      setFeedbackStatus("sending");
                      try {
                        await submitFeedback(msg, feedbackImage);
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
                        onClick={() =>
                          openUrl(activeUrl).catch((e) =>
                            log(`donate: openUrl failed — ${String(e)}`)
                          )
                        }
                      >
                        {t.donateOpen}
                      </button>
                    )}
                    <button
                      className="reset-btn"
                      onClick={() => {
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
              <label>{t.language}</label>
              <select
                value={region.lang}
                onChange={(e) => updateRegion("lang", e.target.value as Lang)}
              >
                <option value="ko">한국어</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="settings-row" title={t.gameLanguageHint}>
              <label>{t.gameLanguage}</label>
              <select
                value={getGameLang(region)}
                onChange={(e) => updateRegion("gameLang", e.target.value as Lang)}
              >
                <option value="ko">한국어</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="settings-row">
              <label>{t.gameMode}</label>
              <select
                value={region.gameMode}
                onChange={(e) => updateRegion("gameMode", e.target.value as GameMode)}
              >
                <option value="regular">{t.gameModePvp}</option>
                <option value="pve">{t.gameModePve}</option>
              </select>
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
                  : formatHotkeyLabel(hotkey, t)}
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
                  : formatHotkeyLabel(toggleHotkey, t)}
              </button>
            </div>
            <div className="settings-row">
              <label>{t.sound}</label>
              <input
                type="checkbox"
                checked={soundOn}
                onChange={(e) => setSoundOn(e.target.checked)}
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
            <div className="settings-row">
              <label title={t.advancedModeHint}>{t.advancedMode}</label>
              <input
                type="checkbox"
                checked={advancedMode}
                onChange={(e) => setAdvancedMode(e.target.checked)}
              />
            </div>
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
                onClick={checkForUpdate}
                disabled={updateChecking}
              >
                {updateChecking
                  ? t.updateChecking
                  : updateCheckedAt && !updateInfo
                    ? t.updateUpToDate
                    : t.updateCheckNow}
              </button>
            </div>
            <div className="settings-row" title={t.autoHideHint}>
              <label>{t.autoHideToggle}</label>
              <input
                type="checkbox"
                checked={region.autoHide}
                onChange={(e) => updateRegion("autoHide", e.target.checked)}
              />
            </div>
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
            <div className="settings-row">
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
            <div className="settings-row">
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
            <div className="settings-row" title={t.pinHint}>
              <label>📌 {t.pinWindow}</label>
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
            </div>
            {(
              [
                ["show24hRange", "displayRange24"],
                ["showLastTrade", "displayLastTrade"],
                ["showWeight", "displayWeight"],
                ["showBuyFor", "displayBuyFor"],
                ["showBartersFor", "displayBartersFor"],
                ["showBartersUsing", "displayBartersUsing"],
                ["showCraftsFor", "displayCraftsFor"],
                ["showHideoutNeeds", "displayHideoutNeeds"],
                ["showQuests", "displayQuests"],
                ["showLootTier", "displayLootTier"],
                ["showAmmoMatrix", "displayAmmoMatrix"],
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

            <div className="settings-section-header">
              {t.questSyncSection}
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
                    {questStatus.effective_path_valid
                      ? questStatus.counts_by_mode
                        ? `✓ PVP ${questStatus.counts_by_mode.pvp.completed}${t.questSyncCountCompletedShort}·${questStatus.counts_by_mode.pvp.started}${t.questSyncCountStartedShort} / PVE ${questStatus.counts_by_mode.pve.completed}${t.questSyncCountCompletedShort}·${questStatus.counts_by_mode.pve.started}${t.questSyncCountStartedShort}`
                        : `✓ ${questStatus.completed_count} ${t.questSyncCompleted} / ${questStatus.started_count} ${t.questSyncStarted}`
                      : t.questSyncPathMissing}
                  </span>
                </div>
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
                      onClick={() => resetQuestState()}
                      title={t.questSyncResetAllHint}
                    >
                      {t.questSyncResetBtn}
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <label title={t.questDisplayModeHint}>
                    {t.questDisplayMode}
                  </label>
                  <select
                    value={questDisplayMode}
                    onChange={(e) => {
                      const v = e.target.value === "pvp" ? "pvp" : "pve";
                      setQuestDisplayMode(v);
                      localStorage.setItem(QUEST_DISPLAY_MODE_KEY, v);
                    }}
                  >
                    <option value="pve">PVE</option>
                    <option value="pvp">PVP</option>
                  </select>
                </div>
              </>
            )}

            <details className="hideout-level-details">
              <summary className="settings-section-header hideout-level-summary">
                {t.hideoutLevelSection}
              </summary>
              <div className="settings-hint" style={{ color: "#bbb", marginBottom: 4 }}>
                {t.hideoutLevelHint}
              </div>
              {hideoutStations.length === 0 ? (
                <div className="settings-row">
                  <span style={{ color: "var(--text-dim)", fontSize: "var(--card-fs-xs)" }}>
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
                            style={cur >= s.maxLevel ? { color: "var(--text-dim)", textDecoration: "line-through" } : undefined}
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
            <div className="copyright">
              <div className="copyright-line">{t.copyright}</div>
              <div className="copyright-line copyright-sub">{t.copyrightLine2}</div>
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
                  📐 {t.captureRegionTitle}
                </span>
                <button
                  className="settings-btn"
                  onClick={() => setCaptureModalOpen(false)}
                  title={t.captureRegionCloseHint}
                >
                  ✕
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
                    <span>🟦</span>
                    <span>{t.legendAnchor}</span>
                  </div>
                  <div className="capture-legend-row">
                    <span>🟥</span>
                    <span>{t.legendPrimary}</span>
                  </div>
                  <div className="capture-legend-row">
                    <span>🟨</span>
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

        {!showSettings && status === "idle" && <div className="hint">{t.hintIdle}</div>}
        {!showSettings && status === "loading" && (
          <div className="hint loading-hint">
            <span className="loading-spinner" aria-hidden="true" />
            <span>{t.hintLoading}</span>
            <div className="hint-sub">{t.hintFirstLoad}</div>
          </div>
        )}
        {!showSettings && status === "error" && <div className="error">⚠ {error}</div>}
        {!showSettings && status === "success" && result && (
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
              <div className="item-name">
                {result.item_name ?? `(${t.noMatch}) "${result.raw_text}"`}
              </div>
            </div>
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
              const hasKappa = (result.used_in_tasks ?? []).some(
                (q) => q.kappa_required
              );
              const hasQuestOrHideout =
                (result.used_in_tasks?.length ?? 0) > 0 ||
                (result.needed_for_hideout?.length ?? 0) > 0;
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
                  {noMarketPrice ? (
                    <div className="no-market-note">{t.noMarketPrice}</div>
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
                                ? "#4caf50"
                                : trend.sign < 0
                                  ? "#ff6b6b"
                                  : "#999",
                          }}
                        >
                          {" "}
                          {trend.text}
                        </span>
                      )}
                    </span>
                    <span className="value">{fmt(result.flea_price)}</span>
                  </div>
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
                    <div className="price sub-price">
                      <span className="label">
                        {t.fleaLastLow}
                        {result.flea_last_offer_count != null && (
                          <span className="vendor-name">
                            {" "}
                            ({result.flea_last_offer_count}{t.fleaOffersUnit})
                          </span>
                        )}
                      </span>
                      <span className="value sub-value">
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
                    </>
                  )}
                  {region.showBuyFor &&
                    result.buy_for &&
                    result.buy_for.length > 0 && (
                    <details className="all-traders" open={region.detailsOpenDefault}>
                      <summary>
                        🏪 {t.buyFor} ({result.buy_for.length})
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
                    <details className="all-traders barters" open={region.detailsOpenDefault}>
                      <summary>🔄 {t.barterFor} ({result.barters_for.length})</summary>
                      <div className="trader-list">
                        {result.barters_for.map((b, idx) => (
                          <div key={idx} className="barter-row">
                            <div className="barter-trader">
                              {b.trader} <span className="barter-level">Lv{b.level}</span>
                            </div>
                            <div className="barter-items">
                              {b.items.map((it, i) => (
                                <span key={i} className="barter-item">
                                  {i > 0 && <span className="barter-plus"> + </span>}
                                  {it.short_name ?? it.name}
                                  <span className="barter-count">×{it.count}</span>
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
                    <details className="all-traders barters" open={region.detailsOpenDefault}>
                      <summary>
                        🔁 {t.barterUsing} ({result.barters_using.length})
                      </summary>
                      <div className="trader-list">
                        {result.barters_using.map((u, idx) => (
                          <div key={idx} className="barter-row">
                            <div className="barter-trader">
                              {u.trader}{" "}
                              <span className="barter-level">Lv{u.level}</span>
                            </div>
                            <div className="barter-items">
                              {t.barterUsingArrow}{" "}
                              {u.rewards.map((it, i) => (
                                <span key={i} className="barter-item">
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
                    result.crafts_for.length > 0 && (
                    <details className="all-traders barters" open={region.detailsOpenDefault}>
                      <summary>
                        🏭 {t.craftFor} ({result.crafts_for.length})
                      </summary>
                      <div className="trader-list">
                        {result.crafts_for.map((c, idx) => (
                          <div key={idx} className="barter-row">
                            <div className="barter-trader">
                              {c.station}{" "}
                              <span className="barter-level">
                                Lv{c.level} · {fmtDuration(c.duration_sec)}
                              </span>
                            </div>
                            <div className="barter-items">
                              {c.items.map((it, i) => (
                                <span key={i} className="barter-item">
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
                        ))}
                      </div>
                    </details>
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
                        <details className="all-traders barters" open={region.detailsOpenDefault}>
                          <summary>
                            🏗️ {t.hideoutNeed} ({countLabel})
                          </summary>
                          <div className="trader-list">
                            {result.needed_for_hideout.map((n, idx) => {
                              const done =
                                hasLevels &&
                                (hideoutLevels[n.station_id] ?? 0) >= n.level;
                              return (
                                <div
                                  key={idx}
                                  className={`hideout-need-row${done ? " done" : ""}`}
                                >
                                  <span className="hideout-need-station">{n.station}</span>
                                  <span className="hideout-need-level">Lv{n.level}</span>
                                  <span className="hideout-need-count">×{n.count}</span>
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
                      // Highlight the current round if this lookup *is* a
                      // round (id match). Weapon lookups won't match any
                      // row so no highlight.
                      const currentId = result.item_name ? result : null;
                      return (
                        // Always open — the ammo matrix is the headline
                        // feature for weapon/round lookups, not a secondary
                        // detail panel. Hiding it behind detailsOpenDefault
                        // (regression since v1.0.7) made users assume the
                        // panel "didn't show up" when their result was a
                        // weapon or ammo. Other details (barters/crafts/
                        // quests) stay user-controlled because they're
                        // auxiliary info.
                        <details className="all-traders barters" open>
                          <summary>
                            🎯 {t.ammoCompare} · {display} ({slot.rounds.length})
                          </summary>
                          <div className="ammo-matrix">
                            <div className="ammo-row ammo-row-head">
                              <span className="ammo-name">{t.ammoName}</span>
                              <span className="ammo-pen" title={t.ammoPenHint}>{t.ammoColPen}</span>
                              <span className="ammo-dmg" title={t.ammoDmgHint}>{t.ammoColDmg}</span>
                              <span className="ammo-ac-head" title={t.ammoAcHint}>{t.ammoColAc}</span>
                            </div>
                            {slot.rounds.map((r) => {
                              const isCurrent =
                                currentId && r.name === result.item_name;
                              return (
                                <div
                                  key={r.id ?? r.name}
                                  className={`ammo-row${isCurrent ? " ammo-row-current" : ""}`}
                                >
                                  <span className="ammo-name">{r.short_name}</span>
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
                    result.used_in_tasks &&
                    result.used_in_tasks.length > 0 && (() => {
                      // Reproject each task's status to the user's chosen
                      // quest-display mode. The backend sends
                      // task_status_by_mode so we don't need a re-capture
                      // when the user flips the dropdown — the same lookup
                      // payload renders correctly for either server.
                      // Older backends only send task_status (no by_mode
                      // dict), so we fall through to the original value.
                      const projected = result.used_in_tasks.map((q) =>
                        q.task_status_by_mode
                          ? {
                              ...q,
                              task_status:
                                q.task_status_by_mode[questDisplayMode] ?? null,
                            }
                          : q
                      );
                      // Filter out completed quests entirely if the user
                      // chose "hide" — otherwise we keep them and just
                      // grey them in the list. Started/failed/unknown
                      // quests are always shown.
                      const visibleQuests =
                        region.completedQuestDisplay === "hide"
                          ? projected.filter(
                              (q) => q.task_status !== "completed"
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
                        <div className="quest-warning">
                          🎯 {t.usedInTasks} ({visibleQuests.length})
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
                              · ✓ {completedShown}
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
                              return (
                                <div
                                  key={q.id ?? idx}
                                  className={`quest-row${statusClass}`}
                                >
                                  <span className="quest-trader">{q.trader}</span>
                                  <span className="quest-name">{q.name}</span>
                                  <span className="quest-count">
                                    {q.task_status === "completed" && (
                                      <span
                                        className="quest-status-icon completed"
                                        title={t.questCompletedHint}
                                      >
                                        ✓
                                      </span>
                                    )}
                                    {q.task_status === "started" && (
                                      <span
                                        className="quest-status-icon started"
                                        title={t.questInProgressHint}
                                      >
                                        ▶
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
                                        {t.questFirBadge}
                                      </span>
                                    ) : (
                                      q.count != null && (
                                        <span
                                          className="quest-anyitem"
                                          title={t.questAnyHint}
                                        >
                                          {t.questAnyBadge}
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
                        <div className="slot-price">
                          {showSlotLine && (
                            <span>
                              📦{" "}
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
                              {slot || isSingleSlot ? " · " : ""}⚖ {result.weight!.toFixed(2)}kg
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
            {/* OCR diagnostic lines (matched_from arrow, raw OCR text)
                are advanced-mode only — regular users only see the final
                resolved item, not the noisy OCR plumbing. */}
            {advancedMode && result.item_name && result.matched_from && (
              <div className="raw-text">
                {t.correctedFrom}: "{result.matched_from}" → "{result.item_name}"
              </div>
            )}
            {advancedMode && !result.item_name && result.raw_text && (
              <div className="raw-text">{t.ocr}: {result.raw_text}</div>
            )}
            {/* "직접 입력" correction UI: hidden by default; advanced
                users can enable it from settings. Past learned corrections
                still apply automatically regardless. */}
            {advancedMode && !correcting && (
              <button
                className="correction-btn"
                onClick={() => {
                  setCorrecting(true);
                  setCorrectionInput(result.item_name ?? result.raw_text ?? "");
                }}
                title={t.correctionHint}
              >
                ✏️ {t.correctionPrompt}
              </button>
            )}
            {advancedMode && correcting && (
              <div className="correction-input-row">
                <input
                  type="text"
                  className="correction-input"
                  autoFocus
                  value={correctionInput}
                  onChange={(e) => setCorrectionInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCorrection();
                    else if (e.key === "Escape") {
                      setCorrecting(false);
                      setCorrectionInput("");
                    }
                  }}
                  placeholder={t.correctionPlaceholder}
                />
                <button
                  className="reset-btn"
                  onClick={submitCorrection}
                  disabled={!correctionInput.trim()}
                >
                  {t.correctionSubmit}
                </button>
                {result.raw_text && loadCorrections()[result.raw_text.toLowerCase()] && (
                  <button
                    className="reset-btn"
                    onClick={() => {
                      removeCorrection(result.raw_text);
                      setCorrecting(false);
                      setCorrectionInput("");
                    }}
                    title={t.correctionForget}
                  >
                    🗑
                  </button>
                )}
              </div>
            )}
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
    </div>
  );
}

export default App;
