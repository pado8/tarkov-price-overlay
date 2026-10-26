// 레이더 2단계: 전체 지도. SVG 지도 그림(CC BY-NC-SA·치트 금지 조항)은 쓰지 않고
// 사이드카 /radar/map 이 tarkov.dev API 좌표로 추린 점·윤곽만 찍는다.
// 미니맵이라 1단계는 PMC 탈출구·스캐브 탈출구·트랜짓·퀘스트 위치만(각각 켜고 끔). 잠긴 문·위험·상자·스폰은 데이터만 받아 두고 아직 안 그린다.
// 좌표계: 게임 x → 오른쪽, 게임 z → 위. 북쪽이 어디인지는 보장하지 않으므로(맵마다 다름) 사용자가 90°씩 돌릴 수 있다.
import { useEffect, useMemo, useRef, useState } from "react";
import type { RadarState, RadarTarget } from "./Radar";

const PYTHON_API = "http://127.0.0.1:8765";
const ROT_KEY = "tarkov.radar.mapRot"; // {[slug]: 0|90|180|270}
const LAYER_KEY = "tarkov.radar.mapLayers";
const FLOOR_M = 5; // 이보다 높이 차가 크면 다른 층으로 보고 흐리게

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

export function RadarMap({ data, lang, t, showScav, onToggleScav }: Props) {
  const slug = data.map?.id ?? null;
  const [doc, setDoc] = useState<MapDoc | null>(slug ? cache.get(`${slug}|${lang}`) ?? null : null);
  const [err, setErr] = useState(false);
  const [layers, setLayers] = useState<Layers>(() => loadJson(LAYER_KEY, DEFAULT_LAYERS));
  const [rot, setRot] = useState<number>(() => (slug ? loadJson<Record<string, number>>(ROT_KEY, {})[slug] ?? 0 : 0));
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 270 });
  // 보기: 중심(게임 좌표)과 축척(px/m). 처음엔 내 위치 중심 150m 반경.
  const [view, setView] = useState<{ cx: number; cz: number; s: number } | null>(null);
  const [sel, setSel] = useState<{ name: string; p: Pt } | null>(null);
  const dragRef = useRef<{ x: number; y: number; cx: number; cz: number; moved: boolean } | null>(null);
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

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 300, h: el.clientHeight || 270 }));
    ro.observe(el);
    setSize({ w: el.clientWidth || 300, h: el.clientHeight || 270 });
    return () => ro.disconnect();
  }, []);

  const me = data.shot;
  const myY = me?.y ?? 0;

  // 기본 보기: 내 위치 중심, 짧은 변이 300m가 되게
  const baseView = useMemo(() => {
    if (!me) return null;
    const s = Math.min(size.w, size.h) / 300;
    return { cx: me.x, cz: me.z, s };
  }, [me?.x, me?.z, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = view ?? baseView;

  // 게임 좌표 → 화면. 회전은 중심 기준으로 먼저 돌린다.
  const toScreen = (gx: number, gz: number) => {
    if (!v) return { x: 0, y: 0 };
    const dx = gx - v.cx;
    const dz = gz - v.cz;
    const a = (rot * Math.PI) / 180;
    const rx = dx * Math.cos(a) - dz * Math.sin(a);
    const rz = dx * Math.sin(a) + dz * Math.cos(a);
    return { x: size.w / 2 + rx * v.s, y: size.h / 2 - rz * v.s };
  };

  const fit = () => {
    if (!doc?.bounds) return;
    const b = doc.bounds;
    const span = Math.max(b.maxx - b.minx, b.maxz - b.minz, 50) * 1.08;
    setView({ cx: (b.minx + b.maxx) / 2, cz: (b.minz + b.maxz) / 2, s: Math.min(size.w, size.h) / span });
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

  // 휠 확대(커서 위치 고정) · 끌어서 이동
  const onWheel = (e: React.WheelEvent) => {
    if (!v) return;
    e.preventDefault();
    const rect = wrapRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const f = e.deltaY < 0 ? 1.25 : 0.8;
    const ns = Math.min(8, Math.max(0.05, v.s * f));
    // 커서 아래 게임 좌표가 그대로 있도록 중심을 보정(회전 역변환)
    const a = (rot * Math.PI) / 180;
    const sx = (mx - size.w / 2) / v.s;
    const sy = -(my - size.h / 2) / v.s;
    const gx = v.cx + sx * Math.cos(a) + sy * Math.sin(a);
    const gz = v.cz - sx * Math.sin(a) + sy * Math.cos(a);
    const nsx = (mx - size.w / 2) / ns;
    const nsy = -(my - size.h / 2) / ns;
    setView({ cx: gx - (nsx * Math.cos(a) + nsy * Math.sin(a)), cz: gz - (-nsx * Math.sin(a) + nsy * Math.cos(a)), s: ns });
  };
  const onDown = (e: React.PointerEvent) => {
    if (!v) return;
    dragRef.current = { x: e.clientX, y: e.clientY, cx: v.cx, cz: v.cz, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !v) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    setDragging(true);
    const a = (rot * Math.PI) / 180;
    const sx = -dx / v.s;
    const sy = dy / v.s;
    setView({ cx: d.cx + sx * Math.cos(a) + sy * Math.sin(a), cz: d.cz - sx * Math.sin(a) + sy * Math.cos(a), s: v.s });
  };
  const onUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const dist = (p: Pt) => (me ? Math.hypot(p[0] - me.x, p[2] - me.z) : 0);
  const dim = (y: number) => (Math.abs(y - myY) > FLOOR_M ? 0.3 : 1);
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
    if (layers.quests) questTargets.forEach((q, i) => cands.push({ key: `q${i}`, text: q.objective || q.name, p: [q.x!, q.y ?? myY, q.z!], off: 6, pr: 0 }));
    cands
      .map((c) => ({ ...c, d: dist(c.p) }))
      .sort((a, b) => a.pr - b.pr || a.d - b.d)
      .forEach((c) => {
        const s = toScreen(c.p[0], c.p[2]);
        if (s.x < -20 || s.y < -20 || s.x > size.w + 20 || s.y > size.h + 20) return;
        const w = c.text.length * 5.4;
        const left = s.x + c.off + w > size.w - 2;
        const lx = left ? s.x - c.off - w : s.x + c.off;
        const box = { x1: lx, y1: s.y - 6, x2: lx + w, y2: s.y + 5 };
        if (boxes.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1)) return;
        boxes.push(box);
        labels.set(c.key, { text: c.text, lx, ly: s.y + 3 });
      });
  }
  const label = (key: string) => {
    const l = labels.get(key);
    return l ? <text x={l.lx} y={l.ly} className="radar-maplabel">{l.text}</text> : null;
  };

  const poly = (ol: [number, number][]) => ol.map((q) => { const s = toScreen(q[0], q[1]); return `${s.x.toFixed(1)},${s.y.toFixed(1)}`; }).join(" ");
  const scaleM = v ? [10, 25, 50, 100, 200, 500].find((m) => m * v.s >= 40) ?? 1000 : 0;

  return (
    <div className="radar-mapblock">
      <div
        ref={wrapRef}
        className={`radar-mapwrap${dragging ? " drag" : ""}`}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={centerMe}
      >
        {doc && v && (
          <svg className="radar-mapsvg" viewBox={`0 0 ${size.w} ${size.h}`} role="img" aria-label={doc.name}>
            {layers.transits &&
              doc.transits.map((x, i) => {
                const s = toScreen(x.p[0], x.p[2]);
                return (
                  <g key={`tr${i}`} onClick={() => setSel({ name: x.name, p: x.p })}>
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
                    <g key={`ex${i}`} onClick={() => setSel({ name: x.name, p: x.p })} opacity={dim(x.p[1]) < 1 ? 0.6 : 1}>
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
                  <g key={`q${i}`} onClick={() => setSel({ name: `${q.name}${q.objective ? " · " + q.objective : ""}`, p: [q.x!, q.y ?? myY, q.z!] })}>
                    <circle cx={s.x} cy={s.y} r={9} fill="transparent" />
                    <circle cx={s.x} cy={s.y} r={5} fill="#f0c040" stroke="#000" strokeWidth={0.8} opacity={dim(q.y ?? myY)} />
                    {label(`q${i}`)}
                  </g>
                );
              })}
            {me && (() => {
              const s = toScreen(me.x, me.z);
              const h = me.heading == null ? null : me.heading + rot;
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
          <button type="button" onClick={centerMe} title={t.radarMapMe}>⌖ {t.radarMapMe}</button>
          <button type="button" onClick={fit} title={t.radarMapFit}>{t.radarMapFit}</button>
          <button type="button" onClick={rotate} title={t.radarMapRotate}>↻</button>
        </div>
        {v && <div className="radar-mapscale">━ {scaleM}m</div>}
      </div>
      <div className="radar-layers">
        <label>
          <input type="checkbox" checked={layers.pmc} onChange={() => toggleLayer("pmc")} /> <span className="radar-sw pmc" /> {t.radarLayerPmc}
        </label>
        <label>
          <input type="checkbox" checked={showScav} onChange={(e) => onToggleScav(e.target.checked)} /> <span className="radar-sw scav" /> {t.radarLayerScav}
        </label>
        <label>
          <input type="checkbox" checked={layers.transits} onChange={() => toggleLayer("transits")} /> <span className="radar-sw transit" /> {t.radarLayerTransits}
        </label>
        <label>
          <input type="checkbox" checked={layers.quests} onChange={() => toggleLayer("quests")} /> <span className="radar-sw quest" /> {t.radarLayerQuests}
        </label>
      </div>
      <div className="radar-mapsel">
        {sel ? (
          <>
            <b>{sel.name}</b> · {Math.round(dist(sel.p))}m
            {Math.abs(sel.p[1] - myY) >= 2.5 && <> · {sel.p[1] > myY ? "▲" : "▼"}{Math.round(Math.abs(sel.p[1] - myY))}m</>}
          </>
        ) : (
          <span className="radar-kind">{t.radarMapHint}</span>
        )}
      </div>
    </div>
  );
}
