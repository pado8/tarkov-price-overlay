import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Capture-region preview windows are tiny secondary webviews loaded with
// ?window=preview-primary or ?window=preview-ground. They render nothing
// but a colored border that fills the (transparent) window — main.tsx
// short-circuits before mounting the full App. Color identifies which
// region the rectangle represents at a glance.
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
} else {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
