import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/traderReset.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 },
});
const { planAlerts, refetchInSec, minutesLeft, loadLead, loadTraders, notifyKey, RST_DEFAULT_TRADERS, RST_LEAD_KEY, RST_TRADERS_KEY } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

const NOW = 1_000_000;
const row = (key, inSec) => ({ key, name: key, reset: NOW + inSec });
const store = (o = {}) => ({ getItem: (k) => o[k] ?? null });

test("an alert fires once the reset is within the lead time", () => {
  const rows = [row("prapor", 4 * 60), row("skier", 20 * 60)];
  const p = planAlerts(rows, NOW, 5, new Set());
  assert.deepEqual(p.fire.map((r) => r.key), ["prapor"]);
  assert.equal(p.nextInSec, 15 * 60); // skier: 20분 − 5분
});

test("nothing fires before the lead time and the next wait is exact", () => {
  const p = planAlerts([row("prapor", 12 * 60 + 7)], NOW, 10, new Set());
  assert.deepEqual(p.fire, []);
  assert.equal(p.nextInSec, 2 * 60 + 7);
});

test("already-notified, past and too-late resets are skipped", () => {
  const a = row("prapor", 4 * 60);
  const rows = [a, row("therapist", -30), row("skier", 20)];
  const p = planAlerts(rows, NOW, 5, new Set([notifyKey(a)]));
  assert.deepEqual(p.fire, []);
  assert.equal(p.nextInSec, null);
});

test("a new reset time for the same trader alerts again", () => {
  const old = row("prapor", 4 * 60);
  const next = { ...old, reset: old.reset + 3600 };
  const p = planAlerts([next], NOW + 3600 - 60, 5, new Set([notifyKey(old)]));
  assert.deepEqual(p.fire.map((r) => r.reset), [next.reset]);
});

test("refetch waits until one minute after the earliest reset", () => {
  assert.equal(refetchInSec([row("prapor", 600), row("skier", 6000)], NOW, 0), 660);
  assert.equal(refetchInSec([row("prapor", 5)], NOW, 0), 65);
});

test("stale data backs off 2, 4, 8, then 10 minutes — never a per-minute poll", () => {
  const rows = [row("prapor", -90), row("skier", 6000)];
  assert.deepEqual([0, 1, 2, 3, 9].map((n) => refetchInSec(rows, NOW, n)), [120, 240, 480, 600, 600]);
  assert.equal(refetchInSec([], NOW, 0), 600);
  assert.ok([0, 1, 2, 3].every((n) => refetchInSec(rows, NOW, n) >= 120));
});

test("minutes left rounds and never shows zero", () => {
  assert.equal(minutesLeft(row("a", 5 * 60 - 10), NOW), 5);
  assert.equal(minutesLeft(row("a", 40), NOW), 1);
});

test("settings fall back to defaults on missing or broken values", () => {
  assert.equal(loadLead(store()), 5);
  assert.equal(loadLead(store({ [RST_LEAD_KEY]: "10" })), 10);
  assert.equal(loadLead(store({ [RST_LEAD_KEY]: "7" })), 5);
  assert.deepEqual(loadTraders(store()), RST_DEFAULT_TRADERS);
  assert.deepEqual(loadTraders(store({ [RST_TRADERS_KEY]: "{oops" })), RST_DEFAULT_TRADERS);
  assert.deepEqual(loadTraders(store({ [RST_TRADERS_KEY]: '["skier", 3, "BAD KEY", "ragman"]' })), ["skier", "ragman"]);
  assert.deepEqual(loadTraders(store({ [RST_TRADERS_KEY]: "[]" })), []);
  assert.equal(loadLead({ getItem() { throw new Error("blocked"); } }), 5);
});
