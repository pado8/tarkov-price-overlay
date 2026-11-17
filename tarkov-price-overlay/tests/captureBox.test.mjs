import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/captureHelp.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 },
});
const { captureScale, scaleGeo, defaultScaleOf, refitBox, refitStreak } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

// App.tsx DEFAULT_REGION 의 상자 값(1920×1080 기준)
const BASE = { offsetX: 10, offsetY: -75, width: 300, height: 70, groundOffsetX: -80, groundOffsetY: 30, groundWidth: 160, groundHeight: 30 };
// 11-07 전의 기본값 계산(가로만 봄) — 그때 설치한 사람들이 지금도 갖고 있는 상자
const oldDefault = (w) => scaleGeo(BASE, Math.max(w / 1920, 1));
const newDefault = (w, h) => scaleGeo(BASE, captureScale(w, h));

test("an untouched default box is recognised at any scale, old rule or new", () => {
  for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160], [3440, 1440], [2560, 1080], [3840, 1080], [5120, 1440], [2880, 1620], [1600, 900]]) {
    assert.ok(defaultScaleOf(newDefault(w, h), BASE) != null, `new ${w}x${h}`);
    assert.ok(defaultScaleOf(oldDefault(w), BASE) != null, `old ${w}x${h}`);
  }
});

test("a box the user adjusted by hand is never treated as default", () => {
  const d = newDefault(2560, 1440);
  assert.equal(defaultScaleOf({ ...d, offsetY: d.offsetY + 12 }, BASE), null);
  assert.equal(defaultScaleOf({ ...d, width: d.width + 60 }, BASE), null);
  assert.equal(defaultScaleOf({ ...d, groundHeight: d.groundHeight + 8 }, BASE), null);
  assert.equal(defaultScaleOf({ ...BASE, width: 240, height: 56 }, BASE), null); // 직접 줄인 상자
  assert.equal(refitBox({ ...d, offsetX: d.offsetX + 5 }, BASE, 3840, 2160), null);
});

test("ultrawide installs from before the height-based fix are refitted", () => {
  // 3440×1440: 가로 기준 538×125 → 세로 기준 400×93
  assert.deepEqual(oldDefault(3440), { offsetX: 18, offsetY: -134, width: 538, height: 125, groundOffsetX: -143, groundOffsetY: 54, groundWidth: 287, groundHeight: 54 });
  assert.deepEqual(refitBox(oldDefault(3440), BASE, 3440, 1440), newDefault(2560, 1440));
  // 2560×1080: 400×93 → 300×70, 3840×1080: 600×140 → 300×70
  assert.deepEqual(refitBox(oldDefault(2560), BASE, 2560, 1080), BASE);
  assert.deepEqual(refitBox(oldDefault(3840), BASE, 3840, 1080), BASE);
});

test("a box sized for another monitor follows the monitor the game is on", () => {
  const box4k = newDefault(3840, 2160);
  assert.deepEqual(refitBox(box4k, BASE, 2560, 1440), newDefault(2560, 1440)); // 4K 주 모니터 + 1440p 에서 게임(또는 전체 화면 1440p)
  assert.deepEqual(refitBox(box4k, BASE, 1920, 1080), BASE);
  assert.deepEqual(refitBox(BASE, BASE, 3840, 2160), box4k); // 1080p 로 설치한 뒤 4K 모니터로 바꿈
});

test("a box that already fits is left alone", () => {
  for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160], [3440, 1440], [2560, 1080], [1280, 720]]) {
    assert.equal(refitBox(newDefault(w, h), BASE, w, h), null, `${w}x${h}`);
  }
  assert.equal(refitBox(oldDefault(2560), BASE, 2560, 1440), null); // 16:9 는 옛 계산과 새 계산이 같다
  assert.equal(refitBox(newDefault(2560, 1440), BASE, 2560, 1600), null); // 16:10 — 가로가 작은 쪽이라 그대로 1.333
  assert.equal(refitBox(newDefault(2560, 1440), BASE, 0, 0), null);
});

test("a refit needs two lookups in a row on the same mismatched monitor", () => {
  let prev = null;
  let apply;
  [apply, prev] = refitStreak(prev, 3440, 1440, true);
  assert.deepEqual([apply, prev], [false, "3440x1440"]);
  [apply, prev] = refitStreak(prev, 3440, 1440, true);
  assert.deepEqual([apply, prev], [true, null]);
  // 다른 모니터에서 한 번 누른 것은 적용 안 됨, 맞는 조회가 끼면 처음부터
  [apply, prev] = refitStreak(null, 1920, 1080, true);
  [apply, prev] = refitStreak(prev, 3440, 1440, true);
  assert.deepEqual([apply, prev], [false, "3440x1440"]);
  [apply, prev] = refitStreak(prev, 3440, 1440, false);
  assert.deepEqual([apply, prev], [false, null]);
});
