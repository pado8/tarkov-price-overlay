// 무기 모딩 조립기 프리셋(11-06): 저장·덮어쓰기·불러오기·링크·삭제·목록 페이지 '내 프리셋'·게임에서 맞추기 표·목록 복사
import { launch, tab, sleep, AD_BLOCK } from "file:///C:/project/tarkov-price-overlay/marketing-plans/guide-audit-261104/ux/cdp.mjs";
import os from "node:os";
const D = os.tmpdir();
// 사용: node scripts/qa/mods_presets.mjs [https://tarkov.aquapado.com/guide/ | .../guide/zh/]
const BASE = process.argv[2] || "http://localhost:8899/guide/";
const { edge, port } = await launch(9353, D);
const t = await tab(port);
const errs = [];
t.on((m, p) => { if (m === "Runtime.exceptionThrown") errs.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text); });
await t.send("Network.setBlockedURLs", { urls: AD_BLOCK });
await t.size(1280, 900);
const U = BASE + "mods/colt-m4a1-556x45-assault-rifle/";
await t.nav(U, 1200);
await t.ev(`localStorage.clear()`);
await t.nav(U, 1500);
const hook = `window.confirm=function(){return true};window.__clip=[];navigator.clipboard.writeText=function(u){window.__clip.push(u);return Promise.resolve()}`;
await t.ev(hook);
const tot = () => t.ev(`[].map.call(document.querySelectorAll("#mtot b"),function(b){return b.textContent}).slice(0,3).join("/")`);
const ok = (c, msg) => console.log((c ? "OK  " : "FAIL") + " " + msg);
// 1) 반동 최소 → 이름 넣어 저장
await t.click('#mb [data-k="rec"]'); await sleep(150);
const recTot = await tot();
await t.click("#mpname"); await t.type("저반동 테스트");
await t.click("#mpsave"); await sleep(150);
// 2) 균형 → 이름 없이 저장(기본 이름)
await t.click('#mb [data-k="bal"]'); await sleep(150);
const balTot = await tot();
await t.click("#mpsave"); await sleep(150);
let names = await t.ev(`[].map.call(document.querySelectorAll("#mplist tbody tr b"),function(b){return b.textContent})`);
ok(names.length === 2 && names[1] === "저반동 테스트" && /\d+\/\d+$/.test(names[0]), "저장 2개 " + JSON.stringify(names));
// 3) 같은 이름 덮어쓰기
await t.click('#mb [data-k="erg"]'); await sleep(150);
await t.click("#mpname"); await t.type("저반동 테스트"); await t.key("Enter", "Enter", 13); await sleep(150);
names = await t.ev(`[].map.call(document.querySelectorAll("#mplist tbody tr b"),function(b){return b.textContent})`);
ok(names.length === 2 && names[0] === "저반동 테스트", "Enter 저장·같은 이름 덮어쓰기 " + JSON.stringify(names));
// 4) 새로고침 뒤 기본 조립으로 바꾸고 → 두 번째(균형) 불러오기
await t.nav(U, 1500); await t.ev(hook);
await t.click('#mb [data-k="def"]'); await sleep(150);
await t.click('#mplist [data-pl="1"]'); await sleep(200);
ok((await tot()) === balTot, "새로고침 뒤 불러오기 = 저장 당시 수치 " + (await tot()) + " vs " + balTot);
ok(await t.ev(`!!document.querySelector('#mb [data-k="bal"].on')`), "불러온 조립 버튼 표시(균형)");
// 5) 링크 복사 → 새 탭처럼 열기
await t.click('#mplist [data-pc="1"]'); await sleep(100);
const link = (await t.ev(`window.__clip`)).pop() || "";
ok(link.includes("?b="), "프리셋 링크 " + link.length + "자");
// 6) 게임에서 맞추기 표 + 목록 복사
const rows = await t.ev(`document.querySelectorAll("#mlist tbody tr").length`);
const first = await t.ev(`[].map.call(document.querySelectorAll("#mlist tbody tr")[0].querySelectorAll("td"),function(td){return td.textContent}).join(" | ")`);
ok(rows > 5, "장착 순서 표 " + rows + "줄 · 첫 줄: " + first.slice(0, 90));
await t.click("#mcopy"); await sleep(100);
const txt = (await t.ev(`window.__clip`)).pop() || "";
ok(txt.split("\n").length === rows + 1, "부품 목록 복사 " + txt.split("\n").length + "줄 · " + txt.split("\n").slice(0, 3).join(" / "));
// 7) 목록 페이지 내 프리셋
await t.nav(BASE + "mods/", 1200);
const myp = await t.ev(`(function(){var b=document.getElementById("myp");return b.hidden?"hidden":b.querySelectorAll("tbody tr").length+" | "+b.querySelector("tbody a").getAttribute("href").slice(0,60)})()`);
ok(/^2 \|/.test(myp), "목록 페이지 내 프리셋 " + myp);
await t.click("#myp tbody a"); await sleep(1500);
ok((await tot()) !== "" , "목록에서 프리셋 열기 → " + (await tot()));
// 8) 삭제
await t.ev(hook);
await t.click('#mplist [data-pd="0"]'); await sleep(150);
names = await t.ev(`[].map.call(document.querySelectorAll("#mplist tbody tr b"),function(b){return b.textContent})`);
ok(names.length === 1, "삭제 뒤 " + JSON.stringify(names));
await t.ev(`document.getElementById("mb").scrollIntoView()`); await sleep(200);
await t.shot(D + "/preset_1280.png");
await t.size(375, 800); await t.nav(U, 1500); await t.ev(`document.getElementById("mpname").scrollIntoView()`); await sleep(200); await t.shot(D + "/preset_375.png");
ok((await t.ev(`document.documentElement.scrollWidth`)) <= 375, "휴대폰 가로 스크롤 없음");
console.log("errors", errs.length, errs.slice(0, 3));
edge.kill();
