// 카카오(공식 한글) + 글로벌(EN) 거래 스탯 데이터를 대조해 모드 텍스트 한글 번역 맵 생성
// 실행: node scripts/fetch-mods.mjs → public/data/mods-ko.json
//
// 거래 stats 엔드포인트는 각 스탯에 로케일 무관 id가 있어 EN↔KR을 안정적으로 조인한다.
// 텍스트는 숫자 자리에 '#' 플레이스홀더를 쓴다 → 정규화(숫자→#)한 EN을 키로, KR을 값으로.
// 런타임(modTranslate.ts)에서 아이템 모드의 숫자를 뽑아 KR 템플릿의 #에 순서대로 치환.
// 파일이 1MB대라 번들에 넣지 않고 public/에 두어 한국어일 때만 fetch(1회 캐시).

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "data", "mods-ko.json");

const EN = "https://www.pathofexile.com/api/trade/data/stats";
const KR = "https://poe.game.daum.net/api/trade/data/stats"; // → poe.kakaogames.com 리다이렉트
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// 아이템에 실제로 붙는 모드 그룹만 (pseudo=검색집계용 제외). 우선순위 순서 = 중복 시 앞선 그룹 채택.
const GROUPS = ["explicit", "implicit", "crafted", "enchant", "fractured", "veiled", "scourge", "crucible"];

async function fetchJson(url, extra = {}) {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, Accept: "application/json", ...extra } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

// 끝의 마커 괄호 제거: "(Local)" / "(특정)" / "(Legacy)" 등. 매칭·표시 모두 마커 없는 형태 사용.
const stripMarker = (s) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();
const normalize = (s) => stripMarker(s).replace(/\d+(?:\.\d+)?/g, "#").trim();

const [en, kr] = await Promise.all([
  fetchJson(EN),
  fetchJson(KR, { Referer: "https://poe.game.daum.net/trade/search/Standard" }),
]);

const krById = {};
for (const g of kr.result) for (const e of g.entries) krById[e.id] = e.text;

const map = {};
let skippedSameText = 0;
for (const gid of GROUPS) {
  const g = en.result.find((x) => x.id === gid);
  if (!g) continue;
  for (const e of g.entries) {
    const k = krById[e.id];
    if (!k) continue;
    const key = normalize(e.text);
    const val = stripMarker(k);
    if (key in map) continue; // 앞선 그룹 우선
    // KR이 EN과 동일(=미번역)하면 저장 안 함 → 런타임에서 영문 폴백
    if (val === stripMarker(e.text)) {
      skippedSameText++;
      continue;
    }
    map[key] = val;
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), source: "pathofexile.com + kakaogames trade stats", mods: map }));

console.log(`mods-ko.json: ${Object.keys(map).length} entries (미번역 스킵 ${skippedSameText})`);
