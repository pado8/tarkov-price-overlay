import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MiniWindow } from "./MiniWindow";
import { initEnginePort } from "./engine";

// 11-21 앱 창은 브라우저가 아니다 — F5·Ctrl+R·Ctrl+F5 로 화면이 새로고침되면 상태가 날아가고(조회 번호 초기화 → 조회가
// '밀린 조회'로 버려짐) 진행 중인 일이 끊긴다. 조회 키가 F5 이고 키를 가로채지 않는 방식이면 창에 포커스가 있을 때 새로고침이
// 되던 것. 기본 동작만 막고 전파는 그대로 둔다(단축키 녹화·다른 키 처리는 그대로).
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R"))) e.preventDefault();
  },
  true
);

// Capture-region preview windows are tiny secondary webviews loaded with
// ?window=preview-primary / preview-ground / preview-anchor. They render
// nothing but a colored marker that fills the (transparent) window —
// main.tsx short-circuits before mounting the full App.
//   preview-primary / ground: bordered rectangle for the capture region
//   preview-anchor: cyan crosshair marker that shows where the cursor
//     reference point is. Without this, "center anchor" mode in the
//     capture modal showed the rectangles at monitor center with no
//     visible anchor — users couldn't tell what (0,0) offset meant.
const params = new URLSearchParams(window.location.search);
const previewMode = params.get("window");

if (previewMode === "preview-primary" || previewMode === "preview-ground") {
  const color = previewMode === "preview-primary" ? "#ff4040" : "#ffc040";
  const fill = previewMode === "preview-primary"
    ? "rgba(255, 64, 64, 0.10)"
    : "rgba(255, 192, 64, 0.10)";
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.body.style.margin = "0";
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <div
      style={{
        position: "fixed",
        inset: 0,
        border: `2px solid ${color}`,
        background: fill,
        boxSizing: "border-box",
        pointerEvents: "none",
      }}
    />,
  );
} else if (previewMode === "preview-anchor") {
  // Crosshair marker — two perpendicular lines through the center plus a
  // small dot at the exact pixel so the user can see where (0,0) offset
  // would land. Cyan stands out against EFT's red/orange UI and against
  // the red/yellow capture rectangles.
  const accent = "#00e5ff";
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.body.style.margin = "0";
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: 2,
          marginLeft: -1,
          background: accent,
          boxShadow: `0 0 4px ${accent}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          height: 2,
          marginTop: -1,
          background: accent,
          boxShadow: `0 0 4px ${accent}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 6,
          height: 6,
          marginLeft: -3,
          marginTop: -3,
          background: accent,
          borderRadius: "50%",
          boxShadow: `0 0 6px ${accent}`,
        }}
      />
    </div>,
  );
} else if (previewMode === "minimap") {
  // 나란히 보기와 함께 띄우는 미니맵 창(11-12 피드백 #61-5) — 투명 창에 지도만
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.body.style.margin = "0";
  // 11-23 엔진 포트를 먼저 받는다(src/engine.ts — 8765 를 다른 프로그램이 쓰면 18765·28765)
  void initEnginePort().finally(() => ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<MiniWindow />));
} else {
  void initEnginePort().finally(() =>
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  );
}
