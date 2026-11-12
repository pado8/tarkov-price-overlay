import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/version.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 } });
const { cmpVersion } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const sign = (n) => Math.sign(n);

test("숫자 비교(문자열 함정 없음)", () => {
  assert.equal(sign(cmpVersion("1.2.10", "1.2.9")), 1);
  assert.equal(sign(cmpVersion("1.3.1", "1.3.2")), -1);
  assert.equal(cmpVersion("1.3.2", "1.3.2"), 0);
  assert.equal(cmpVersion("1.3", "1.3.0"), 0);
});
test("rc 끼리는 꼬리로 — 받아 둔 rc2 표시를 rc1 에서 지우면 안 된다(11-12 QA)", () => {
  assert.equal(sign(cmpVersion("1.3.2-rc1", "1.3.2-rc2")), -1);
  assert.equal(sign(cmpVersion("1.3.2-rc2", "1.3.2-rc2")), 0);
  assert.equal(sign(cmpVersion("1.3.2-rc10", "1.3.2-rc2")), 1);
});
test("정식판은 같은 숫자의 미리보기보다 높다", () => {
  assert.equal(sign(cmpVersion("1.3.2", "1.3.2-rc2")), 1);
  assert.equal(sign(cmpVersion("1.3.2-rc2", "1.3.2")), -1);
  assert.equal(sign(cmpVersion("1.3.1", "1.3.2-rc1")), -1);
});
test("앞의 v 는 무시", () => {
  assert.equal(cmpVersion("v1.3.2", "1.3.2"), 0);
});
