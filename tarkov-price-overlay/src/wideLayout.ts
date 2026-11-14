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
