import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { QRCodeSVG } from "qrcode.react";
import { T, type Lang, type GameMode } from "./i18n";
import "./App.css";

declare const __APP_VERSION__: string;
const APP_VERSION = __APP_VERSION__;
const UPDATE_REPO = "pado8/tarkov-price-overlay-releases";
const UPDATE_CHECK_KEY = "tarkov.autoCheckUpdate";

function loadAutoCheckUpdate(): boolean {
  const v = localStorage.getItem(UPDATE_CHECK_KEY);
  return v == null ? true : v === "true";
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

type LookupResult = {
  raw_text: string;
  item_name: string | null;
  short_name: string | null;
  width: number | null;
  height: number | null;
  flea_price: number | null;
  flea_low_24h: number | null;
  flea_change_48h_pct: number | null;
  trader_price: number | null;
  sell_for: TraderPrice[];
  barters_for: Barter[];
  matched_from: string | null;
};

type Status = "idle" | "loading" | "success" | "error";

type Region = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  lang: Lang;
  gameMode: GameMode;
  hideDelaySec: number;
};

const DEFAULT_REGION: Region = {
  offsetX: 10,
  offsetY: -75,
  width: 300,
  height: 70,
  lang: "ko",
  gameMode: "regular",
  hideDelaySec: 5,
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
    if (raw) return { ...DEFAULT_REGION, ...JSON.parse(raw) };
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
  const [cardVisible, setCardVisible] = useState(true);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [correctionInput, setCorrectionInput] = useState<string>("");
  const [correcting, setCorrecting] = useState<boolean>(false);
  const [autoCheckUpdate, setAutoCheckUpdate] = useState<boolean>(
    loadAutoCheckUpdate
  );
  const [advancedMode, setAdvancedMode] = useState<boolean>(loadAdvanced);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState<boolean>(false);
  const [updateCheckedAt, setUpdateCheckedAt] = useState<number | null>(null);
  const [showDonate, setShowDonate] = useState(false);
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

  // Tray icon events: left-click or "Show" menu item brings the card up.
  // "Settings" menu item brings the card up AND opens the settings panel.
  useEffect(() => {
    const unlistenShow = listen("tray-show", () => {
      log("React: tray-show event");
      showCard();
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
        showCard(); // bring card up + cancel any in-flight hide
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
              onClick={() => setHistoryVisible((v) => !v)}
              title={t.history}
            >
              🕒
            </button>
            <button
              className="settings-btn"
              onClick={() => setShowSettings((s) => !s)}
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
              </>
            )}
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
            {showDonate && (
              <div className="donate-panel">
                <div className="donate-hint">{t.donateScanHint}</div>
                <div className="donate-qr">
                  <QRCodeSVG
                    value={KAKAOPAY_URL}
                    size={140}
                    bgColor="#ffffff"
                    fgColor="#000000"
                    level="M"
                    includeMargin
                  />
                </div>
                <div className="donate-url">{KAKAOPAY_URL}</div>
                <div className="donate-actions">
                  <button
                    className="reset-btn"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(KAKAOPAY_URL)
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
            )}
          </div>
        )}

        {status === "idle" && <div className="hint">{t.hintIdle}</div>}
        {status === "loading" && (
          <div className="hint">
            {t.hintLoading}
            <div style={{ fontSize: 10, marginTop: 4, color: "#666" }}>
              {t.hintFirstLoad}
            </div>
          </div>
        )}
        {status === "error" && <div className="error">⚠ {error}</div>}
        {status === "success" && result && (
          <div className="result">
            <div className="item-name">
              {result.item_name ?? `(${t.noMatch}) "${result.raw_text}"`}
            </div>
            {result.item_name && (() => {
              const trend = trendPct(result.flea_change_48h_pct);
              const slot = fmtSlot(
                result.flea_price ?? result.trader_price,
                result.width,
                result.height
              );
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
                  {result.flea_low_24h != null && (
                    <div className="price sub-price">
                      <span className="label">{t.fleaLow24}</span>
                      <span className="value sub-value">{fmt(result.flea_low_24h)}</span>
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
                  {result.sell_for.length > 1 && (
                    <details className="all-traders">
                      <summary>{t.allTraders} ({result.sell_for.length})</summary>
                      <div className="trader-list">
                        {result.sell_for.map((tr) => (
                          <div key={tr.name} className="price sub-price">
                            <span className="label">{tr.name}</span>
                            <span className="value sub-value">{fmt(tr.price)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {result.barters_for && result.barters_for.length > 0 && (
                    <details className="all-traders barters">
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
                  {slot && (
                    <div className="slot-price">
                      📦 {result.width}×{result.height} → <strong>{slot}</strong>
                    </div>
                  )}
                </div>
              );
            })()}
            {result.item_name && result.matched_from && (
              <div className="raw-text">
                {t.correctedFrom}: "{result.matched_from}" → "{result.item_name}"
              </div>
            )}
            {!result.item_name && result.raw_text && (
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
