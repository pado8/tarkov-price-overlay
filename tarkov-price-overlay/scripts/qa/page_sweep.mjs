// 가이드 전 페이지 실화면 점검(11-06) — 브라우저로 하나씩 열어 화면에 보이는 것 기준으로:
//   스크립트 오류 · 실패한 요청(그림 포함) · 깨진 값(undefined/NaN/[object …]/자리표시자) · 같은 목록·표·칩 안 중복 줄 ·
//   빈 표·빈 칩 · 깨진 그림 · 가로 넘침
// 사용: node scripts/qa/page_sweep.mjs [http://localhost:8899] [결과.json] [언어 접두사 ""|en/|ru/|zh/]
import { launch, tab, sleep, AD_BLOCK } from "file:///C:/project/tarkov-price-overlay/marketing-plans/guide-audit-261104/ux/cdp.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const ORIGIN = process.argv[2] || "http://localhost:8899";
const OUT = process.argv[3] || path.join(os.tmpdir(), "page_sweep.json");
const PRE = process.argv[4] || "";
const ROOT = "C:/project/tarkov-price-overlay/landing/guide/" + PRE;
const pages = [];
(function walk(d, rel) {
  for (const n of fs.readdirSync(d, { withFileTypes: true })) {
    if (!n.isDirectory()) continue;
    if (!rel && ["en", "ru", "zh"].includes(n.name)) continue;
    const r = rel + n.name + "/";
    if (fs.existsSync(path.join(d, n.name, "index.html"))) pages.push(r);
    walk(path.join(d, n.name), r);
  }
})(ROOT, "");
pages.unshift("");
console.log("pages", pages.length);
const CHECK = `(function(){
var out={bad:[],dup:[],empty:[],img:[],overflow:0};
var vis=document.body.innerText||"";
var re=/\\b(undefined|NaN)\\b|\\[object [A-Za-z]+\\]|__[A-Z]{3,}__|\\{\\{|\\}\\}/g,m;
while((m=re.exec(vis))&&out.bad.length<5){out.bad.push(vis.slice(Math.max(0,m.index-40),m.index+40).replace(/\\s+/g," "))}
function norm(t){return (t||"").replace(/\\s+/g," ").trim()}
function path(e){var p=[];while(e&&e!==document.body&&p.length<4){p.unshift(e.tagName.toLowerCase()+(e.id?"#"+e.id:"")+(e.className&&typeof e.className==="string"?"."+e.className.trim().split(/\\s+/)[0]:""));e=e.parentElement}return p.join(">")}
document.querySelectorAll("ul,ol,tbody,.chips,.rlist,.cols3,.objs").forEach(function(c){
  if(c.closest("nav,.top,footer,details.lang,script"))return;
  var seen={},kids=[].filter.call(c.children,function(k){return k.offsetParent!==null||k.tagName==="TR"});
  kids.forEach(function(k){var t=norm(k.innerText);if(t.length<3)return;seen[t]=(seen[t]||0)+1});
  Object.keys(seen).forEach(function(t){if(seen[t]>1&&out.dup.length<8)out.dup.push(path(c)+" ×"+seen[t]+" | "+t.slice(0,90))})});
document.querySelectorAll("table").forEach(function(tb){var b=tb.tBodies[0];if(b&&!b.rows.length&&tb.offsetParent!==null)out.empty.push("빈 표 "+path(tb))});
document.querySelectorAll(".chips").forEach(function(c){if(!c.children.length&&!norm(c.innerText)&&c.offsetParent!==null&&out.empty.length<8)out.empty.push("빈 칩 "+path(c))});
document.querySelectorAll("section.box,.box").forEach(function(s){var h=s.querySelector("h2");if(!h)return;var rest=norm(s.innerText).replace(norm(h.innerText),"");if(rest.length<2&&s.offsetParent!==null&&out.empty.length<8)out.empty.push("빈 섹션 "+norm(h.innerText).slice(0,40))});
document.querySelectorAll("img").forEach(function(i){if(i.complete&&i.naturalWidth===0&&i.loading!=="lazy"&&out.img.length<5)out.img.push(i.getAttribute("src"))});
out.overflow=document.documentElement.scrollWidth-window.innerWidth;
out.h1=norm((document.querySelector("h1")||{}).innerText||"").slice(0,80);
return out})()`;
const res = {};
async function worker(port, list) {
  const { edge } = await launch(port, os.tmpdir());
  const t = await tab(port);
  await t.send("Network.setBlockedURLs", { urls: AD_BLOCK });
  await t.size(1280, 900);
  let cur = null;
  t.on((m, p) => {
    if (!cur) return;
    if (m === "Runtime.exceptionThrown") cur.err.push((p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "").slice(0, 160));
    if (m === "Network.responseReceived" && p.response.status >= 400 && !/googles|gtag|beacon|insights|8765|fundingchoices|doubleclick/.test(p.response.url)) cur.fail.push(p.response.status + " " + p.response.url.slice(0, 120));
    if (m === "Network.loadingFailed" && !p.canceled && !/ERR_BLOCKED|BLOCKED_BY_CLIENT/.test(p.errorText || "")) cur.fail.push("실패 " + (p.errorText || ""));
  });
  for (const pg of list) {
    cur = { err: [], fail: [] };
    try {
      await t.nav(ORIGIN + "/guide/" + PRE + pg, 900);
      const r = await t.ev(CHECK);
      res[pg] = { ...r, err: cur.err, fail: cur.fail.filter((x) => !/실패 net::ERR_ABORTED/.test(x)) };
    } catch (e) { res[pg] = { fatal: String(e).slice(0, 200), err: cur.err, fail: cur.fail }; }
    cur = null;
  }
  edge.kill();
}
const N = 4, chunks = Array.from({ length: N }, (_, i) => pages.filter((_, j) => j % N === i));
const t0 = Date.now();
await Promise.all(chunks.map((c, i) => worker(9370 + i, c)));
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
const issues = Object.entries(res).filter(([, r]) => r.fatal || r.err?.length || r.fail?.length || r.bad?.length || r.dup?.length || r.empty?.length || r.img?.length || r.overflow > 2);
console.log("done", Object.keys(res).length, "pages in", Math.round((Date.now() - t0) / 1000) + "s · 문제 있는 페이지", issues.length, "→", OUT);
