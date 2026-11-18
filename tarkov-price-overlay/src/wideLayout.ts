export type WideMapSide = "left" | "right" | "top" | "bottom";

export const WIDE_MAP_SIDE_KEY = "tarkov.wideMode.mapSide";

const SIDES: readonly WideMapSide[] = ["left", "right", "top", "bottom"];

/** Existing installations keep the map on the right until they choose otherwise. */
export function loadWideMapSide(storage: Pick<Storage, "getItem">): WideMapSide {
  try {
    const v = storage.getItem(WIDE_MAP_SIDE_KEY);
    return (SIDES as readonly (string | null)[]).includes(v) ? (v as WideMapSide) : "right";
  } catch {
    return "right";
  }
}

export function saveWideMapSide(
  storage: Pick<Storage, "setItem">,
  side: WideMapSide,
): boolean {
  try {
    storage.setItem(WIDE_MAP_SIDE_KEY, side);
    return true;
  } catch {
    // Keep the current session usable even if settings cannot be saved.
    return false;
  }
}

/** 카드와 지도를 위아래로 쌓는가 — 위·아래를 골랐거나, 왼쪽·오른쪽인데 창이 세로로 길 때(예전 동작 그대로). */
export function wideStacked(side: WideMapSide, portrait: boolean): boolean {
  return side === "top" || side === "bottom" || portrait;
}

/** 쌓았을 때 지도가 위인가 — '위'를 골랐을 때만. 나머지는 예전처럼 카드가 위, 지도가 아래. */
export function wideMapOnTop(side: WideMapSide): boolean {
  return side === "top";
}

/** 하루 config 줄의 ws 값: L/R/T/B (꺼짐 0 은 부르는 쪽에서). */
export function wideSideCode(side: WideMapSide): "L" | "R" | "T" | "B" {
  return side === "left" ? "L" : side === "top" ? "T" : side === "bottom" ? "B" : "R";
}

export type Rect = { x: number; y: number; w: number; h: number };
export type MonitorArea = { x: number; y: number; w: number; h: number }; // 작업 영역(작업표시줄 제외), 물리 픽셀

/**
 * 저장된 나란히 창(rect)을 모니터 안으로 맞춘다 — 창 가운데가 있는 모니터(없으면 가장 많이 겹치는 모니터) 기준,
 * 크기는 그 모니터보다 클 때만 줄이고 나머지는 위치를 밀어 넣는다. 맞출 모니터가 없으면 null.
 * 11-18: 예전엔 '왼쪽 위 모서리가 있는 모니터' 기준으로 위치는 두고 크기를 줄여서, 모니터 경계에 걸치게 옮기면
 * 2048×1152 창이 503×875 → 200×539 로 쪼그라들었다(사용자가 옆 모니터로 옮겼을 때 실측).
 */
export function fitWideRect(r: Rect, mons: MonitorArea[], minW = 200, minH = 150): Rect | null {
  if (!mons.length) return null;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let m = mons.find((a) => cx >= a.x && cx < a.x + a.w && cy >= a.y && cy < a.y + a.h);
  if (!m) {
    let best = 0;
    for (const a of mons) {
      const ow = Math.min(r.x + r.w, a.x + a.w) - Math.max(r.x, a.x);
      const oh = Math.min(r.y + r.h, a.y + a.h) - Math.max(r.y, a.y);
      const area = Math.max(0, ow) * Math.max(0, oh);
      if (area > best) { best = area; m = a; }
    }
  }
  if (!m) return null;
  const w = Math.max(Math.min(minW, m.w), Math.min(r.w, m.w));
  const h = Math.max(Math.min(minH, m.h), Math.min(r.h, m.h));
  const x = Math.max(m.x, Math.min(r.x, m.x + m.w - w));
  const y = Math.max(m.y, Math.min(r.y, m.y + m.h - h));
  return { x, y, w, h };
}
