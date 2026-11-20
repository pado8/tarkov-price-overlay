import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/backup.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 },
});
const { BACKUP_KEYS, readBackupData, applyBackupData, restorableCount, planProgress } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

class MemStore {
  constructor(init = {}) { this.m = new Map(Object.entries(init)); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
}

test("the allow-list keeps user data and leaves out ids, stats, sessions, one-time notices and window positions", () => {
  for (const k of ["tarkov.hideoutLevels", "tarkov.manualQuestDone", "tarkov.history", "tarkov.hotkey", "tarkov.captureRegion", "tarkov.radar.myKeys"]) {
    assert.ok(BACKUP_KEYS.includes(k), k);
  }
  for (const k of ["tarkov.installId", "tarkov.stats.queue", "tarkov.stats.daily", "tarkov.party.code", "tarkov.party.url", "tarkov.party.mid",
    "tarkov.adminBannerDismissed", "tarkov.announceSeen", "tarkov.feedbackDiag", "tarkov.radar.pipPos", "tarkov.radar.miniSnap",
    "tarkov.capture.lastMon", "tarkov.windowPosition", "tarkov.statsConsent", "tarkov.mapShare.on"]) {
    assert.ok(!BACKUP_KEYS.includes(k), k);
  }
});

test("export reads only allow-listed keys; restore writes only allow-listed string values", () => {
  const src = new MemStore({ "tarkov.hotkey": "F5", "tarkov.installId": "id-a", "tarkov.stats.daily": "{}" });
  const data = readBackupData(src);
  assert.deepEqual(data, { "tarkov.hotkey": "F5" });
  const dst = new MemStore({ "tarkov.installId": "id-b", "tarkov.hotkey": "F2" });
  const n = applyBackupData(dst, { ...data, "tarkov.installId": "id-a", "tarkov.unknownNewKey": "x", "tarkov.history": 5 });
  assert.equal(n, 1);
  assert.equal(dst.getItem("tarkov.hotkey"), "F5");
  assert.equal(dst.getItem("tarkov.installId"), "id-b", "install id is never overwritten");
  assert.equal(dst.getItem("tarkov.unknownNewKey"), null);
  assert.equal(restorableCount({ "tarkov.hotkey": "F5", "tarkov.installId": "x" }), 1);
  assert.equal(restorableCount(null), 0);
});

test("a progress-only backup adds only completions this PC does not know, keeps manual faction, merges promo codes", () => {
  const plan = planProgress(
    { mode: "pve", completed: ["q1", "q2", "q3"], hideout: { st1: 2, st2: 0, st3: 99 }, faction: "USEC", faction_source: "manual", promo_used: ["CODE1", "CODE2", "bad code"] },
    { completed: ["q1"], promo_used: ["CODE1"] },
    { pve: ["q2"] }
  );
  assert.equal(plan.mode, "pve");
  assert.deepEqual(plan.questsAdd, ["q3"]);
  assert.deepEqual(plan.hideout, { st1: 2 });
  assert.equal(plan.faction, "USEC");
  assert.deepEqual(plan.promoAdd, ["CODE2"]);
  const auto = planProgress({ mode: "pvp", faction: "BEAR", faction_source: "auto" }, null, {});
  assert.equal(auto.faction, null, "an auto-detected faction is not forced onto the new PC");
  assert.equal(planProgress({ mode: "arena", completed: ["q"] }, null, {}).questsAdd.length, 0);
  assert.equal(planProgress(null, null, {}).mode, null);
});
