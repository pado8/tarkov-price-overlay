// 레이더(미니맵 1단계) 화면. 데이터는 사이드카 /radar(radar.py)가 계산한다 —
// 게임 스크린샷 파일명의 좌표·방향 + 게임 로그로 판정한 맵 + tarkov.dev 좌표.
// '내가 바라보는 쪽 = 위' 기준이라 지도 북쪽 방위는 쓰지 않는다(맵마다 회전이 달라 틀릴 위험).
import { useState } from "react";
import type { Strings as LiteralStrings } from "./i18n";
import { RadarMap } from "./RadarMap";

// i18n은 글자 값까지 고정된 타입이라 언어별 객체가 서로 대입되지 않는다 — 키만 맞으면 되게 넓힌다
type Strings = { [K in keyof LiteralStrings]: string };

export type RadarTarget = {
  kind: "extract" | "transit" | "quest";
  name: string;
  dist: number;
  rel: number | null; // 0 = 정면, +90 = 오른쪽, -90 = 왼쪽
  dy: number; // 대상 높이 - 내 높이 (m)
  faction?: string; // 탈출구: pmc | scav | shared
  switch?: boolean;
  paid?: boolean;
  dest?: string | null; // 트랜짓 목적지
  objective?: string;
  optional?: boolean;
  task?: string;
  // 전체 지도용 게임 좌표(2단계)
  x?: number;
  y?: number;
  z?: number;
};

export type RadarState = {
  folder: string | null;
  shot: { id: string; ts: number; age: number; x: number; y: number; z: number; heading: number | null } | null;
  map: { id: string; name: string } | null;
  map_source: "log" | "manual" | null;
  targets: RadarTarget[];
  maps: { id: string; name: string }[];
  light?: boolean;
  error?: string;
  active_quests?: number;
};

const RANGES = [25, 50, 100, 200, 400, 800, 1600];
const STALE_SEC = 15 * 60;
const COLORS: Record<string, string> = {
  extract: "var(--success)",
  scav: "#9a9a9a",
  transit: "#6fa8dc",
  quest: "var(--gold-bright)",
};

const colorOf = (t: RadarTarget) =>
  t.kind === "extract" ? (t.faction === "scav" ? COLORS.scav : COLORS.extract) : COLORS[t.kind];

/** 가까운 대상 몇 개가 원 안에 들어오는 가장 작은 거리 단계 */
function pickRange(ts: RadarTarget[]): number {
  if (!ts.length) return 100;
  const ref = ts[Math.min(3, ts.length - 1)].dist * 1.1;
  return RANGES.find((r) => r >= ref) ?? RANGES[RANGES.length - 1];
}

function ago(sec: number, t: Strings): string {
  if (sec < 60) return t.radarAgoNow;
  if (sec < 3600) return t.radarAgoMin.replace("{n}", String(Math.floor(sec / 60)));
  return t.radarAgoHour.replace("{n}", String(Math.floor(sec / 3600)));
}

const short = (s: string, n = 11) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

type Props = {
  data: RadarState | null;
  loading: boolean;
  t: Strings;
  lang: string;
  showScav: boolean;
  onToggleScav: (v: boolean) => void;
  onPickMap: (id: string | null) => void;
  onClose: () => void;
};

const MODE_KEY = "tarkov.radar.mode"; // "radar" | "map"

export function RadarPanel({ data, loading, t, lang, showScav, onToggleScav, onPickMap, onClose }: Props) {
  const [mode, setMode] = useState<"radar" | "map">(() => (localStorage.getItem(MODE_KEY) === "map" ? "map" : "radar"));
  const pickMode = (m: "radar" | "map") => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  };
  const header = (
    <div className="radar-head">
      <span className="radar-title">
        🧭 {data?.map ? data.map.name : t.radarTitle}
        {data?.map_source === "manual" && <span className="radar-src"> · {t.radarManual}</span>}
      </span>
      {data?.map && data.shot && (
        <span className="radar-tabs" role="tablist">
          <button type="button" role="tab" className={`radar-tab${mode === "radar" ? " on" : ""}`} onClick={() => pickMode("radar")}>{t.radarModeRadar}</button>
          <button type="button" role="tab" className={`radar-tab${mode === "map" ? " on" : ""}`} onClick={() => pickMode("map")}>{t.radarModeMap}</button>
        </span>
      )}
      {data?.shot && (
        <span className={`radar-age${data.shot.age > STALE_SEC ? " stale" : ""}`}>{ago(data.shot.age, t)}</span>
      )}
      <button className="settings-btn" onClick={onClose} title={t.radarClose}>
        ↩
      </button>
    </div>
  );

  if (!data) {
    return (
      <div className="radar">
        {header}
        <div className="hint">{loading ? t.hintLoading : t.radarNoShot}</div>
      </div>
    );
  }
  if (!data.folder) {
    return (
      <div className="radar">
        {header}
        <div className="hint">{t.radarNoFolder}</div>
      </div>
    );
  }
  if (!data.shot) {
    return (
      <div className="radar">
        {header}
        <div className="hint">{t.radarNoShot}</div>
      </div>
    );
  }

  const mapPicker = (
    <select
      className="radar-map"
      value={data.map_source === "manual" && data.map ? data.map.id : ""}
      onChange={(e) => onPickMap(e.target.value || null)}
      aria-label={t.radarPickMap}
    >
      <option value="">{data.map_source === "log" ? `${t.radarFromLog}: ${data.map?.name}` : t.radarPickMap}</option>
      {data.maps.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );

  if (!data.map) {
    return (
      <div className="radar">
        {header}
        <div className="hint">{t.radarNoMap}</div>
        {mapPicker}
      </div>
    );
  }

  const visible = data.targets.filter((x) => showScav || !(x.kind === "extract" && x.faction === "scav"));
  if (mode === "map") {
    return (
      <div className="radar">
        {header}
        {error(data, t)}
        <RadarMap data={data} lang={lang} t={t} showScav={showScav} onToggleScav={onToggleScav} />
        <div className="radar-foot">{mapPicker}</div>
        <div className="radar-note">{t.radarMapNote}</div>
      </div>
    );
  }
  const range = pickRange(visible);
  const R = 92; // 원 반지름(px)
  const C = 100; // 중심
  const stale = data.shot.age > STALE_SEC;
  const heading = data.shot.heading;

  // 점 위치 + 이름표 자리 잡기: 가까운 것부터 최대 5개, 이미 놓인 이름표·내 화살표와 겹치면 생략
  const dots = visible.map((x) => {
    if (x.rel == null) return null;
    const r = Math.min(x.dist / range, 1) * R;
    const a = (x.rel * Math.PI) / 180;
    return { x, out: x.dist > range, px: C + Math.sin(a) * r, py: C - Math.cos(a) * r };
  });
  const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [{ x1: C - 9, y1: C - 10, x2: C + 9, y2: C + 8 }];
  const labels = new Map<number, { text: string; lx: number; ly: number }>();
  dots.forEach((d, i) => {
    if (!d || labels.size >= 5) return;
    const text = short(d.x.name); // 퀘스트도 이름으로 — 목표 문장은 길어서 원 위에선 잘린다(목록에 두 줄로 나옴)
    const w = text.length * 5.6;
    const left = d.px + 6 + w > 198; // 오른쪽 끝이면 점 왼쪽에 붙인다
    const lx = left ? d.px - 6 - w : d.px + 6;
    const box = { x1: lx, y1: d.py - 6, x2: lx + w, y2: d.py + 5 };
    if (boxes.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1)) return;
    boxes.push(box);
    labels.set(i, { text, lx, ly: d.py + 3 });
  });

  return (
    <div className={`radar${stale ? " radar-stale" : ""}`}>
      {header}
      {error(data, t)}
      {stale && <div className="radar-warn">{t.radarStale}</div>}
      <svg className="radar-svg" viewBox="0 0 200 200" width="200" height="200" role="img" aria-label={t.radarTitle}>
        <circle cx={C} cy={C} r={R} className="radar-ring" />
        <circle cx={C} cy={C} r={R / 2} className="radar-ring" />
        <line x1={C} y1={C - R} x2={C} y2={C + R} className="radar-axis" />
        <line x1={C - R} y1={C} x2={C + R} y2={C} className="radar-axis" />
        <text x={C + 3} y={C - R / 2 - 3} className="radar-scale">{range / 2}m</text>
        <text x={C + 3} y={C - R + 9} className="radar-scale">{range}m</text>
        {heading != null &&
          dots
            .map((d, i) => {
              if (!d) return null;
              const lab = labels.get(i);
              return (
                <g key={`${d.x.kind}-${d.x.name}-${i}`}>
                  <circle
                    cx={d.px}
                    cy={d.py}
                    r={d.x.kind === "quest" ? 4.5 : 4}
                    fill={d.out ? "none" : colorOf(d.x)}
                    stroke={colorOf(d.x)}
                    strokeWidth={d.out ? 1.5 : 1}
                  />
                  {lab && (
                    <text x={lab.lx} y={lab.ly} className="radar-label">
                      {lab.text}
                    </text>
                  )}
                </g>
              );
            })
            .reverse() /* 가까운 것이 위에 그려지게 */}
        {heading != null ? (
          <path d={`M ${C} ${C - 8} L ${C + 6} ${C + 6} L ${C} ${C + 3} L ${C - 6} ${C + 6} Z`} className="radar-me" />
        ) : (
          <circle cx={C} cy={C} r={5} className="radar-me" />
        )}
      </svg>
      {heading == null && <div className="hint">{t.radarDirUnknown}</div>}
      <div className="radar-list">
        {visible.length === 0 && <div className="hint">{t.radarNoTargets}</div>}
        {visible.slice(0, 8).map((x, i) => (
          <div className="radar-row" key={`${x.kind}-${x.name}-${i}`}>
            <span className="radar-dot" style={{ background: colorOf(x) }} />
            <span className="radar-name">
              <span className="radar-kind">
                {x.kind === "extract" ? t.radarExtract : x.kind === "transit" ? t.radarTransit : t.radarQuest}
              </span>{" "}
              {x.name}
              {x.kind === "quest" && x.objective && <span className="radar-sub">{x.objective}</span>}
              {x.switch && <span className="radar-flag"> {t.radarSwitch}</span>}
              {x.paid && <span className="radar-flag"> {t.radarPaid}</span>}
            </span>
            <span className="radar-dist">{Math.round(x.dist)}m</span>
            {x.rel != null && heading != null && (
              <span className="radar-arrow" style={{ transform: `rotate(${x.rel}deg)` }} aria-hidden="true">
                ↑
              </span>
            )}
            {Math.abs(x.dy) >= 2.5 && (
              <span className={`radar-dy ${x.dy > 0 ? "up" : "down"}`}>
                {x.dy > 0 ? "▲" : "▼"}
                {Math.round(Math.abs(x.dy))}m
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="radar-foot">
        <label className="radar-chk">
          <input type="checkbox" checked={showScav} onChange={(e) => onToggleScav(e.target.checked)} /> {t.radarScav}
        </label>
        {mapPicker}
      </div>
      <div className="radar-note">{t.radarNote}</div>
    </div>
  );
}

function error(data: RadarState, t: Strings) {
  return data.error ? <div className="radar-warn">{t.radarDataError}</div> : null;
}
