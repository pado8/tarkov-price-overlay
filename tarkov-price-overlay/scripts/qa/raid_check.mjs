// 출정 준비물: 연동(진행 중) 자동 담기 · 합산 · 탈출구 준비물 · 기본 준비물 · 체크 저장 · 목록 복사 · 맵 전환 · 폰 가로 스크롤
import { launch, tab, sleep, AD_BLOCK } from "file:///C:/project/tarkov-price-overlay/marketing-plans/guide-audit-261104/ux/cdp.mjs";
import os from "node:os";
const D = os.tmpdir();
const BASE = process.argv[2] || "http://localhost:8899/guide/";
const { edge, port } = await launch(9357, D);
const t = await tab(port);
const errs = [];
t.on((m, p) => { if (m === "Runtime.exceptionThrown") errs.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text); });
await t.send("Network.setBlockedURLs", { urls: AD_BLOCK });
await t.size(1280, 900);
const U = BASE + "raid/?map=woods";
await t.nav(U, 1200);
const ok = (c, msg) => console.log((c ? "OK  " : "FAIL") + " " + msg);
// 연동 흉내: 무기 유통(MS2000 ×2) · 시청자(카메라) 진행 중
await t.ev(`localStorage.clear();localStorage.setItem("guide.sync.m.regular",JSON.stringify({ts:Date.now(),mode:"regular",smode:"regular",completed:[],started:["5a27ba1c86f77461ea5a3c56","666314bd920800278d0f6748"],hideout:{}}));localStorage.setItem("guide.sync",JSON.stringify({mode:"regular"}))`);
await t.nav(U, 1500);
await t.ev(`window.__clip=[];navigator.clipboard.writeText=function(u){window.__clip.push(u);return Promise.resolve()}`);
const prep = () => t.ev(`[].map.call(document.querySelectorAll("#rp li"),function(li){return li.querySelector("label").textContent.replace(/\\s+/g," ").trim()})`);
const heads = () => t.ev(`[].map.call(document.querySelectorAll("#rp h3"),function(h){return h.textContent})`);
const map = await t.ev(`document.querySelector("#rmap button.on").textContent`);
ok(/삼림|Woods/.test(map), "주소 ?map=woods → " + map);
const started = await t.ev(`document.querySelectorAll("#rq h3")[0].textContent+" | 체크됨 "+document.querySelectorAll("#rq input:checked").length`);
ok(/진행 중/.test(started), "진행 중 그룹 " + started);
let p = await prep();
ok(p.some((x) => /MS2000/.test(x) && /×2/.test(x)), "MS2000 ×2 합산: " + p.filter((x) => /MS2000/.test(x)).join(" / "));
ok(p.some((x) => /WI-FI|카메라/.test(x)), "와이파이 카메라: " + p.filter((x) => /WI-FI|카메라/.test(x)).join(" / "));
console.log("   섹션:", (await heads()).join(" · "));
// 받을 수 있는 퀘스트 하나 더 담기
const avail = await t.ev(`(function(){var h=[].filter.call(document.querySelectorAll("#rq h3"),function(x){return /받을/.test(x.textContent)})[0];if(!h)return "";var i=h.nextElementSibling;while(i&&!i.querySelector)i=i.nextElementSibling;var c=i&&i.querySelector("input:not(:checked)");if(!c)return "";c.click();return c.parentNode.textContent.trim()})()`);
await sleep(150);
ok(avail && (await prep()).length > p.length, "받을 수 있음에서 추가: " + avail.slice(0, 40) + " → 항목 " + (await prep()).length);
// 탈출구 고르기: 조명탄 · 차량
for (const re of ["ZB-016", "V-Ex"]) { await t.ev(`[].filter.call(document.querySelectorAll("#rx input"),function(c){return c.parentNode.textContent.indexOf(${JSON.stringify(re)})>=0})[0].click()`); await sleep(120); }
await sleep(150);
p = await prep();
ok(p.some((x) => /신호탄|signal/i.test(x)) && p.some((x) => /루블|Rouble/i.test(x)), "탈출 준비: " + p.filter((x) => /신호탄|루블/.test(x)).join(" / "));
// 기본 준비물
await t.click("#rbin"); await t.type("지혈대 2개"); await t.key("Enter", "Enter", 13); await sleep(150);
p = await prep();
ok(p.some((x) => /지혈대 2개/.test(x)), "기본 준비물 추가");
// 체크 → 새로고침 뒤 유지
await t.ev(`document.querySelector("#rp li input").click()`); await sleep(100);
const sum1 = await t.ev(`document.getElementById("rsum").textContent`);
await t.nav(U, 1500);
const sum2 = await t.ev(`document.getElementById("rsum").textContent`);
ok(sum1 === sum2 && /1개 챙김/.test(sum2), "체크 저장·복원: " + sum2);
// 목록 복사
await t.ev(`window.__clip=[];navigator.clipboard.writeText=function(u){window.__clip.push(u);return Promise.resolve()}`);
await t.click("#rcopy"); await sleep(100);
const txt = (await t.ev(`window.__clip`)).pop() || "";
ok(/\[x\]/.test(txt) && /\[ \]/.test(txt), "목록 복사 " + txt.split("\n").length + "줄: " + txt.split("\n").slice(0, 3).join(" | "));
// 맵 전환(세관)
await t.ev(`[].filter.call(document.querySelectorAll("#rmap button"),function(b){return /세관|Customs/.test(b.textContent)})[0].click()`); await sleep(200);
ok(/세관|Customs/.test(await t.ev(`document.getElementById("rmapn").textContent`)), "맵 전환 → 세관, 탈출구 " + (await t.ev(`document.querySelectorAll("#rx input").length`)) + "곳");
// 연동 해제 상태
await t.ev(`localStorage.removeItem("guide.sync.m.regular");localStorage.removeItem("guide.sync")`);
await t.nav(BASE + "raid/?map=woods", 1500);
ok(/연동 전/.test(await t.ev(`document.getElementById("rq").textContent`)), "연동 없을 때 안내 문구");
await t.shot(D + "/raid_1280.png", true);
await t.size(375, 800); await t.nav(U, 1500);
ok((await t.ev(`document.documentElement.scrollWidth`)) <= 375, "휴대폰 가로 스크롤 없음 (" + (await t.ev(`document.documentElement.scrollWidth`)) + ")");
await t.shot(D + "/raid_375.png");
console.log("errors", errs.length, errs.slice(0, 3));
console.log("shots", D);
edge.kill();
