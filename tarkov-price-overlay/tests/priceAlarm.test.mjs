import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/priceAlarm.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 },
});
const { upsertAlarm, removeAlarm, evaluate } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

const A = { id: "battery", name: "Car battery", mode: "regular", dir: "above", price: 100000 };

test("an alarm fires once when the flea price crosses it, and re-arms after it comes back", () => {
  let list = upsertAlarm([], A, 90000);
  let r = evaluate(list, "regular", { battery: 101000 }, 1);
  assert.equal(r.fired.length, 1);
  r = evaluate(r.next, "regular", { battery: 105000 }, 2);
  assert.equal(r.fired.length, 0, "no repeat while still above");
  r = evaluate(r.next, "regular", { battery: 95000 }, 3);
  r = evaluate(r.next, "regular", { battery: 100000 }, 4);
  assert.equal(r.fired.length, 1, "fires again after dropping back below");
});

test("an alarm set when the price is already past it does not fire right away", () => {
  const list = upsertAlarm([], A, 120000);
  assert.equal(evaluate(list, "regular", { battery: 121000 }, 1).fired.length, 0);
});

test("below alarms, other game modes and missing prices", () => {
  const list = upsertAlarm(upsertAlarm([], { ...A, dir: "below", price: 50000 }, 60000), { ...A, mode: "pve" }, 90000);
  assert.equal(list.length, 2);
  const r = evaluate(list, "regular", { battery: 49000 }, 1);
  assert.deepEqual(r.fired.map((a) => a.mode), ["regular"]);
  assert.equal(evaluate(list, "regular", {}, 1).fired.length, 0);
  assert.equal(removeAlarm(list, "battery", "pve").length, 1);
  assert.equal(upsertAlarm(list, { ...A, price: 1 }, null).filter((a) => a.mode === "regular").length, 1, "one alarm per item and mode");
});
