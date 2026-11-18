// 지도 루팅 상자 아이콘(11-18). 그림은 이 앱에서 직접 그린 24×24 도형이다 — 게임·다른 지도 사이트의 그림을 쓰지 않는다.
export type LootRow = [number, number, number, string, string?]; // x, y, z, 묶음, 종류

export const LOOT_ICON_PATH: Record<string, string> = {
  weapon: "M2 10h13l1-2h2v2h4v3h-6l-1 1h-3l-1 4H7l1-5H2z",
  grenade: "M10 9.6V7h5v2.6a6.5 6.5 0 1 1-5 0zM9 3h8l3.5 3.5L19 8l-3-3H9z",
  ammo: "M3.5 9c0-3 1.6-5 2.5-6 .9 1 2.5 3 2.5 6v11h-5zM9.5 9c0-3 1.6-5 2.5-6 .9 1 2.5 3 2.5 6v11h-5zM15.5 9c0-3 1.6-5 2.5-6 .9 1 2.5 3 2.5 6v11h-5z",
  tool: "M8 8V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V8h5a1 1 0 0 1 1 1v4h-7v-1.5H9V13H2V9a1 1 0 0 1 1-1zM10 6v2h4V6zM2 14.5h7V16h6v-1.5h7V20a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z",
  tech: "M8 2h2v3h4V2h2v3h1a2 2 0 0 1 2 2v1h3v2h-3v4h3v2h-3v1a2 2 0 0 1-2 2h-1v3h-2v-3h-4v3H8v-3H7a2 2 0 0 1-2-2v-1H2v-2h3v-4H2V8h3V7a2 2 0 0 1 2-2h1zM9 9v6h6V9z",
  pc: "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM9 5v2h6V5zM9 9v2h6V9zM12 15.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  medbag: "M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM11 5v2h2V5zM10.5 10v2.5H8v3h2.5V18h3v-2.5H16v-3h-2.5V10z",
  medcase: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM10.5 7v3.5H7v3h3.5V17h3v-3.5H17v-3h-3.5V7z",
  medcrate: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6z",
  safe: "M4 3h16a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1h-1v2h-3v-2H8v2H5v-2H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 7a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 10a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
  register: "M6 3h9v4h-3v2h5a2 2 0 0 1 2 1.6L21 16H3l1.9-5.4A2 2 0 0 1 7 9h3V7H6zM3 17.5h18V21H3zM10 18.5V20h4v-1.5z",
  drawer: "M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM6 11h12V4H6zM6 20h12v-7H6zM9.5 6.5v2h5v-2zM9.5 15.5v2h5v-2z",
  jacket: "M8 3l4 3 4-3 5 3 1.5 6-3.5 1v8H5v-8l-3.5-1L3 6zM11.25 8v11h1.5V8z",
  suitcase: "M9 6V3.5A1.5 1.5 0 0 1 10.5 2h3A1.5 1.5 0 0 1 15 3.5V6h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM10.5 3.5V6h3V3.5zM8 9v10h1.5V9zM14.5 9v10H16V9z",
  barrel: "M7 2h10l1.5 3h-13zM5 6.5h14v4H5zM5 12h14v5.5H5zM5.5 19h13L17 22H7z",
  cache: "M5 4h14v10H5zM10 6v2h4V6zM2 16h20v2H2zM5 19.5h4V21H5zM11 19.5h4V21h-4zM17 19.5h3V21h-3z",
  stash: "M3 8h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM8 13h8v7H8zM12 15a1.3 1.3 0 0 0-.7 2.4V19h1.4v-1.6A1.3 1.3 0 0 0 12 15zM8.6 13V7a3.4 3.4 0 0 1 6.8 0v6h-1.8V7a1.6 1.6 0 0 0-3.2 0v6z",
  duffle: "M8 7a4 4 0 0 1 8 0h3a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3zM10 7h4a2 2 0 0 0-4 0zM6 10v7h1.5v-7zM16.5 10v7H18v-7z",
  crate: "M3 3h18v18H3zM5.5 5.5v1.6l11.4 11.4h1.6v-1.6L7.1 5.5z",
  ration: "M4 3h2v6h1.5V3h2v6H11V3h2v7a3.5 3.5 0 0 1-3 3.46V21H7v-7.54A3.5 3.5 0 0 1 4 10zM16 3c3 0 5 3 5 8v2h-2v8h-3z",
  body: "M12 2c5 0 9 3.5 9 8.5 0 3-1.4 5.3-3.5 6.7V20a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-2.8C4.4 15.8 3 13.5 3 10.5 3 5.5 7 2 12 2zM8 9a2.2 2.2 0 1 0 0 4.4A2.2 2.2 0 0 0 8 9zM16 9a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM12 14l-1.5 2.5h3z",
};

export const LOOT_KIND_ICON: Record<string, string> = {
  "weapon-box": "weapon", "grenade-box": "grenade", "wooden-ammo-box": "ammo",
  toolbox: "tool", "technical-supply-crate": "tech", "pc-block": "pc",
  medbag: "medbag", medcase: "medcase", "medical-supply-crate": "medcrate",
  safe: "safe", "bank-safe": "safe", "cash-register": "register", "bank-cash-register": "register",
  drawer: "drawer", jacket: "jacket", "plastic-suitcase": "suitcase",
  "buried-barrel-cache": "barrel", "ground-cache": "cache", "shturmans-stash": "stash",
  "duffle-bag": "duffle", "wooden-crate": "crate", "ration-supply-crate": "ration",
  "dead-scav": "body", "pmc-body": "body", "civilian-body": "body", "scav-body": "body", "lab-technician-body": "body",
};

// 묶음 버튼과, 종류를 모르는 상자에 쓰는 대표 아이콘
export const LOOT_GROUP_ICON: Record<string, string> = { w: "weapon", t: "tool", m: "medbag", v: "safe", j: "jacket", s: "suitcase", f: "drawer", c: "cache", b: "duffle", d: "body" };

export const lootIconOf = (kind: string | undefined, group: string): string =>
  (kind && LOOT_KIND_ICON[kind]) || LOOT_GROUP_ICON[group] || "crate";

// 화면 1m 가 몇 px 인지(s)에 따른 아이콘 크기. 0 = 전체 보기처럼 멀리서 볼 때 작은 점만 찍는다.
export const lootBadgeSize = (s: number): number => (s < 0.5 ? 0 : s < 1.2 ? 11 : s < 2.5 ? 15 : 19);

// 겹칠 때 값진 묶음이 위로 오게 그리는 순서(뒤에 그린 것이 위)
const DRAW_RANK: Record<string, number> = { d: 0, b: 1, f: 2, t: 3, m: 4, s: 5, j: 6, c: 7, w: 8, v: 9 };
const drawOrder = new WeakMap<LootRow[], LootRow[]>();
export function lootInDrawOrder(rows: LootRow[]): LootRow[] {
  let sorted = drawOrder.get(rows);
  if (!sorted) {
    sorted = [...rows].sort((a, b) => (DRAW_RANK[a[3]] ?? 0) - (DRAW_RANK[b[3]] ?? 0));
    drawOrder.set(rows, sorted);
  }
  return sorted;
}
