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

export interface SampleItem {
  id: string;
  label: string; // 아이템 이름 (버튼 표기)
  note?: string; // 어떤 크래프팅 데모용인지 (en)
  note_ko?: string;
  text: string;
}

/**
 * 3.29 "Curse of the Allflame" 공식 라이브 리빌(KR)에서 베스퍼 올플레임 크래프팅
 * 시연에 등장한 실제 아이템들. 화면 툴팁에서 스탯을 그대로 재구성(Ctrl+C 포맷).
 * 무형화(Intangibility) 라인은 시뮬레이터가 0에서 누적하므로 붙여넣기 텍스트에서는 제외.
 * 출처: https://www.youtube.com/watch?v=Sp3INL721x0 (베스퍼 크래프팅 구간)
 */
export const SAMPLE_ITEMS: SampleItem[] = [
  {
    id: "demon-bite",
    label: "Demon Bite",
    note: "Minion/spell wand (fossil reforge demo)",
    note_ko: "소환수/주문 완드 (화석 리포지 시연)",
    text: `Item Class: Wands
Rarity: Rare
Demon Bite
Convoking Wand
--------
Wand
Physical Damage: 28-52
Critical Strike Chance: 8.00%
Attacks per Second: 1.50
--------
Requirements:
Level: 72
Int: 242
--------
Item Level: 84
--------
Minions deal 28% increased Damage (implicit)
--------
37% increased Spell Damage
9% increased Cast Speed
+1 to Level of all Spell Skill Gems
+1 to Level of all Minion Skill Gems
Grants 7 Life per Enemy Hit
Minions have 6% increased Attack and Cast Speed`,
  },
  {
    id: "tempest-twine",
    label: "Tempest Twine",
    note: "Life/resist belt",
    note_ko: "생명력/저항 벨트",
    text: `Item Class: Belts
Rarity: Rare
Tempest Twine
Leather Belt
--------
Requirements:
Level: 60
--------
Item Level: 84
--------
+27 to maximum Life (implicit)
--------
+116 to maximum Life
+65 to maximum Mana
+39% to Fire Resistance
+44% to Lightning Resistance
+25% to Chaos Resistance
17% increased Flask Life Recovery rate`,
  },
  {
    id: "armageddon-league",
    label: "Armageddon League",
    note: "Energy shield boots",
    note_ko: "에너지 보호막 장화",
    text: `Item Class: Boots
Rarity: Rare
Armageddon League
Sorcerer Boots
--------
Energy Shield: 188
--------
Requirements:
Level: 67
Int: 123
--------
Item Level: 84
--------
30% increased Movement Speed
+43 to maximum Energy Shield
90% increased Energy Shield
+30% to Lightning Resistance`,
  },
  {
    id: "corsair-sword",
    label: "Corsair Sword",
    note: "Attack sword (Kishara's Ducat demo)",
    note_ko: "공격 검 (키샤라의 두카트 시연)",
    text: `Item Class: One Hand Swords
Rarity: Rare
Corsair Sword
Corsair Sword
--------
One Handed Sword
Physical Damage: 20-80
Critical Strike Chance: 5.00%
Attacks per Second: 1.55
Weapon Range: 1.1 metres
--------
Requirements:
Level: 58
Str: 81
Dex: 117
--------
Item Level: 84
--------
40% increased Global Accuracy Rating
24% increased Attack Speed
Adds 29 to 46 Physical Damage
14% reduced Enemy Stun Threshold`,
  },
];

/** 하위호환: 기존 단일 예시 참조 */
export const SAMPLE_ITEM_TEXT = SAMPLE_ITEMS[0].text;
