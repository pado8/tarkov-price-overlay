// poe.ninja에서 유니크 방어구 목록을 수집해 src/data/uniques.json 생성
// + 카카오(공식 한글) 거래 데이터로 이름/베이스 한글명(name_ko, baseType_ko) 보강
// 실행: node scripts/fetch-uniques.mjs
// Standard 리그를 소스로 사용 (역대 유니크가 가장 완전함)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "src", "data", "uniques.json");

const API =
  "https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=Standard&type=UniqueArmour";

// 공식 한글명: 글로벌(EN) + 카카오(KR) 거래 데이터를 카테고리별로 대조.
// 두 로케일은 카테고리 순서·항목 순서가 동일 → 유니크 항목(flags.unique)만 뽑아 인덱스로 zip.
// 유니크 부분집합은 전 카테고리에서 개수가 완전히 일치함(검증됨). 베이스 타입은
// 유니크 항목의 type 필드에서 파생(내가 필요한 베이스는 전부 유니크를 가지므로 100% 커버).
const TRADE_EN = "https://www.pathofexile.com/api/trade/data/items";
const TRADE_KR = "https://poe.game.daum.net/api/trade/data/items"; // → poe.kakaogames.com 리다이렉트

// 3.29 신규 접두 변형: 한글명 미확정이므로 영문 접두 유지 + 안쪽 유니크 한글명 조합
const NEW_PREFIXES = ["Foulborn "];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchJson(url, extraHeaders = {}) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": UA, Accept: "application/json", ...extraHeaders },
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function buildKoMaps() {
  let en, kr;
  try {
    [en, kr] = await Promise.all([
      fetchJson(TRADE_EN),
      fetchJson(TRADE_KR, { Referer: "https://poe.game.daum.net/trade/search/Standard" }),
    ]);
  } catch (e) {
    console.warn(`⚠ 한글명 보강 건너뜀 (거래 데이터 실패): ${e.message}`);
    return { nameMap: {}, baseMap: {} };
  }
  const krById = Object.fromEntries(kr.result.map((c) => [c.id, c]));
  const nameMap = {};
  const baseMap = {}; // 전체 베이스 타입 영문→한글 (유니크 명·베이스 표기 + 붙여넣기 아이템 베이스 번역용)
  for (const cat of en.result) {
    const k = krById[cat.id];
    if (!k) continue;
    // (a) 유니크 항목: 이름 + 베이스. 유니크 부분집합은 전 카테고리 개수 정합(검증됨).
    const eu = cat.entries.filter((x) => x.flags?.unique && x.name);
    const ku = k.entries.filter((x) => x.flags?.unique && x.name);
    if (eu.length === ku.length) {
      for (let i = 0; i < eu.length; i++) {
        if (eu[i].name) nameMap[eu[i].name] = ku[i].name;
        if (eu[i].type && ku[i].type && !(eu[i].type in baseMap)) baseMap[eu[i].type] = ku[i].type;
      }
    }
    // (b) 비유니크 베이스 항목: 개수 일치 카테고리만 index zip(armour/monster/graft는 1개씩 어긋나 스킵).
    //     유니크 없는 베이스(예: Convoking Wand)까지 커버.
    const eb = cat.entries.filter((x) => !(x.flags?.unique));
    const kb = k.entries.filter((x) => !(x.flags?.unique));
    if (eb.length === kb.length) {
      for (let i = 0; i < eb.length; i++) {
        if (eb[i].type && kb[i].type && !(eb[i].type in baseMap)) baseMap[eb[i].type] = kb[i].type;
      }
    }
  }
  return { nameMap, baseMap };
}

/** 유니크 영문명 → 한글명. Foulborn 등 신규 접두는 접두(영문)+안쪽 한글명으로 조합 */
function koName(enName, nameMap) {
  if (nameMap[enName]) return nameMap[enName];
  for (const p of NEW_PREFIXES) {
    if (enName.startsWith(p) && nameMap[enName.slice(p.length)]) {
      return p + nameMap[enName.slice(p.length)];
    }
  }
  return null; // UI에서 영문 폴백
}

// 인슈라우딩 대상 슬롯 5종 (3.29: 장신구·무기 불가)
const SLOTS = ["Body Armour", "Helmet", "Gloves", "Boots", "Shield"];

const { lines } = await fetchJson(API, { "User-Agent": "poe-enshrouding-sim/0.1 (data build script)" });
const { nameMap, baseMap } = await buildKoMaps();

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
    name_ko: koName(l.name, nameMap),
    baseType: l.baseType,
    baseType_ko: baseMap[l.baseType] ?? null,
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
writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), source: "poe.ninja Standard + Kakao trade (ko)", uniques }, null, 1));

// 전체 베이스 타입 영문→한글 맵 (붙여넣기/샘플 아이템 베이스 번역용). public 정적 에셋으로 fetch.
const BASES_OUT = join(__dirname, "..", "public", "data", "bases-ko.json");
mkdirSync(dirname(BASES_OUT), { recursive: true });
writeFileSync(BASES_OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), source: "pathofexile.com + kakaogames trade items", bases: baseMap }));

const bySlot = {};
for (const u of uniques) bySlot[u.slot] = (bySlot[u.slot] ?? 0) + 1;
const koCount = uniques.filter((u) => u.name_ko).length;
console.log(`total: ${uniques.length}`, bySlot);
console.log(`한글명 매핑: 이름 ${koCount}/${uniques.length}, 베이스 ${uniques.filter((u) => u.baseType_ko).length}/${uniques.length}`);
console.log(`bases-ko.json: ${Object.keys(baseMap).length}종`);
