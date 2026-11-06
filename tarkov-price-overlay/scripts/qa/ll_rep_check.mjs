// 상인 등급 추정(11-06): 받은 퀘스트 LL(하한) + 깬 퀘스트 우호도 합 → LL, 내 레벨 입력 반영 — 실제 진행 기록(JSON)을 연동처럼 넣어 확인
// 사용: node scripts/qa/ll_rep_check.mjs <진행 기록 json {completed,started}> [https://…/guide/]
import { launch, tab, sleep, AD_BLOCK } from "file:///C:/project/tarkov-price-overlay/marketing-plans/guide-audit-261104/ux/cdp.mjs";
import fs from "node:fs";
import os from "node:os";
const prog = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const BASE = process.argv[3] || "http://localhost:8899/guide/";
const { edge, port } = await launch(9358, os.tmpdir());
const t = await tab(port);
const errs = [];
t.on((m, p) => { if (m === "Runtime.exceptionThrown") errs.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text); });
await t.send("Network.setBlockedURLs", { urls: AD_BLOCK });
await t.size(1280, 900);
await t.nav(BASE + "quests/", 1000);
const sy = { ts: Date.now(), mode: "pve", smode: "pve", completed: prog.completed, started: prog.started, hideout: {} };
await t.ev(`localStorage.clear();localStorage.setItem("guide.mode",JSON.stringify("pve"));localStorage.setItem("guide.sync",${JSON.stringify(JSON.stringify(sy))});localStorage.setItem("guide.sync.m.pve",${JSON.stringify(JSON.stringify(sy))})`);
await t.nav(BASE + "quests/", 1500);
await t.ev(`window.__guideLLEst&&window.__guideLLEst()`); await sleep(1200);
const rows = () => t.ev(`[].map.call(document.querySelectorAll("#llsel .llrow"),function(r){return r.querySelector("span").textContent+" | "+r.querySelector("select option").textContent+" | "+((r.querySelector(".llwhy")||{}).textContent||"")})`);
console.log("레벨 미입력:"); (await rows()).forEach((r) => console.log("  " + r));
console.log("요약:", await t.ev(`document.getElementById("llsum").textContent`));
await t.ev(`document.querySelector("details#llbox").open=true`);
await t.click("#plv"); await t.type("20"); await t.ev(`document.getElementById("plv").dispatchEvent(new Event("change"))`); await sleep(1200);
console.log("레벨 20 입력:"); (await rows()).slice(0, 4).forEach((r) => console.log("  " + r));
const before = await t.ev(`document.querySelectorAll("#view .q, #view article, #view tr").length`);
await t.ev(`document.getElementById("canOnly").click()`); await sleep(300);
console.log("지금 받을 수 있는 것만:", await t.ev(`document.getElementById("prog").textContent`));
console.log("errors", errs.length, errs.slice(0, 3));
edge.kill();
