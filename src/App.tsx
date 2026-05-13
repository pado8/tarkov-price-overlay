import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { QRCodeSVG } from "qrcode.react";
import { T, type Lang, type GameMode } from "./i18n";
import "./App.css";

declare const __APP_VERSION__: string;
const APP_VERSION = __APP_VERSION__;
const UPDATE_REPO = "pado8/tarkov-price-overlay-releases";
const UPDATE_CHECK_KEY = "tarkov.autoCheckUpdate";
// One-shot dismiss for the "run as administrator" diagnostic banner. We
// remember it forever per machine so users who already moved to elevated
// shortcuts never see it again. Clearing localStorage brings it back.
const ADMIN_BANNER_DISMISS_KEY = "tarkov.adminBannerDismissed";

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

type UpdateInfo = { tag: string; url: string };

function compareSemver(a: string, b: string): number {
  // returns >0 if a > b, <0 if a < b, 0 if equal. Strips leading "v".
  const pa = a.replace(/^v/, "").split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

async function fetchLatestRelease(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.tag_name || !data?.html_url) return null;
    return { tag: data.tag_name, url: data.html_url };
  } catch {
    return null;
  }
}
const FEEDBACK_EMAIL = "floe9235@gmail.com";
const KAKAOPAY_URL = "https://qr.kakaopay.com/Ej8AkkdEJ";
const PAYPAL_URL = "https://paypal.me/tarkovoverlay";

const hideToTray = () => {
  invoke("hide_to_tray").catch(() => {});
};

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


const PYTHON_API = "http://127.0.0.1:8765";

const log = (msg: string) => {
  invoke("log_msg", { msg }).catch(() => {});
};

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
  task_status: "started" | "completed" | "failed" | null;
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
};

type HideoutCraft = {
  station: string;
  level: number;
  duration_sec: number;
  items: BarterRequiredItem[];
};

type HideoutNeed = {
  station: string;
  level: number;
  count: number;
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
  matched_from: string | null;
};

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
  gameMode: GameMode;
  hideDelaySec: number;
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
  // Loot-tier letter badge (D/C/B/A/S) next to ₽/slot. When off, the
  // slot price renders bare. Tier rules live in computeLootTier().
  showLootTier: boolean;
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
  showLootTier: true,
};

const STORAGE_KEY = "tarkov.captureRegion";
const POSITION_KEY = "tarkov.windowPosition";
const HOTKEY_KEY = "tarkov.hotkey";
const TOGGLE_HOTKEY_KEY = "tarkov.toggleHotkey";
const SOUND_KEY = "tarkov.soundOn";
const HISTORY_KEY = "tarkov.history";
const CORRECTIONS_KEY = "tarkov.ocrCorrections";
const ADVANCED_KEY = "tarkov.advancedMode";

function loadAdvanced(): boolean {
  return localStorage.getItem(ADVANCED_KEY) === "true";
}
const WIN_BASE_W = 800;
const FONT_DEFAULT = 13;
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
  const [showCaptureRegion, setShowCaptureRegion] = useState(false);
  // Click-to-edit toggle for the opacity readout next to the slider.
  const [opacityEditing, setOpacityEditing] = useState(false);
  // "Run as administrator" diagnostic: shown when sidecar reports we are
  // not elevated. Hidden once the user dismisses (persisted via
  // ADMIN_BANNER_DISMISS_KEY).
  const [adminInfo, setAdminInfo] = useState<Diagnostics | null>(null);
  const [adminDismissed, setAdminDismissed] = useState<boolean>(
    () => localStorage.getItem(ADMIN_BANNER_DISMISS_KEY) === "true"
  );
  const [cardVisible, setCardVisible] = useState(true);
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
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState<boolean>(false);
  const [updateCheckedAt, setUpdateCheckedAt] = useState<number | null>(null);
  const [showDonate, setShowDonate] = useState(false);
  // Default donate tab follows the user's UI language (Korean → KakaoPay first,
  // others → PayPal first). They can flip with the tabs.
  const [donateTab, setDonateTab] = useState<"kakao" | "paypal">(
    region.lang === "ko" ? "kakao" : "paypal"
  );
  const [donateCopied, setDonateCopied] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const hideDelayRef = useRef(region.hideDelaySec);
  useEffect(() => {
    hideDelayRef.current = region.hideDelaySec;
  }, [region.hideDelaySec]);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const cancelHideTimer = () => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };
  const scheduleHide = () => {
    cancelHideTimer();
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
    invoke("register_lookup_hotkey", { accelerator: hotkey })
      .then(() => log(`React: lookup hotkey = ${hotkey}`))
      .catch((e) => log(`React: lookup hotkey FAILED (${hotkey}): ${e}`));
  }, [hotkey]);

  useEffect(() => {
    localStorage.setItem(TOGGLE_HOTKEY_KEY, toggleHotkey);
    invoke("register_toggle_hotkey", { accelerator: toggleHotkey })
      .then(() => log(`React: toggle hotkey = ${toggleHotkey}`))
      .catch((e) =>
        log(`React: toggle hotkey FAILED (${toggleHotkey}): ${e}`)
      );
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

  // Probe sidecar diagnostics once on mount. We re-probe ~3s later in
  // case the sidecar wasn't ready yet (cold-start window).
  useEffect(() => {
    let mounted = true;
    const probe = async () => {
      const info = await fetchDiagnostics();
      if (mounted && info) setAdminInfo(info);
    };
    probe();
    const t = setTimeout(probe, 3000);
    return () => {
      mounted = false;
      clearTimeout(t);
    };
  }, []);

  // Update check helper.
  const checkForUpdate = async () => {
    setUpdateChecking(true);
    const latest = await fetchLatestRelease();
    setUpdateChecking(false);
    setUpdateCheckedAt(Date.now());
    if (latest && compareSemver(latest.tag, APP_VERSION) > 0) {
      setUpdateInfo(latest);
      log(`update: ${APP_VERSION} -> ${latest.tag} available`);
    } else {
      setUpdateInfo(null);
      log(
        `update: up to date (${APP_VERSION}, latest=${latest?.tag ?? "?"})`
      );
    }
  };

  // Run a single auto-check shortly after mount, if user opted in.
  useEffect(() => {
    if (!autoCheckUpdate) return;
    const t = window.setTimeout(() => {
      checkForUpdate();
    }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const resetQuestState = async () => {
    try {
      const res = await fetch(`${PYTHON_API}/quests/reset`, { method: "POST" });
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
  useEffect(() => {
    if (showSettings) fetchQuestStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

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
    if (recordingTarget === null) return;
    // Release the OS-level grab so the chosen key actually reaches the page.
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
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      // Restore both grabs. If a hotkey changed, its useEffect will also fire
      // and re-register — duplicate registration is idempotent (each command
      // unregisters its previous accelerator first).
      invoke("register_lookup_hotkey", { accelerator: hotkey }).catch(() => {});
      invoke("register_toggle_hotkey", { accelerator: toggleHotkey }).catch(
        () => {}
      );
    };
  }, [recordingTarget]);

  useEffect(() => {
    const win = getCurrentWindow();
    try {
      const raw = localStorage.getItem(POSITION_KEY);
      if (raw) {
        const { x, y } = JSON.parse(raw);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          win.setPosition(new PhysicalPosition(x, y)).catch(() => {});
        }
      }
    } catch {}

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
  // Clamped to the screen's available height so very large fonts don't push the
  // bottom of the card off-screen.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    let raf = 0;
    const apply = () => {
      const h = Math.ceil(el.getBoundingClientRect().height) + WIN_VPAD;
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
    apply();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
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
        const body = JSON.stringify({
          x: event.payload.x + r.offsetX,
          y: event.payload.y + r.offsetY,
          width: r.width,
          height: r.height,
          lang: r.lang,
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
          const res = await fetch(`${PYTHON_API}/lookup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data: LookupResult = await res.json();
          log(`React: result item_name=${data.item_name} raw="${data.raw_text}"`);
          setResult(data);
          setStatus("success");
          setHistory(addToHistory(data));
          setCorrecting(false);
          if (loadSoundOn()) playDing(data.item_name != null);
        } catch (e) {
          const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          log(`React: fetch ERROR ${msg}`);
          setError(
            e instanceof Error && e.name === "AbortError" ? T[r.lang].timeout : msg
          );
          setStatus("error");
          if (loadSoundOn()) playDing(false);
        } finally {
          clearTimeout(timeoutId);
          // Start the auto-hide countdown only after fetch completes,
          // so a slow OCR call doesn't make the card disappear mid-lookup.
          scheduleHide();
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
    const body = JSON.stringify({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      lang: r.lang,
      game_mode: r.gameMode,
      override_text: name,
      corrections: loadCorrections(),
    });
    try {
      const res = await fetch(`${PYTHON_API}/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: LookupResult = await res.json();
      setResult(data);
      setStatus("success");
      setHistory(addToHistory(data));
      setCorrecting(false);
      if (loadSoundOn()) playDing(data.item_name != null);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setError(msg);
      setStatus("error");
      if (loadSoundOn()) playDing(false);
    } finally {
      scheduleHide();
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
        className={`card${cardVisible ? "" : " card-hidden"}`}
        style={{
          "--card-fs": `${region.fontSize}px`,
          width: `${Math.round(280 * region.fontSize / FONT_DEFAULT)}px`,
          // Auto-hide already handles the full 0→opacity transition via
          // .card-hidden. We only dim while visible so the fade-out can
          // still drop to 0 without fighting the user's preference.
          opacity: cardVisible ? region.opacity / 100 : undefined,
        } as React.CSSProperties}
        onMouseEnter={() => cancelHideTimer()}
        onMouseLeave={() => {
          if (!recordingHotkey) scheduleHide();
        }}
      >
        <div className="header" data-tauri-drag-region>
          <span className="title" data-tauri-drag-region>{t.title}</span>
          <div className="header-actions">
            <span className="hotkey" data-tauri-drag-region>
              <span className="hotkey-icon" aria-hidden="true">⌨︎</span>
              <span className="hotkey-sep">:</span>
              <span className="hotkey-key">{hotkey}</span>
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
            <button
              className="settings-btn exit-btn"
              onClick={hideToTray}
              title={t.hideToTrayTitle}
            >
              ✕
            </button>
          </div>
        </div>

        {updateInfo && updateInfo.tag !== dismissedUpdate && (
          <div className="update-banner">
            <span className="update-text">
              🆕 {t.updateAvailable} <strong>{updateInfo.tag}</strong>
            </span>
            <button
              className="reset-btn update-btn"
              onClick={() => openUrl(updateInfo.url).catch(() => {})}
            >
              {t.updateOpen}
            </button>
            <button
              className="settings-btn"
              onClick={() => setDismissedUpdate(updateInfo.tag)}
              title={t.updateLater}
            >
              ✕
            </button>
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
                localStorage.setItem(ADMIN_BANNER_DISMISS_KEY, "true");
                setAdminDismissed(true);
              }}
              title={t.adminDismiss}
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

        {showSettings && (
          <div className="settings">
            <div className="settings-row settings-feedback-row">
              <button
                className="reset-btn feedback-btn"
                onClick={() => sendFeedback(region.lang)}
                title={`mailto:${FEEDBACK_EMAIL}`}
              >
                ✉ {t.feedback}
              </button>
              <button
                className="reset-btn donate-btn"
                onClick={() => {
                  setShowDonate((s) => !s);
                  setDonateCopied(false);
                }}
                title={t.donateTitle}
              >
                💝 {t.donate}
              </button>
            </div>
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
            <div className="settings-row">
              <label>{t.hotkey}</label>
              <button
                className="reset-btn hotkey-rec-btn"
                onClick={() =>
                  setRecordingTarget((r) => (r === "lookup" ? null : "lookup"))
                }
                title={t.hotkeyHint}
              >
                {recordingTarget === "lookup" ? t.recordingHotkey : hotkey}
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
                  ? t.recordingHotkey
                  : toggleHotkey}
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
            <div className="settings-row">
              <label>{t.hideDelay}</label>
              <input
                type="number"
                min="1"
                max="60"
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
                      ? `✓ ${questStatus.completed_count} ${t.questSyncCompleted} / ${questStatus.started_count} ${t.questSyncStarted}`
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
                  <label>{t.questSyncReset}</label>
                  <button className="reset-btn" onClick={resetQuestState}>
                    {t.questSyncResetBtn}
                  </button>
                </div>
              </>
            )}

            <div className="settings-row">
              <label>{t.captureRegion}</label>
              <button
                className="reset-btn hotkey-rec-btn"
                onClick={() => setShowCaptureRegion((s) => !s)}
              >
                {showCaptureRegion ? t.hide : t.edit}
              </button>
            </div>
            {showCaptureRegion && (
              <>
                <div className="settings-row">
                  <label>{t.offsetX}</label>
                  <input
                    type="number"
                    value={region.offsetX}
                    onChange={(e) =>
                      updateRegion("offsetX", parseInt(e.target.value) || 0)
                    }
                  />
                </div>
                <div className="settings-row">
                  <label>{t.offsetY}</label>
                  <input
                    type="number"
                    value={region.offsetY}
                    onChange={(e) =>
                      updateRegion("offsetY", parseInt(e.target.value) || 0)
                    }
                  />
                </div>
                <div className="settings-row">
                  <label>{t.width}</label>
                  <input
                    type="number"
                    value={region.width}
                    onChange={(e) =>
                      updateRegion("width", parseInt(e.target.value) || 1)
                    }
                  />
                </div>
                <div className="settings-row">
                  <label>{t.height}</label>
                  <input
                    type="number"
                    value={region.height}
                    onChange={(e) =>
                      updateRegion("height", parseInt(e.target.value) || 1)
                    }
                  />
                </div>
                <div className="settings-hint">{t.captureHint}</div>
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

                <div className="settings-row" style={{ marginTop: "12px" }}>
                  <label style={{ fontWeight: 600 }}>{t.groundCaptureRegion}</label>
                </div>
                <div className="settings-row">
                  <label>{t.groundOffsetX}</label>
                  <input
                    type="number"
                    value={region.groundOffsetX}
                    onChange={(e) =>
                      updateRegion("groundOffsetX", parseInt(e.target.value) || 0)
                    }
                  />
                </div>
                <div className="settings-row">
                  <label>{t.groundOffsetY}</label>
                  <input
                    type="number"
                    value={region.groundOffsetY}
                    onChange={(e) =>
                      updateRegion("groundOffsetY", parseInt(e.target.value) || 0)
                    }
                  />
                </div>
                <div className="settings-row">
                  <label>{t.groundWidth}</label>
                  <input
                    type="number"
                    value={region.groundWidth}
                    onChange={(e) =>
                      updateRegion("groundWidth", parseInt(e.target.value) || 1)
                    }
                  />
                </div>
                <div className="settings-row">
                  <label>{t.groundHeight}</label>
                  <input
                    type="number"
                    value={region.groundHeight}
                    onChange={(e) =>
                      updateRegion("groundHeight", parseInt(e.target.value) || 1)
                    }
                  />
                </div>
                <div className="settings-hint">{t.groundCaptureHint}</div>
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
              </>
            )}
            <div className="copyright">
              <div className="copyright-line">{t.copyright}</div>
              <div className="copyright-line copyright-sub">{t.copyrightLine2}</div>
            </div>
          </div>
        )}

        {!showSettings && status === "idle" && <div className="hint">{t.hintIdle}</div>}
        {!showSettings && status === "loading" && (
          <div className="hint">
            {t.hintLoading}
            <div style={{ fontSize: 10, marginTop: 4, color: "#666" }}>
              {t.hintFirstLoad}
            </div>
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
              return (
                <div className="prices">
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
                    result.needed_for_hideout.length > 0 && (
                    <details className="all-traders barters" open={region.detailsOpenDefault}>
                      <summary>
                        🏗️ {t.hideoutNeed} ({result.needed_for_hideout.length})
                      </summary>
                      <div className="trader-list">
                        {result.needed_for_hideout.map((n, idx) => (
                          <div key={idx} className="hideout-need-row">
                            <span className="hideout-need-station">{n.station}</span>
                            <span className="hideout-need-level">Lv{n.level}</span>
                            <span className="hideout-need-count">×{n.count}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {region.showQuests &&
                    result.used_in_tasks &&
                    result.used_in_tasks.length > 0 && (() => {
                      // Filter out completed quests entirely if the user
                      // chose "hide" — otherwise we keep them and just
                      // grey them in the list. Started/failed/unknown
                      // quests are always shown.
                      const visibleQuests =
                        region.completedQuestDisplay === "hide"
                          ? result.used_in_tasks.filter(
                              (q) => q.task_status !== "completed"
                            )
                          : result.used_in_tasks;
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
                  {(slot || (region.showWeight && result.weight && result.weight > 0)) && (
                    <div className="slot-price">
                      {slot && (
                        <span>
                          📦 {result.width}×{result.height} →{" "}
                          <strong>{slot}</strong>
                          {region.showLootTier && lootTier && (
                            <span
                              className={`loot-tier loot-tier-${lootTier}`}
                              title={t.lootTierHint}
                            >
                              {lootTier}
                            </span>
                          )}
                        </span>
                      )}
                      {region.showWeight &&
                        result.weight != null &&
                        result.weight > 0 && (
                          <span className="weight-info">
                            {slot ? " · " : ""}⚖ {result.weight.toFixed(2)}kg
                            {result.flea_price != null &&
                              result.weight >= 0.05 && (
                                <span className="weight-per">
                                  {" "}
                                  ({Math.round(
                                    result.flea_price / result.weight
                                  ).toLocaleString()}{" "}
                                  {t.perKgUnit})
                                </span>
                              )}
                          </span>
                        )}
                    </div>
                  )}
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
      </div>
    </div>
  );
}

export default App;
