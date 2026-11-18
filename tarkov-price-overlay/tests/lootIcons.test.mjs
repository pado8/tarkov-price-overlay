import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lootIcons.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
const icons = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const radar = await readFile(new URL("../python-core/radar.py", import.meta.url), "utf8");
const table = radar.match(/LOOT_GROUPS: dict = \{([\s\S]*?)\n\}/)[1];
const kinds = [...table.matchAll(/"([a-z-]+)": "[a-z]"/g)].map((m) => m[1]);

test("엔진의 상자 종류 전부에 전용 아이콘이 있다", () => {
  assert.ok(kinds.length >= 27);
  for (const kind of kinds) assert.ok(icons.LOOT_ICON_PATH[icons.LOOT_KIND_ICON[kind]], kind);
});

test("묶음 대표 아이콘과 모르는 종류", () => {
  const groups = new Set([...table.matchAll(/"[a-z-]+": "([a-z])"/g)].map((m) => m[1]));
  assert.equal(groups.size, 10);
  for (const g of groups) assert.ok(icons.LOOT_ICON_PATH[icons.LOOT_GROUP_ICON[g]], g);
  assert.equal(icons.lootIconOf("safe", "b"), "safe");
  assert.equal(icons.lootIconOf("새 상자", "m"), "medbag");
  assert.equal(icons.lootIconOf(undefined, "없는 묶음"), "crate");
});

test("축척에 따라 점에서 아이콘으로 커진다", () => {
  assert.deepEqual([0.3, 0.5, 1.2, 2.5].map(icons.lootBadgeSize), [0, 11, 15, 19]);
});

test("값진 묶음을 나중에 그리고 원본 순서는 건드리지 않는다", () => {
  const rows = [[0, 0, 0, "v"], [0, 0, 0, "d"], [0, 0, 0, "w"], [0, 0, 0, "b"]];
  assert.deepEqual(icons.lootInDrawOrder(rows).map((r) => r[3]), ["d", "b", "w", "v"]);
  assert.equal(rows[0][3], "v");
  assert.equal(icons.lootInDrawOrder(rows), icons.lootInDrawOrder(rows));
});
