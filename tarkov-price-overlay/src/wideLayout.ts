export type WideMapSide = "left" | "right";

export const WIDE_MAP_SIDE_KEY = "tarkov.wideMode.mapSide";

/** Existing installations keep the map on the right until they choose otherwise. */
export function loadWideMapSide(storage: Pick<Storage, "getItem">): WideMapSide {
  try {
    return storage.getItem(WIDE_MAP_SIDE_KEY) === "left" ? "left" : "right";
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
