// 루팅 계획의 '지남' 표시는 정류장 순번(Set<number>)으로 기억한다. 정류장을 지우거나 순서를 바꾸면 순번이 달라지므로
// 같은 정류장을 따라가게 다시 매긴다(11-17 — 전에는 표시가 옆 정류장으로 옮겨 붙었다). 정류장은 객체 그대로 비교한다
// (지우기·옮기기는 배열만 새로 만들고 정류장 객체는 그대로 쓴다). tests/planDone.test.mjs

export function remapDone<T>(oldStops: readonly T[], newStops: readonly T[], done: ReadonlySet<number>): Set<number> {
  const was = new Set<T>();
  for (const i of done) if (i >= 0 && i < oldStops.length) was.add(oldStops[i]);
  const out = new Set<number>();
  newStops.forEach((s, j) => {
    if (was.has(s)) out.add(j);
  });
  return out;
}
