// 시세 카드를 커서 옆에 띄우기(11-12 피드백 #61-3) — 창 자리 계산(창 이동·숨김은 App.tsx)
export const CARD_GAP_PX = 24; // 커서에서 오른쪽 아래로 띄우는 거리(논리 px)
export const CURSOR_LEAVE_PX = 50; // F2 를 누른 자리에서 커서가 이만큼(논리 px) 넘게 멀어지면 카드를 숨긴다 — 11-12 사용자 280→50(아이템에서 커서를 떼면 바로)

type Mon = { position: { x: number; y: number }; size: { width: number; height: number }; scaleFactor: number; workArea?: { position: { x: number; y: number }; size: { width: number; height: number } } };

/** 커서(물리 px)가 있는 모니터 기준 — 오른쪽 아래 대각선, 오른쪽이 모자라면 커서 왼쪽, 아래가 모자라면 작업 영역 바닥에 맞춘다 */
export function spotNearCursor(cx: number, cy: number, w: number, h: number, mons: Mon[]): { x: number; y: number } {
  const mon = mons.find((m) => cx >= m.position.x && cx < m.position.x + m.size.width && cy >= m.position.y && cy < m.position.y + m.size.height) ?? mons[0];
  if (!mon) return { x: cx, y: cy };
  const wa = mon.workArea ?? { position: mon.position, size: mon.size };
  const gap = Math.round(CARD_GAP_PX * (mon.scaleFactor || 1));
  const right = wa.position.x + wa.size.width;
  const bottom = wa.position.y + wa.size.height;
  let x = cx + gap;
  if (x + w > right) x = cx - gap - w;
  x = Math.max(wa.position.x, Math.min(x, right - w));
  let y = cy + gap;
  if (y + h > bottom) y = bottom - h;
  y = Math.max(wa.position.y, y);
  return { x, y };
}

/** 커서가 F2 자리에서 멀리 갔나(물리 px, 배율 sf) */
export function cursorLeft(anchor: { x: number; y: number }, cur: { x: number; y: number }, sf: number): boolean {
  return Math.hypot(cur.x - anchor.x, cur.y - anchor.y) > CURSOR_LEAVE_PX * (sf || 1);
}
