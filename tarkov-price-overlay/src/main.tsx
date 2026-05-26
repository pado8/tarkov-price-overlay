import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

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
} else {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
