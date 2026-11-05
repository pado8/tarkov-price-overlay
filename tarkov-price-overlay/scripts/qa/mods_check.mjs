// 무기 모딩(11-06): 정적 표(한눈에 비교)의 인체공학·수직·수평 반동 == 조립기 버튼 결과인지 무기 12정에서 대조
// 사용: node scripts/qa/mods_check.mjs [https://dev.tarkov-aquapado.pages.dev/guide/mods/]   (en/ru/zh 는 /guide/<언어>/mods/)
import { launch, tab, sleep, AD_BLOCK } from "file:///C:/project/tarkov-price-overlay/marketing-plans/guide-audit-261104/ux/cdp.mjs";
import fs from "node:fs";
import os from "node:os";
const D = os.tmpdir();
const base = process.argv[2] || "http://localhost:8899/guide/mods/";
const dirs = fs.readdirSync("C:/project/tarkov-price-overlay/landing/guide/mods").filter((d) => !d.includes(".") && fs.existsSync(`C:/project/tarkov-price-overlay/landing/guide/mods/${d}/data.json`));
const pick = dirs.filter((_, i) => i % Math.ceil(dirs.length / 12) === 0);
const { edge, port } = await launch(9352, D);
const t = await tab(port);
const errs = [];
t.on((m, p) => { if (m === "Runtime.exceptionThrown") errs.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text); });
await t.send("Network.setBlockedURLs", { urls: AD_BLOCK });
let bad = 0, n = 0;
for (const d of pick) {
  await t.nav(base + d + "/", 1200);
  await t.ev(`localStorage.clear()`);
  const rows = await t.ev(`[].map.call(document.querySelectorAll("section.box table.tot")[0].querySelectorAll("tbody tr"),function(r){var c=r.querySelectorAll("td");return [c[1],c[2],c[3]].map(function(x){return x.querySelector("b")?x.querySelector("b").textContent:x.textContent.split(" ")[0]})})`);
  const keys = ["def", "rec", "bal", "erg"];
  for (let i = 0; i < keys.length; i++) {
    await t.click(`#mb [data-k="${keys[i]}"]`); await sleep(120);
    const got = await t.ev(`[].map.call(document.querySelectorAll("#mtot b"),function(b){return b.textContent}).slice(0,3)`);
    n++;
    if (JSON.stringify(got) !== JSON.stringify(rows[i])) { bad++; console.log("MISMATCH", d, keys[i], "page", rows[i], "builder", got); }
  }
}
console.log("weapons", pick.length, "checks", n, "mismatch", bad, "errors", errs.length, errs.slice(0, 3));
edge.kill();
