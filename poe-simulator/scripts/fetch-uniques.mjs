// poe.ninja에서 유니크 방어구 목록을 수집해 src/data/uniques.json 생성
// 실행: node scripts/fetch-uniques.mjs
// Standard 리그를 소스로 사용 (역대 유니크가 가장 완전함)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "src", "data", "uniques.json");

const API =
  "https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=Standard&type=UniqueArmour";

// 인슈라우딩 대상 슬롯 5종 (3.29: 장신구·무기 불가)
const SLOTS = ["Body Armour", "Helmet", "Gloves", "Boots", "Shield"];

const res = await fetch(API, {
  headers: { "User-Agent": "poe-enshrouding-sim/0.1 (data build script)" },
});
if (!res.ok) throw new Error(`poe.ninja API ${res.status}`);
const { lines } = await res.json();

const seen = new Set();
const uniques = [];
for (const l of lines) {
  if (!SLOTS.includes(l.itemType)) continue;
  // 동일 유니크가 6링크/변형별로 중복 등장 → 이름+베이스로 1회만
  const key = `${l.name}|${l.baseType}`;
  if (seen.has(key)) continue;
  seen.add(key);
  uniques.push({
    name: l.name,
    baseType: l.baseType,
    slot: l.itemType,
    icon: l.icon,
    levelRequired: l.levelRequired ?? 0,
    implicits: (l.implicitModifiers ?? []).map((m) => m.text),
    explicits: (l.explicitModifiers ?? []).map((m) => m.text),
    flavourText: l.flavourText ?? "",
    isReplica: l.name.startsWith("Replica "),
    detailsId: l.detailsId,
  });
}

uniques.sort((a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), source: "poe.ninja Standard", uniques }, null, 1));

const bySlot = {};
for (const u of uniques) bySlot[u.slot] = (bySlot[u.slot] ?? 0) + 1;
console.log(`total: ${uniques.length}`, bySlot);
