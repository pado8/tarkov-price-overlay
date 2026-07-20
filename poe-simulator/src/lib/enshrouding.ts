import type { CrystalInfo, Eligibility, UniqueItem, VestigialEntry } from "./types";
import uniquesData from "@/data/uniques.json";
import vestigialData from "@/data/vestigial.json";
import crystalsData from "@/data/crystals.json";
import poolOverrides from "@/data/pool-overrides.json";

export const ALL_UNIQUES = (uniquesData as { uniques: UniqueItem[] }).uniques;
export const CRYSTALS = (crystalsData as unknown as { crystals: CrystalInfo[] }).crystals;
export const DATA_FETCHED_AT = (uniquesData as { fetchedAt: string }).fetchedAt;

const VESTIGIAL_ENTRIES = (vestigialData as unknown as { entries: Record<string, VestigialEntry> }).entries;
const EXCLUDED_FROM_POOL = new Set((poolOverrides as { excludedFromPool: string[] }).excludedFromPool);
const FATELORN = new Set((poolOverrides as { fatelornUniques: string[] }).fatelornUniques);

/** 3.29 규칙: 방어구 5슬롯만, 타락 불가, Fatelorn 불가. reasons는 i18n 키. */
export function getEligibility(item: UniqueItem, opts: { corrupted: boolean }): Eligibility {
  const reasons: string[] = [];
  if (opts.corrupted) reasons.push("reason_corrupted");
  if (FATELORN.has(item.name)) reasons.push("reason_fatelorn");
  return { eligible: reasons.length === 0, reasons };
}

/** 결과 풀: 같은 슬롯의 다른 유니크 (Ancient Orb 획득 가능 풀, 보스 전용 제외) */
export function getOutputPool(item: UniqueItem): UniqueItem[] {
  return ALL_UNIQUES.filter(
    (u) => u.slot === item.slot && u.name !== item.name && !EXCLUDED_FROM_POOL.has(u.name),
  );
}

export function getVestigial(item: UniqueItem): VestigialEntry {
  return VESTIGIAL_ENTRIES[item.name] ?? { mod: null, status: "unknown" };
}

export function getCrystalForSlot(slot: UniqueItem["slot"]): CrystalInfo | undefined {
  return CRYSTALS.find((c) => c.slot === slot);
}
