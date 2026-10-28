// 레이더 2단계: 전체 지도(미니맵). SVG 지도 그림(CC BY-NC-SA·치트 금지 조항)은 쓰지 않고
// 사이드카 /radar/map 이 tarkov.dev API 좌표로 추린 점·윤곽만 찍는다.
// 미니맵이라 PMC 탈출구·스캐브 탈출구·트랜짓·퀘스트 위치만(각각 켜고 끔). 잠긴 문·위험·상자·스폰은 데이터만 받아 두고 아직 안 그린다.
// 미니맵 동작: 새 스크린샷이 오면 내 위치로 돌아오고(확대 배율은 유지), 확대 배율은 기억한다.
// 좌표계: 게임 x → 오른쪽, 게임 z → 위. 북쪽이 어디인지는 보장하지 않으므로(맵마다 다름) 사용자가 90°씩 돌릴 수 있고,
// '고정' 을 끄면 레이더 탭처럼 바라보는 쪽이 위가 되게 지도가 돈다.
import { useEffect, useMemo, useRef, useState } from "react";
import type { RadarState, RadarTarget } from "./Radar";

const PYTHON_API = "http://127.0.0.1:8765";
const ROT_KEY = "tarkov.radar.mapRot.v2"; // {[slug]: 0|90|180|270} — v2: 기본 회전이 tarkov.dev 지도 방향으로 바뀌어 옛 수동 회전은 버린다
export const LAYER_KEY = "tarkov.radar.mapLayers";
const IMG_KEY = "tarkov.radar.mapImg"; // "0" = 지도 그림 끔
// tarkov.dev 층 이름 → 한국어(한국어 UI 일 때만)
const FLOOR_KO: Record<string, string> = {
  "2nd Floor": "2층", "3rd Floor": "3층", "4th Floor": "4층", "5th Floor": "5층", "Second Level": "2층",
  Underground: "지하", Tunnels: "터널", Bunkers: "벙커", Garage: "주차장", Technical: "기술층",
};

/** 내 높이·위치로 층 고르기 — extents 의 높이 범위 안이고(구역이 있으면 그 사각형 안) 처음 맞는 층. 없으면 null(지상) */
export function autoFloor(layers: NonNullable<MapDoc["img"]>["layers"], x: number, y: number, z: number): string | null {
  for (const l of layers) {
    for (const e of l.ext) {
      if (y < e.h[0] || y > e.h[1]) continue;
      if (!e.b.length) return l.g;
      for (const r of e.b) {
        const [x1, z1, x2, z2] = r;
        if (x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && z >= Math.min(z1, z2) && z <= Math.max(z1, z2)) return l.g;
      }
    }
  }
  return null;
}
const SPAN_KEY = "tarkov.radar.mapSpan"; // 짧은 변이 몇 m 인지(확대 배율). 휠로 바꾸면 기억
const SPAN_DEFAULT = 300;
const SPAN_MIN = 30;
const SPAN_MAX = 4000;
const FLOOR_M = 5; // 층 구역이 다르고 높이 차도 이보다 크면 다른 층으로 보고 흐리게
const DIM = 0.45;
export const SCAV_COLOR = "#f0f0f0"; // 스캐브 탈출구 — 회색(#9a9a9a)은 어두운 지도 그림 위에서 묻혀 밝은 흰색으로

type Pt = [number, number, number]; // x, y, z
export type MapDoc = {
  slug: string;
  name: string;
  rot: number | null;
  bounds: { minx: number; maxx: number; minz: number; maxz: number } | null;
  // 지도 그림(tarkov.dev SVG, CC BY-NC-SA 4.0): 좌표 변환은 tarkov.dev 사이트(maps.json·getCRS)와 같은 식
  img?: {
    url: string; rot: number; bounds: [number, number][]; transform: number[]; credit: string;
    base: string | null; // SVG 바탕 그룹 id(지상)
    layers: { name: string; g: string; ext: { h: [number, number]; b: number[][] }[] }[]; // 층: 그룹 id + 높이·구역(x1,z1,x2,z2)
  } | null;
  extracts: { name: string; p: Pt; faction: string; switch: boolean; outline: [number, number][] }[];
  transits: { name: string; p: Pt; outline: [number, number][] }[];
  hazards: { name: string; type: string; p: Pt | null; outline: [number, number][] }[];
  locks: { p: Pt; type: string; key?: string | null }[]; // key = 여는 열쇠 아이템 id
  containers: Pt[];
  spawns: [number, number, number, string][]; // 마지막 = p(PMC) s(스캐브) b(보스) n(스나이퍼) o
  bosses?: { name: string; pts: [number, number][]; bosses: { name: string; chance: number }[] }[]; // 보스 스폰 구역(구역별 합침)
  weapons: Pt[];
  switches: Pt[];
};

export type Layers = { pmc: boolean; transits: boolean; quests: boolean; hazards: boolean; spawns: boolean; locks: boolean }; // 스캐브 탈출구는 showScav 로 켜고 끈다. 상태는 RadarPanel 이 갖고(목록·레이더 원·지도가 같은 필터) 여기엔 props 로 온다
export const DEFAULT_LAYERS: Layers = { pmc: true, transits: true, quests: true, hazards: false, spawns: false, locks: false }; // 추가 3종(where am I 벤치마킹 10-28)은 기본 끔

type Strings = { [k: string]: string };
type Props = {
  data: RadarState;
  lang: string;
  t: Strings;
  showScav: boolean;
  onToggleScav: (v: boolean) => void;
  layers: Layers;
  onToggleLayer: (k: keyof Layers) => void;
  hiddenQuests: Set<string>; // 사용자가 숨긴 퀘스트(task id) — 지도 점·이름표에서 뺀다
  size: number; // 지도 높이(px). 폭은 카드 폭을 따라간다
  fixed: boolean; // true = 지도 고정(↻ 90° 회전만) · false = 바라보는 쪽이 위
  highlightKey?: string | null; // 시세로 조회한 열쇠 아이템 id — 이 열쇠로 여는 문을 금색으로 강조(잠긴 문 레이어와 무관)
};

const cache = new Map<string, MapDoc>();
const floorMemo: Record<string, string> = {}; // 맵별 층 선택(세션 동안)

/** 맵별 90° 회전 설정(지도 탭에서 ↻로 돌린 값) — 레이더 고정 모드도 같은 기준을 쓴다 */
export function loadMapRot(slug: string | null | undefined, fallback = 0): number {
  if (!slug) return fallback;
  try {
    const v = localStorage.getItem(ROT_KEY);
    const all = v ? (JSON.parse(v) as Record<string, number>) : {};
    return all[slug] ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

function loadSpan(): number {
  try {
    const n = Number(localStorage.getItem(SPAN_KEY));
    if (Number.isFinite(n) && n > 0) return Math.max(SPAN_MIN, Math.min(SPAN_MAX, n));
  } catch {}
  return SPAN_DEFAULT;
}

/** 맵 문서(좌표·그림 메타) 받기 — 맵·언어별 캐시. 지도 탭과 레이더 탭(배경 지도)이 같이 쓴다 */
export function useMapDoc(slug: string | null, lang: string): { doc: MapDoc | null; err: boolean } {
  const [doc, setDoc] = useState<MapDoc | null>(slug ? cache.get(`${slug}|${lang}`) ?? null : null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!slug) return;
    const key = `${slug}|${lang}`;
    const hit = cache.get(key);
    if (hit) {
      setDoc(hit);
      return;
    }
    let dead = false;
    setErr(false);
    fetch(`${PYTHON_API}/radar/map?map=${encodeURIComponent(slug)}&lang=${encodeURIComponent(lang)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: MapDoc) => {
        cache.set(key, d);
        if (!dead) setDoc(d);
      })
      .catch(() => {
        if (!dead) setErr(true);
      });
    return () => {
      dead = true;
    };
  }, [slug, lang]);
  return { doc, err };
}

/** 지도 그림(tarkov.dev SVG)을 화면에 놓는 아핀 행렬. tarkov.dev 사이트와 같은 식 — (x, z)를 coordinateRotation 만큼 돌린 뒤
 * px = t0·rx + t1, py = −t2·rz + t3. 그림은 bounds 두 모서리의 투영 사각형을 꽉 채우므로 그림 픽셀 (u, v) → 투영 (pxmin+u, pymin+v)
 * → 역변환 → 게임 좌표 → 화면(toScreen). 전부 아핀이라 <image transform="matrix(…)"> 하나로 놓을 수 있다. */
export function imageMatrix(im: NonNullable<MapDoc["img"]>, toScreen: (gx: number, gz: number) => { x: number; y: number }): { W: number; H: number; matrix: string } | null {
  const [t0, t1, t2, t3] = im.transform;
  const a = (im.rot * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const proj = (gx: number, gz: number) => ({ x: t0 * (gx * ca - gz * sa) + t1, y: -t2 * (gx * sa + gz * ca) + t3 });
  const p1 = proj(im.bounds[0][0], im.bounds[0][1]);
  const p2 = proj(im.bounds[1][0], im.bounds[1][1]);
  const pxmin = Math.min(p1.x, p2.x), pymin = Math.min(p1.y, p2.y);
  const W = Math.abs(p2.x - p1.x), H = Math.abs(p2.y - p1.y);
  if (!(W > 0 && H > 0) || !t0 || !t2) return null;
  const game = (u: number, w: number) => {
    const rx = (pxmin + u - t1) / t0;
    const rz = (pymin + w - t3) / -t2;
    return { gx: rx * ca + rz * sa, gz: -rx * sa + rz * ca };
  };
  const scr = (u: number, w: number) => { const g = game(u, w); return toScreen(g.gx, g.gz); };
  const s0 = scr(0, 0), sx = scr(1, 0), sy = scr(0, 1);
  return { W, H, matrix: [sx.x - s0.x, sx.y - s0.y, sy.x - s0.x, sy.y - s0.y, s0.x, s0.y].map((n) => n.toFixed(4)).join(" ") };
}

const BOSS_PAD = 12; // 구역 사각형 여유(m)
function bossBox(pts: [number, number][]) {
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  return { x1: Math.min(...xs) - BOSS_PAD, x2: Math.max(...xs) + BOSS_PAD, z1: Math.min(...zs) - BOSS_PAD, z2: Math.max(...zs) + BOSS_PAD };
}
function bossText(z: NonNullable<MapDoc["bosses"]>[number], max = 9): string {
  return z.bosses.slice(0, max).map((b) => `${b.name} ${Math.round(b.chance * 100)}%`).join(", ");
}

function hazardPt(h: MapDoc["hazards"][number]): Pt | null {
  if (h.p) return h.p;
  if (h.outline.length) {
    const x = h.outline.reduce((a, q) => a + q[0], 0) / h.outline.length;
    const z = h.outline.reduce((a, q) => a + q[1], 0) / h.outline.length;
    return [x, 0, z];
  }
  return null;
}

export function RadarMap({ data, lang, t, showScav, onToggleScav, layers, onToggleLayer, hiddenQuests, size, fixed, highlightKey }: Props) {
  const slug = data.map?.id ?? null;
  const { doc, err } = useMapDoc(slug, lang);
  const [showImg, setShowImg] = useState<boolean>(() => localStorage.getItem(IMG_KEY) !== "0");
  // "auto" | "base" | 층 그룹 id. 조회(F2) 뒤 레이더를 다시 열면 패널이 새로 만들어지므로 맵별 선택을 모듈 메모리에 둔다(앱 켜 있는 동안)
  const [floor, setFloorState] = useState<string>(() => (slug && floorMemo[slug]) || "auto");
  const setFloor = (f: string) => {
    setFloorState(f);
    if (slug) floorMemo[slug] = f;
  };
  const toggleImg = () => {
    setShowImg((v) => {
      try {
        localStorage.setItem(IMG_KEY, v ? "0" : "1");
      } catch {}
      return !v;
    });
  };
  // 기본 회전 = tarkov.dev 지도 그림 방향(coordinateRotation, /radar 의 map.rot) — 사용자가 ↻로 돌린 값이 있으면 그걸로
  const defRot = data.map?.rot ?? 0;
  const [rot, setRot] = useState<number>(() => loadMapRot(slug, defRot));
  const [span, setSpan] = useState<number>(loadSpan);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 300, h: size });
  // 보기: null = 내 위치 중심(기억한 배율) · 값 = 끌거나 '전체'로 옮긴 중심과 축척(px/m)
  const [view, setView] = useState<{ cx: number; cz: number; s: number } | null>(null);
  const [sel, setSel] = useState<{ name: string; p: Pt } | null>(null);
  const dragRef = useRef<{ x: number; y: number; cx: number; cz: number; moved: boolean } | null>(null);
  const movedRef = useRef(false); // 끌고 난 뒤 따라오는 click 은 선택으로 치지 않는다
  const [dragging, setDragging] = useState(false);

  // 맵이 바뀌면 회전·보기 초기화
  useEffect(() => {
    setRot(loadMapRot(slug, defRot));
    setView(null);
    setSel(null);
    setFloorState((slug && floorMemo[slug]) || "auto");
  }, [slug]);

  const me = data.shot;
  const myY = me?.y ?? 0;
  const heading = me?.heading ?? null;

  // 새 스크린샷(위치가 바뀜) → 미니맵답게 내 위치로 돌아온다. 확대 배율(span)은 그대로
  useEffect(() => {
    setView(null);
  }, [me?.x, me?.z]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => setBox({ w: el.clientWidth || 300, h: el.clientHeight || size });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, [size]);

  // 기본 보기: 내 위치 중심, 짧은 변이 span m
  const baseView = useMemo(() => {
    if (!me) return null;
    return { cx: me.x, cz: me.z, s: Math.min(box.w, box.h) / span };
  }, [me?.x, me?.z, box.w, box.h, span]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = view ?? baseView;

  // 실제 회전(세계를 반시계로 eff 만큼): 고정이면 맵별 90° 값, 아니면 바라보는 쪽이 위.
  // toScreen 은 방위 β 인 대상을 화면 각 β − eff(위에서 시계 방향)에 놓으므로, 바라보는 쪽(β = heading)이 위(0)가 되려면 eff = heading.
  // 내 화살표도 같은 식으로 heading − eff. (전엔 −heading / heading + eff 로 써서 바라보는 쪽 위 모드가 거울상, 90°·270° 회전에서 화살표가 반대였다)
  const headingUp = !fixed && heading != null;
  const eff = headingUp ? heading! : rot;
  const effRef = useRef(eff);
  effRef.current = eff;

  // 게임 좌표 → 화면. 회전은 중심 기준으로 먼저 돌린다.
  const toScreen = (gx: number, gz: number) => {
    if (!v) return { x: 0, y: 0 };
    const dx = gx - v.cx;
    const dz = gz - v.cz;
    const a = (eff * Math.PI) / 180;
    const rx = dx * Math.cos(a) - dz * Math.sin(a);
    const rz = dx * Math.sin(a) + dz * Math.cos(a);
    return { x: box.w / 2 + rx * v.s, y: box.h / 2 - rz * v.s };
  };

  const fit = () => {
    if (!doc?.bounds) return;
    const b = { ...doc.bounds };
    if (doc.img && showImg) {
      // 지도 그림까지 다 보이게
      for (const [bx, bz] of doc.img.bounds) {
        b.minx = Math.min(b.minx, bx); b.maxx = Math.max(b.maxx, bx);
        b.minz = Math.min(b.minz, bz); b.maxz = Math.max(b.maxz, bz);
      }
    }
    const spanM = Math.max(b.maxx - b.minx, b.maxz - b.minz, 50) * 1.08;
    setView({ cx: (b.minx + b.maxx) / 2, cz: (b.minz + b.maxz) / 2, s: Math.min(box.w, box.h) / spanM });
  };
  const centerMe = () => setView(null);
  const rotate = () => {
    const r = (rot + 90) % 360;
    setRot(r);
    if (slug) {
      const all = loadJson<Record<string, number>>(ROT_KEY, {});
      all[slug] = r;
      try {
        localStorage.setItem(ROT_KEY, JSON.stringify(all));
      } catch {}
    }
  };
  // 휠 확대(커서 위치 고정). React 의 onWheel 은 passive 로 붙어 preventDefault 가 안 먹고 카드가 같이 스크롤되므로
  // 네이티브 리스너를 non-passive 로 단다.
  const vRef = useRef(v);
  vRef.current = v;
  const boxRef = useRef(box);
  boxRef.current = box;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const cur = vRef.current;
      if (!cur) return;
      e.preventDefault();
      const { w, h } = boxRef.current;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const f = e.deltaY < 0 ? 1.25 : 0.8;
      const short = Math.min(w, h);
      const ns = Math.min(short / SPAN_MIN, Math.max(short / SPAN_MAX, cur.s * f));
      // 커서 아래 게임 좌표가 그대로 있도록 중심을 보정(회전 역변환)
      const a = (effRef.current * Math.PI) / 180;
      const sx = (mx - w / 2) / cur.s;
      const sy = -(my - h / 2) / cur.s;
      const gx = cur.cx + sx * Math.cos(a) + sy * Math.sin(a);
      const gz = cur.cz - sx * Math.sin(a) + sy * Math.cos(a);
      const nsx = (mx - w / 2) / ns;
      const nsy = -(my - h / 2) / ns;
      setView({ cx: gx - (nsx * Math.cos(a) + nsy * Math.sin(a)), cz: gz - (-nsx * Math.sin(a) + nsy * Math.cos(a)), s: ns });
      const sp = Math.round(short / ns);
      setSpan(sp);
      try {
        localStorage.setItem(SPAN_KEY, String(sp));
      } catch {}
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onDown = (e: React.PointerEvent) => {
    if (!v) return;
    dragRef.current = { x: e.clientX, y: e.clientY, cx: v.cx, cz: v.cz, moved: false };
    movedRef.current = false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !v) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    movedRef.current = true;
    setDragging(true);
    const a = (eff * Math.PI) / 180;
    const sx = -dx / v.s;
    const sy = dy / v.s;
    setView({ cx: d.cx + sx * Math.cos(a) + sy * Math.sin(a), cz: d.cz - sx * Math.sin(a) + sy * Math.cos(a), s: v.s });
  };
  const onUp = () => {
    dragRef.current = null;
    setDragging(false);
  };
  const pick = (s: { name: string; p: Pt } | null) => {
    if (movedRef.current) return; // 끌기 끝의 click
    setSel(s);
  };
  const onSvgClick = (e: React.MouseEvent) => {
    if (!(e.target as Element).closest("g")) pick(null); // 빈 곳 클릭 → 선택 해제
  };

  const dist = (p: Pt) => (me ? Math.hypot(p[0] - me.x, p[2] - me.z) : 0);
  // 다른 층 흐리게: 층 구역 정보가 있는 맵은 내 층과 대상의 층(autoFloor)이 다를 때만. 층 정보가 없는 맵은
  // 높이 차로 판단하면 야외 지형 고저차에도 걸려 멀쩡한 탈출구가 흐려지므로 아예 안 흐린다.
  const floorLayers = doc?.img?.layers ?? [];
  const myFloor = me && floorLayers.length ? autoFloor(floorLayers, me.x, me.y, me.z) : null;
  const op = (x: number, y: number, z: number) =>
    floorLayers.length && me && autoFloor(floorLayers, x, y, z) !== myFloor && Math.abs(y - myY) > FLOOR_M ? DIM : 1;
  const questTargets: RadarTarget[] = (data.targets || []).filter((x) => x.kind === "quest" && x.x != null && x.z != null && !hiddenQuests.has(x.task ?? x.name));

  // 탈출구 진영별 표시: scav 는 showScav, 나머지(pmc·shared)는 pmc 레이어
  const showExtract = (faction: string) => (faction === "scav" ? showScav : layers.pmc);

  // 이름표 자리 잡기: 가까운 것부터 놓고, 먼저 놓인 이름표·내 마커와 겹치거나 화면 밖이면 생략
  const labels = new Map<string, { text: string; lx: number; ly: number }>();
  if (doc && v) {
    // 도구 버튼(오른쪽 위)·축척/방향 표시(아래 줄) 자리는 미리 막아 이름표가 그 밑에 깔리지 않게
    const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [
      { x1: box.w - 170, y1: 0, x2: box.w, y2: 30 },
      { x1: 0, y1: box.h - 20, x2: box.w, y2: box.h },
    ];
    if (me) {
      const s = toScreen(me.x, me.z);
      boxes.push({ x1: s.x - 6, y1: s.y - 7, x2: s.x + 6, y2: s.y + 6 }); // 내 화살표 자리(바로 옆 탈출구의 이름표까지 막지 않게 작게)
    }
    // 우선순위: 퀘스트 0 → PMC 탈출구 1 → 스캐브 탈출구 2 → 트랜짓 3, 같은 종류끼리는 가까운 순
    const cands: { key: string; text: string; p: Pt; off: number; pr: number }[] = [];
    if (highlightKey) doc.locks.forEach((x, i) => { if (x.key === highlightKey) cands.push({ key: `kl${i}`, text: `🔑 ${t.radarKeyDoor}`, p: x.p, off: 12, pr: -1 }); });
    if (layers.transits) doc.transits.forEach((x, i) => cands.push({ key: `tr${i}`, text: x.name, p: x.p, off: 5, pr: 3 }));
    if (layers.hazards) doc.hazards.forEach((x, i) => { const p = hazardPt(x); if (p) cands.push({ key: `hz${i}`, text: x.name, p, off: 6, pr: 4 }); });
    if (layers.spawns) (doc.bosses ?? []).forEach((z, i) => { const b = bossBox(z.pts); cands.push({ key: `bz${i}`, text: `${z.name} · ${bossText(z, 1)}`, p: [(b.x1 + b.x2) / 2, myY, (b.z1 + b.z2) / 2], off: 10, pr: 0.5 }); });
    doc.extracts.forEach((x, i) => {
      if (showExtract(x.faction)) cands.push({ key: `ex${i}`, text: `${x.name}${x.switch ? " ⚡" : ""}`, p: x.p, off: 5, pr: x.faction === "scav" ? 2 : 1 });
    });
    // 퀘스트는 이름만(목표 문장은 길어서 다른 이름표를 다 밀어낸다 — 점을 누르면 전문)
    if (layers.quests) questTargets.forEach((q, i) => cands.push({ key: `q${i}`, text: q.name, p: [q.x!, q.y ?? myY, q.z!], off: 6, pr: 0 }));
    cands
      .map((c) => ({ ...c, d: dist(c.p) }))
      .sort((a, b) => a.pr - b.pr || a.d - b.d)
      .forEach((c) => {
        const s = toScreen(c.p[0], c.p[2]);
        if (s.x < 0 || s.y < 0 || s.x > box.w || s.y > box.h) return; // 점이 화면 밖이면 이름표도 생략(가장자리에 글자만 잘려 들어오지 않게)
        const w = c.text.length * 5.4;
        // 자리 후보: 오른쪽 → 왼쪽 → 아래(가운데) → 위(가운데). 먼저 놓인 이름표·도구 영역과 안 겹치고 화면 안에 드는 첫 자리.
        // 한 자리만 보고 포기하면 점이 몰린 곳(시내 동쪽 등)의 이름표가 통째로 빠진다
        const spots: [number, number][] = [
          [s.x + c.off, s.y + 3], [s.x - c.off - w, s.y + 3], [s.x - w / 2, s.y + c.off + 9], [s.x - w / 2, s.y - c.off - 3],
          // 대각선(점이 몰린 곳에서 마지막 수단)
          [s.x + c.off, s.y - c.off - 4], [s.x + c.off, s.y + c.off + 9], [s.x - c.off - w, s.y - c.off - 4], [s.x - c.off - w, s.y + c.off + 9],
        ];
        for (const [lx, ly] of spots) {
          const b = { x1: lx, y1: ly - 9, x2: lx + w, y2: ly + 2 };
          if (b.x1 < 2 || b.x2 > box.w - 2 || b.y1 < 2 || b.y2 > box.h - 2) continue;
          if (boxes.some((o) => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1)) continue;
          boxes.push(b);
          labels.set(c.key, { text: c.text, lx, ly });
          break;
        }
      });
  }
  const label = (key: string) => {
    const l = labels.get(key);
    return l ? <text x={l.lx} y={l.ly} className="radar-maplabel">{l.text}</text> : null;
  };

  const poly = (ol: [number, number][]) => ol.map((q) => { const s = toScreen(q[0], q[1]); return `${s.x.toFixed(1)},${s.y.toFixed(1)}`; }).join(" ");

  // 지도 그림 ↔ 게임 좌표: tarkov.dev 사이트와 같은 식 — (x, z)를 coordinateRotation 만큼 돌린 뒤 px = t0·rx + t1, py = −t2·rz + t3.
  // 그림은 bounds 두 모서리의 투영 사각형을 꽉 채우므로 그림 픽셀 (u, v) → 투영 (pxmin+u, pymin+v) → 역변환 → 게임 좌표 → 화면.
  // 전부 아핀이라 그림을 SVG <image transform="matrix(…)"> 하나로 놓을 수 있다.
  // 층: 자동이면 내 높이·위치로, 아니면 고른 층. 그림은 사이드카가 그 층만 켠 SVG 변형으로 준다(?layer=)
  const floorAuto = doc?.img && me ? autoFloor(doc.img.layers, me.x, me.y, me.z) : null;
  const floorNow = floor === "auto" ? floorAuto : floor === "base" ? null : floor;
  const floorName = (g: string | null) => {
    if (!g) return t.radarFloorBase;
    const l = doc?.img?.layers.find((x) => x.g === g);
    const n = l?.name ?? g;
    return lang === "ko" ? FLOOR_KO[n] ?? n : n;
  };
  const imgLayer = (() => {
    const im = doc?.img;
    if (!im || !v || !showImg) return null;
    const mx = imageMatrix(im, toScreen);
    if (!mx) return null;
    const href = `${PYTHON_API}${im.url}` + (floorNow ? `&layer=${encodeURIComponent(floorNow)}` : "");
    return <image href={href} width={mx.W} height={mx.H} preserveAspectRatio="none" transform={`matrix(${mx.matrix})`} opacity={0.9} style={{ pointerEvents: "none" }} />;
  })();
  const scaleM = v ? [10, 25, 50, 100, 200, 500].find((m) => m * v.s >= 40) ?? 1000 : 0;
  const chip = (on: boolean, k: string, text: string, onClick: () => void) => (
    <button type="button" className={`radar-chip${on ? " on" : ""}`} aria-pressed={on} onClick={onClick}>
      <span className={`radar-sw ${k}`} /> {text}
    </button>
  );

  return (
    <div className="radar-mapblock">
      <div
        ref={wrapRef}
        className={`radar-mapwrap${dragging ? " drag" : ""}`}
        style={{ height: size }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={centerMe}
      >
        {doc && v && (
          <svg className="radar-mapsvg" viewBox={`0 0 ${box.w} ${box.h}`} role="img" aria-label={doc.name} onClick={onSvgClick}>
            {imgLayer}
            {layers.hazards &&
              doc.hazards.map((x, i) => {
                const p = hazardPt(x);
                if (!p) return null;
                const s = toScreen(p[0], p[2]);
                if (x.type === "sniper") {
                  // 저격수 스캐브: tarkov.dev 처럼 조준점 하나(구역 윤곽은 안 그림 — 빨간 표시가 너무 많아진다)
                  return (
                    <g key={`hz${i}`} onClick={() => pick({ name: x.name, p })} opacity={op(p[0], p[1], p[2])}>
                      <circle cx={s.x} cy={s.y} r={10} fill="transparent" />
                      <circle cx={s.x} cy={s.y} r={6} fill="rgba(0,0,0,0.35)" stroke="#f5f5f5" strokeWidth={1.2} />
                      <line x1={s.x - 9} y1={s.y} x2={s.x + 9} y2={s.y} stroke="#f5f5f5" strokeWidth={1.2} />
                      <line x1={s.x} y1={s.y - 9} x2={s.x} y2={s.y + 9} stroke="#f5f5f5" strokeWidth={1.2} />
                      <circle cx={s.x} cy={s.y} r={1.5} fill="#ff4d4d" />
                      {label(`hz${i}`)}
                    </g>
                  );
                }
                return (
                  <g key={`hz${i}`} onClick={() => pick({ name: x.name, p })} opacity={op(p[0], p[1], p[2])}>
                    {x.outline.length >= 3 ? (
                      <polygon points={poly(x.outline)} fill="rgba(255,120,40,0.18)" stroke="#ff9f1c" strokeWidth={1} strokeDasharray="3 2" />
                    ) : (
                      <circle cx={s.x} cy={s.y} r={6} fill="rgba(255,120,40,0.25)" stroke="#ff9f1c" strokeWidth={1} />
                    )}
                    <circle cx={s.x} cy={s.y} r={9} fill="transparent" />
                    <text x={s.x} y={s.y + 3} textAnchor="middle" fontSize={8} fill="#ff9f1c" fontWeight={700}>!</text>
                    {label(`hz${i}`)}
                  </g>
                );
              })}
            {layers.transits &&
              doc.transits.map((x, i) => {
                const s = toScreen(x.p[0], x.p[2]);
                return (
                  <g key={`tr${i}`} onClick={() => pick({ name: x.name, p: x.p })} opacity={op(x.p[0], x.p[1], x.p[2])}>
                    {x.outline.length >= 3 && <polygon points={poly(x.outline)} fill="rgba(111,168,220,0.15)" stroke="#6fa8dc" strokeWidth={1} />}
                    <circle cx={s.x} cy={s.y} r={9} fill="transparent" />
                    <circle cx={s.x} cy={s.y} r={4} fill="#6fa8dc" stroke="#000" strokeWidth={0.8} />
                    {label(`tr${i}`)}
                  </g>
                );
              })}
            {doc.extracts.map((x, i) => {
                  if (!showExtract(x.faction)) return null; // 이름표 키(ex{i})가 원본 인덱스라 filter 로 줄이면 안 됨
                  const s = toScreen(x.p[0], x.p[2]);
                  const c = x.faction === "scav" ? SCAV_COLOR : "#6fbf73";
                  return (
                    <g key={`ex${i}`} onClick={() => pick({ name: x.name, p: x.p })} opacity={op(x.p[0], x.p[1], x.p[2])}>
                      {x.outline.length >= 3 && <polygon points={poly(x.outline)} fill="rgba(111,191,115,0.15)" stroke={c} strokeWidth={1} />}
                      <circle cx={s.x} cy={s.y} r={9} fill="transparent" />
                      <circle cx={s.x} cy={s.y} r={4} fill={c} stroke="#000" strokeWidth={0.8} />
                      {label(`ex${i}`)}
                    </g>
                  );
                })}
            {layers.locks &&
              doc.locks.map((x, i) => {
                const s = toScreen(x.p[0], x.p[2]);
                return (
                  <g key={`lk${i}`} onClick={() => pick({ name: `${t.radarLayerLocks}${x.type && x.type !== "door" ? " · " + x.type : ""}`, p: x.p })} opacity={op(x.p[0], x.p[1], x.p[2])}>
                    <circle cx={s.x} cy={s.y} r={8} fill="transparent" />
                    <rect x={s.x - 3} y={s.y - 3} width={6} height={6} fill="#c08cff" stroke="#000" strokeWidth={0.7} transform={`rotate(45 ${s.x} ${s.y})`} />
                  </g>
                );
              })}
            {layers.spawns &&
              (doc.bosses ?? []).map((z, i) => {
                // 구역 = 스폰 점들을 감싸는 사각형(여유 12m) — tarkov.dev 처럼 붉게 칠하고 해골
                const b = bossBox(z.pts);
                const c = toScreen((b.x1 + b.x2) / 2, (b.z1 + b.z2) / 2);
                const corners = [[b.x1, b.z1], [b.x2, b.z1], [b.x2, b.z2], [b.x1, b.z2]] as [number, number][];
                const text = bossText(z);
                return (
                  <g key={`bz${i}`} onClick={() => pick({ name: `☠ ${z.name}: ${text}`, p: [(b.x1 + b.x2) / 2, myY, (b.z1 + b.z2) / 2] })}>
                    <polygon points={poly(corners)} fill="rgba(220,40,40,0.22)" stroke="#ff4d4d" strokeWidth={1.2} strokeDasharray="4 2" />
                    <text x={c.x} y={c.y + 5} textAnchor="middle" fontSize={14} fill="#ff4d4d" stroke="#000" strokeWidth={0.6}>☠</text>
                    {label(`bz${i}`)}
                  </g>
                );
              })}
            {highlightKey &&
              doc.locks.map((x, i) => {
                if (x.key !== highlightKey) return null;
                const s = toScreen(x.p[0], x.p[2]);
                return (
                  <g key={`kl${i}`} onClick={() => pick({ name: `🔑 ${t.radarKeyDoor}${x.type === "trunk" ? " · " + t.radarLockTrunk : ""}`, p: x.p })} opacity={op(x.p[0], x.p[1], x.p[2])}>
                    <circle cx={s.x} cy={s.y} r={11} fill="none" stroke="#ffd34d" strokeWidth={1.6} className="radar-keyring" />
                    <rect x={s.x - 4.5} y={s.y - 4.5} width={9} height={9} fill="#ffd34d" stroke="#000" strokeWidth={0.8} transform={`rotate(45 ${s.x} ${s.y})`} />
                    {label(`kl${i}`)}
                  </g>
                );
              })}
            {layers.quests &&
              questTargets.map((q, i) => {
                const s = toScreen(q.x!, q.z!);
                return (
                  <g key={`q${i}`} onClick={() => pick({ name: `${q.name}${q.objective ? " · " + q.objective : ""}${q.keys?.length ? " · 🔑 " + q.keys.join(", ") : ""}`, p: [q.x!, q.y ?? myY, q.z!] })} opacity={op(q.x!, q.y ?? myY, q.z!)}>
                    <circle cx={s.x} cy={s.y} r={9} fill="transparent" />
                    <circle cx={s.x} cy={s.y} r={5} fill="#f0c040" stroke="#000" strokeWidth={0.8} />
                    {label(`q${i}`)}
                  </g>
                );
              })}
            {me && (() => {
              const s = toScreen(me.x, me.z);
              const h = heading == null ? null : heading - eff;
              return h == null ? (
                <circle cx={s.x} cy={s.y} r={5} className="radar-me" />
              ) : (
                <path d={`M ${s.x} ${s.y - 9} L ${s.x + 6} ${s.y + 6} L ${s.x} ${s.y + 3} L ${s.x - 6} ${s.y + 6} Z`} className="radar-me" transform={`rotate(${h} ${s.x} ${s.y})`} />
              );
            })()}
          </svg>
        )}
        {!doc && <div className="radar-mapmsg">{err ? t.radarMapError : t.radarMapLoading}</div>}
        <div className="radar-maptools">
          {view && <button type="button" onClick={centerMe} title={t.radarMapMe}>⌖ {t.radarMapMe}</button>}
          <button type="button" onClick={fit} title={t.radarMapFit}>{t.radarMapFit}</button>
          {!headingUp && <button type="button" onClick={rotate} title={t.radarMapRotate}>↻</button>}
        </div>
        {v && <div className="radar-mapscale">━ {scaleM}m</div>}
        {headingUp && <div className="radar-mapup">▲ {t.radarMapHeadingUp}</div>}
        {doc?.img && showImg && <div className="radar-mapcredit">{doc.img.credit}</div>}
        {doc?.img && showImg && floorNow && <div className="radar-mapfloor">{floorName(floorNow)}</div>}
      </div>
      <div className="radar-layers">
        {chip(layers.pmc, "pmc", t.radarLayerPmc, () => onToggleLayer("pmc"))}
        {chip(showScav, "scav", t.radarLayerScav, () => onToggleScav(!showScav))}
        {chip(layers.transits, "transit", t.radarLayerTransits, () => onToggleLayer("transits"))}
        {chip(layers.quests, "quest", t.radarLayerQuests, () => onToggleLayer("quests"))}
        {chip(layers.hazards, "hazard", t.radarLayerHazards, () => onToggleLayer("hazards"))}
        {chip(layers.spawns, "spawn", t.radarLayerSpawns, () => onToggleLayer("spawns"))}
        {chip(layers.locks, "lock", t.radarLayerLocks, () => onToggleLayer("locks"))}
        {doc?.img && chip(showImg, "img", t.radarLayerImg, toggleImg)}
      </div>
      {doc?.img && showImg && doc.img.layers.length > 0 && (
        <div className="radar-layers radar-floors">
          <span className="radar-kind">{t.radarFloor}</span>
          <button type="button" className={`radar-chip${floor === "auto" ? " on" : ""}`} aria-pressed={floor === "auto"} onClick={() => setFloor("auto")}>
            {t.radarFloorAuto}{floor === "auto" ? ` · ${floorName(floorAuto)}` : ""}
          </button>
          <button type="button" className={`radar-chip${floor === "base" ? " on" : ""}`} aria-pressed={floor === "base"} onClick={() => setFloor("base")}>{t.radarFloorBase}</button>
          {doc.img.layers.map((l) => (
            <button key={l.g} type="button" className={`radar-chip${floor === l.g ? " on" : ""}`} aria-pressed={floor === l.g} onClick={() => setFloor(l.g)}>{floorName(l.g)}</button>
          ))}
        </div>
      )}
      {sel && (
        <div className="radar-mapsel">
          <b>{sel.name}</b> · {Math.round(dist(sel.p))}m
          {Math.abs(sel.p[1] - myY) >= 2.5 && <> · {sel.p[1] > myY ? "▲" : "▼"}{Math.round(Math.abs(sel.p[1] - myY))}m</>}
        </div>
      )}
    </div>
  );
}
