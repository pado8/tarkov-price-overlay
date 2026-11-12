import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// wideLayout.test.mjs 와 같은 방식 — 프로젝트의 TypeScript 로 옮겨 읽는다
const source = await readFile(new URL("../src/miniSnap.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 } });
const { snapToWorkArea } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

// 주 모니터 2560x1440 @125%(작업표시줄 아래 60px), 오른쪽 모니터 1920x1080 @100%
const MONS = [
  { position: { x: 0, y: 0 }, size: { width: 2560, height: 1440 }, scaleFactor: 1.25, workArea: { position: { x: 0, y: 0 }, size: { width: 2560, height: 1380 } } },
  { position: { x: 2560, y: 0 }, size: { width: 1920, height: 1080 }, scaleFactor: 1, workArea: { position: { x: 2560, y: 0 }, size: { width: 1920, height: 1080 } } },
];
const W = { width: 300, height: 300 };

test("오른쪽 위 모서리 가까이 → 모서리에 딱", () => {
  assert.deepEqual(snapToWorkArea({ x: 2560 - 300 - 40, y: 30 }, W, MONS), { x: 2260, y: 0 });
});
test("왼쪽 아래는 작업표시줄 위에 붙는다", () => {
  assert.deepEqual(snapToWorkArea({ x: 20, y: 1380 - 300 - 25 }, W, MONS), { x: 0, y: 1080 });
});
test("가장자리 하나만 가까우면 그쪽만", () => {
  assert.deepEqual(snapToWorkArea({ x: 10, y: 600 }, W, MONS), { x: 0, y: 600 });
});
test("가운데는 그대로", () => {
  assert.deepEqual(snapToWorkArea({ x: 1000, y: 600 }, W, MONS), { x: 1000, y: 600 });
});
test("기준 거리는 배율을 따른다(125% = 60px, 100% = 48px)", () => {
  assert.deepEqual(snapToWorkArea({ x: 59, y: 600 }, W, MONS), { x: 0, y: 600 });
  assert.deepEqual(snapToWorkArea({ x: 2560 + 49, y: 600 }, W, MONS), { x: 2609, y: 600 });
  assert.deepEqual(snapToWorkArea({ x: 2560 + 47, y: 600 }, W, MONS), { x: 2560, y: 600 });
});
test("창 중심이 있는 모니터 기준(두 모니터 경계)", () => {
  assert.deepEqual(snapToWorkArea({ x: 2560 + 1920 - 300 - 10, y: 1080 - 300 - 5 }, W, MONS), { x: 4180, y: 780 });
});
test("모니터 밖이면 그대로, 작업 영역 정보가 없으면 모니터 전체", () => {
  assert.deepEqual(snapToWorkArea({ x: -5000, y: 0 }, W, MONS), { x: -5000, y: 0 });
  const noWa = [{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 }];
  assert.deepEqual(snapToWorkArea({ x: 1920 - 300 - 10, y: 1080 - 300 - 10 }, W, noWa), { x: 1620, y: 780 });
});
