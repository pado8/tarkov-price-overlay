// 레이더(미니맵 1단계) 화면. 데이터는 사이드카 /radar(radar.py)가 계산한다 —
// 게임 스크린샷 파일명의 좌표·방향 + 게임 로그로 판정한 맵 + tarkov.dev 좌표.
// '내가 바라보는 쪽 = 위' 기준이라 지도 북쪽 방위는 쓰지 않는다(맵마다 회전이 달라 틀릴 위험).
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Strings as LiteralStrings } from "./i18n";
import { RadarMap, loadMapRot, useMapDoc, imageMatrix, autoFloor, loadJson, LAYER_KEY, DEFAULT_LAYERS } from "./RadarMap";
import type { Layers } from "./RadarMap";

const PYTHON_API = "http://127.0.0.1:8765";
const GUIDE_URL = "https://tarkov.aquapado.com/guide/";
const RADAR_IMG_KEY = "tarkov.radar.radarImg"; // "0" = 레이더 원 안 지도 배경 끔
const HIDDEN_Q_KEY = "tarkov.radar.hiddenQuests"; // 사용자가 목록에서 ✕ 로 숨긴 퀘스트 [{id, name}] — 맵과 무관하게 유지, 복원 전까지
type HiddenQuest = { id: string; name: string };
function loadHidden(): HiddenQuest[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_Q_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string") : [];
  } catch {
    return [];
  }
}

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
  cond?: string[]; // 탈출구 조건 태그(python-core/extract_conditions.py, 위키 기준)
  dest?: string | null; // 트랜짓 목적지
  objective?: string;
  optional?: boolean;
  task?: string;
  slug?: string; // 가이드 퀘스트 페이지 slug(tarkov.dev normalizedName)
  // 전체 지도용 게임 좌표(2단계)
  x?: number;
  y?: number;
  z?: number;
};

export type RadarState = {
  folder: string | null;
  shot: { id: string; ts: number; age: number; x: number; y: number; z: number; heading: number | null } | null;
  map: { id: string; name: string; rot?: number } | null; // rot = tarkov.dev 지도 기준 기본 회전
  map_source: "log" | "manual" | null;
  targets: RadarTarget[];
  maps: { id: string; name: string }[];
  light?: boolean;
  error?: string;
  active_quests?: number;
};

// 레이더 지름 = 지도 높이(px). 사용자가 슬라이더로 바꾸고 App 이 카드 폭을 여기에 맞춘다(창 폭 800 안에서 카드 최대 760).
export const RADAR_SIZE_KEY = "tarkov.radar.size";
export const RADAR_SIZE_MIN = 160;
export const RADAR_SIZE_MAX = 600;
export const RADAR_SIZE_DEFAULT = 240;
export function loadRadarSize(): number {
  try {
    const n = parseInt(localStorage.getItem(RADAR_SIZE_KEY) ?? "", 10);
    if (Number.isFinite(n)) return Math.max(RADAR_SIZE_MIN, Math.min(RADAR_SIZE_MAX, n));
  } catch {}
  return RADAR_SIZE_DEFAULT;
}

const RANGES = [25, 50, 100, 200, 400, 800, 1600];
const STALE_SEC = 15 * 60;
const COLORS: Record<string, string> = {
  extract: "var(--success)",
  scav: "#f0f0f0", // RadarMap.SCAV_COLOR 와 같게 — 회색은 묻힌다
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

// 탈출구 조건 태그 → 짧은 표시. vex(차량)는 유료와 겹쳐 따로 안 쓴다. 옛 사이드카(cond 없음)는 switch/paid로
const COND_KEYS: [string, keyof Strings][] = [
  ["lever", "radarSwitch"], ["key", "radarKey"], ["flare", "radarFlare"], ["item", "radarItem"], ["paid", "radarPaid"],
  ["coop", "radarCoop"], ["nobag", "radarNoBag"], ["climb", "radarClimb"], ["time", "radarTime"],
];
function condLabels(x: RadarTarget, t: Strings): string[] {
  const tags = x.cond ?? [...(x.switch ? ["lever"] : []), ...(x.paid ? ["paid"] : [])];
  return COND_KEYS.filter(([k]) => tags.includes(k)).map(([, s]) => t[s]);
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
  size: number; // 레이더 지름 = 지도 높이(px)
  onSize: (px: number) => void;
  forceMode?: "radar" | "map"; // 지도 나란히 패널: 탭 없이 이 모드만
  fill?: boolean; // 패널이 크기를 정한다 — 크기 슬라이더 숨김
};

const MODE_KEY = "tarkov.radar.mode"; // "radar" | "map"
const FIXED_KEY = "tarkov.radar.fixed"; // "1" = 지도 고정(내 화살표가 돈다) · "0" = 바라보는 쪽이 위. 레이더·지도 탭 공통, 기본 고정

export function RadarPanel({ data, loading, t, lang, showScav, onToggleScav, onPickMap, onClose, size, onSize, forceMode, fill }: Props) {
  const [modeState, setMode] = useState<"radar" | "map">(() => (localStorage.getItem(MODE_KEY) === "map" ? "map" : "radar"));
  const mode = forceMode ?? modeState;
  const [fixed, setFixed] = useState<boolean>(() => localStorage.getItem(FIXED_KEY) !== "0");
  const [sizeDraft, setSizeDraft] = useState<number | null>(null); // 슬라이더를 끄는 동안의 값(적용 전)
  const [radarImg, setRadarImg] = useState<boolean>(() => localStorage.getItem(RADAR_IMG_KEY) !== "0");
  const toggleRadarImg = (v: boolean) => {
    setRadarImg(v);
    try {
      localStorage.setItem(RADAR_IMG_KEY, v ? "1" : "0");
    } catch {}
  };
  // 표시 필터(PMC 탈출구·트랜짓·퀘스트 + 스캐브는 showScav) — 지도 칩과 목록·레이더 원이 한 상태를 쓴다
  const [layers, setLayers] = useState<Layers>(() => loadJson(LAYER_KEY, DEFAULT_LAYERS));
  const toggleLayer = (k: keyof Layers) =>
    setLayers((L) => {
      const n = { ...L, [k]: !L[k] };
      try {
        localStorage.setItem(LAYER_KEY, JSON.stringify(n));
      } catch {}
      return n;
    });
  // 퀘스트 개별 숨김: 목록의 ✕ 로 숨기고, '숨긴 퀘스트 n개' 줄에서 하나씩·전부 복원
  const [hiddenQ, setHiddenQ] = useState<HiddenQuest[]>(loadHidden);
  const [showHidden, setShowHidden] = useState(false);
  const saveHidden = (list: HiddenQuest[]) => {
    setHiddenQ(list);
    try {
      localStorage.setItem(HIDDEN_Q_KEY, JSON.stringify(list));
    } catch {}
  };
  const questKey = (x: RadarTarget) => x.task ?? x.name;
  const hiddenSet = new Set(hiddenQ.map((h) => h.id));
  const hideQuest = (x: RadarTarget) => {
    const id = questKey(x);
    if (!hiddenSet.has(id)) saveHidden([...hiddenQ, { id, name: x.name }]);
  };
  const restoreQuest = (id: string) => saveHidden(hiddenQ.filter((h) => h.id !== id));
  const chip = (on: boolean, k: string, text: string, onClick: () => void) => (
    <button type="button" className={`radar-chip${on ? " on" : ""}`} aria-pressed={on} onClick={onClick}>
      <span className={`radar-sw ${k}`} /> {text}
    </button>
  );
  const layerChips = (
    <>
      {chip(layers.pmc, "pmc", t.radarLayerPmc, () => toggleLayer("pmc"))}
      {chip(showScav, "scav", t.radarLayerScav, () => onToggleScav(!showScav))}
      {chip(layers.transits, "transit", t.radarLayerTransits, () => toggleLayer("transits"))}
      {chip(layers.quests, "quest", t.radarLayerQuests, () => toggleLayer("quests"))}
    </>
  );
  // 레이더 원 안 배경(건물·도로 윤곽 정도만 보이게 흐리게) — 지도 탭과 같은 문서·그림을 쓴다
  const { doc: mapDoc } = useMapDoc(data?.map?.id ?? null, lang);
  const pickFixed = (v: boolean) => {
    setFixed(v);
    try {
      localStorage.setItem(FIXED_KEY, v ? "1" : "0");
    } catch {}
  };
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
      {data?.map && data.shot && !forceMode && (
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

  // 크기 슬라이더(레이더 지름 = 지도 높이). 두 탭이 같은 값을 쓴다
  // 끄는 동안은 숫자만 미리 보여주고 손을 뗄 때 적용한다 — 바로 적용하면 카드가 넓어지며 슬라이더가 커서 밑에서 움직여
  // 값이 다시 바뀌는 되먹임(띡띡 튐)이 생긴다. 키보드(화살표)는 키를 뗄 때마다 적용.
  const commitSize = () => {
    if (sizeDraft != null) {
      if (sizeDraft !== size) onSize(sizeDraft);
      setSizeDraft(null);
    }
  };
  const shown = sizeDraft ?? size;
  const sizeCtl = fill ? null : (
    <label className="radar-size" title={`${t.radarSize} ${shown}px`}>
      <span>{t.radarSize}</span>
      <input
        type="range"
        min={RADAR_SIZE_MIN}
        max={RADAR_SIZE_MAX}
        step={20}
        value={shown}
        onChange={(e) => setSizeDraft(Number(e.target.value))}
        onPointerUp={commitSize}
        onLostPointerCapture={commitSize}
        onKeyUp={commitSize}
        onBlur={commitSize}
        aria-label={t.radarSize}
      />
      <span className="radar-size-val">{shown}</span>
    </label>
  );
  const fixedCtl = (
    <label className="radar-chk" title={t.radarFixedHint}>
      <input type="checkbox" checked={fixed} onChange={(e) => pickFixed(e.target.checked)} /> {t.radarFixed}
    </label>
  );

  // 목록·레이더 원 모두 지도와 같은 필터: 탈출구(PMC/공용 = pmc 칩, 스캐브 = showScav)·트랜짓·퀘스트(+개별 숨김)
  const visible = data.targets.filter((x) =>
    x.kind === "extract" ? (x.faction === "scav" ? showScav : layers.pmc)
    : x.kind === "transit" ? layers.transits
    : layers.quests && !hiddenSet.has(questKey(x)),
  );
  // 대상 목록(탈출구·트랜짓·진행 중 퀘스트 목표 요약) — 레이더 탭 아래와 지도 모드(카드는 지도 아래, 나란히 패널은 지도 오른쪽 열)에 같이 쓴다
  const heading = data.shot.heading;
  const stale = data.shot.age > STALE_SEC;
  const listMax = fill ? 30 : 8;
  const targetList = (
    <div className="radar-list">
      {visible.length === 0 && <div className="hint">{t.radarNoTargets}</div>}
      {visible.slice(0, listMax).map((x, i) => (
        <div className="radar-row" key={`${x.kind}-${x.name}-${i}`}>
          <span className="radar-dot" style={{ background: colorOf(x) }} />
          <span className="radar-name">
            <span className="radar-kind">
              {x.kind === "extract" ? t.radarExtract : x.kind === "transit" ? t.radarTransit : t.radarQuest}
            </span>{" "}
            {x.name}
            {x.kind === "quest" && x.objective && <span className="radar-sub">{x.objective}</span>}
            {condLabels(x, t).map((c) => (
              <span className="radar-flag" key={c}>
                {" "}
                {c}
              </span>
            ))}
            {x.kind === "quest" && x.slug && (
              <button
                type="button"
                className="radar-hide radar-guide"
                onClick={() => void openUrl(`${GUIDE_URL}quest/${x.slug}/`).catch(() => {})}
                title={t.radarOpenGuide}
                aria-label={t.radarOpenGuide}
              >
                📖
              </button>
            )}
            {x.kind === "quest" && (
              <button type="button" className="radar-hide" onClick={() => hideQuest(x)} title={t.radarHideQuest} aria-label={t.radarHideQuest}>
                ✕
              </button>
            )}
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
      {hiddenQ.length > 0 && (
        <div className="radar-hidden">
          <button type="button" className="radar-link" onClick={() => setShowHidden((v) => !v)} aria-expanded={showHidden}>
            {t.radarHiddenQuests.replace("{n}", String(hiddenQ.length))} {showHidden ? "▴" : "▾"}
          </button>
          {showHidden && (
            <>
              {hiddenQ.map((h) => (
                <div className="radar-hidden-row" key={h.id}>
                  <span className="radar-name">{h.name}</span>
                  <button type="button" className="radar-link" onClick={() => restoreQuest(h.id)}>{t.radarRestore}</button>
                </div>
              ))}
              <button type="button" className="radar-link" onClick={() => saveHidden([])}>{t.radarRestoreAll}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
  if (mode === "map") {
    return (
      <div className="radar">
        {header}
        {error(data, t)}
        {stale && <div className="radar-warn">{t.radarStale}</div>}
        {fill ? (
          <div className="radar-maprow">
            <RadarMap data={data} lang={lang} t={t} showScav={showScav} onToggleScav={onToggleScav} layers={layers} onToggleLayer={toggleLayer} hiddenQuests={hiddenSet} size={size} fixed={fixed} />
            <div className="radar-side">{targetList}</div>
          </div>
        ) : (
          <>
            <RadarMap data={data} lang={lang} t={t} showScav={showScav} onToggleScav={onToggleScav} layers={layers} onToggleLayer={toggleLayer} hiddenQuests={hiddenSet} size={size} fixed={fixed} />
            {targetList}
          </>
        )}
        <div className="radar-foot">
          {mapPicker}
          {sizeCtl}
        </div>
        {fixedCtl}
        <div className="radar-note">{t.radarMapNote}</div>
      </div>
    );
  }
  const range = pickRange(visible);
  const S = size; // SVG 한 변(px) — 글자·점 크기는 고정, 원만 커진다
  const C = S / 2; // 중심
  const R = C - 10; // 원 반지름(px)
  // 고정 모드: 점은 절대 방위(바라보는 방향 + 상대각 + 지도 탭과 같은 90° 회전)에 놓고 내 화살표를 돌린다.
  // 바라보는 쪽 위 모드: 점은 상대각 그대로, 화살표는 항상 위.
  const mapRot = loadMapRot(data.map?.id, data.map?.rot ?? 0);
  // 지도 탭과 같은 규약: 세계를 반시계로 eff 만큼 돌리면 방위 β 는 화면 각 β − eff. 고정 모드 eff = mapRot → 점은 rel + heading − mapRot, 화살표도 heading − mapRot
  const base = fixed && heading != null ? heading - mapRot : 0;
  // 배경 지도: 레이더 좌표계(중심 = 나, 축척 = R/range px/m, 회전 = 고정이면 mapRot, 아니면 바라보는 쪽 위)
  const bgImg = (() => {
    const im = mapDoc?.img;
    if (!radarImg || !im || !data.shot) return null;
    const eff = fixed ? mapRot : heading ?? 0;
    const a = (eff * Math.PI) / 180;
    const k = R / range;
    const me = data.shot;
    const toScreen = (gx: number, gz: number) => {
      const dx = gx - me.x, dz = gz - me.z;
      const rx = dx * Math.cos(a) - dz * Math.sin(a);
      const rz = dx * Math.sin(a) + dz * Math.cos(a);
      return { x: C + rx * k, y: C - rz * k };
    };
    const mx = imageMatrix(im, toScreen);
    if (!mx) return null;
    const floor = autoFloor(im.layers, me.x, me.y, me.z);
    const href = `${PYTHON_API}${im.url}` + (floor ? `&layer=${encodeURIComponent(floor)}` : "");
    return <image href={href} width={mx.W} height={mx.H} preserveAspectRatio="none" transform={`matrix(${mx.matrix})`} clipPath="url(#radar-clip)" className="radar-bg" />;
  })();

  // 점 위치 + 이름표 자리 잡기: 가까운 것부터(원이 클수록 더 많이·더 길게), 이미 놓인 이름표·내 화살표와 겹치면 생략
  const maxLabels = Math.max(5, Math.round(S / 40));
  const nameLen = Math.max(11, Math.round(S / 18));
  const dots = visible.map((x) => {
    if (x.rel == null) return null;
    const r = Math.min(x.dist / range, 1) * R;
    const a = ((x.rel + base) * Math.PI) / 180;
    return { x, out: x.dist > range, px: C + Math.sin(a) * r, py: C - Math.cos(a) * r };
  });
  const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [{ x1: C - 9, y1: C - 10, x2: C + 9, y2: C + 8 }];
  const labels = new Map<number, { text: string; lx: number; ly: number }>();
  dots.forEach((d, i) => {
    if (!d || labels.size >= maxLabels) return;
    const text = short(d.x.name, nameLen); // 퀘스트도 이름으로 — 목표 문장은 길어서 원 위에선 잘린다(목록에 두 줄로 나옴)
    const w = text.length * 5.6;
    const left = d.px + 6 + w > S - 2; // 오른쪽 끝이면 점 왼쪽에 붙인다
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
      <svg className="radar-svg" viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="img" aria-label={t.radarTitle}>
        <defs>
          <clipPath id="radar-clip"><circle cx={C} cy={C} r={R} /></clipPath>
        </defs>
        {bgImg}
        <circle cx={C} cy={C} r={R} className="radar-ring" />
        <circle cx={C} cy={C} r={R / 2} className="radar-ring" />
        <line x1={C} y1={C - R} x2={C} y2={C + R} className="radar-axis" />
        <line x1={C - R} y1={C} x2={C + R} y2={C} className="radar-axis" />
        <text x={C + 3} y={C - R / 2 - 3} className="radar-scale">{range / 2}m</text>
        <text x={C + 3} y={C - R + 9} className="radar-scale">{range}m</text>
        {fixed && heading != null && <text x={C} y={C - R - 1} className="radar-scale" textAnchor="middle">▲</text>}
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
          <path d={`M ${C} ${C - 8} L ${C + 6} ${C + 6} L ${C} ${C + 3} L ${C - 6} ${C + 6} Z`} className="radar-me" transform={base ? `rotate(${base} ${C} ${C})` : undefined} />
        ) : (
          <circle cx={C} cy={C} r={5} className="radar-me" />
        )}
      </svg>
      {heading == null && <div className="hint">{t.radarDirUnknown}</div>}
      {targetList}
      <div className="radar-layers">{layerChips}</div>
      <div className="radar-foot">{mapPicker}</div>
      <div className="radar-foot">
        {fixedCtl}
        {sizeCtl}
      </div>
      {mapDoc?.img && (
        <label className="radar-chk" title={t.radarImgBgHint}>
          <input type="checkbox" checked={radarImg} onChange={(e) => toggleRadarImg(e.target.checked)} /> {t.radarImgBg}
        </label>
      )}
      <div className="radar-note">{fixed ? t.radarNoteFixed : t.radarNote}{radarImg && mapDoc?.img ? ` · ${t.radarImgCredit}` : ""}</div>
    </div>
  );
}

function error(data: RadarState, t: Strings) {
  return data.error ? <div className="radar-warn">{t.radarDataError}</div> : null;
}
