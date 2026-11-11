// 지도 패널(RadarMap + 대상 목록). 데이터는 사이드카 /radar(radar.py)가 계산한다 —
// 게임 스크린샷 파일명의 좌표·방향 + 게임 로그로 판정한 맵 + tarkov.dev 좌표.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Strings as LiteralStrings } from "./i18n";
import { RadarMap, loadJson, LAYER_KEY, DEFAULT_LAYERS } from "./RadarMap";
import type { Layers } from "./RadarMap";
import { Icon } from "./Icon";
import { type useParty, type Friend, normCode, validCode, defaultPartyName } from "./party";
import { friendAgo } from "./RadarMap";
import { stat } from "./statBus";

type PartyApi = ReturnType<typeof useParty>;

const GUIDE_URL = "https://tarkov.aquapado.com/guide/";
// 카드(App.tsx guideUrl)와 같은 규칙: UI 언어별 가이드 + src=app(GA4 앱발 방문 표식)
const guideQuestUrl = (lang: string, slug: string) =>
  `${GUIDE_URL}${lang === "ko" ? "" : `${lang}/`}quest/${slug}/?src=app`;
const PYTHON_API = "http://127.0.0.1:8765";
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
  dist: number | null; // 레이드 시작 전(pre_raid, 내 위치 모름)엔 null
  rel: number | null; // 0 = 정면, +90 = 오른쪽, -90 = 왼쪽
  dy: number | null; // 대상 높이 - 내 높이 (m) — 레이드 시작 전엔 null
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
  my_exits?: string[]; // 11-06 이번 레이드 내 탈출구(탈출구 목록 사진 OCR, 영어 원문)
  raid_side?: "pmc" | "scav"; // 11-07 이번 레이드 진영(로그의 레이드 프로필 = 본 프로필이면 PMC)
  raid_ts?: number; // 이번 레이드 맵 로딩 시각 — 레이드가 바뀌었는지 알 때
  pre_raid?: boolean; // 11-08 새 레이드 로딩 중·첫 스크린샷 전 — 맵은 로그로 알지만 내 위치(shot)는 없다
  loading?: { map: string; ts: number }; // 11-08 마지막 스크린샷 뒤에 시작한 맵 로딩 — 가벼운 응답에도 실려 앱이 지도를 미리 받는다
  story_chapters?: { id: string; name: string }[]; // 스토리 챕터 선택 목록(스토리 순)
  story_auto?: string[]; // '자동' 일 때 로그로 추정한 진행 중 챕터 id 들(없으면 빈 배열)
  story_site_hidden?: number; // 11-10 가이드 사이트에서 체크해 지도에서 뺀 스토리 목표 수(POST /progress/story)
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

// 11-07 레이드 진영 자동: 이 레이드(raid_ts)에 칩을 이미 맞췄는가 — 지도를 다시 열면 패널이 새로 만들어지므로 모듈에 둔다
let sideAppliedFor: string | null = null;

export function RadarPanel({ data, loading, t, lang, showScav, onToggleScav, onPickMap, onClose, size, onSize, fill, highlightKey, story, onPickStory, mini, onMini, miniSize = RADAR_MINI_DEFAULT, onMiniSize, mapAlpha = 100, onMapAlpha, dragRegion, party }: Props) {
  const [showParty, setShowParty] = useState(false);
  // 나란히(fill): 지도 높이를 '패널 − 고정값'이 아니라 실제로 그려진 나머지(머리글·경고·칩·아래 조작부·세로면 목록 열) 높이를
  // 재서 정한다 — 파티 패널을 열거나 경고 줄이 생겨도 패널 밖으로 넘치지 않게(11-05: 고정값이라 아래가 잘렸다)
  const radarRef = useRef<HTMLDivElement>(null);
  const siteSeen = useRef(false); // 11-10 사이트 스토리 체크 줄 노출 지표(ssh)는 패널을 연 동안 한 번만
  const [fitSize, setFitSize] = useState<number | null>(null);
  // 11-09 통계: 파티 방이 안 쓰이는 게 '몰라서'인지 — 지도를 열 때 파티 버튼이 창 안에 보였나(pbv) / 화면 밖이었나(pbo), 누름(pbc)
  useEffect(() => {
    const id = window.setTimeout(() => {
      const btn = radarRef.current?.querySelector(".radar-party-btn") as HTMLElement | null;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const inView = r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
      stat(inView ? "pbv" : "pbo");
    }, 400); // 첫 그리기·높이 맞춤이 끝난 뒤
    return () => window.clearTimeout(id);
  }, []);
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
  // 11-07 레이드 진영 자동(PMC/스캐브): 레이드가 바뀌거나 같은 레이드에서 진영 판정이 바뀔 때(11-08: 로그엔 없다가 내 탈출구로
  // 정해짐 등) PMC 탈출구·스캐브 탈출구 칩을 그 진영에 맞춘다. 판정이 안 바뀌는 동안 직접 바꾼 칩은 그대로(지도를 다시 열어도).
  useEffect(() => {
    const side = data?.raid_side;
    // 11-08: 열쇠에 진영도 — 같은 레이드에서 진영 판정이 나중에 바뀌면(로그엔 없다가 내 탈출구로 정해짐 등) 다시 맞춘다
    const key = data?.raid_ts != null && side ? `${data.raid_ts}|${side}` : null;
    if (!side || !key || sideAppliedFor === key) return;
    sideAppliedFor = key;
    const scav = side === "scav";
    setLayers((L) => {
      if (L.pmc === !scav) return L;
      const n = { ...L, pmc: !scav };
      try {
        localStorage.setItem(LAYER_KEY, JSON.stringify(n));
      } catch {}
      return n;
    });
    if (showScav !== scav) onToggleScav(scav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.raid_side, data?.raid_ts]);
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
      {/* 11-11 파티 버튼을 머리글로(통계: 지도를 열 때 버튼이 화면 밖 13/23명 — 목표 목록이 길면 아래 조작부가 창 밖으로 밀렸다).
          클래스 radar-party-btn 은 그대로 — pbv/pbo 판정이 같은 기준으로 1.3.1 과 비교되게 */}
      {party && (
        <button type="button" className={`radar-mini-btn radar-party-btn radar-head-party${showParty || party.code ? " on" : ""}`} onClick={() => {
          if (!showParty) stat("pbc");
          setShowParty((v) => !v);
        }} aria-expanded={showParty} title={t.partyBtn}>
          👥 {t.partyBtn}
          {party.code ? ` · ${party.friends.filter((f) => f.online).length + 1}` : ""}
        </button>
      )}
      <button className="settings-btn" onClick={onClose} title={t.radarClose}>
        <Icon name="back" />
      </button>
    </div>
  );
  // 파티 패널은 머리글 바로 아래(지도 위)에 연다 — 버튼만 올리고 패널이 맨 아래에 열리면 또 안 보인다
  const partyPanel = party && showParty ? <PartyPanel party={party} t={t} maps={data?.maps ?? []} mapId={mapId} /> : null;

  if (mini) {
    // 지도만 남긴 미니맵 — 상태 안내도 지도 자리 안에서 한 줄로. 도구(옮기기·작게·크게·펼치기)는 마우스를 올렸을 때만(CSS)
    const ready = !!(data && data.folder && (data.shot || data.pre_raid) && data.map);
    const msg = !data ? (loading ? t.hintLoading : t.radarNoShot) : !data.folder ? t.radarNoFolder : !data.shot && !data.pre_raid ? t.radarNoShot : t.radarNoMap;
    const step = (d: number) => onMiniSize?.(Math.max(RADAR_MINI_MIN, Math.min(RADAR_MINI_MAX, miniSize + d)));
    return (
      <div className="radar radar-mini" style={{ width: miniSize }}>
        {ready ? (
          <RadarMap data={data!} lang={lang} t={t} showScav={showScav} onToggleScav={onToggleScav} layers={layers} onToggleLayer={toggleLayer} hiddenQuests={hiddenSet} size={miniSize} fixed={fixed} highlightKey={highlightKey} bigMe={bigMe} mini mapAlpha={mapAlpha / 100} friends={friendsHere} />
        ) : (
          <div className="radar-mini-msg" style={{ width: miniSize, height: Math.round(miniSize * 0.5) }}>{msg}</div>
        )}
        {ready && data!.shot && data!.shot.age > STALE_SEC && <div className="radar-mini-stale" title={t.radarStale}>{ago(data!.shot.age, t)}</div>}
        {ready && !data!.shot && <div className="radar-mini-stale" title={t.radarPreRaid}>{t.radarPreRaidShort}</div>}
        <div className="radar-mini-tools">
          {/* 11-07 data-tauri-drag-region 대신 직접 끌기 — 그 속성은 더블클릭에 창 최대화를 건다(App.tsx onHeaderDown 과 같은 이유) */}
          <span
            className="radar-mini-grip"
            title={t.radarMiniDrag}
            onMouseDown={(e) => {
              if (!dragRegion || e.button !== 0 || e.detail !== 1) return;
              getCurrentWindow().startDragging().catch(() => {});
            }}
          >
            ⠿
          </span>
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
        {partyPanel}
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
                onClick={() => {
                  stat("gq");
                  void openUrl(guideQuestUrl(lang, x.slug!)).catch(() => {});
                }}
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
          {x.dist != null && <span className="radar-dist">{Math.round(x.dist)}m</span>}
          {x.rel != null && heading != null && (
            <span className="radar-arrow" style={{ transform: `rotate(${x.rel}deg)` }} aria-hidden="true">
              ↑
            </span>
          )}
          {x.dy != null && Math.abs(x.dy) >= 2.5 && (
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
  // 맵 선택·스토리·크기·고정·내 위치 크게·지도 불투명도·미니맵·사용법 — 카드는 지도 아래, 나란히는 오른쪽 열 위(파티는 11-11부터 머리글)
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
        {onMini && !fill && (
          <button type="button" className="radar-mini-btn" onClick={() => onMini(true)} title={t.radarMiniHint}>
            <Icon name="map" /> {t.radarMini}
          </button>
        )}
        {/* 긴 사용법 안내는 접어 둔다 — 칩·슬라이더·맵 선택과 함께 한 화면에 있으면 하단이 복잡하다(11-02 점검) */}
        <details className="radar-help">
          <summary>{t.radarHelp}</summary>
          <div className="radar-note">{t.radarMapNote}</div>
          <div className="radar-note">{t.radarMyExitsNote}</div>
        </details>
      </>
  );
  // 11-06 친구 시험 피드백 '맵을 고르기 전엔 지도 옵션이 안 뜬다' — 스크린샷 폴더·스크린샷·맵이 아직 없어도 안내 문구 아래에
  // 맵 선택·크기·고정·내 위치 크게·불투명도·파티·미니맵을 그대로 보여 준다(레이드 전에 파티 방부터 들어가는 경우 등).
  // 전엔 이 세 경우에 패널이 옵션을 만들기 전에 끝나 머리글과 안내 한 줄만 보였다.
  const noMapHint = !data.folder ? t.radarNoFolder : !data.shot && !data.pre_raid ? t.radarNoShot : !data.map ? t.radarNoMap : null;
  if (noMapHint) {
    return (
      <div className="radar" ref={radarRef}>
        {header}
        {partyPanel}
        {error(data, t)}
        <div className="hint">{noMapHint}</div>
        {controls}
      </div>
    );
  }
  return (
    <div className="radar" ref={radarRef}>
      {header}
      {partyPanel}
      {error(data, t)}
      {stale && <div className="radar-warn">{t.radarStale}</div>}
      {/* 11-08 레이드 로딩 화면에서 맵을 미리 띄운 상태 — 위치·방향은 첫 스크린샷부터 */}
      {!data.shot && data.pre_raid && <div className="hint">{t.radarPreRaid}</div>}
      {data.shot && heading == null && <div className="hint">{t.radarDirUnknown}</div>}
      {story === "auto" && data.story_auto && data.story_auto.length === 0 && <div className="hint">{t.radarStoryAutoNone}</div>}
      {/* 11-10 사이트에서 체크한 스토리 목표는 지도에서 뺀다 — 몇 개 뺐는지 + 다시 보이기(지표 ssh 노출·ssc 다시 보이기) */}
      {story && (data.story_site_hidden ?? 0) > 0 && (
        <div className="hint" ref={(el) => { if (el && !siteSeen.current) { siteSeen.current = true; stat("ssh"); } }}>
          {t.radarStorySite.replace("{n}", String(data.story_site_hidden))}{" "}
          <button type="button" className="radar-link" onClick={() => {
            stat("ssc");
            fetch(`${PYTHON_API}/progress/story`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: 1, clear: true }) }).catch(() => {});
          }}>{t.radarStorySiteShow}</button>
        </div>
      )}
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
  const [editMid, setEditMid] = useState<string | null>(null); // 11-07 별명 고치는 중인 파티원
  const [editVal, setEditVal] = useState("");
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
        {/* 11-07 인게임 메모: '파티 방'이라고만 있어 내 닉네임을 어디서 바꾸는지 모르겠다 → 라벨 + 방 안에선 안내 한 줄 */}
        <span className="party-name-lbl">{t.partyMyName}</span>
        <input
          type="text"
          value={party.name}
          placeholder={defaultPartyName()}
          maxLength={16}
          onChange={(e) => party.setName(e.target.value)}
          onBlur={() => party.applyName()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              party.applyName();
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label={t.partyMyName}
          title={party.code ? t.partyNameLiveHint : t.partyNamePh}
        />
      </div>
      {party.code && <div className="party-hint">{t.partyNameLiveShort}</div>}
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
              <span className="party-dot" style={{ background: f.color, opacity: f.online ? 1 : 0.4 }} />{" "}
              {editMid === f.mid ? (
                <input
                  type="text"
                  className="party-alias"
                  autoFocus
                  value={editVal}
                  maxLength={16}
                  placeholder={f.orig ?? f.name}
                  onChange={(e) => setEditVal(e.target.value)}
                  onBlur={() => {
                    party.setAlias(f.mid, editVal);
                    setEditMid(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditMid(null);
                  }}
                  aria-label={t.partyAlias}
                />
              ) : (
                <>
                  <span title={f.orig ? `${t.partyAliasOrig}: ${f.orig}` : undefined}>{f.name}</span>
                  <button
                    type="button"
                    className="party-alias-btn"
                    title={t.partyAliasHint}
                    aria-label={t.partyAlias}
                    onClick={() => {
                      setEditMid(f.mid);
                      setEditVal(f.orig ? f.name : "");
                    }}
                  >
                    ✎
                  </button>
                </>
              )}
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
