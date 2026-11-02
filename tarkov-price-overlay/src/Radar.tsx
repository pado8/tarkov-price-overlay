// 지도 패널(RadarMap + 대상 목록). 데이터는 사이드카 /radar(radar.py)가 계산한다 —
// 게임 스크린샷 파일명의 좌표·방향 + 게임 로그로 판정한 맵 + tarkov.dev 좌표.
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Strings as LiteralStrings } from "./i18n";
import { RadarMap, loadJson, LAYER_KEY, DEFAULT_LAYERS } from "./RadarMap";
import type { Layers } from "./RadarMap";
import { Icon } from "./Icon";

const GUIDE_URL = "https://tarkov.aquapado.com/guide/";
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
  keys?: string[]; // 목표에 필요한 열쇠(대체 열쇠는 ' / ')
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

// 지도 높이(px). 사용자가 슬라이더로 바꾸고 App 이 카드 폭을 여기에 맞춘다(창 폭 800 안에서 카드 최대 760).
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

const STALE_SEC = 15 * 60;
const COLORS: Record<string, string> = {
  extract: "var(--success)",
  scav: "#f0f0f0", // RadarMap.SCAV_COLOR 와 같게 — 회색은 묻힌다
  transit: "#6fa8dc",
  quest: "var(--gold-bright)",
};

const colorOf = (t: RadarTarget) =>
  t.kind === "extract" ? (t.faction === "scav" ? COLORS.scav : COLORS.extract) : COLORS[t.kind];

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

type Props = {
  data: RadarState | null;
  loading: boolean;
  t: Strings;
  lang: string;
  showScav: boolean;
  onToggleScav: (v: boolean) => void;
  onPickMap: (id: string | null) => void;
  onClose: () => void;
  size: number; // 지도 높이(px)
  onSize: (px: number) => void;
  fill?: boolean; // 패널이 크기를 정한다 — 크기 슬라이더 숨김
  highlightKey?: string | null; // 시세로 조회한 열쇠 — 지도에서 여는 문 강조
};

const FIXED_KEY = "tarkov.radar.fixed"; // "1" = 지도 고정(내 화살표가 돈다) · "0" = 바라보는 쪽이 위. 기본 고정

export function RadarPanel({ data, loading, t, lang, showScav, onToggleScav, onPickMap, onClose, size, onSize, fill, highlightKey }: Props) {
  const [fixed, setFixed] = useState<boolean>(() => localStorage.getItem(FIXED_KEY) !== "0");
  const [sizeDraft, setSizeDraft] = useState<number | null>(null); // 슬라이더를 끄는 동안의 값(적용 전)
  // 표시 필터(PMC 탈출구·트랜짓·퀘스트 + 스캐브는 showScav) — 지도 칩과 목록이 한 상태를 쓴다
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
  const pickFixed = (v: boolean) => {
    setFixed(v);
    try {
      localStorage.setItem(FIXED_KEY, v ? "1" : "0");
    } catch {}
  };
  const header = (
    <div className="radar-head">
      <span className="radar-title">
        <Icon name="map" /> {data?.map ? data.map.name : t.radarTitle}
        {data?.map_source === "manual" && <span className="radar-src"> · {t.radarManual}</span>}
      </span>
      {data?.shot && (
        <span className={`radar-age${data.shot.age > STALE_SEC ? " stale" : ""}`}>{ago(data.shot.age, t)}</span>
      )}
      <button className="settings-btn" onClick={onClose} title={t.radarClose}>
        <Icon name="back" />
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

  // 크기 슬라이더(지도 높이).
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

  // 목록은 지도와 같은 필터: 탈출구(PMC/공용 = pmc 칩, 스캐브 = showScav)·트랜짓·퀘스트(+개별 숨김)
  const visible = data.targets.filter((x) =>
    x.kind === "extract" ? (x.faction === "scav" ? showScav : layers.pmc)
    : x.kind === "transit" ? layers.transits
    : layers.quests && !hiddenSet.has(questKey(x)),
  );
  // 대상 목록(탈출구·트랜짓·진행 중 퀘스트 목표 요약) — 카드는 지도 아래, 나란히 패널은 지도 오른쪽 열
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
            {x.kind === "quest" &&
              x.keys?.map((k) => (
                <span className="radar-flag radar-key" key={k} title={t.radarKeyNeeded}>
                  {" "}
                  <Icon name="key" /> {k}
                </span>
              ))}
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
                <Icon name="book" />
              </button>
            )}
            {x.kind === "quest" && (
              <button type="button" className="radar-hide" onClick={() => hideQuest(x)} title={t.radarHideQuest} aria-label={t.radarHideQuest}>
                <Icon name="x" />
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
  return (
    <div className="radar">
      {header}
      {error(data, t)}
      {stale && <div className="radar-warn">{t.radarStale}</div>}
      {heading == null && <div className="hint">{t.radarDirUnknown}</div>}
      {fill ? (
        <div className="radar-maprow">
          <RadarMap data={data} lang={lang} t={t} showScav={showScav} onToggleScav={onToggleScav} layers={layers} onToggleLayer={toggleLayer} hiddenQuests={hiddenSet} size={size} fixed={fixed} highlightKey={highlightKey} />
          <div className="radar-side">{targetList}</div>
        </div>
      ) : (
        <>
          <RadarMap data={data} lang={lang} t={t} showScav={showScav} onToggleScav={onToggleScav} layers={layers} onToggleLayer={toggleLayer} hiddenQuests={hiddenSet} size={size} fixed={fixed} highlightKey={highlightKey} />
          {targetList}
        </>
      )}
      <div className="radar-foot">
        {mapPicker}
        {sizeCtl}
      </div>
      {fixedCtl}
      {/* 긴 사용법 안내는 접어 둔다 — 칩·슬라이더·맵 선택과 함께 한 화면에 있으면 하단이 복잡하다(11-02 점검) */}
      <details className="radar-help">
        <summary>{t.radarHelp}</summary>
        <div className="radar-note">{t.radarMapNote}</div>
      </details>
    </div>
  );
}

function error(data: RadarState, t: Strings) {
  return data.error ? <div className="radar-warn">{t.radarDataError}</div> : null;
}
