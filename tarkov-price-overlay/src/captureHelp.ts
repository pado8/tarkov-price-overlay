// 첫 설정 도움 상자와 캡처 영역 기본값 배율 — App.tsx 가 쓴다. 순수 함수라 dev/capture-help.test.ts 로 검증한다.
//
// 11-07 통계(실패 상위 설치 × 도움 상자): 1.2.7 반복 실패자 10명 중 9명이 상자를 봤지만, 평소 잘 읽히던 사람이
//   빈 화면을 반복하며 '캡처 맞추기'를 수십 번 눌러도 회복 0인 경우가 있었다 → 캡처 영역이 아니라 툴팁 없는 곳
//   (빈 칸·인벤토리 밖·툴팁 뜨기 전)에서 누른 것으로 보고, 그땐 '툴팁이 뜬 뒤 누르세요' 안내를 먼저 보인다.
// 같은 날 해상도별 품질: 울트라와이드(2560×1080·3440×1440)는 실패 중 잡음 비율이 높았다 — 기본값 배율이
//   가로/1920 이라 세로를 따라 커지는 툴팁보다 상자가 컸다 → 가로·세로 배율 중 작은 쪽.

export type HelpMode = "capture" | "tip";

/** 상자를 띄울 때 어떤 안내를 보일지. everOk = 한 번이라도 성공, sessionOk = 이번 세션 성공 수,
 *  failKinds = 최근 실패 종류(empty/junk/no_match, 최대 10), actions = 상자의 조치 버튼을 누른 뒤 아직 회복 못 한 횟수 */
export function chooseHelpMode(everOk: boolean, sessionOk: number, failKinds: string[], actions: number): HelpMode {
  if (actions >= 3) return "tip";
  const emptyShare = failKinds.length ? failKinds.filter((k) => k === "empty").length / failKinds.length : 0;
  return everOk && sessionOk >= 5 && emptyShare >= 0.7 ? "tip" : "capture";
}

/** 캡처 영역 기본값 배율(1920×1080 = 1). 1 아래로는 안 줄인다. */
export function captureScale(monitorWidth: number, monitorHeight?: number): number {
  const byWidth = monitorWidth / 1920;
  const byHeight = monitorHeight ? monitorHeight / 1080 : byWidth;
  return Math.max(Math.min(byWidth, byHeight), 1.0);
}

/** 11-10 통계(하루 요약 bxm·bxf): 저장된 캡처 상자 높이가 조회 때 커서가 있는 모니터의 기본값(70 × captureScale)과
 *  20% 넘게 다르면 true. 상자는 첫 실행 때 주 모니터 바탕화면 기준으로 정해지는데, 게임을 다른 해상도·모니터에서 돌리면
 *  어긋난다(4K@150 실패 가설). 직접 맞춘 상자도 true 가 될 수 있다 — 콘솔에서 실패율을 어긋남/맞음으로 나눠 본다. */
export function boxMismatch(boxHeight: number, monitorWidth: number, monitorHeight: number, baseHeight = 70): boolean {
  if (!(boxHeight > 0 && monitorWidth > 0 && monitorHeight > 0)) return false;
  const expected = baseHeight * captureScale(monitorWidth, monitorHeight);
  return Math.abs(boxHeight - expected) / expected > 0.2;
}

// ── 11-17 캡처 상자를 게임 모니터에 다시 맞추기 ─────────────────────────────────────────────────────────
// 통계(11-17, 7일): 실패율 중앙이 1080p·1440p 4.8~4.9% 인데 울트라와이드는 3440×1440 16.9%·2560×1080 21.4%·3840×1080 33.5%
// (못 찾음 위주) — 상자가 필요한 크기보다 1.34배·1.33배·2배 큰 순서 그대로다. 기본 상자는 '저장된 상자가 없을 때만'
// 주 모니터 크기로 계산하는데(App.tsx applyMonitorScaling), 11-07 에 배율을 세로 기준으로 고친 것은 새 설치에만 닿았고
// 그 전에 설치한 울트라와이드 사용자는 가로 기준으로 부풀린 상자를 그대로 쓴다. 게임을 주 모니터가 아닌 모니터에서 돌리거나
// 전체 화면에서 더 낮은 해상도로 돌리는 사람(4K 모니터에 1440p 등)도 같은 어긋남이 생긴다.
// → 사용자가 손대지 않은 기본 상자(기본값 × 어떤 배율 그대로)이고 지금 게임 모니터의 기본값과 다르면 그 모니터 기준으로 다시 계산한다.
//   직접 조정한 상자는 건드리지 않는다. 윈도우 화면 배율(125%·150%)은 상자·툴팁 크기와 무관했다(1440p@125 실기기 확인).

/** 캡처 상자를 이루는 8개 값(물리 픽셀) */
export type BoxGeo = {
  offsetX: number; offsetY: number; width: number; height: number;
  groundOffsetX: number; groundOffsetY: number; groundWidth: number; groundHeight: number;
};
const GEO_KEYS = ["offsetX", "offsetY", "width", "height", "groundOffsetX", "groundOffsetY", "groundWidth", "groundHeight"] as const;

/** base 에 배율을 곱한 상자(App.tsx scaleRegionForMonitor 와 같은 반올림). */
export function scaleGeo(base: BoxGeo, scale: number): BoxGeo {
  const out = {} as BoxGeo;
  for (const k of GEO_KEYS) out[k] = Math.round(base[k] * scale);
  return out;
}

/** 상자가 '기본값 × 배율' 그대로면 그 배율, 사용자가 하나라도 조정했으면 null. 반올림 차이로 값마다 ±1 은 허용. */
export function defaultScaleOf(geo: BoxGeo, base: BoxGeo): number | null {
  if (!(geo.width > 0 && base.width > 0)) return null;
  const s = geo.width / base.width;
  if (s < 0.999) return null; // 기본값은 1 아래로 안 줄인다 → 그보다 작으면 직접 줄인 것
  for (const k of GEO_KEYS) if (Math.abs(geo[k] - base[k] * s) > 1) return null;
  return s;
}

/** 지금 게임 모니터(monW×monH)에 맞는 상자. 다시 맞출 필요가 없거나(이미 맞음·직접 조정한 상자·크기 모름) 하면 null.
 *  배율 차이가 3% 안이면(반올림 수준) 그대로 둔다. */
export function refitBox(geo: BoxGeo, base: BoxGeo, monW: number, monH: number): BoxGeo | null {
  if (!(monW > 0 && monH > 0)) return null;
  const cur = defaultScaleOf(geo, base);
  if (cur == null) return null;
  const want = captureScale(monW, monH);
  if (Math.abs(cur - want) / want <= 0.03) return null;
  return scaleGeo(base, want);
}

// ── 11-19 '초기화' 버튼 ───────────────────────────────────────────────────────
// 예전엔 초기화가 1920x1080 기본값(300x70)을 그대로 넣고 다른 쪽 상자는 그대로 둬서, 1440p 이상에선 상자가 작아지고 두 상자의 배율이
// 달라져 '직접 조정한 상자'로 분류됐다 → 그 뒤 자동 맞춤이 영영 막혔다. 이제 게임 모니터 배율의 기본값으로 되돌리고, 다른 쪽 상자도
// 손대지 않은 기본값이면 같은 배율로 함께 맞춘다(직접 조정한 쪽은 그대로).
const PRIMARY_KEYS = ["offsetX", "offsetY", "width", "height"] as const;
const GROUND_KEYS = ["groundOffsetX", "groundOffsetY", "groundWidth", "groundHeight"] as const;

function partIsDefault(geo: BoxGeo, base: BoxGeo, keys: readonly (keyof BoxGeo)[]): boolean {
  const s = geo[keys[2]] / base[keys[2]];
  if (!(s >= 0.999)) return false;
  return keys.every((k) => Math.abs(geo[k] - base[k] * s) <= 1);
}

/** part 상자를 scale 배율 기본값으로 되돌린 상자. */
export function resetGeo(geo: BoxGeo, base: BoxGeo, scale: number, part: "primary" | "ground"): BoxGeo {
  const want = scaleGeo(base, scale);
  const out = { ...geo };
  const [mine, other] = part === "primary" ? [PRIMARY_KEYS, GROUND_KEYS] : [GROUND_KEYS, PRIMARY_KEYS];
  for (const k of mine) out[k] = want[k];
  if (partIsDefault(geo, base, other)) for (const k of other) out[k] = want[k];
  return out;
}

// ── 11-19 넓은 범위에서 찾은 툴팁 위치로 캡처 상자 조정 ─────────────────────────
// 상자가 빗나가 사이드카가 커서 주변에서 툴팁을 직접 찾아 읽은 조회(attempt "scan")가 같은 모니터에서 3번 이어지면, 그 위치를 덮도록
// 상자를 옮긴다. 다른 상자로 읽힌 조회가 끼면 처음부터 센다. 직접 조정한 상자는 건드리지 않는다(App.tsx 가 확인).

/** 커서 기준 툴팁 패널 위치(물리 픽셀) */
export type ScanHit = { dx: number; dy: number; w: number; h: number };
export type ScanStreak = { mon: string; hits: ScanHit[] };
export type PrimaryBox = Pick<BoxGeo, "offsetX" | "offsetY" | "width" | "height">;
export const SCAN_STREAK_N = 3;

/** 아이템을 읽은 조회마다 부른다. hit = 넓은 범위 찾기로 읽은 위치, 다른 상자로 읽었으면 null. */
export function nextScanStreak(prev: ScanStreak | null, mon: string, hit: ScanHit | null): ScanStreak | null {
  if (!hit) return null;
  const hits = prev && prev.mon === mon ? [...prev.hits, hit].slice(-SCAN_STREAK_N) : [hit];
  return { mon, hits };
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 3번의 위치가 서로 맞고 지금 상자 밖이면 새 상자. 위치가 들쭉날쭉하거나 이미 상자 안(위치가 아니라 글자 인식 문제)이면 null.
 *  왼쪽에 뜬 툴팁은 오른쪽으로 뒤집어 본다 — 사이드카가 상자를 커서 좌우 대칭(mirror)으로 함께 읽는다. */
export function scanFitBox(geo: PrimaryBox, hits: ScanHit[]): PrimaryBox | null {
  if (hits.length < SCAN_STREAK_N) return null;
  const rows = hits.map((p) => {
    const left = p.dx + p.w / 2 < 0 ? -(p.dx + p.w) : p.dx;
    return { left, right: left + p.w, cy: p.dy + p.h / 2, h: p.h };
  });
  const h = median(rows.map((p) => p.h));
  const cy = median(rows.map((p) => p.cy));
  const left = median(rows.map((p) => p.left));
  if (rows.some((p) => Math.abs(p.h - h) > h * 0.5 || Math.abs(p.cy - cy) > h * 0.75 || Math.abs(p.left - left) > h * 1.5)) return null;
  const inside = rows.every((p) => p.left >= geo.offsetX && p.right <= geo.offsetX + geo.width
    && p.cy - p.h / 2 >= geo.offsetY && p.cy + p.h / 2 <= geo.offsetY + geo.height);
  if (inside) return null;
  const pad = Math.round(h * 0.25);
  const minLeft = Math.min(...rows.map((p) => p.left));
  const maxRight = Math.max(...rows.map((p) => p.right));
  const height = Math.max(Math.round(h * 1.6), Math.max(...rows.map((p) => p.h)) + pad * 2);
  return {
    offsetX: Math.round(minLeft) - pad,
    offsetY: Math.round(cy - height / 2),
    width: Math.max(geo.width, Math.round(maxRight - minLeft) + pad * 2),
    height,
  };
}

/** 같은 모니터에서 연달아 n 번(기본 2) 어긋났을 때만 다시 맞춘다 — 다른 모니터에서 한 번 잘못 누른 것으로 상자가 바뀌지 않게.
 *  prev = 직전 조회의 "가로x세로"(어긋났을 때만, 아니면 null). 돌려주는 값: [다시 맞출지, 다음에 넘길 prev] */
export function refitStreak(prev: string | null, monW: number, monH: number, mismatched: boolean): [boolean, string | null] {
  if (!mismatched) return [false, null];
  const key = `${monW}x${monH}`;
  return prev === key ? [true, null] : [false, key];
}
