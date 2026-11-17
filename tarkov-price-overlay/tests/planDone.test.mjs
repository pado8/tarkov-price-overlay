import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/planDone.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 },
});
const { remapDone } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const stops = () => ["a", "b", "c", "d"].map((name) => ({ name }));
const names = (list, done) => [...done].sort().map((i) => list[i].name);

test("removing an earlier stop keeps the mark on the same stop", () => {
  const s = stops();
  const done = new Set([1, 2]); // b·c 를 지남
  const after = s.filter((_, i) => i !== 0); // a 삭제
  assert.deepEqual(names(after, remapDone(s, after, done)), ["b", "c"]);
});

test("removing a visited stop drops its mark only", () => {
  const s = stops();
  const after = s.filter((_, i) => i !== 1); // 지난 b 삭제
  assert.deepEqual(names(after, remapDone(s, after, new Set([1, 2]))), ["c"]);
});

test("reordering moves the mark with the stop", () => {
  const s = stops();
  const after = [s[1], s[0], s[2], s[3]]; // a 와 b 를 바꿈
  assert.deepEqual(names(after, remapDone(s, after, new Set([0]))), ["a"]);
  assert.deepEqual([...remapDone(s, after, new Set([0]))], [1]);
});

test("unchanged stops and empty marks stay as they are", () => {
  const s = stops();
  assert.deepEqual([...remapDone(s, s.slice(), new Set([0, 3]))].sort(), [0, 3]);
  assert.equal(remapDone(s, s.slice(1), new Set()).size, 0);
  assert.equal(remapDone(s, [], new Set([0])).size, 0);
  assert.equal(remapDone(s, s, new Set([9])).size, 0); // 범위 밖 순번은 버린다
});
