// 루팅 계획(11-13 지도 기능 계획 5·6단계): 지도에서 고른 지점을 순서대로 이은 '내 경로'.
// 스폰 무리에 붙여 두면, 레이드 첫 스크린샷 좌표가 그 스폰 근처일 때 자동으로 뜬다(유저 스캐브 파밍용).
// 전부 이 PC 의 localStorage 에만 둔다(서버 호출 없음). 공유는 글자 코드 복사·붙여넣기.
// 유캐브 보조: 이번 레이드 '내 탈출구' 중 가장 가까운 것을 경로 끝에 잇고, 남은 시간으로 갈 수 있는 지점을 어림하고,
// 경로가 지뢰밭을 지나거나 보스 구역 근처면 경고한다.
import { useState } from "react";

type Strings = { [k: string]: string };
type P3 = [number, number, number];
export type PlanStop = { p: P3; name: string };
export type LootPlan = { id: string; map: string; name: string; spawn: string | null; stops: PlanStop[] };
export type SpawnGroup = { id: string; c: [number, number]; n: number; p: number; s: number }; // p·s = PMC·스캐브 지점 수
export type PlanExit = { name: string; p: P3 };
export type PlanWarn = { at: number; kind: "mine" | "boss"; text: string }; // at = 지점 번호(0부터). mine 은 at → at+1 구간

export const PLAN_KEY = "tarkov.radar.plans";
export const PLAN_REACH_M = 15; // 이 안에 들어오면 그 지점은 '지남'
export const PLAN_SPAWN_M = 80; // 첫 스크린샷이 스폰 무리 중심에서 이 안이면 그 스폰으로 본다
// 시간 어림: 직선 거리 × 돌아가는 몫 ÷ 이동 속도 + 지점마다 뒤지는 시간. 길 자료가 없어 어림값이다(화면에도 그렇게 적는다)
export const PLAN_DETOUR = 1.3;
export const PLAN_SPEED_MPS = 3.5;
export const PLAN_LOOT_SEC = 20;
const BOSS_NEAR_M = 35;
const CODE_PREFIX = "TPO-PLAN1:";

export function loadPlans(): LootPlan[] {
  try {
    const v = JSON.parse(localStorage.getItem(PLAN_KEY) || "[]");
    return Array.isArray(v) ? v.filter((p) => p && typeof p.id === "string" && Array.isArray(p.stops)) : [];
  } catch {
    return [];
  }
}

export function savePlans(plans: LootPlan[]): void {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plans));
  } catch {
    /* 저장 실패는 무시 */
  }
}

export const newPlanId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function nearestGroup(groups: SpawnGroup[] | undefined, x: number, z: number, max = PLAN_SPAWN_M): SpawnGroup | null {
  let best: SpawnGroup | null = null;
  let bd = max;
  for (const g of groups ?? []) {
    const d = Math.hypot(g.c[0] - x, g.c[1] - z);
    if (d <= bd) {
      bd = d;
      best = g;
    }
  }
  return best;
}

/** 이번 레이드 내 탈출구 중, 경로 마지막 지점(없으면 내 위치)에서 가장 가까운 것. 내 탈출구를 모르면 null */
export function planExit(plan: LootPlan, extracts: { name: string; en?: string; p: P3 }[], mine: Set<string> | null, me: { x: number; z: number } | null): PlanExit | null {
  if (!mine) return null;
  const last = plan.stops.length ? plan.stops[plan.stops.length - 1].p : me ? ([me.x, 0, me.z] as P3) : null;
  if (!last) return null;
  let best: PlanExit | null = null;
  let bd = Infinity;
  for (const e of extracts) {
    if (!e.en || !mine.has(e.en)) continue;
    const d = Math.hypot(e.p[0] - last[0], e.p[2] - last[2]);
    if (d < bd) {
      bd = d;
      best = { name: e.name, p: e.p };
    }
  }
  return best;
}

function inPoly(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 경로 경고: 구간이 지뢰밭 윤곽을 지나는지(5m 간격으로 찍어 봄) · 지점이 보스 구역 점에서 BOSS_NEAR_M 안인지 */
export function planWarnings(
  plan: LootPlan,
  exit: PlanExit | null,
  hazards: { name: string; type: string; outline: [number, number][] }[],
  bosses: { name: string; pts: [number, number][]; bosses: { name: string; chance: number }[]; anywhere?: boolean }[],
): PlanWarn[] {
  const pts: P3[] = [...plan.stops.map((s) => s.p), ...(exit ? [exit.p] : [])];
  const mines = hazards.filter((h) => h.type === "minefield" && h.outline.length >= 3);
  const out: PlanWarn[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, , az] = pts[i];
    const [bx, , bz] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 5));
    const hit = mines.find((h) => {
      for (let k = 0; k <= n; k++) if (inPoly(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, h.outline)) return true;
      return false;
    });
    if (hit) out.push({ at: i, kind: "mine", text: hit.name });
  }
  plan.stops.forEach((s, i) => {
    const z = bosses.find((b) => !b.anywhere && b.pts.some((q) => Math.hypot(q[0] - s.p[0], q[1] - s.p[2]) <= BOSS_NEAR_M));
    if (z) out.push({ at: i, kind: "boss", text: z.bosses.slice(0, 2).map((b) => `${b.name} ${Math.round(b.chance * 100)}%`).join(", ") });
  });
  return out;
}

export function planCode(p: LootPlan): string {
  const body = JSON.stringify({ m: p.map, n: p.name, s: p.spawn, t: p.stops.map((x) => [x.p[0], x.p[1], x.p[2], x.name]) });
  return CODE_PREFIX + btoa(unescape(encodeURIComponent(body)));
}

export function planFromCode(code: string): LootPlan | null {
  try {
    const c = code.trim();
    if (!c.startsWith(CODE_PREFIX)) return null;
    const o = JSON.parse(decodeURIComponent(escape(atob(c.slice(CODE_PREFIX.length)))));
    if (typeof o.m !== "string" || !Array.isArray(o.t)) return null;
    const stops: PlanStop[] = o.t
      .filter((x: unknown) => Array.isArray(x) && x.length >= 3 && [0, 1, 2].every((i) => Number.isFinite(Number((x as unknown[])[i]))))
      .slice(0, 200)
      .map((x: unknown[]) => ({ p: [Number(x[0]), Number(x[1]), Number(x[2])], name: String(x[3] ?? "").slice(0, 80) }));
    return { id: newPlanId(), map: o.m, name: String(o.n ?? "").slice(0, 60), spawn: typeof o.s === "string" ? o.s : null, stops };
  } catch {
    return null;
  }
}

/** 지도 위 경로: 지점을 잇는 선 + 번호. 지난 지점은 흐리게, 내 위치 → 다음 지점은 점선, 마지막 지점 → 내 탈출구도 점선 */
export function PlanOverlay({ plan, done, me, exit, warns, toScreen }: { plan: LootPlan; done: Set<number>; me: { x: number; z: number } | null; exit: PlanExit | null; warns: PlanWarn[]; toScreen: (x: number, z: number) => { x: number; y: number } }) {
  const pts = plan.stops.map((s) => toScreen(s.p[0], s.p[2]));
  const next = plan.stops.findIndex((_, i) => !done.has(i));
  const m = me ? toScreen(me.x, me.z) : null;
  const ex = exit ? toScreen(exit.p[0], exit.p[2]) : null;
  const all = ex ? [...pts, ex] : pts;
  const bad = new Set(warns.filter((w) => w.kind === "mine").map((w) => w.at));
  return (
    <g className="radar-plan" style={{ pointerEvents: "none" }}>
      {pts.length > 1 && <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#40e0d0" strokeWidth={1.6} strokeOpacity={0.75} strokeLinejoin="round" />}
      {ex && pts.length > 0 && <line x1={pts[pts.length - 1].x} y1={pts[pts.length - 1].y} x2={ex.x} y2={ex.y} stroke="#7dff9a" strokeWidth={1.5} strokeDasharray="6 4" />}
      {[...bad].map((i) => all[i] && all[i + 1] && <line key={`w${i}`} x1={all[i].x} y1={all[i].y} x2={all[i + 1].x} y2={all[i + 1].y} stroke="#ff5a4d" strokeWidth={2.6} strokeOpacity={0.9} />)}
      {m && next >= 0 && <line x1={m.x} y1={m.y} x2={pts[next].x} y2={pts[next].y} stroke="#40e0d0" strokeWidth={1.4} strokeDasharray="5 4" />}
      {pts.map((p, i) => (
        <g key={i} opacity={done.has(i) ? 0.35 : 1}>
          <circle cx={p.x} cy={p.y} r={i === next ? 9 : 7.5} fill={i === next ? "#40e0d0" : "#0d2a2a"} stroke="#40e0d0" strokeWidth={1.4} />
          <text x={p.x} y={p.y + 3.6} textAnchor="middle" fontSize={10} fontWeight={700} fill={i === next ? "#062020" : "#bff5ee"}>{i + 1}</text>
        </g>
      ))}
      {ex && <circle cx={ex.x} cy={ex.y} r={11} fill="none" stroke="#7dff9a" strokeWidth={1.8} strokeDasharray="3 2" />}
    </g>
  );
}

type PanelProps = {
  t: Strings;
  plans: LootPlan[]; // 이 맵의 계획
  plan: LootPlan | null;
  done: Set<number>;
  hereGroup: SpawnGroup | null; // 지금 내 위치가 속한 스폰 무리(없으면 null)
  me: { x: number; z: number } | null;
  exit: PlanExit | null;
  warns: PlanWarn[];
  keys: { name: string; own: boolean }[]; // 경로 지점 근처 잠긴 문의 열쇠(가졌는지 표시)
  autoLeftSec: number | null; // 로그로 어림한 남은 레이드 시간(PMC 만). 직접 넣은 값이 있으면 그 값이 우선
  onSelect: (id: string | null) => void;
  onNew: () => void;
  onChange: (p: LootPlan) => void;
  onDelete: (id: string) => void;
  onAddMe: () => void;
  onImport: (p: LootPlan) => void;
  onResetDone: () => void;
};

export function PlanPanel({ t, plans, plan, done, hereGroup, me, exit, warns, autoLeftSec, keys, onSelect, onNew, onChange, onDelete, onAddMe, onImport, onResetDone }: PanelProps) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [mins, setMins] = useState("");
  const move = (i: number, d: number) => {
    if (!plan) return;
    const j = i + d;
    if (j < 0 || j >= plan.stops.length) return;
    const stops = plan.stops.slice();
    [stops[i], stops[j]] = [stops[j], stops[i]];
    onChange({ ...plan, stops });
  };
  const next = plan ? plan.stops.findIndex((_, i) => !done.has(i)) : -1;
  // 남은 경로의 누적 거리·시간: 내 위치(없으면 다음 지점)에서 아직 안 지난 지점을 순서대로, 끝에 내 탈출구
  const cum: Record<number, { m: number; sec: number }> = {};
  let exitCum: { m: number; sec: number } | null = null;
  if (plan) {
    let cur: [number, number] | null = me ? [me.x, me.z] : null;
    let m = 0;
    let sec = 0;
    plan.stops.forEach((s, i) => {
      if (done.has(i)) return;
      if (cur) {
        const d = Math.hypot(s.p[0] - cur[0], s.p[2] - cur[1]) * PLAN_DETOUR;
        m += d;
        sec += d / PLAN_SPEED_MPS;
      }
      cum[i] = { m, sec };
      sec += PLAN_LOOT_SEC;
      cur = [s.p[0], s.p[2]];
    });
    if (exit && cur) {
      const d = Math.hypot(exit.p[0] - cur[0], exit.p[2] - cur[1]) * PLAN_DETOUR;
      exitCum = { m: m + d, sec: sec + d / PLAN_SPEED_MPS };
    }
  }
  const budget = Number(mins) > 0 ? Number(mins) * 60 : autoLeftSec;
  const total = exitCum ?? (plan && next >= 0 ? cum[Math.max(...Object.keys(cum).map(Number))] : null);
  const exitLegSec = exitCum && total ? exitCum.sec - Math.max(0, ...Object.values(cum).map((c) => c.sec + PLAN_LOOT_SEC)) : 0;
  // 시간 안에 드는 지점 = 그 지점까지 가서 뒤지고, 거기서 탈출구까지 갈 시간이 남는 것(탈출 구간은 마지막 구간 시간으로 어림)
  const late = (i: number) => budget != null && cum[i] != null && cum[i].sec + PLAN_LOOT_SEC + Math.max(0, exitLegSec) > budget;
  return (
    <div className="radar-planpanel">
      <div className="radar-planrow">
        <select value={plan?.id ?? ""} onChange={(e) => onSelect(e.target.value || null)} aria-label={t.radarPlan}>
          <option value="">{t.radarPlanNone}</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>{p.name || t.radarPlan}{p.spawn ? " ⚑" : ""} ({p.stops.length})</option>
          ))}
        </select>
        <button type="button" onClick={onNew}>{t.radarPlanNew}</button>
        {plan && <button type="button" onClick={() => onDelete(plan.id)}>{t.radarPlanDel}</button>}
      </div>
      {plan && (
        <>
          <div className="radar-planrow">
            <input value={plan.name} maxLength={60} placeholder={t.radarPlanName} onChange={(e) => onChange({ ...plan, name: e.target.value })} />
            {me && <button type="button" onClick={onAddMe}>{t.radarPlanAddMe}</button>}
          </div>
          <div className="radar-planrow radar-planspawn">
            <span>{plan.spawn ? t.radarPlanSpawnOn : t.radarPlanSpawnOff}</span>
            {hereGroup && plan.spawn !== hereGroup.id && <button type="button" onClick={() => onChange({ ...plan, spawn: hereGroup.id })}>{t.radarPlanSpawnHere}</button>}
            {plan.spawn && <button type="button" onClick={() => onChange({ ...plan, spawn: null })}>{t.radarPlanSpawnClear}</button>}
          </div>
          {plan.stops.length === 0 ? (
            <div className="radar-planhint">{t.radarPlanEmpty}</div>
          ) : (
            <ol className="radar-planstops">
              {plan.stops.map((s, i) => (
                <li key={i} className={done.has(i) ? "done" : late(i) ? "late" : i === next ? "next" : undefined}>
                  <span className="nm">{s.name || "—"}</span>
                  {cum[i] && me && <span className="d">{Math.round(cum[i].m)}m</span>}
                  {late(i) && <span className="d" title={t.radarPlanLate}>⏱</span>}
                  {warns.some((w) => w.at === i && w.kind === "boss") && <span className="d" title={warns.find((w) => w.at === i && w.kind === "boss")!.text}>☠</span>}
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="up">▲</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === plan.stops.length - 1} aria-label="down">▼</button>
                  <button type="button" onClick={() => onChange({ ...plan, stops: plan.stops.filter((_, k) => k !== i) })} aria-label="remove">✕</button>
                </li>
              ))}
            </ol>
          )}
          {exit && <div className="radar-planexit">➜ {t.radarPlanExit}: <b>{exit.name}</b>{exitCum && me ? ` · ${Math.round(exitCum.m)}m` : ""}</div>}
          {total && me && (
            <div className="radar-planhint">
              {t.radarPlanTotal.replace("{m}", String(Math.round(total.m))).replace("{t}", String(Math.max(1, Math.round(total.sec / 60))))}
            </div>
          )}
          {keys.length > 0 && (
            <div className="radar-plankeys">
              🔑 {t.radarPlanKeys}: {keys.map((k, i) => (
                <span key={i} className={k.own ? "own" : undefined}>{i > 0 ? ", " : ""}{k.name}{k.own ? " ✓" : ""}</span>
              ))}
            </div>
          )}
          {warns.map((w, i) => (
            <div key={i} className="radar-planwarn">
              {w.kind === "mine" ? `⚠ ${w.at + 1}→${w.at + 2 > plan.stops.length ? t.radarPlanExit : w.at + 2}: ${w.text}` : `☠ ${w.at + 1}: ${t.radarPlanWarnBoss} — ${w.text}`}
            </div>
          ))}
          <div className="radar-planrow">
            <input className="mins" inputMode="numeric" value={mins} placeholder={autoLeftSec != null ? t.radarPlanBudgetAuto.replace("{t}", String(Math.max(1, Math.round(autoLeftSec / 60)))) : t.radarPlanBudget} onChange={(e) => setMins(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
            {done.size > 0 && <button type="button" onClick={onResetDone}>{t.radarPlanReset}</button>}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(planCode(plan)).then(() => setMsg(t.radarPlanCopied), () => setMsg(""));
              }}
            >
              {t.radarPlanCopy}
            </button>
          </div>
        </>
      )}
      <div className="radar-planrow">
        <input value={code} placeholder={t.radarPlanPasteHint} onChange={(e) => setCode(e.target.value)} />
        <button
          type="button"
          disabled={!code.trim()}
          onClick={() => {
            const p = planFromCode(code);
            if (p) {
              onImport(p);
              setCode("");
              setMsg("");
            } else setMsg(t.radarPlanBadCode);
          }}
        >
          {t.radarPlanPaste}
        </button>
      </div>
      {msg && <div className="radar-planhint">{msg}</div>}
    </div>
  );
}
