// 가이드 ↔ 오버레이 연동 시나리오(11-04 점검 C1 회귀 방지). 가짜 /progress 응답을 CDP Fetch 로 주입해 앱 없이 돈다.
// 사용: node scripts/qa/sync_scenarios.mjs <BASE(예: http://localhost:8899)> [작업폴더]
//   ① PVE 연동 뒤 PVP 화면: PVE 에서만 깬 퀘스트가 '완료'로 보이면 안 된다
//   ② 프레스티지(앱 진행도 비움) 뒤: 예전 연동 완료가 남으면 안 된다
//   ③ 연동된 완료를 직접 해제: 다음 페이지에서도 해제 유지
//   ④ 예전 형식(연동분이 guide.quests 에 섞임) 정리: 직접 체크는 남고 연동분만 빠짐
// 종료 코드 1 = 실패
import { launch, tab, sleep } from "../../marketing-plans/guide-audit-261104/ux/cdp.mjs";
import os from "node:os";

const BASE = (process.argv[2] || "http://localhost:8899").replace(/\/$/, "");
const DIR = process.argv[3] || os.tmpdir();
const A = "5936d90786f7742b1420ba5b"; // 데뷔 — 직접 체크
const B = "67a09673972c11a3f507731d"; // 타르코프의 도살자 — PVE 에서만 연동 완료
const C = "5ae3270f86f77445ba41d4dd"; // 건스미스 AKM — PVP 연동 완료
const D = "5c0bde0986f77479cf22c2f8"; // 하늘에서 태어난 사수 — PVE 연동 완료
let prog = { regular: [C], pve: [B, D] };

const { edge, port } = await launch(9333, DIR);
const t = await tab(port);
await t.send("Fetch.enable", { patterns: [{ urlPattern: "*127.0.0.1:8765/progress*" }] });
t.on(async (m, p) => {
  if (m !== "Fetch.requestPaused") return;
  const u = new URL(p.request.url);
  const gm = u.searchParams.get("game_mode") || "auto";
  const mode = gm === "pve" ? "pve" : "regular";
  const body = JSON.stringify({ ok: true, mode, completed: prog[mode], started: [], hideout: {}, quest_count: 500, promo_used: [] });
  await t.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }],
    body: Buffer.from(body).toString("base64") });
});
const q = (slug) => `${BASE}/guide/quest/${slug}/`;
const checked = async (slug) => { await t.nav(q(slug), 900); return t.ev(`document.getElementById("qdone").checked`); };
const set = (obj) => t.ev(`(function(){localStorage.clear();var o=${JSON.stringify(obj)};for(var k in o)localStorage.setItem(k,JSON.stringify(o[k]));return 1})()`);
const res = [];
const ok = (name, cond, info) => { res.push([name, cond]); console.log((cond ? "  통과 " : "✗ 실패 ") + name + (info ? "  " + info : "")); };

await t.nav(`${BASE}/guide/`, 300);
// ① PVE 로 한 번 연동된 브라우저 → 사이트 모드 PVP 로 바꿔 보기
await set({ "guide.mode": "pve", "guide.sync": { ts: Date.now() - 60000, mode: "pve", completed: [B, D] } });
await checked("debut"); // 자동 읽기 한 번(pve)
await t.ev(`localStorage.setItem("guide.mode",JSON.stringify("pvp"))`);
const b1 = await checked("the-tarkov-butcher");
ok("① PVP 화면에서 PVE 전용 완료가 안 보임", b1 === false, `checked=${b1}`);
const c1 = await checked("gunsmith-akm-bear");
ok("① PVP 화면에서 PVP 연동 완료는 보임", c1 === true, `checked=${c1}`);

// ② 프레스티지: 앱이 PVE 진행도를 비움
await t.ev(`localStorage.setItem("guide.mode",JSON.stringify("pve"))`);
prog.pve = [];
const d2 = await checked("shooter-born-in-heaven");
await sleep(300);
const d2b = await checked("shooter-born-in-heaven");
ok("② 앱 진행도가 비면 사이트 완료도 사라짐", d2b === false, `checked=${d2}/${d2b}`);
prog.pve = [B, D];

// ③ 연동된 완료를 직접 해제 → 다른 페이지 다녀와도 유지
await checked("shooter-born-in-heaven");
await t.click("#qdone");
await sleep(200);
await checked("debut");
const d3 = await checked("shooter-born-in-heaven");
ok("③ 연동 완료를 직접 해제하면 유지", d3 === false, `checked=${d3}`);

// ④ 예전 형식 정리
await set({ "guide.mode": "pve", "guide.quests": { [A]: 1, [B]: 1 }, "guide.quests.synced": { [B]: 1 }, "guide.sync": { ts: Date.now() - 60000, mode: "pve", completed: [B] } });
prog.pve = [];
const a4 = await checked("debut");
const st = await t.ev(`JSON.stringify({q:JSON.parse(localStorage.getItem("guide.quests")),s:localStorage.getItem("guide.quests.synced")})`);
const b4 = await checked("the-tarkov-butcher");
ok("④ 직접 체크(데뷔)는 남음", a4 === true, `checked=${a4}`);
ok("④ 섞여 있던 연동분(도살자)은 빠짐", b4 === false, `checked=${b4} 저장=${st}`);

edge.kill();
const bad = res.filter((r) => !r[1]).length;
console.log(bad ? `[sync] 실패 ${bad}건` : "[sync] 통과");
process.exit(bad ? 1 : 0);
