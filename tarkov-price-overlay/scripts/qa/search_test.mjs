// 실제 search.js 의 검색 함수(norm·cho·near·find)를 잘라 실행해, 자주 찾는 말이 0건이 아닌지 본다(11-04 점검 회귀 방지).
// 사용: node scripts/qa/search_test.mjs [landing/guide 경로]   종료 코드 1 = 0건 질의 있음
import fs from "node:fs";
const ROOT = (process.argv[2] || "landing/guide").replace(/\/?$/, "/");
const MUST = {
  "": ["카파", "kappa", "컬렉터", "ㅋㅍ", "데뷔", "대뷔", "킬라", "태길라", "레샬라", "글루하", "샤투른", "보스", "M855A1", "7.62x39", "탄약",
       "하이드아웃", "팩토리", "랩", "레덱스", "IFAK", "SICC", "탈출구", "프로모", "건스미스", "프레스티지", "쇄빙선", "UN Roadblock 없음?", "모딩", "M4A1", "AK-74N", "모신"],
  "en/": ["kappa", "collector", "tagilla", "reshala", "m855a1", "extract", "crafts", "ifak", "sicc", "hideout", "icebreaker", "weapon build", "m4a1"],
  "ru/": ["каппа", "тагилла", "решала", "патроны", "убежище", "крафт", "сборка", "m4a1"],
  "zh/": ["kappa", "收藏家", "藏身处", "弹药", "海关", "tagilla", "枪匠", "破冰船", "撤离点", "m855a1", "ifak", "改装", "m4a1"],
};
const ALLOW_ZERO = new Set(["UN Roadblock 없음?"]);  // 0건이어야 정상인 질의(지워진 탈출구)
const js = fs.readFileSync(ROOT + "search.js", "utf8");
const body = js.slice(js.indexOf("function norm("), js.indexOf("function esc("));
let bad = 0;
for (const [pre, qs] of Object.entries(MUST)) {
  const raw = JSON.parse(fs.readFileSync(ROOT + pre + "search.json", "utf8"));
  const f = new Function("raw", "fetch", body + `;var idx=raw.map(function(r){var s=norm(r[1]);return{k:r[0],n:r[1],a:r[2],u:r[3],s:s,z:norm(r[2]+" "+(r[4]||"")),c:cho(s),t:String(r[4]||"").split(" ").map(norm)}});return find;`);
  const find = f(raw, () => {});
  for (const q of qs) {
    const hits = find(q);
    const zeroOk = ALLOW_ZERO.has(q);
    const ok = zeroOk ? !hits.some((h) => /roadblock/i.test(h.n) && /ground|그라운드/i.test(h.a)) : hits.length > 0;
    if (!ok) bad++;
    console.log((ok ? "  " : "✗ ") + (pre || "ko/") + " " + q.padEnd(18) + String(hits.length).padStart(3) + "  " + (hits[0] ? hits[0].k + ":" + hits[0].n + " → " + hits[0].u : ""));
  }
}
console.log(bad ? `[search] 실패 ${bad}건` : "[search] 통과");
process.exit(bad ? 1 : 0);
