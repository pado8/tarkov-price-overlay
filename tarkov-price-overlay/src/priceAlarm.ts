// 11-08 가격 알람 — 아이템마다 '플리가 N₽ 이상/이하면 알림'. 판정은 순수 함수(evaluate), 저장은 이 PC localStorage.
// 넘는 순간 한 번만 알리고(armed=false), 기준 반대쪽으로 돌아오면 다시 건다 — 10분마다 같은 알림이 반복되지 않게.

export type Alarm = {
  id: string; // 아이템 id
  name: string;
  mode: string; // 게임 모드(regular·pve·pvp-season) — 모드별 시세가 다르다
  dir: "above" | "below";
  price: number;
  armed: boolean;
  last?: number | null; // 마지막으로 본 플리가
  firedAt?: number | null;
};

const KEY = "tarkov.priceAlarms";

export function loadAlarms(): Alarm[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v)
      ? v.filter((a) => a && typeof a.id === "string" && (a.dir === "above" || a.dir === "below") && typeof a.price === "number")
      : [];
  } catch {
    return [];
  }
}

export function saveAlarms(list: Alarm[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

/** 같은 아이템·모드의 알람은 하나만(새로 정하면 바꾼다). 늘 켠 채로 시작한다.
 * 11-20 실기: 예전엔 지금 가격이 이미 기준을 넘었으면 꺼 둔 채로 시작해, 반대쪽으로 갔다 다시 넘을 때까지 안 울렸다
 * → '걸었는데 안 뜬다'. 이제 이미 넘었으면 첫 확인 때 한 번 울리고, 그 뒤로는 평소처럼 넘는 순간만. */
export function upsertAlarm(list: Alarm[], a: Omit<Alarm, "armed">, current?: number | null): Alarm[] {
  const rest = list.filter((x) => !(x.id === a.id && x.mode === a.mode));
  return [...rest, { ...a, armed: true, last: current ?? null }];
}

export function removeAlarm(list: Alarm[], id: string, mode: string): Alarm[] {
  return list.filter((x) => !(x.id === id && x.mode === mode));
}

const hit = (a: Alarm, p: number) => (a.dir === "above" ? p >= a.price : p <= a.price);

/** prices: 아이템 id → 지금 플리가(없으면 판정 안 함). 바뀐 목록과 이번에 울릴 알람. */
export function evaluate(list: Alarm[], mode: string, prices: Record<string, number | null | undefined>, now: number): { next: Alarm[]; fired: Alarm[] } {
  const fired: Alarm[] = [];
  const next = list.map((a) => {
    if (a.mode !== mode) return a;
    const p = prices[a.id];
    if (p == null || !(p > 0)) return a;
    if (hit(a, p)) {
      if (a.armed) {
        const f = { ...a, armed: false, last: p, firedAt: now };
        fired.push(f);
        return f;
      }
      return { ...a, last: p };
    }
    return { ...a, armed: true, last: p };
  });
  return { next, fired };
}
