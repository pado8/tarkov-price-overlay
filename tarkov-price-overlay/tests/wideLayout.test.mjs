import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Use the project's existing TypeScript compiler so the tests also run on Node 18.
const source = await readFile(new URL("../src/wideLayout.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 },
});
const { fitWideRect, loadWideMapSide, saveWideMapSide, wideMapOnTop, wideSideCode, wideStacked, WIDE_MAP_SIDE_KEY } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("existing installations retain the map-on-right default", () => {
  assert.equal(loadWideMapSide(memoryStorage()), "right");
});

test("both map-side choices survive saving and reloading settings", () => {
  const storage = memoryStorage();
  for (const side of ["left", "right", "top", "bottom", "left"]) {
    assert.equal(saveWideMapSide(storage, side), true);
    assert.equal(loadWideMapSide(storage), side);
  }
});

test("invalid saved values fall back to the existing layout", () => {
  for (const value of ["", "LEFT", "null", "Top", "up"]) {
    assert.equal(loadWideMapSide(memoryStorage({ [WIDE_MAP_SIDE_KEY]: value })), "right");
  }
});

test("unavailable storage does not prevent loading the app", () => {
  assert.equal(loadWideMapSide({ getItem() { throw new Error("blocked"); } }), "right");
});

test("a failed settings write is reported without throwing", () => {
  assert.equal(saveWideMapSide({ setItem() { throw new Error("full"); } }, "left"), false);
});

test("left and right stack only in a portrait window, with the card on top as before", () => {
  for (const side of ["left", "right"]) {
    assert.equal(wideStacked(side, false), false);
    assert.equal(wideStacked(side, true), true);
    assert.equal(wideMapOnTop(side), false);
  }
});

test("top and bottom stack in any window shape; only top puts the map above the card", () => {
  for (const portrait of [false, true]) {
    assert.equal(wideStacked("top", portrait), true);
    assert.equal(wideStacked("bottom", portrait), true);
  }
  assert.equal(wideMapOnTop("top"), true);
  assert.equal(wideMapOnTop("bottom"), false);
});

test("each choice reports its own one-letter stats code", () => {
  assert.deepEqual(["left", "right", "top", "bottom"].map(wideSideCode), ["L", "R", "T", "B"]);
});

// 11-18 사용자 PC 구성: 가운데 2560×1440(작업 영역 2560×1392), 오른쪽 1920×1080 @ 2560,358, 왼쪽 1920×1080 @ -1920,357
const MONS = [
  { x: 0, y: 0, w: 2560, h: 1392 },
  { x: 2560, y: 358, w: 1920, h: 1032 },
  { x: -1920, y: 357, w: 1920, h: 1032 },
];

test("fitWideRect: 모니터 안에 있으면 그대로", () => {
  assert.deepEqual(fitWideRect({ x: 100, y: 50, w: 1600, h: 900 }, MONS), { x: 100, y: 50, w: 1600, h: 900 });
});

test("fitWideRect: 경계에 걸치면 크기는 두고 가운데가 있는 모니터 안으로 민다(쪼그라들지 않음)", () => {
  // 실측: 2048×1152 창 왼쪽 위가 2057,505 — 예전엔 503×875 로 줄었다. 가운데(3081,1081)는 오른쪽 모니터 → 그 모니터에 맞춤
  assert.deepEqual(fitWideRect({ x: 2057, y: 505, w: 2048, h: 1152 }, MONS), { x: 2560, y: 358, w: 1920, h: 1032 });
  // 가운데가 주 모니터면 주 모니터 안으로 밀기만
  assert.deepEqual(fitWideRect({ x: 1200, y: 300, w: 1600, h: 900 }, MONS), { x: 960, y: 300, w: 1600, h: 900 });
});

test("fitWideRect: 모니터보다 크면 모니터 크기로", () => {
  assert.deepEqual(fitWideRect({ x: -1900, y: 400, w: 2400, h: 1300 }, MONS), { x: -1920, y: 357, w: 1920, h: 1032 });
});

test("fitWideRect: 가운데가 모니터 밖이면 가장 많이 겹치는 모니터, 아무 데도 없으면 null", () => {
  // 가운데(2510,-50)는 어느 모니터에도 없음 → 주 모니터와 가장 많이 겹친다
  assert.deepEqual(fitWideRect({ x: 2300, y: -200, w: 420, h: 300 }, MONS), { x: 2140, y: 0, w: 420, h: 300 });
  assert.equal(fitWideRect({ x: 9000, y: 9000, w: 400, h: 300 }, MONS), null);
  assert.equal(fitWideRect({ x: 0, y: 0, w: 400, h: 300 }, []), null);
});
