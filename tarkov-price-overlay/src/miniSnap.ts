// 미니맵 자석 정렬(11-12 피드백 #61) — 끌어 놓은 미니맵 창을 화면 가장자리·모서리에 붙이는 계산(창 이동은 App.tsx)
export const MINI_SNAP_PX = 48; // 작업 영역 가장자리에서 이만큼(논리 px) 안이면 붙는다

/** 창(물리 px)을 그 중심이 있는 모니터의 작업 영역(작업표시줄 뺀 곳) 가장자리에 붙인다 — 가로·세로 따로, 둘 다면 모서리 */
export function snapToWorkArea(
  pos: { x: number; y: number },
  size: { width: number; height: number },
  mons: { position: { x: number; y: number }; size: { width: number; height: number }; scaleFactor: number; workArea?: { position: { x: number; y: number }; size: { width: number; height: number } } }[],
): { x: number; y: number } {
  const cx = pos.x + size.width / 2;
  const cy = pos.y + size.height / 2;
  const mon = mons.find((m) => cx >= m.position.x && cx < m.position.x + m.size.width && cy >= m.position.y && cy < m.position.y + m.size.height);
  if (!mon) return { x: pos.x, y: pos.y };
  const wa = mon.workArea ?? { position: mon.position, size: mon.size };
  const th = Math.round(MINI_SNAP_PX * (mon.scaleFactor || 1));
  const axis = (v: number, lo: number, len: number, w: number) => {
    const hi = lo + len - w;
    if (Math.abs(v - lo) <= th) return lo;
    if (Math.abs(v - hi) <= th) return hi;
    return v;
  };
  return { x: axis(pos.x, wa.position.x, wa.size.width, size.width), y: axis(pos.y, wa.position.y, wa.size.height, size.height) };
}
