// 레이더 2단계: 전체 지도(미니맵). SVG 지도 그림(CC BY-NC-SA·치트 금지 조항)은 쓰지 않고
// 사이드카 /radar/map 이 tarkov.dev API 좌표로 추린 점·윤곽만 찍는다.
// 미니맵이라 PMC 탈출구·스캐브 탈출구·트랜짓·퀘스트 위치만(각각 켜고 끔). 잠긴 문·위험·상자·스폰은 데이터만 받아 두고 아직 안 그린다.
// 미니맵 동작: 새 스크린샷이 오면 내 위치로 돌아오고(확대 배율은 유지), 확대 배율은 기억한다.
// 좌표계: 게임 x → 오른쪽, 게임 z → 위. 북쪽이 어디인지는 보장하지 않으므로(맵마다 다름) 사용자가 90°씩 돌릴 수 있고,
// '고정' 을 끄면 레이더 탭처럼 바라보는 쪽이 위가 되게 지도가 돈다.
import { useEffect, useMemo, useRef, useState } from "react";
import type { RadarState, RadarTarget } from "./Radar";

const PYTHON_API = "http://127.0.0.1:8765";
const ROT_KEY = "tarkov.radar.mapRot"; // {[slug]: 0|90|180|270}
const LAYER_KEY = "tarkov.radar.mapLayers";
const SPAN_KEY = "tarkov.radar.mapSpan"; // 짧은 변이 몇 m 인지(확대 배율). 휠로 바꾸면 기억
const SPAN_DEFAULT = 300;
const SPAN_MIN = 30;
const SPAN_MAX = 4000;
const FLOOR_M = 5; // 이보다 높이 차가 크면 다른 층으로 보고 흐리게
const DIM = 0.45;

type Pt = [number, number, number]; // x, y, z
export type MapDoc = {
  slug: string;
  name: string;
  rot: number | null;
  bounds: { minx: number; maxx: number; minz: number; maxz: number } | null;
  extracts: { name: string; p: Pt; faction: string; switch: boolean; outline: [number, number][] }[];
  transits: { name: string; p: Pt; outline: [number, number][] }[];
  hazards: { name: string; type: string; p: Pt | null; outline: [number, number][] }[];
  locks: { p: Pt; type: string }[];
  containers: Pt[];
  spawns: [number, number, number, string][]; // 마지막 = p(PMC) s(스캐브) b(보스) n(스나이퍼) o
  weapons: Pt[];
  switches: Pt[];
};

type Layers = { pmc: boolean; transits: boolean; quests: boolean }; // 스캐브 탈출구는 레이더 탭과 같은 showScav 로 켜고 끈다
const DEFAULT_LAYERS: Layers = { pmc: true, transits: true, quests: true };

type Strings = { [k: string]: string };
type Props = {
  data: RadarState;
  lang: string;
  t: Strings;
  showScav: boolean;
  onToggleScav: (v: boolean) => void;
  size: number; // 지도 높이(px). 폭은 카드 폭을 따라간다
  fixed: boolean; // true = 지도 고정(↻ 90° 회전만) · false = 바라보는 쪽이 위
};

const cache = new Map<string, MapDoc>();

/** 맵별 90° 회전 설정(지도 탭에서 ↻로 돌린 값) — 레이더 고정 모드도 같은 기준을 쓴다 */
export function loadMapRot(slug: string | null | undefined): number {
  if (!slug) return 0;
  try {
    const v = localStorage.getItem(ROT_KEY);
    const all = v ? (JSON.parse(v) as Record<string, number>) : {};
    return all[slug] ?? 0;
  } catch {
    return 0;
  }
}

function loadJson<T>(key: string, fallback: T): T {
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

export function RadarMap({ data, lang, t, showScav, onToggleScav, size, fixed }: Props) {
  const slug = data.map?.id ?? null;
  const [doc, setDoc] = useState<MapDoc | null>(slug ? cache.get(`${slug}|${lang}`) ?? null : null);
  const [err, setErr] = useState(false);
  const [layers, setLayers] = useState<Layers>(() => loadJson(LAYER_KEY, DEFAULT_LAYERS));
  const [rot, setRot] = useState<number>(() => (slug ? loadJson<Record<string, number>>(ROT_KEY, {})[slug] ?? 0 : 0));
  const [span, setSpan] = useState<number>(loadSpan);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 300, h: size });
  // 보기: null = 내 위치 중심(기억한 배율) · 값 = 끌거나 '전체'로 옮긴 중심과 축척(px/m)
  const [view, setView] = useState<{ cx: number; cz: number; s: number } | null>(null);
  const [sel, setSel] = useState<{ name: string; p: Pt } | null>(null);
  const dragRef = useRef<{ x: number; y: number; cx: number; cz: number; moved: boolean } | null>(null);
  const movedRef = useRef(false); // 끌고 난 뒤 따라오는 click 은 선택으로 치지 않는다
  const [dragging, setDragging] = useState(false);

  // 지도 문서 받기(맵·언어별 캐시)
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

  // 맵이 바뀌면 회전·보기 초기화
  useEffect(() => {
    setRot(slug ? loadJson<Record<string, number>>(ROT_KEY, {})[slug] ?? 0 : 0);
    setView(null);
    setSel(null);
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

  // 실제 회전: 고정이면 맵별 90° 값, 아니면 바라보는 쪽이 위(내 화살표 각 = heading + eff = 0)
  const headingUp = !fixed && heading != null;
  const eff = headingUp ? -heading! : rot;
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
    const b = doc.bounds;
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
  const toggleLayer = (k: keyof Layers) =>
    setLayers((L) => {
      const n = { ...L, [k]: !L[k] };
      try {
        localStorage.setItem(LAYER_KEY, JSON.stringify(n));
      } catch {}
      return n;
    });

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
  const op = (y: number) => (Math.abs(y - myY) > FLOOR_M ? DIM : 1);
  const questTargets: RadarTarget[] = (data.targets || []).filter((x) => x.kind === "quest" && x.x != null && x.z != null);

  // 탈출구 진영별 표시: scav 는 showScav, 나머지(pmc·shared)는 pmc 레이어
  const showExtract = (faction: string) => (faction === "scav" ? showScav : layers.pmc);

  // 이름표 자리 잡기: 가까운 것부터 놓고, 먼저 놓인 이름표·내 마커와 겹치거나 화면 밖이면 생략
  const labels = new Map<string, { text: string; lx: number; ly: number }>();
  if (doc && v) {
    const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
    if (me) {
      const s = toScreen(me.x, me.z);
      boxes.push({ x1: s.x - 10, y1: s.y - 10, x2: s.x + 10, y2: s.y + 10 });
    }
    // 우선순위: 퀘스트 0 → PMC 탈출구 1 → 스캐브 탈출구 2 → 트랜짓 3, 같은 종류끼리는 가까운 순
    const cands: { key: string; text: string; p: Pt; off: number; pr: number }[] = [];
    if (layers.transits) doc.transits.forEach((x, i) => cands.push({ key: `tr${i}`, text: x.name, p: x.p, off: 5, pr: 3 }));
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
        const left = s.x + c.off + w > box.w - 2;
        const lx = left ? s.x - c.off - w : s.x + c.off;
        const b = { x1: lx, y1: s.y - 6, x2: lx + w, y2: s.y + 5 };
        if (boxes.some((o) => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1)) return;
        boxes.push(b);
        labels.set(c.key, { text: c.text, lx, ly: s.y + 3 });
      });
  }
  const label = (key: string) => {
    const l = labels.get(key);
    return l ? <text x={l.lx} y={l.ly} className="radar-maplabel">{l.text}</text> : null;
  };

  const poly = (ol: [number, number][]) => ol.map((q) => { const s = toScreen(q[0], q[1]); return `${s.x.toFixed(1)},${s.y.toFixed(1)}`; }).join(" ");
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
            {layers.transits &&
              doc.transits.map((x, i) => {
                const s = toScreen(x.p[0], x.p[2]);
                return (
                  <g key={`tr${i}`} onClick={() => pick({ name: x.name, p: x.p })} opacity={op(x.p[1])}>
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
                  const c = x.faction === "scav" ? "#9a9a9a" : "#6fbf73";
                  return (
                    <g key={`ex${i}`} onClick={() => pick({ name: x.name, p: x.p })} opacity={op(x.p[1])}>
                      {x.outline.length >= 3 && <polygon points={poly(x.outline)} fill="rgba(111,191,115,0.15)" stroke={c} strokeWidth={1} />}
                      <circle cx={s.x} cy={s.y} r={9} fill="transparent" />
                      <circle cx={s.x} cy={s.y} r={4} fill={c} stroke="#000" strokeWidth={0.8} />
                      {label(`ex${i}`)}
                    </g>
                  );
                })}
            {layers.quests &&
              questTargets.map((q, i) => {
                const s = toScreen(q.x!, q.z!);
                return (
                  <g key={`q${i}`} onClick={() => pick({ name: `${q.name}${q.objective ? " · " + q.objective : ""}`, p: [q.x!, q.y ?? myY, q.z!] })} opacity={op(q.y ?? myY)}>
                    <circle cx={s.x} cy={s.y} r={9} fill="transparent" />
                    <circle cx={s.x} cy={s.y} r={5} fill="#f0c040" stroke="#000" strokeWidth={0.8} />
                    {label(`q${i}`)}
                  </g>
                );
              })}
            {me && (() => {
              const s = toScreen(me.x, me.z);
              const h = heading == null ? null : heading + eff;
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
      </div>
      <div className="radar-layers">
        {chip(layers.pmc, "pmc", t.radarLayerPmc, () => toggleLayer("pmc"))}
        {chip(showScav, "scav", t.radarLayerScav, () => onToggleScav(!showScav))}
        {chip(layers.transits, "transit", t.radarLayerTransits, () => toggleLayer("transits"))}
        {chip(layers.quests, "quest", t.radarLayerQuests, () => toggleLayer("quests"))}
      </div>
      {sel && (
        <div className="radar-mapsel">
          <b>{sel.name}</b> · {Math.round(dist(sel.p))}m
          {Math.abs(sel.p[1] - myY) >= 2.5 && <> · {sel.p[1] > myY ? "▲" : "▼"}{Math.round(Math.abs(sel.p[1] - myY))}m</>}
        </div>
      )}
    </div>
  );
}
