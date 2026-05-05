import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

const PYTHON_API = "http://127.0.0.1:8765";
// 마우스 좌표 기준, 좌상단으로 캡처 (타르코프 툴팁 위치)
const CAPTURE_WIDTH = 400;
const CAPTURE_HEIGHT = 50;
const CAPTURE_OFFSET_X = -CAPTURE_WIDTH; // cursor.x - 400 ~ cursor.x
const CAPTURE_OFFSET_Y = -CAPTURE_HEIGHT; // cursor.y - 50 ~ cursor.y

type LookupResult = {
  raw_text: string;
  item_name: string | null;
  flea_price: number | null;
  trader_price: number | null;
};

type Status = "idle" | "loading" | "success" | "error";

function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const unlistenPromise = listen<{ x: number; y: number }>(
      "hotkey-lookup",
      async (event) => {
        setStatus("loading");
        setError("");
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);
        try {
          const res = await fetch(`${PYTHON_API}/lookup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              x: event.payload.x + CAPTURE_OFFSET_X,
              y: event.payload.y + CAPTURE_OFFSET_Y,
              width: CAPTURE_WIDTH,
              height: CAPTURE_HEIGHT,
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data: LookupResult = await res.json();
          setResult(data);
          setStatus("success");
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") {
            setError("Timeout (120s). 첫 호출이면 EasyOCR 한글 모델 다운로드 중일 수 있음. Python 콘솔 확인.");
          } else {
            setError(e instanceof Error ? e.message : String(e));
          }
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

  return (
    <div className="overlay">
      <div className="card">
        <div className="header">
          <span className="title">Tarkov Price</span>
          <span className="hotkey">F2</span>
        </div>
        {status === "idle" && (
          <div className="hint">Hover an item, press F2</div>
        )}
        {status === "loading" && (
          <div className="hint">
            Looking up…
            <div style={{ fontSize: 10, marginTop: 4, color: "#666" }}>
              첫 호출은 OCR 모델 다운로드로 1~5분 걸릴 수 있음
            </div>
          </div>
        )}
        {status === "error" && (
          <div className="error">⚠ {error}</div>
        )}
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
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
