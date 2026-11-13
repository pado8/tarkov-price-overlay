// 레이드 준비 화면(11-13): 고른 맵 하나에 대해 '들어가기 전에 볼 것'을 한 화면에 모은다.
// 퀘스트 목표·필요한 열쇠 · 탈출구와 조건 · 보스 확률 · 위험 구역 · 내 루팅 계획 · 챙길 것.
// 새 자료를 받지 않는다 — 지도 문서(doc)와 레이더 응답(targets), 이 PC 의 계획·내 열쇠만 쓴다.
import type { RadarTarget } from "./Radar";
import type { LootPlan } from "./LootPlan";

type Strings = { [k: string]: string };
const COND_KEYS: [string, string][] = [
  ["lever", "radarSwitch"], ["key", "radarKey"], ["flare", "radarFlare"], ["item", "radarItem"], ["paid", "radarPaid"],
  ["coop", "radarCoop"], ["nobag", "radarNoBag"], ["climb", "radarClimb"], ["time", "radarTime"],
];
const clean = (s: string) => s.replace(/^[·\s]+/, "");

type Props = {
  t: Strings;
  mapName: string;
  raidMin: number | null;
  side: "pmc" | "scav" | null; // 이번 레이드 진영(모르면 null → 둘 다 보여 줌)
  targets: RadarTarget[];
  bosses: { name: string; bosses: { name: string; chance: number }[]; anywhere?: boolean }[];
  mines: number;
  snipers: number;
  plans: LootPlan[];
  planId: string | null;
  planKeys: { name: string; own: boolean }[];
  onPickPlan: (id: string) => void;
};

export function RaidPrep({ t, mapName, raidMin, side, targets, bosses, mines, snipers, plans, planId, planKeys, onPickPlan }: Props) {
  const quests = targets.filter((x) => x.kind === "quest");
  const byTask = new Map<string, { n: number; keys: Set<string> }>();
  for (const q of quests) {
    const k = q.task ?? q.name;
    const e = byTask.get(k) ?? { n: 0, keys: new Set<string>() };
    e.n += 1;
    (q.keys ?? []).forEach((x) => e.keys.add(x));
    byTask.set(k, e);
  }
  const questKeys = [...new Set(quests.flatMap((q) => q.keys ?? []))];
  const exits = targets.filter((x) => x.kind === "extract" && (!side || !x.faction || x.faction === "shared" || x.faction === side));
  const condOf = (x: RadarTarget) => {
    const tags = x.cond ?? [...(x.switch ? ["lever"] : []), ...(x.paid ? ["paid"] : [])];
    return COND_KEYS.filter(([k]) => tags.includes(k)).map(([, s]) => clean(t[s] ?? k(s)));
  };
  const k = (s: string) => s;
  const open = exits.filter((x) => condOf(x).length === 0);
  const cond = exits.filter((x) => condOf(x).length > 0);
  const needFlare = exits.some((x) => (x.cond ?? []).includes("flare"));
  const needClimb = exits.some((x) => (x.cond ?? []).includes("climb"));
  // 구역마다 보스가 겹쳐 나오므로 보스 이름별 가장 높은 확률만
  const bossMax = new Map<string, number>();
  bosses.forEach((z) => z.bosses.forEach((b) => bossMax.set(b.name, Math.max(bossMax.get(b.name) ?? 0, b.chance))));
  const bossList = [...bossMax.entries()].sort((a, b) => b[1] - a[1]);
  const bring = [
    ...(questKeys.length ? [`🔑 ${t.radarPrepQuestKeys}: ${questKeys.join(", ")}`] : []),
    ...(planKeys.length ? [`🔑 ${t.radarPlanKeys}: ${planKeys.map((x) => x.name + (x.own ? " ✓" : "")).join(", ")}`] : []),
    ...(needFlare ? [t.radarPrepFlare] : []),
    ...(needClimb ? [t.radarPrepClimb] : []),
  ];
  return (
    <div className="radar-prep">
      <div className="radar-prep-h">
        <b>{mapName}</b>
        {raidMin ? <span> · {t.radarPrepRaid.replace("{n}", String(raidMin))}</span> : null}
        {side ? <span> · {side === "scav" ? t.radarSideScav : t.radarSidePmc}</span> : null}
      </div>
      <section>
        <h4>{t.radarPrepQuests} {byTask.size > 0 && <i>{byTask.size}</i>}</h4>
        {byTask.size === 0 ? <p className="dim">{t.radarPrepNoQuests}</p> : (
          <ul>
            {[...byTask.entries()].slice(0, 12).map(([name, e]) => (
              <li key={name}>{name}{e.n > 1 ? ` ×${e.n}` : ""}{e.keys.size ? <span className="key"> 🔑 {[...e.keys].join(", ")}</span> : null}</li>
            ))}
            {byTask.size > 12 && <li className="dim">+{byTask.size - 12}</li>}
          </ul>
        )}
      </section>
      <section>
        <h4>{t.radarPrepExits} <i>{exits.length}</i></h4>
        {open.length > 0 && <p>{t.radarPrepExitsOpen}: {open.map((x) => x.name).join(", ")}</p>}
        {cond.length > 0 && (
          <ul>
            {cond.map((x, i) => <li key={i}>{x.name} <span className="cond">{condOf(x).join(" · ")}</span></li>)}
          </ul>
        )}
        {exits.length === 0 && <p className="dim">{t.radarPrepNoData}</p>}
      </section>
      <section>
        <h4>{t.radarPrepDanger}</h4>
        <p>
          {bossList.length ? bossList.map(([n, c]) => `☠ ${n} ${Math.round(c * 100)}%`).join(" · ") : t.radarPrepNoBoss}
          {mines > 0 ? ` · ⚠ ${t.radarPrepMines.replace("{n}", String(mines))}` : ""}
          {snipers > 0 ? ` · ⌖ ${t.radarPrepSnipers.replace("{n}", String(snipers))}` : ""}
        </p>
      </section>
      <section>
        <h4>{t.radarPlan} {plans.length > 0 && <i>{plans.length}</i>}</h4>
        {plans.length === 0 ? <p className="dim">{t.radarPrepNoPlan}</p> : (
          <div className="radar-prep-plans">
            {plans.map((p) => (
              <button key={p.id} type="button" className={p.id === planId ? "on" : undefined} onClick={() => onPickPlan(p.id)}>
                {p.name || t.radarPlan}{p.spawn ? " ⚑" : ""} ({p.stops.length})
              </button>
            ))}
          </div>
        )}
      </section>
      {bring.length > 0 && (
        <section>
          <h4>{t.radarPrepBring}</h4>
          <ul>{bring.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
