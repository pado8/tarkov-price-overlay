import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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
};

type Status = "idle" | "loading" | "success" | "error";

type Lang = "ko" | "en";
type Region = {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  lang: Lang;
};

const DEFAULT_REGION: Region = {
  offsetX: -300,
  offsetY: -100,
  width: 600,
  height: 100,
  lang: "ko",
};

const STORAGE_KEY = "tarkov.captureRegion";

function loadRegion(): Region {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_REGION, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_REGION;
}

function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string>("");
  const [region, setRegion] = useState<Region>(loadRegion);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(region));
  }, [region]);

  useEffect(() => {
    log("React: subscribing to hotkey-lookup");
    const unlistenPromise = listen<{ x: number; y: number }>(
      "hotkey-lookup",
      async (event) => {
        const r = loadRegion();
        log(`React: got hotkey-lookup payload=${JSON.stringify(event.payload)} region=${JSON.stringify(r)}`);
        setStatus("loading");
        setError("");
        const body = JSON.stringify({
          x: event.payload.x + r.offsetX,
          y: event.payload.y + r.offsetY,
          width: r.width,
          height: r.height,
          lang: r.lang,
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
            e instanceof Error && e.name === "AbortError"
              ? "Timeout (120s). 첫 호출이면 OCR 모델 다운로드 중. Python 콘솔 확인."
              : msg
          );
          setStatus("error");
        } finally {
          clearTimeout(timeoutId);
        }
      }
    );
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  const fmt = (n: number | null) =>
    n == null ? "—" : n.toLocaleString() + " ₽";

  const updateRegion = <K extends keyof Region>(key: K, value: Region[K]) =>
    setRegion((r) => ({ ...r, [key]: value }));

  return (
    <div className="overlay">
      <div className="card">
        <div className="header">
          <span className="title">Tarkov Price</span>
          <span className="hotkey">F2</span>
          <button
            className="settings-btn"
            onClick={() => setShowSettings((s) => !s)}
          >
            ⚙
          </button>
        </div>

        {showSettings && (
          <div className="settings">
            <div className="settings-row">
              <label>language</label>
              <select
                value={region.lang}
                onChange={(e) => updateRegion("lang", e.target.value as Lang)}
              >
                <option value="ko">한국어</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="settings-row">
              <label>offsetX</label>
              <input
                type="number"
                value={region.offsetX}
                onChange={(e) => updateRegion("offsetX", parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="settings-row">
              <label>offsetY</label>
              <input
                type="number"
                value={region.offsetY}
                onChange={(e) => updateRegion("offsetY", parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="settings-row">
              <label>width</label>
              <input
                type="number"
                value={region.width}
                onChange={(e) => updateRegion("width", parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="settings-row">
              <label>height</label>
              <input
                type="number"
                value={region.height}
                onChange={(e) => updateRegion("height", parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="settings-hint">
              capture box = (cursor.x + offsetX, cursor.y + offsetY) ~ +width/+height
            </div>
            <button
              className="reset-btn"
              onClick={() => setRegion(DEFAULT_REGION)}
            >
              Reset
            </button>
          </div>
        )}

        {status === "idle" && (
          <div className="hint">Hover an item, press F2</div>
        )}
        {status === "loading" && (
          <div className="hint">
            Looking up…
            <div style={{ fontSize: 10, marginTop: 4, color: "#666" }}>
              첫 호출은 OCR 모델 다운로드로 1~5분
            </div>
          </div>
        )}
        {status === "error" && <div className="error">⚠ {error}</div>}
        {status === "success" && result && (
          <div className="result">
            <div className="item-name">
              {result.item_name ?? `(no match) "${result.raw_text}"`}
            </div>
            {result.item_name && (
              <div className="prices">
                <div className="price">
                  <span className="label">Flea</span>
                  <span className="value">{fmt(result.flea_price)}</span>
                </div>
                <div className="price">
                  <span className="label">Trader</span>
                  <span className="value">{fmt(result.trader_price)}</span>
                </div>
              </div>
            )}
            {!result.item_name && result.raw_text && (
              <div className="raw-text">OCR: {result.raw_text}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
