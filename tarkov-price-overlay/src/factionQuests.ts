// PMC 진영(BEAR/USEC)으로 카드 퀘스트 행 거르기 — App.tsx 가 쓴다. 순수 함수라 dev/faction-quests.test.ts 로 검증한다.
//
// 11-06: 퀘스트 34개(BEAR 17·USEC 17)는 진영 전용이라 같은 이름 퀘스트가 두 판 있다(Textile·Drip-Out 등).
// 앱이 진영을 몰라 카드에 「Textile - Part 1」이 두 줄씩 나왔다.
//   · 진영을 알면(설정에서 고름, 또는 '자동' = 사이드카가 진영 전용 퀘스트 기록으로 추정) 반대 진영 판을 뺀다.
//   · 모르면 이름이 같은 두 판 중 요구 개수·FiR 가 같은 건 한 줄로 합치고(factionTag 'both' — 어느 진영이든 맞아 화면엔 표시 안 함),
//     다르면 진영을 붙여(factionTag 'BEAR'|'USEC', 카드에 작은 표시) 둘 다 둔다.
export type Faction = "BEAR" | "USEC";
export type FactionSetting = "auto" | Faction;
export type FactionTag = Faction | "both";

export function effectiveFaction(setting: FactionSetting | undefined, detected: string | null | undefined): Faction | null {
  if (setting === "BEAR" || setting === "USEC") return setting;
  return detected === "BEAR" || detected === "USEC" ? detected : null;
}

type Row = { name: string; faction?: string | null; count?: number | null; fir?: boolean };

export function filterFactionQuests<T extends Row>(rows: T[], f: Faction | null): (T & { factionTag?: FactionTag })[] {
  const isF = (x: T) => x.faction === "BEAR" || x.faction === "USEC";
  if (f) return rows.filter((r) => !isF(r) || r.faction === f);
  const out: (T & { factionTag?: FactionTag })[] = [];
  const merged = new Set<T>();
  for (const r of rows) {
    if (merged.has(r)) continue;
    if (!isF(r)) {
      out.push(r);
      continue;
    }
    const twin = rows.find((o) => o !== r && isF(o) && o.faction !== r.faction && o.name === r.name && !merged.has(o));
    if (twin && (twin.count ?? null) === (r.count ?? null) && !!twin.fir === !!r.fir) {
      merged.add(twin);
      out.push({ ...r, factionTag: "both" });
    } else {
      out.push({ ...r, factionTag: r.faction as Faction });
    }
  }
  return out;
}
