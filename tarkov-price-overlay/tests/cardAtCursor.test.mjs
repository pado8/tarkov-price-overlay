import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/cardAtCursor.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 } });
const { spotNearCursor, cursorLeft } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const MONS = [
  { position: { x: 0, y: 0 }, size: { width: 2560, height: 1440 }, scaleFactor: 1.25, workArea: { position: { x: 0, y: 0 }, size: { width: 2560, height: 1380 } } },
  { position: { x: 2560, y: 0 }, size: { width: 1920, height: 1080 }, scaleFactor: 1, workArea: { position: { x: 2560, y: 0 }, size: { width: 1920, height: 1080 } } },
];

test("보통은 커서 오른쪽 아래 대각선(125% = 30px)", () => {
  assert.deepEqual(spotNearCursor(1000, 500, 500, 400, MONS), { x: 1030, y: 530 });
});
test("오른쪽이 모자라면 커서 왼쪽으로", () => {
  assert.deepEqual(spotNearCursor(2300, 500, 500, 400, MONS), { x: 2300 - 30 - 500, y: 530 });
});
test("아래가 모자라면 작업 영역(작업표시줄 위) 바닥에 맞춤", () => {
  assert.deepEqual(spotNearCursor(1000, 1300, 500, 400, MONS), { x: 1030, y: 980 });
});
test("커서가 있는 모니터 안에만(옆 모니터로 안 넘어감)", () => {
  const p = spotNearCursor(2400, 300, 500, 400, MONS);
  assert.ok(p.x + 500 <= 2560 && p.x >= 0, JSON.stringify(p));
  const q = spotNearCursor(2600, 300, 500, 400, MONS);
  assert.deepEqual(q, { x: 2624, y: 324 });
});
test("멀어짐 판정은 배율을 따른다", () => {
  assert.equal(cursorLeft({ x: 0, y: 0 }, { x: 300, y: 0 }, 1), true);
  assert.equal(cursorLeft({ x: 0, y: 0 }, { x: 300, y: 0 }, 1.25), false);
  assert.equal(cursorLeft({ x: 0, y: 0 }, { x: 200, y: 200 }, 1), true);
  assert.equal(cursorLeft({ x: 0, y: 0 }, { x: 100, y: 100 }, 1), false);
});
