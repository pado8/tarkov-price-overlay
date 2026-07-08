// Shadow DOM 내부에 주입되는 스타일.
// 페이지 CSS와 완전히 격리되므로 여기 셀렉터는 확장 메모 UI에만 적용된다.
const STICKY_NOTES_CSS = `
:host {
  all: initial;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

#layer {
  position: fixed;
  inset: 0;
  width: 0;
  height: 0;
  overflow: visible;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic",
    "Apple SD Gothic Neo", Roboto, sans-serif;
}

.note {
  position: fixed;
  display: flex;
  flex-direction: column;
  min-width: 160px;
  min-height: 120px;
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28), 0 1px 3px rgba(0, 0, 0, 0.15);
  overflow: visible;
  pointer-events: auto;
  color: #3b3324;
}

/* 색상 팔레트 */
.note[data-color="yellow"] { background: #fff3a3; }
.note[data-color="green"]  { background: #d4f7bc; }
.note[data-color="pink"]   { background: #ffd6e0; }
.note[data-color="blue"]   { background: #cfe8ff; }
.note[data-color="purple"] { background: #e6dbff; }

.note-header {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 6px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 6px 6px 0 0;
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
}
.note-header:active { cursor: grabbing; }

.note-header button {
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: inherit;
  border-radius: 4px;
  line-height: 1;
}

.scope-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 7px;
  border-radius: 9px;
  white-space: nowrap;
}
.note[data-scope="site"] .scope-badge {
  background: rgba(0, 0, 0, 0.10);
  color: #4a4335;
}
.note[data-scope="global"] .scope-badge {
  background: #3d6ef7;
  color: #fff;
}
.scope-badge:hover { filter: brightness(0.93); }

.header-space { flex: 1; min-width: 8px; }

.color-btn {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(0, 0, 0, 0.25) !important;
  padding: 0;
  flex-shrink: 0;
}
.note[data-color="yellow"] .color-btn { background: #f5d94e; }
.note[data-color="green"]  .color-btn { background: #9ede6e; }
.note[data-color="pink"]   .color-btn { background: #ff9cb6; }
.note[data-color="blue"]   .color-btn { background: #7db8f0; }
.note[data-color="purple"] .color-btn { background: #b79cf0; }

.palette {
  position: absolute;
  top: 32px;
  right: 28px;
  display: none;
  gap: 6px;
  padding: 7px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
  z-index: 3;
}
.palette.open { display: flex; }
.palette button {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(0, 0, 0, 0.2);
  cursor: pointer;
  padding: 0;
}
.palette button:hover { transform: scale(1.15); }
.palette button[data-color="yellow"] { background: #ffe45c; }
.palette button[data-color="green"]  { background: #a5e874; }
.palette button[data-color="pink"]   { background: #ffa8c0; }
.palette button[data-color="blue"]   { background: #85c2f5; }
.palette button[data-color="purple"] { background: #c3a8f5; }

.collapse-btn,
.hide-btn {
  font-size: 12px;
  width: 20px;
  height: 20px;
  color: rgba(0, 0, 0, 0.5) !important;
  flex-shrink: 0;
}
.collapse-btn:hover,
.hide-btn:hover {
  background: rgba(0, 0, 0, 0.12) !important;
}

/* 접힌 상태: 헤더만 남긴다 */
.note.collapsed {
  min-height: 0;
  height: auto !important;
}
.note.collapsed .note-text,
.note.collapsed .resize-handle {
  display: none;
}
.note.collapsed .note-header {
  border-radius: 6px;
}

.delete-btn {
  font-size: 16px;
  width: 22px;
  height: 22px;
  color: rgba(0, 0, 0, 0.45) !important;
}
.delete-btn:hover {
  background: rgba(220, 60, 60, 0.85) !important;
  color: #fff !important;
}

.note-text {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.45;
  color: inherit;
}
.note-text::placeholder { color: rgba(0, 0, 0, 0.35); }

.resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  background:
    linear-gradient(135deg, transparent 50%, rgba(0, 0, 0, 0.22) 50%, rgba(0, 0, 0, 0.22) 60%,
      transparent 60%, transparent 75%, rgba(0, 0, 0, 0.22) 75%, rgba(0, 0, 0, 0.22) 85%, transparent 85%);
  border-radius: 0 0 6px 0;
}

/* 삭제 확인 바 */
.confirm-bar {
  position: absolute;
  inset: 0;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 6px;
  z-index: 2;
  font-size: 13px;
  color: #333;
}
.confirm-bar.open { display: flex; }
.confirm-actions { display: flex; gap: 8px; }
.confirm-bar button {
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.confirm-yes { background: #dc3c3c; color: #fff; }
.confirm-yes:hover { background: #c22f2f; }
.confirm-no { background: #e4e4e4; color: #333; }
.confirm-no:hover { background: #d4d4d4; }

/* 팝업에서 항목 클릭 시 잠깐 강조 */
.note.flash {
  animation: sticky-flash 0.9s ease;
}
@keyframes sticky-flash {
  0%, 100% { box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28); }
  35% { box-shadow: 0 0 0 4px #3d6ef7, 0 4px 14px rgba(0, 0, 0, 0.28); }
}
`;
