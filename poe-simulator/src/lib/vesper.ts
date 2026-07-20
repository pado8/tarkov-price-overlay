// 올플레임(베스퍼) 크래프팅 엔진: 파싱된 아이템에 화폐/두캇을 적용해 고스트 변형을 생성
// 모드 추가/재굴림은 간이 모드 풀(generic-mods.json, placeholder) 사용 — 정식 풀 주입 전까지의 근사.

import type { ParsedItem } from "./itemParser";
import genericMods from "@/data/generic-mods.json";
import allflameData from "@/data/allflame.json";

export type Tier = "low" | "medium" | "high";

export interface VesperCurrency {
  id: string;
  name: string;
  tier: Tier;
  ducat?: boolean;
  disabled?: string; // 사용 불가 사유 (i18n 키 아님, 짧은 설명)
}

export const VESPER_CURRENCIES: VesperCurrency[] = [
  { id: "transmute", name: "Orb of Transmutation", tier: "low" },
  { id: "alt", name: "Orb of Alteration", tier: "low" },
  { id: "aug", name: "Orb of Augmentation", tier: "low" },
  { id: "alch", name: "Orb of Alchemy", tier: "low" },
  { id: "scour", name: "Orb of Scouring", tier: "low" },
  { id: "chaos", name: "Chaos Orb", tier: "medium" },
  { id: "regal", name: "Regal Orb", tier: "medium" },
  { id: "essence", name: "Essence (reforge)", tier: "medium" },
  { id: "fossil", name: "Fossil (reforge)", tier: "medium" },
  { id: "annul", name: "Orb of Annulment", tier: "high" },
  { id: "exalt", name: "Exalted Orb", tier: "high" },
  { id: "divine", name: "Divine Orb", tier: "high" },
  { id: "kishara", name: "Kishara's Ducat", tier: "high", ducat: true },
  { id: "genteel", name: "Genteel's Ducat", tier: "medium", ducat: true },
  { id: "brinehook", name: "Brinehook's Ducat", tier: "high", ducat: true, disabled: "mechanics undisclosed" },
  { id: "vaal", name: "Vaal Orb", tier: "high", disabled: "not usable with Vesper" },
];

const CFG = allflameData.config;
export const GHOST_COPIES: number = CFG.ghostCopies.value;
export const KISHARA_COPIES = 4; // reported: 고스트 4개

export function tierIntangibility(tier: Tier): number {
  return Number((CFG.intangibilityTiers as Record<string, unknown>)[tier]) || 0;
}
export function tierSulphur(tier: Tier): number {
  return Number((CFG.sulphurCostTiers as Record<string, unknown>)[tier]) || 0;
}
export const RESET_DUCAT_ODDS: number = CFG.resetDucatOdds.value;

// ---------- 간이 모드 풀 ----------

interface GenericMod {
  text: string;
  min: number;
  max: number;
}

const PREFIXES = genericMods.prefixes as GenericMod[];
const SUFFIXES = genericMods.suffixes as GenericMod[];

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function rollGeneric(pool: GenericMod[], exclude: Set<string>): string {
  const candidates = pool.filter((m) => !exclude.has(m.text));
  const m = candidates.length > 0 ? pick(candidates) : pick(pool);
  exclude.add(m.text);
  return m.text.replace("{v}", String(rand(m.min, m.max)));
}

/** 접두 p개 + 접미 s개의 새 모드 목록 생성 */
function rollMods(prefixCount: number, suffixCount: number): string[] {
  const used = new Set<string>();
  const mods: string[] = [];
  for (let i = 0; i < prefixCount; i++) mods.push(rollGeneric(PREFIXES, used));
  for (let i = 0; i < suffixCount; i++) mods.push(rollGeneric(SUFFIXES, used));
  return mods;
}

/** 레어 4~6모드 (접두 1-3, 접미 1-3, 합 4-6) */
function rollRareMods(): string[] {
  let p = rand(1, 3);
  let s = rand(1, 3);
  while (p + s < 4) {
    if (p < 3 && (s >= 3 || Math.random() < 0.5)) p++;
    else s++;
  }
  return rollMods(p, s);
}

const rollMagicMods = (): string[] => (Math.random() < 0.5 ? rollMods(1, 1) : Math.random() < 0.5 ? rollMods(1, 0) : rollMods(0, 1));

/** 기존 모드의 숫자를 ±20% 내에서 재굴림 (디바인 근사) */
function jiggleNumbers(mod: string): string {
  return mod.replace(/\d+(\.\d+)?/g, (n) => {
    const v = parseFloat(n);
    const nv = v * (0.8 + Math.random() * 0.4);
    return n.includes(".") ? nv.toFixed(1) : String(Math.max(1, Math.round(nv)));
  });
}

// ---------- 적용 가능 여부 ----------

export function canApply(item: ParsedItem, c: VesperCurrency): { ok: boolean; reason?: string } {
  if (c.disabled) return { ok: false, reason: c.disabled };
  if (item.corrupted) return { ok: false, reason: "corrupted" };
  const mods = item.explicits.length;
  switch (c.id) {
    case "transmute":
      return item.rarity === "Normal" ? { ok: true } : { ok: false, reason: "requires Normal" };
    case "alt":
      return item.rarity === "Magic" ? { ok: true } : { ok: false, reason: "requires Magic" };
    case "aug":
      return item.rarity === "Magic" && mods < 2 ? { ok: true } : { ok: false, reason: "requires Magic, <2 mods" };
    case "alch":
      return item.rarity === "Normal" ? { ok: true } : { ok: false, reason: "requires Normal" };
    case "regal":
      return item.rarity === "Magic" ? { ok: true } : { ok: false, reason: "requires Magic" };
    case "chaos":
      return item.rarity === "Rare" ? { ok: true } : { ok: false, reason: "requires Rare" };
    case "scour":
      return (item.rarity === "Magic" || item.rarity === "Rare")
        ? { ok: true }
        : { ok: false, reason: "requires Magic/Rare" };
    case "annul":
      return (item.rarity === "Magic" || item.rarity === "Rare") && mods > 0
        ? { ok: true }
        : { ok: false, reason: "requires mods" };
    case "exalt":
      return item.rarity === "Rare" && mods < 6 ? { ok: true } : { ok: false, reason: "requires Rare, <6 mods" };
    case "divine":
      return mods > 0 ? { ok: true } : { ok: false, reason: "requires mods" };
    case "essence":
    case "fossil":
      return item.rarity !== "Unique" ? { ok: true } : { ok: false, reason: "not on Unique" };
    case "kishara":
      return item.rarity === "Rare" && mods >= 2 ? { ok: true } : { ok: false, reason: "requires Rare, 2+ mods" };
    case "genteel": {
      const r = item.requirements;
      return (r.str ?? 0) + (r.dex ?? 0) + (r.int ?? 0) > 0
        ? { ok: true }
        : { ok: false, reason: "requires attribute requirement" };
    }
    default:
      return { ok: false, reason: "unknown" };
  }
}

// ---------- 적용 (변형 1개 생성) ----------

function clone(item: ParsedItem): ParsedItem {
  return JSON.parse(JSON.stringify(item));
}

export function applyCurrency(item: ParsedItem, c: VesperCurrency): ParsedItem {
  const v = clone(item);
  switch (c.id) {
    case "transmute":
      v.rarity = "Magic";
      v.explicits = rollMagicMods();
      break;
    case "alt":
      v.explicits = rollMagicMods();
      break;
    case "aug":
      v.explicits = [...v.explicits, ...(Math.random() < 0.5 ? rollMods(1, 0) : rollMods(0, 1))];
      break;
    case "alch":
      v.rarity = "Rare";
      v.explicits = rollRareMods();
      break;
    case "regal":
      v.rarity = "Rare";
      v.explicits = [...v.explicits, ...(Math.random() < 0.5 ? rollMods(1, 0) : rollMods(0, 1))];
      break;
    case "chaos":
    case "essence":
    case "fossil":
      v.rarity = "Rare";
      v.explicits = rollRareMods();
      break;
    case "scour":
      v.rarity = "Normal";
      v.explicits = [];
      break;
    case "annul":
      v.explicits = v.explicits.filter((_, i) => i !== Math.floor(Math.random() * v.explicits.length));
      break;
    case "exalt":
      v.explicits = [...v.explicits, ...(Math.random() < 0.5 ? rollMods(1, 0) : rollMods(0, 1))];
      break;
    case "divine":
      v.explicits = v.explicits.map(jiggleNumbers);
      break;
    case "kishara": {
      // 원본 모드 1개만 유지 (고스트마다 다른 모드)
      const keep = pick(v.explicits);
      v.explicits = [keep];
      break;
    }
    case "genteel": {
      // 능력치 요구 교체: 현재 최대 요구 능력치를 다른 능력치로
      const r = v.requirements;
      const attrs: Array<"str" | "dex" | "int"> = ["str", "dex", "int"];
      const current = attrs.filter((a) => (r[a] ?? 0) > 0);
      if (current.length > 0) {
        const from = pick(current);
        const others = attrs.filter((a) => a !== from);
        const to = pick(others);
        r[to] = (r[to] ?? 0) + (r[from] ?? 0);
        r[from] = 0;
      }
      break;
    }
  }
  return v;
}

/** 고스트 미리보기 생성. 무형화 발동(single) 시 1개, Kishara는 4개(각각 다른 모드 유지) */
export function generateGhosts(item: ParsedItem, c: VesperCurrency, single: boolean): ParsedItem[] {
  if (c.id === "kishara") {
    // 서로 다른 원본 모드를 유지하는 4개 (모드 수보다 많으면 중복 허용)
    const shuffled = [...item.explicits].sort(() => Math.random() - 0.5);
    const count = single ? 1 : KISHARA_COPIES;
    return Array.from({ length: count }, (_, i) => {
      const v = clone(item);
      v.explicits = [shuffled[i % shuffled.length]];
      return v;
    });
  }
  const count = single ? 1 : GHOST_COPIES;
  return Array.from({ length: count }, () => applyCurrency(item, c));
}
