import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Use the project's existing TypeScript compiler so the tests also run on Node 18.
const source = await readFile(new URL("../src/wideLayout.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 },
});
const { loadWideMapSide, saveWideMapSide, WIDE_MAP_SIDE_KEY } = await import(
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
  for (const side of ["left", "right", "left"]) {
    assert.equal(saveWideMapSide(storage, side), true);
    assert.equal(loadWideMapSide(storage), side);
  }
});

test("invalid saved values fall back to the existing layout", () => {
  for (const value of ["", "LEFT", "null", "top"]) {
    assert.equal(loadWideMapSide(memoryStorage({ [WIDE_MAP_SIDE_KEY]: value })), "right");
  }
});

test("unavailable storage does not prevent loading the app", () => {
  assert.equal(loadWideMapSide({ getItem() { throw new Error("blocked"); } }), "right");
});

test("a failed settings write is reported without throwing", () => {
  assert.equal(saveWideMapSide({ setItem() { throw new Error("full"); } }, "left"), false);
});
