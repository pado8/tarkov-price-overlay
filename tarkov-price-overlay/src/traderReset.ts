// 11-16 상인 재입고(초기화) 알림 — 언제 알림을 띄우고 언제 시각을 다시 받을지 정하는 계산만(화면·네트워크 없음, tests/traderReset.test.mjs).
// 시각은 사이드카 GET /traders/resets 가 json.tarkov.dev 에서 받아 준다. 주기 폴링은 하지 않는다 — 받는 때는 앱 시작 때 한 번과
// 고른 상인의 초기화가 지난 1분 뒤뿐이고, tarkov.dev 값이 아직 그대로면 간격을 늘려(2·4·8·10분) 다시 묻는다.

export type ResetRow = { key: string; name: string; reset: number }; // reset = epoch 초

export const RST_ON_KEY = "tarkov.traderReset.on"; // "1" = 켬(기본 꺼짐)
export const RST_LEAD_KEY = "tarkov.traderReset.lead"; // 몇 분 전
export const RST_TRADERS_KEY = "tarkov.traderReset.traders"; // 고른 상인 key 목록(JSON)
export const RST_LEADS = [5, 10] as const;
export const RST_DEFAULT_TRADERS = ["prapor", "therapist", "skier", "peacekeeper", "mechanic", "ragman", "jaeger"];
const MIN_LEFT_SEC = 30; // 초기화까지 이보다 적게 남았으면 알림을 띄우지 않는다(늦은 알림은 소용없다)
const REFETCH_AFTER_SEC = 60; // 초기화 시각이 지난 뒤 이만큼 기다렸다가 다시 받는다
const BACKOFF_SEC = [120, 240, 480, 600]; // 값이 아직 그대로일 때 다시 묻는 간격

export function loadLead(storage: Pick<Storage, "getItem">): number {
  try {
    const v = Number(storage.getItem(RST_LEAD_KEY));
    return (RST_LEADS as readonly number[]).includes(v) ? v : RST_LEADS[0];
  } catch {
    return RST_LEADS[0];
  }
}

export function loadTraders(storage: Pick<Storage, "getItem">): string[] {
  try {
    const v = JSON.parse(storage.getItem(RST_TRADERS_KEY) || "null");
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string" && /^[a-z0-9-]{1,40}$/.test(x)).slice(0, 30);
  } catch {}
  return [...RST_DEFAULT_TRADERS];
}

export const notifyKey = (r: ResetRow) => `${r.key}:${r.reset}`;

/** 지금 띄울 알림(fire)과 다음 알림까지 남은 초(nextInSec, 없으면 null). 이미 알린 것(notified)·이미 지난 것·30초도 안 남은 것은 뺀다. */
export function planAlerts(rows: ResetRow[], nowSec: number, leadMin: number, notified: ReadonlySet<string>): { fire: ResetRow[]; nextInSec: number | null } {
  const fire: ResetRow[] = [];
  let next: number | null = null;
  for (const r of rows) {
    if (notified.has(notifyKey(r))) continue;
    const left = r.reset - nowSec;
    if (left < MIN_LEFT_SEC) continue;
    const wait = left - leadMin * 60;
    if (wait <= 0) fire.push(r);
    else if (next === null || wait < next) next = wait;
  }
  return { fire, nextInSec: next === null ? null : Math.ceil(next) };
}

/** 시각을 다시 받기까지 기다릴 초. 고른 상인 중 지난 값이 있으면(tarkov.dev 가 아직 안 바꿈) 간격을 늘려 가며, 아니면 가장 이른 초기화 1분 뒤. */
export function refetchInSec(rows: ResetRow[], nowSec: number, staleTries: number): number {
  if (!rows.length) return BACKOFF_SEC[BACKOFF_SEC.length - 1];
  if (rows.some((r) => r.reset <= nowSec)) return BACKOFF_SEC[Math.min(Math.max(staleTries, 0), BACKOFF_SEC.length - 1)];
  const first = Math.min(...rows.map((r) => r.reset));
  return Math.max(REFETCH_AFTER_SEC, Math.ceil(first - nowSec) + REFETCH_AFTER_SEC);
}

/** 알림에 쓸 '약 n분' — 반올림, 최소 1. */
export function minutesLeft(r: ResetRow, nowSec: number): number {
  return Math.max(1, Math.round((r.reset - nowSec) / 60));
}
