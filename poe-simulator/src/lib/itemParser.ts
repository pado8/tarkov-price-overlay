// PoE 인게임 Ctrl+C 아이템 텍스트 파서
// 섹션은 "--------" 구분선으로 나뉜다.

export interface ParsedItem {
  itemClass: string;
  rarity: "Normal" | "Magic" | "Rare" | "Unique" | "Unknown";
  name: string;
  baseType: string;
  quality: number;
  itemLevel: number;
  requirements: { level?: number; str?: number; dex?: number; int?: number };
  sockets: string;
  implicits: string[];
  explicits: string[];
  corrupted: boolean;
}

const SECTION_SPLIT = /\r?\n-{3,}\r?\n/;

export function parseItemText(text: string): ParsedItem | { error: string } {
  const sections = text
    .trim()
    .split(SECTION_SPLIT)
    .map((s) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    .filter((s) => s.length > 0);

  if (sections.length === 0) return { error: "empty" };

  const header = sections[0];
  const item: ParsedItem = {
    itemClass: "",
    rarity: "Unknown",
    name: "",
    baseType: "",
    quality: 0,
    itemLevel: 0,
    requirements: {},
    sockets: "",
    implicits: [],
    explicits: [],
    corrupted: false,
  };

  // 헤더: Item Class / Rarity / 이름 1~2줄
  const nameLines: string[] = [];
  for (const line of header) {
    const cls = line.match(/^Item Class:\s*(.+)$/i);
    const rar = line.match(/^Rarity:\s*(.+)$/i);
    if (cls) item.itemClass = cls[1];
    else if (rar) {
      const r = rar[1].trim();
      item.rarity = (["Normal", "Magic", "Rare", "Unique"].find((x) => x.toLowerCase() === r.toLowerCase()) ??
        "Unknown") as ParsedItem["rarity"];
    } else nameLines.push(line);
  }
  if (nameLines.length >= 2) {
    item.name = nameLines[0];
    item.baseType = nameLines[1];
  } else if (nameLines.length === 1) {
    item.name = nameLines[0];
    item.baseType = nameLines[0];
  } else {
    return { error: "no-name" };
  }

  let ilvlSectionIdx = -1;

  sections.slice(1).forEach((sec, i) => {
    const idx = i + 1;
    for (const line of sec) {
      const q = line.match(/^Quality:\s*\+?(\d+)%/i);
      const il = line.match(/^Item Level:\s*(\d+)/i);
      const so = line.match(/^Sockets:\s*(.+)$/i);
      const lv = line.match(/^Level:\s*(\d+)/i);
      const st = line.match(/^Str(?:ength)?:\s*(\d+)/i);
      const dx = line.match(/^Dex(?:terity)?:\s*(\d+)/i);
      const it = line.match(/^Int(?:elligence)?:\s*(\d+)/i);
      if (q) item.quality = Number(q[1]);
      if (il) {
        item.itemLevel = Number(il[1]);
        ilvlSectionIdx = idx;
      }
      if (so) item.sockets = so[1].trim();
      if (lv) item.requirements.level = Number(lv[1]);
      if (st) item.requirements.str = Number(st[1]);
      if (dx) item.requirements.dex = Number(dx[1]);
      if (it) item.requirements.int = Number(it[1]);
      if (/^Corrupted$/i.test(line)) item.corrupted = true;
      if (/\((implicit|enchant)\)\s*$/i.test(line)) {
        item.implicits.push(line.replace(/\s*\((implicit|enchant)\)\s*$/i, ""));
      }
    }
  });

  // 명시적 모드: Item Level 섹션 뒤에서, 마커 없는 첫 텍스트 섹션
  const isMarkerSection = (sec: string[]) =>
    sec.every(
      (l) =>
        /\((implicit|enchant)\)\s*$/i.test(l) ||
        /^(Corrupted|Mirrored|Split|Unmodifiable)$/i.test(l) ||
        /^(Note|Item Class|Rarity|Quality|Sockets|Item Level|Requirements|Level|Str|Dex|Int|Armour|Evasion Rating|Energy Shield|Ward):/i.test(l) ||
        /^\(.*\)$/.test(l),
    );

  if (ilvlSectionIdx >= 0) {
    for (let i = ilvlSectionIdx + 1; i < sections.length; i++) {
      const sec = sections[i];
      if (isMarkerSection(sec)) continue;
      item.explicits = sec
        .filter((l) => !/\((implicit|enchant)\)\s*$/i.test(l) && !/^(Corrupted|Mirrored)$/i.test(l))
        .map((l) => l.replace(/\s*\(crafted\)\s*$/i, " (crafted)").trim());
      break;
    }
  }

  return item;
}

/** 데모/테스트용 예시 레어 아이템 (Ctrl+C 포맷) */
export const SAMPLE_ITEM_TEXT = `Item Class: Body Armours
Rarity: Rare
Entropy Shell
Astral Plate
--------
Quality: +20% (augmented)
Armour: 2114 (augmented)
--------
Requirements:
Level: 62
Str: 180
--------
Sockets: R-R-R-B-B-G
--------
Item Level: 86
--------
+12% to all Elemental Resistances (implicit)
--------
+95 to maximum Life
+42% to Fire Resistance
+37% to Cold Resistance
+58 to maximum Mana
--------
Note: ~price 1 divine`;
