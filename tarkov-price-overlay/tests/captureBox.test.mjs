import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/captureHelp.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 },
});
const { captureScale, scaleGeo, defaultScaleOf, refitBox, refitStreak, nextScanStreak, scanFitBox, resetGeo } = await import(
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

// 11-19 넓은 범위 찾기로 읽은 툴팁 위치로 상자 옮기기
const BOX = { offsetX: 13, offsetY: 150, width: 400, height: 93 }; // 툴팁과 동떨어진 상자
const HIT = { dx: 18, dy: -74, w: 265, h: 58 };

test("three scanned hits on one monitor build a streak, any other read resets it", () => {
  let s = nextScanStreak(null, "2560x1440", HIT);
  s = nextScanStreak(s, "2560x1440", HIT);
  assert.equal(s.hits.length, 2);
  assert.equal(nextScanStreak(s, "2560x1440", null), null);
  assert.equal(nextScanStreak(s, "3840x2160", HIT).hits.length, 1);
  s = nextScanStreak(nextScanStreak(s, "2560x1440", HIT), "2560x1440", HIT);
  assert.equal(s.hits.length, 4);
  for (let i = 0; i < 4; i++) s = nextScanStreak(s, "2560x1440", HIT);
  assert.equal(s.hits.length, 5, "keeps at most five");
});

test("a box the user adjusted needs five hits, a default box three", () => {
  const far = { dx: 60, dy: -300, w: 265, h: 58 };
  assert.ok(scanFitBox(BOX, [far, far, far]));
  assert.equal(scanFitBox(BOX, [far, far, far], 5), null);
  assert.equal(scanFitBox(BOX, [far, far, far, far], 5), null);
  assert.ok(scanFitBox(BOX, [far, far, far, far, far], 5));
  assert.deepEqual(scanFitBox(BOX, [{ ...far, dy: 400 }, far, far, far, far, far], 5), scanFitBox(BOX, [far, far, far, far, far], 5), "uses only the last five");
});

test("the moved box covers the tooltip that was outside it", () => {
  const b = scanFitBox(BOX, [HIT, { ...HIT, w: 229, dx: 18 }, { ...HIT, w: 398, h: 79, dy: -95 }]);
  assert.ok(b);
  assert.ok(b.offsetX <= HIT.dx && b.offsetX + b.width >= HIT.dx + 398);
  assert.ok(b.offsetY <= -95 && b.offsetY + b.height >= HIT.dy + HIT.h);
});

test("a tooltip on the left of the cursor is mirrored to the right", () => {
  const left = { ...HIT, dx: -(18 + 265) };
  assert.deepEqual(scanFitBox(BOX, [left, left, left]), scanFitBox(BOX, [HIT, HIT, HIT]));
});

test("no move with fewer than three hits, scattered hits, or a tooltip already inside", () => {
  assert.equal(scanFitBox(BOX, [HIT, HIT]), null);
  assert.equal(scanFitBox(BOX, [HIT, HIT, { ...HIT, dy: 200 }]), null);
  assert.equal(scanFitBox(BOX, [HIT, HIT, { ...HIT, dx: 300 }]), null);
  assert.equal(scanFitBox({ offsetX: 10, offsetY: -100, width: 400, height: 110 }, [HIT, HIT, HIT]), null);
});

// 11-19 '초기화' 버튼
test("reset brings back the game monitor's default, and refit works again afterwards", () => {
  const d1440 = newDefault(2560, 1440);
  const before = { ...d1440, offsetY: d1440.offsetY + 30 }; // 위쪽 상자만 손댐
  const after = resetGeo(before, BASE, captureScale(2560, 1440), "primary");
  assert.deepEqual(after, d1440);
  assert.equal(defaultScaleOf(after, BASE), 4 / 3);
  // 옛 초기화(1920 기본값을 위쪽에만)는 직접 조정한 상자로 분류됐다
  assert.equal(defaultScaleOf({ ...d1440, offsetX: 10, offsetY: -75, width: 300, height: 70 }, BASE), null);
});

test("reset keeps the other box when the user adjusted it, and moves it along when untouched", () => {
  const old = newDefault(1920, 1080);
  const custom = { ...old, groundWidth: 333 };
  assert.equal(resetGeo(custom, BASE, 2, "primary").groundWidth, 333);
  assert.deepEqual(resetGeo(old, BASE, 2, "primary"), scaleGeo(BASE, 2));
  assert.deepEqual(resetGeo(old, BASE, 2, "ground"), scaleGeo(BASE, 2));
});
