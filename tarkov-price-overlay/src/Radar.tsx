// 지도 패널(RadarMap + 대상 목록). 데이터는 사이드카 /radar(radar.py)가 계산한다 —
// 게임 스크린샷 파일명의 좌표·방향 + 게임 로그로 판정한 맵 + tarkov.dev 좌표.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Strings as LiteralStrings } from "./i18n";
import { RadarMap, loadJson, LAYER_KEY, DEFAULT_LAYERS } from "./RadarMap";
import type { Layers } from "./RadarMap";
import { Icon } from "./Icon";
import { type useParty, type Friend, normCode, validCode, defaultPartyName } from "./party";
import { friendAgo } from "./RadarMap";

type PartyApi = ReturnType<typeof useParty>;

const GUIDE_URL = "https://tarkov.aquapado.com/guide/";
// 카드(App.tsx guideUrl)와 같은 규칙: UI 언어별 가이드 + src=app(GA4 앱발 방문 표식)
const guideQuestUrl = (lang: string, slug: string) =>
  `${GUIDE_URL}${lang === "ko" ? "" : `${lang}/`}quest/${slug}/?src=app`;
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
  story?: string; // 스토리(메인 퀘스트) 목표면 챕터 id — 사용자가 고른 챕터만 온다
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
  story_chapters?: { id: string; name: string }[]; // 스토리 챕터 선택 목록(스토리 순)
  story_auto?: string[]; // '자동' 일 때 로그로 추정한 진행 중 챕터 id 들(없으면 빈 배열)
};

// 지도 높이(px). 사용자가 슬라이더로 바꾸고 App 이 카드 폭을 여기에 맞춘다(창 폭 800 안에서 카드 최대 760).
export const RADAR_SIZE_KEY = "tarkov.radar.size";
export const RADAR_SIZE_MIN = 160;
export const RADAR_SIZE_MAX = 600;
export const RADAR_SIZE_DEFAULT = 240;
// 미니맵 모드(11-05 피드백 '진짜 미니맵처럼 게임 위에') — 정사각형 지도만. 크기·켜짐·지도 불투명도는 따로 저장
export const RADAR_MINI_KEY = "tarkov.radar.mini";
export const RADAR_MINI_SIZE_KEY = "tarkov.radar.miniSize";
export const RADAR_MAP_ALPHA_KEY = "tarkov.radar.mapAlpha"; // 0~100, 지도 그림·바탕만(표식은 그대로)
export const RADAR_PIP_POS_KEY = "tarkov.radar.pipPos"; // 미니맵(작은 지도 창)을 끌어 옮긴 위치(물리 px) — 11-06 PiP 를 미니맵 모드로 합침, 키 이름은 그대로
export const RADAR_MINI_MIN = 100;
export const RADAR_MINI_MAX = 600;
export const RADAR_MINI_DEFAULT = 220;
function loadNum(key: string, lo: number, hi: number, dflt: number): number {
  try {
    const n = parseInt(localStorage.getItem(key) ?? "", 10);
    if (Number.isFinite(n)) return Math.max(lo, Math.min(hi, n));
  } catch {}
  return dflt;
}
export const loadMiniSize = () => loadNum(RADAR_MINI_SIZE_KEY, RADAR_MINI_MIN, RADAR_MINI_MAX, RADAR_MINI_DEFAULT);
export const loadMapAlpha = () => loadNum(RADAR_MAP_ALPHA_KEY, 0, 100, 100);
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
  story: "#d6a6ff", // RadarMap 의 스토리 점과 같은 보라
};

const colorOf = (t: RadarTarget) =>
  t.kind === "extract" ? (t.faction === "scav" ? COLORS.scav : COLORS.extract) : t.kind === "quest" && t.story ? COLORS.story : COLORS[t.kind];

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
  story: string; // 지도에 띄울 스토리 챕터 id("" = 안 띄움)
  onPickStory: (id: string) => void;
  mini?: boolean; // 미니맵 모드(카드 안에서만 — 나란히 패널은 안 씀)
  onMini?: (v: boolean) => void;
  miniSize?: number;
  onMiniSize?: (px: number) => void;
  mapAlpha?: number; // 0~100
  onMapAlpha?: (v: number) => void;
  dragRegion?: boolean; // 미니맵 옮기기 손잡이를 창 끌기 영역으로(고정 모드면 false)
  party?: PartyApi; // 파티 방(친구 위치 공유) — 없으면 버튼도 없음
};

const BIGME_KEY = "tarkov.radar.bigMe"; // "1" = 내 위치 크게(11-04)
const FIXED_KEY = "tarkov.radar.fixed"; // "1" = 지도 고정(내 화살표가 돈다) · "0" = 바라보는 쪽이 위. 기본 고정

export function RadarPanel({ data, loading, t, lang, showScav, onToggleScav, onPickMap, onClose, size, onSize, fill, highlightKey, story, onPickStory, mini, onMini, miniSize = RADAR_MINI_DEFAULT, onMiniSize, mapAlpha = 100, onMapAlpha, dragRegion, party }: Props) {
  const [showParty, setShowParty] = useState(false);
  // 나란히(fill): 지도 높이를 '패널 − 고정값'이 아니라 실제로 그려진 나머지(머리글·경고·칩·아래 조작부·세로면 목록 열) 높이를
  // 재서 정한다 — 파티 패널을 열거나 경고 줄이 생겨도 패널 밖으로 넘치지 않게(11-05: 고정값이라 아래가 잘렸다)
  const radarRef = useRef<HTMLDivElement>(null);
  const [fitSize, setFitSize] = useState<number | null>(null);
  const measureFit = () => {
    const el = radarRef.current;
    if (!fill || !el) return;
    const wrap = el.querySelector(".radar-mapwrap") as HTMLElement | null;
    if (!wrap) return;
    const top = el.getBoundingClientRect().top;
    let bottom = top;
    for (const c of Array.from(el.children)) bottom = Math.max(bottom, (c as HTMLElement).getBoundingClientRect().bottom);
    const extra = bottom - top - wrap.offsetHeight; // 지도 칸을 뺀 나머지 내용 높이
    const want = Math.max(160, Math.floor(el.clientHeight - extra - 2));
    setFitSize((cur) => (cur != null && Math.abs(cur - want) <= 1 ? cur : want));
  };
  useLayoutEffect(measureFit);
  useEffect(() => {
    const el = radarRef.current;
    if (!fill || !el) return;
    const ro = new ResizeObserver(() => measureFit());
    ro.observe(el);
    const under = el.querySelector(".radar-under");
    if (under) ro.observe(under);
    return () => ro.disconnect();
  });
  // 이 맵에 있는 친구(위치가 있는 사람만) — 지도에 그린다. 다른 맵 친구는 파티 패널 목록에만
  const mapId = data?.map?.id ?? null;
  const friendsHere: Friend[] = party && mapId ? party.friends.filter((f) => f.map === mapId && f.x != null) : [];
  const [fixed, setFixed] = useState<boolean>(() => localStorage.getItem(FIXED_KEY) !== "0");
  const [bigMe, setBigMe] = useState<boolean>(() => localStorage.getItem(BIGME_KEY) === "1");
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
    if (!hiddenSet.has(id)) saveHidden([...hiddenQ, { id, name: x.story && x.objective ? `${x.name} · ${x.objective}` : x.name }]);
  };
  const restoreQuest = (id: string) => saveHidden(hiddenQ.filter((h) => h.id !== id));
  const pickBigMe = (v: boolean) => {
    setBigMe(v);
    try {
      localStorage.setItem(BIGME_KEY, v ? "1" : "0");
    } catch {}
  };
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

  if (mini) {
    // 지도만 남긴 미니맵 — 상태 안내도 지도 자리 안에서 한 줄로. 도구(옮기기·작게·크게·펼치기)는 마우스를 올렸을 때만(CSS)
    const ready = !!(data && data.folder && data.shot && data.map);
    const msg = !data ? (loading ? t.hintLoading : t.radarNoShot) : !data.folder ? t.radarNoFolder : !data.shot ? t.radarNoShot : t.radarNoMap;
    const step = (d: number) => onMiniSize?.(Math.max(RADAR_MINI_MIN, Math.min(RADAR_MINI_MAX, miniSize + d)));
    return (
      <div className="radar radar-mini" style={{ width: miniSize }}>
        {ready ? (
          <RadarMap data={data!} lang={lang} t={t} showScav={showScav} onToggleScav={onToggleScav} layers={layers} onToggleLayer={toggleLayer} hiddenQuests={hiddenSet} size={miniSize} fixed={fixed} highlightKey={highlightKey} bigMe={bigMe} mini mapAlpha={mapAlpha / 100} friends={friendsHere} />
        ) : (
          <div className="radar-mini-msg" style={{ width: miniSize, height: Math.round(miniSize * 0.5) }}>{msg}</div>
        )}
        {ready && data!.shot!.age > STALE_SEC && <div className="radar-mini-stale" title={t.radarStale}>{ago(data!.shot!.age, t)}</div>}
        <div className="radar-mini-tools">
          <span className="radar-mini-grip" data-tauri-drag-region={dragRegion ? true : undefined} title={t.radarMiniDrag}>⠿</span>
          <button type="button" onClick={() => step(-20)} disabled={miniSize <= RADAR_MINI_MIN} title={t.radarMiniSmaller} aria-label={t.radarMiniSmaller}>−</button>
          <button type="button" onClick={() => step(20)} disabled={miniSize >= RADAR_MINI_MAX} title={t.radarMiniBigger} aria-label={t.radarMiniBigger}>+</button>
          <button type="button" onClick={() => onMini?.(false)} title={t.radarMiniExpand}>{t.radarMiniExpand}</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="radar">
        {header}
        <div className="hint">{loading ? t.hintLoading : t.radarNoShot}</div>
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
  const bigMeCtl = (
    <label className="radar-chk" title={t.radarBigMeHint}>
      <input type="checkbox" checked={bigMe} onChange={(e) => pickBigMe(e.target.checked)} /> {t.radarBigMe}
    </label>
  );

  // 목록은 퀘스트 목표만(퀘스트 칩·개별 숨김을 따른다). 11-06 사용자: '탈출구까지 나와 목록이 너무 길어 가려지는 게 많다'
  // → 탈출구·트랜짓은 지도 위 표시로만. 퀘스트가 없을 때 이유는 지도 칩 아래 안내 줄(RadarMap questNote)이 알려 준다.
  const visible = (data.targets ?? []).filter((x) => x.kind === "quest" && layers.quests && !hiddenSet.has(questKey(x)));
  // 대상 목록(진행 중 퀘스트 목표 요약 — 탈출구·트랜짓은 지도에만) — 카드는 지도 아래, 나란히 패널은 지도 오른쪽 열
  const heading = data.shot?.heading ?? null;
  const stale = (data.shot?.age ?? 0) > STALE_SEC;
  const listMax = fill ? 40 : 8;
  const rows = visible.slice(0, listMax).map((x, i) => (
        <div className="radar-row" key={`${x.kind}-${x.name}-${i}`}>
          <span className="radar-dot" style={{ background: colorOf(x) }} />
          <span className="radar-name">
            <span className="radar-kind">
              {x.kind === "extract" ? t.radarExtract : x.kind === "transit" ? t.radarTransit : x.story ? t.radarStory : t.radarQuest}
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
                onClick={() => void openUrl(guideQuestUrl(lang, x.slug!)).catch(() => {})}
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
      ));
  const hiddenBlock = hiddenQ.length > 0 && (
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
      );
  const emptyHint = null; // 퀘스트가 없을 때 이유는 지도 칩 아래 한 줄(questNote)이 이미 보여 준다 — 같은 말을 두 번 하지 않게
  // 카드: 가까운 8개. 나란히: 목록 열 높이에 들어가는 만큼만(스크롤 없음) — 나머지 먼 대상은 지도에만(11-05 피드백)
  const targetList = (
    <div className="radar-list">
      {emptyHint}
      {rows}
      {hiddenBlock}
    </div>
  );
  // 맵 선택·스토리·크기·고정·내 위치 크게·지도 불투명도·파티·미니맵·사용법 — 카드는 지도 아래, 나란히는 오른쪽 열 위
  // (나란히 패널은 지도 높이를 '패널 − 210px'로 잡아서, 아래에 붙이면 파티 패널 등이 잘렸다 — 11-05 피드백)
  const controls = (
    <>
      <div className="radar-foot">
          {mapPicker}
          {/* 스토리(메인 퀘스트) 챕터 — 게임이 스토리 진행을 로그에 안 남겨 자동 감지가 안 된다 → 진행 중인 챕터를 직접 고른다 */}
          {(data.story_chapters?.length ?? 0) > 0 && (
            <select className="radar-map" value={story === "all" || story === "auto" || data.story_chapters!.some((c) => c.id === story) ? story : ""} onChange={(e) => onPickStory(e.target.value)} aria-label={t.radarStoryPick} title={t.radarStoryHint}>
              <option value="">{t.radarStoryOff}</option>
              <option value="auto">{t.radarStoryAuto}</option>
              {data.story_chapters!.map((c) => (
                <option key={c.id} value={c.id}>
                  {t.radarStory}: {c.name}
                </option>
              ))}
              <option value="all">{t.radarStoryAll}</option>
            </select>
          )}
          {sizeCtl}
        </div>
        {fixedCtl}
        {bigMeCtl}
        {onMapAlpha && (
          <label className="radar-size" title={t.radarMapOpacityHint}>
            <span>{t.radarMapOpacity}</span>
            <input type="range" min={0} max={100} step={5} value={mapAlpha} onChange={(e) => onMapAlpha(Number(e.target.value))} aria-label={t.radarMapOpacity} />
            <span className="radar-size-val">{mapAlpha}%</span>
          </label>
        )}
        {party && (
          <button type="button" className={`radar-mini-btn radar-party-btn${showParty || party.code ? " on" : ""}`} onClick={() => setShowParty((v) => !v)} aria-expanded={showParty}>
            👥 {t.partyBtn}
            {party.code ? ` · ${party.friends.filter((f) => f.online).length + 1}` : ""}
          </button>
        )}
        {party && showParty && <PartyPanel party={party} t={t} maps={data.maps} mapId={mapId} />}
        {onMini && !fill && (
          <button type="button" className="radar-mini-btn" onClick={() => onMini(true)} title={t.radarMiniHint}>
            <Icon name="map" /> {t.radarMini}
          </button>
        )}
        {/* 긴 사용법 안내는 접어 둔다 — 칩·슬라이더·맵 선택과 함께 한 화면에 있으면 하단이 복잡하다(11-02 점검) */}
        <details className="radar-help">
          <summary>{t.radarHelp}</summary>
          <div className="radar-note">{t.radarMapNote}</div>
        </details>
      </>
  );
  // 11-06 친구 시험 피드백 '맵을 고르기 전엔 지도 옵션이 안 뜬다' — 스크린샷 폴더·스크린샷·맵이 아직 없어도 안내 문구 아래에
  // 맵 선택·크기·고정·내 위치 크게·불투명도·파티·미니맵을 그대로 보여 준다(레이드 전에 파티 방부터 들어가는 경우 등).
  // 전엔 이 세 경우에 패널이 옵션을 만들기 전에 끝나 머리글과 안내 한 줄만 보였다.
  const noMapHint = !data.folder ? t.radarNoFolder : !data.shot ? t.radarNoShot : !data.map ? t.radarNoMap : null;
  if (noMapHint) {
    return (
      <div className="radar" ref={radarRef}>
        {header}
        {error(data, t)}
        <div className="hint">{noMapHint}</div>
        {controls}
      </div>
    );
  }
  return (
    <div className="radar" ref={radarRef}>
      {header}
      {error(data, t)}
      {stale && <div className="radar-warn">{t.radarStale}</div>}
      {heading == null && <div className="hint">{t.radarDirUnknown}</div>}
      {story === "auto" && data.story_auto && data.story_auto.length === 0 && <div className="hint">{t.radarStoryAutoNone}</div>}
      {fill ? (
        <div className="radar-maprow">
          <div className="radar-leftcol">
            <RadarMap data={data} lang={lang} t={t} showScav={showScav} onToggleScav={onToggleScav} layers={layers} onToggleLayer={toggleLayer} hiddenQuests={hiddenSet} size={fitSize ?? size} fixed={fixed} highlightKey={highlightKey} bigMe={bigMe} mapAlpha={mapAlpha / 100} friends={friendsHere} />
            <div className="radar-under">{controls}</div>
          </div>
          <div className="radar-side">
            <div className="radar-side-in">
              {emptyHint}
              <FitList t={t}>{rows}</FitList>
              {hiddenBlock}
            </div>
          </div>
        </div>
      ) : (
        <>
          <RadarMap data={data} lang={lang} t={t} showScav={showScav} onToggleScav={onToggleScav} layers={layers} onToggleLayer={toggleLayer} hiddenQuests={hiddenSet} size={size} fixed={fixed} highlightKey={highlightKey} bigMe={bigMe} mapAlpha={mapAlpha / 100} friends={friendsHere} />
          {targetList}
        </>
      )}
      {!fill && controls}
    </div>
  );
}

function error(data: RadarState, t: Strings) {
  return data.error ? <div className="radar-warn">{t.radarDataError}</div> : null;
}

function PartyPanel({ party, t, maps, mapId }: { party: PartyApi; t: Strings; maps: { id: string; name: string }[]; mapId: string | null }) {
  const [codeIn, setCodeIn] = useState("");
  const [copied, setCopied] = useState(false);
  const [bad, setBad] = useState(false);
  const [, tick] = useState(0);
  // 목록의 '12초 전'을 갱신
  useEffect(() => {
    const iv = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => window.clearInterval(iv);
  }, []);
  const mapName = (id?: string) => maps.find((m) => m.id === id)?.name ?? id ?? "?";
  const now = Date.now();
  const copy = () => {
    if (!party.code) return;
    void navigator.clipboard?.writeText(party.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  const doJoin = () => {
    const c = normCode(codeIn);
    if (!validCode(c)) {
      setBad(true);
      return;
    }
    setBad(false);
    party.join(c);
    setCodeIn("");
  };
  return (
    <div className="party">
      <div className="party-row">
        <b>{t.partyTitle}</b>
        <input type="text" value={party.name} placeholder={defaultPartyName()} maxLength={16} onChange={(e) => party.setName(e.target.value)} aria-label={t.partyNamePh} title={t.partyNamePh} />
      </div>
      {!party.code ? (
        <div className="party-row">
          <button type="button" onClick={() => party.create()}>{t.partyCreate}</button>
          <input type="text" className="code" value={codeIn} placeholder={t.partyCodePh} maxLength={8} onChange={(e) => setCodeIn(normCode(e.target.value))} onKeyDown={(e) => e.key === "Enter" && doJoin()} aria-label={t.partyCodePh} />
          <button type="button" onClick={doJoin}>{t.partyJoin}</button>
          {bad && <span className="party-warn">{t.partyBadCode}</span>}
          {party.status === "full" && <span className="party-warn">{t.partyFull}</span>}
        </div>
      ) : (
        <>
          <div className="party-row">
            <span className="party-note">{t.partyRoom}</span>
            <span className="party-code">{party.code}</span>
            <button type="button" onClick={copy}>{copied ? t.partyCopied : t.partyCopy}</button>
            <button type="button" onClick={() => party.leave()}>{t.partyLeave}</button>
            {party.status === "connecting" && <span className="party-warn">{t.partyConnecting}</span>}
            {party.status === "error" && <span className="party-warn">{t.partyError}</span>}
          </div>
          <label className="radar-chk">
            <input type="checkbox" checked={party.share} onChange={(e) => party.setShare(e.target.checked)} /> {t.partyShare}
          </label>
          {party.me && (
            <div className="party-mem">
              <span className="party-dot" style={{ background: party.me.color }} /> {party.name.trim() || defaultPartyName()} ({t.partyMe})
            </div>
          )}
          {party.friends.length === 0 && party.status === "on" && <div className="party-note">{t.partyNoMembers}</div>}
          {party.friends.map((f) => (
            <div className="party-mem" key={f.mid}>
              <span className="party-dot" style={{ background: f.color, opacity: f.online ? 1 : 0.4 }} /> {f.name}
              <span className="st">
                {!f.online ? t.partyOffline : f.at == null ? t.partyNoPos : f.map !== mapId ? t.partyOtherMap.replace("{map}", mapName(f.map)) : friendAgo(now - f.at, t)}
              </span>
            </div>
          ))}
        </>
      )}
      <div className="party-note">{t.partyNote}</div>
    </div>
  );
}

/** 들어가는 만큼만 보여 주는 목록(나란히 패널 오른쪽 열) — 스크롤 대신 넘치는 뒤쪽(먼 대상)을 가리고 개수만 알린다.
 *  가린 행도 자리는 차지하게 두어(visibility) 다시 재도 위치가 안 바뀐다 → 재기·가리기가 서로를 흔들지 않는다. */
function FitList({ children, t }: { children: ReactNode[]; t: Strings }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState<number>(children.length);
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const kids = Array.from(el.children).filter((c) => (c as HTMLElement).dataset.row === "1") as HTMLElement[];
    const limit = el.clientHeight - 22; // 아래 '먼 대상 n개' 줄 자리
    let n = kids.length;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].offsetTop + kids[i].offsetHeight > (i === kids.length - 1 ? el.clientHeight : limit)) {
        n = i;
        break;
      }
    }
    setCut((c) => (c === n ? c : n));
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const more = children.length - Math.min(cut, children.length);
  return (
    <div className="radar-list radar-fit" ref={ref}>
      {children.map((c, i) => (
        <div data-row="1" key={i} style={i >= cut ? { visibility: "hidden" } : undefined}>
          {c}
        </div>
      ))}
      {more > 0 && <div className="radar-fit-more">{t.radarMoreOnMap.replace("{n}", String(more))}</div>}
    </div>
  );
}
