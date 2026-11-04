// 상인 등급(하한 추정·직접 입력) 시나리오(11-04). 가짜 /progress 를 CDP Fetch 로 주입 — 앱 없이 돈다.
// 사용: node scripts/qa/ll_scenarios.mjs <BASE(예: http://localhost:8899)> [작업폴더]   종료 코드 1 = 실패
import { launch, tab, sleep } from "../../marketing-plans/guide-audit-261104/ux/cdp.mjs";
import os from "node:os";

const BASE = (process.argv[2] || "http://localhost:8899").replace(/\/$/, "");
const DIR = process.argv[3] || os.tmpdir();
const BUTCHER = "67a09673972c11a3f507731d"; // 테라피스트 LL2 — 완료
const DIPLO = "5edaba7c0c502106f869bc02"; // 테라피스트 LL3 — 진행 중
const CRISIS = "60e71c48c1bfa3050473b8e5"; // 테라피스트 LL4, 선행 없음

const { edge, port } = await launch(9336, DIR);
const t = await tab(port);
await t.send("Fetch.enable", { patterns: [{ urlPattern: "*127.0.0.1:8765/progress*" }] });
t.on(async (m, p) => {
  if (m !== "Fetch.requestPaused") return;
  const body = JSON.stringify({ ok: true, mode: "pve", log_ok: true, completed: [BUTCHER], started: [DIPLO], hideout: {}, quest_count: 100, promo_used: [] });
  await t.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }],
    body: Buffer.from(body).toString("base64") });
});
const res = [];
const ok = (n, c, i) => { res.push(c); console.log((c ? "  통과 " : "✗ 실패 ") + n + (i ? "  " + i : "")); };

await t.nav(`${BASE}/guide/`, 300);
await t.ev(`(function(){localStorage.clear();localStorage.setItem("guide.mode",JSON.stringify("pve"));localStorage.setItem("guide.sync",JSON.stringify({ts:Date.now()-60000,mode:"pve",completed:[]}));return 1})()`);
await t.nav(`${BASE}/guide/quests/`, 2500); // 자동 연동 → ll.json → 추정
const est = await t.ev(`JSON.parse(localStorage.getItem("guide.ll.est.pve")||"{}").est`);
ok("① 연동 추정: 테라피스트 최소 LL3", est && est.therapist === 3, JSON.stringify(est));
const sum = await t.ev(`document.getElementById("llsum").textContent`);
ok("① 요약에 'LL3↑' 표시", /LL3↑/.test(sum), sum);

const crisisShown = async () => t.ev(`(function(){document.getElementById("canOnly").checked=true;document.getElementById("canOnly").dispatchEvent(new Event("change"));return !!document.querySelector('.qrow[data-id="${CRISIS}"]')})()`);
ok("② 받을 수 있는 것만: LL4 위기(Crisis) 빠짐", (await crisisShown()) === false);
await t.ev(`(function(){var s=document.querySelector('#llsel select[data-ts="therapist"]');s.value="4";s.dispatchEvent(new Event("change",{bubbles:true}));return 1})()`);
ok("③ 직접 LL4 고르면 위기 포함", (await crisisShown()) === true);
const man = await t.ev(`localStorage.getItem("guide.ll.man.pve")`);
ok("③ 직접 입력은 모드별 저장", man === '{"therapist":4}', man);

await t.nav(`${BASE}/guide/quest/crisis/`, 1500);
const txt4 = await t.ev(`(document.querySelector(".myll")||{}).textContent||""`);
ok("④ 상세: 직접 LL4 → 충족 표시", /LL4.*✓/.test(txt4), txt4);
await t.ev(`localStorage.removeItem("guide.ll.man.pve");1`);
await t.nav(`${BASE}/guide/quest/crisis/`, 1500);
const txt3 = await t.ev(`(document.querySelector(".myll")||{}).textContent||""`);
ok("④ 상세: 추정 LL3↑ → '더 높을 수 있음'", /LL3↑/.test(txt3) && !/✓/.test(txt3), txt3);

edge.kill();
const bad = res.filter((c) => !c).length;
console.log(bad ? `[ll] 실패 ${bad}건` : "[ll] 통과");
process.exit(bad ? 1 : 0);
