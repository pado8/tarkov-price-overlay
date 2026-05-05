import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { T, type Lang, type GameMode } from "./i18n";
import "./App.css";

const PYTHON_API = "http://127.0.0.1:8765";

const log = (msg: string) => {
  invoke("log_msg", { msg }).catch(() => {});
};

type LookupResult = {
  raw_text: string;
  item_name: string | null;
  flea_price: number | null;
  trader_price: number | null;
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
  hideDelaySec: 7,
};

const STORAGE_KEY = "tarkov.captureRegion";
const POSITION_KEY = "tarkov.windowPosition";
const HOTKEY_KEY = "tarkov.hotkey";
const DEFAULT_HOTKEY = "F2";

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
  const [recordingHotkey, setRecordingHotkey] = useState(false);
  const [showCaptureRegion, setShowCaptureRegion] = useState(false);
  const [cardVisible, setCardVisible] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  const hideDelayRef = useRef(region.hideDelaySec);
  useEffect(() => {
    hideDelayRef.current = region.hideDelaySec;
  }, [region.hideDelaySec]);

  const setClickthrough = (enabled: boolean) => {
    getCurrentWindow().setIgnoreCursorEvents(enabled).catch(() => {});
  };
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
      setClickthrough(true);
      hideTimerRef.current = null;
    }, ms);
  };
  const showCard = () => {
    cancelHideTimer();
    setCardVisible(true);
    setClickthrough(false);
  };

  const t = T[region.lang];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(region));
  }, [region]);

  useEffect(() => {
    localStorage.setItem(HOTKEY_KEY, hotkey);
    invoke("register_hotkey", { accelerator: hotkey })
      .then(() => log(`React: hotkey registered = ${hotkey}`))
      .catch((e) => log(`React: hotkey register FAILED (${hotkey}): ${e}`));
  }, [hotkey]);

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
    if (!recordingHotkey) return;
    // Release the OS-level grab so the chosen key actually reaches the page.
    invoke("unregister_hotkey").catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setRecordingHotkey(false);
        return;
      }
      const accel = eventToAccelerator(e);
      if (accel) {
        setHotkey(accel);
        setRecordingHotkey(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      // Restore the grab. If the hotkey was changed, the [hotkey] effect will
      // also re-register — duplicate registration is idempotent (we always
      // unregister_all first), so this is safe.
      invoke("register_hotkey", { accelerator: hotkey }).catch(() => {});
    };
  }, [recordingHotkey]);

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
        } catch (e) {
          const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          log(`React: fetch ERROR ${msg}`);
          setError(
            e instanceof Error && e.name === "AbortError" ? T[r.lang].timeout : msg
          );
          setStatus("error");
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

  const fmt = (n: number | null) =>
    n == null ? "—" : n.toLocaleString() + " ₽";

  const updateRegion = <K extends keyof Region>(key: K, value: Region[K]) =>
    setRegion((r) => ({ ...r, [key]: value }));

  return (
    <div className="overlay">
      <div
        className={`card${cardVisible ? "" : " card-hidden"}`}
        onMouseEnter={() => cancelHideTimer()}
        onMouseLeave={() => {
          if (!recordingHotkey) scheduleHide();
        }}
      >
        <div className="header" data-tauri-drag-region>
          <span className="title" data-tauri-drag-region>{t.title}</span>
          <span className="hotkey" data-tauri-drag-region>{hotkey}</span>
          <button
            className="settings-btn"
            onClick={() => setShowSettings((s) => !s)}
            title={t.settings}
          >
            ⚙
          </button>
        </div>

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
                onClick={() => setRecordingHotkey((r) => !r)}
                title={t.hotkeyHint}
              >
                {recordingHotkey ? t.recordingHotkey : hotkey}
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
            {result.item_name && (
              <div className="prices">
                <div className="price">
                  <span className="label">{t.flea}</span>
                  <span className="value">{fmt(result.flea_price)}</span>
                </div>
                <div className="price">
                  <span className="label">{t.trader}</span>
                  <span className="value">{fmt(result.trader_price)}</span>
                </div>
              </div>
            )}
            {result.item_name && result.matched_from && (
              <div className="raw-text">
                {t.correctedFrom}: "{result.matched_from}" → "{result.item_name}"
              </div>
            )}
            {!result.item_name && result.raw_text && (
              <div className="raw-text">{t.ocr}: {result.raw_text}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
