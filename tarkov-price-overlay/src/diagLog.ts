// 진단 기록(11-06) — '마우스를 올리면 오버레이가 사라진다'(#55)처럼 이 PC 에선 재현이 안 되는 문제를 사용자 PC 에서 잡으려고
// 최근 사건을 시각순으로 모아 둔다. 피드백 '진단 정보 함께 보내기'가 설정·모니터·게임 화면 모드와 함께 이 기록을 붙인다.
// 앞 창은 프로그램 이름 대신 game / overlay / other 로만(다른 프로그램 이름은 남기지 않는다). 메모리에만, 앱을 끄면 사라진다.
const MAX = 80;
const t0 = Date.now();
const buf: string[] = [];
let last = "";
let repeat = 0;

/** 사건 하나. 같은 사건이 연달아 오면 한 줄로 묶어 (xN) 표시 */
export function diag(ev: string): void {
  if (ev === last) {
    repeat++;
    buf[buf.length - 1] = `${buf[buf.length - 1].replace(/ \(x\d+\)$/, "")} (x${repeat + 1})`;
    return;
  }
  last = ev;
  repeat = 0;
  buf.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${ev}`);
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
}

export function diagLines(): string[] {
  return buf.slice();
}

/** 피드백 본문에 붙일 진단 덩어리 — 남은 글자 수(room)에 맞춰 오래된 사건부터 자른다 */
export function diagBlock(head: string[], room: number): string {
  const top = ["--- 진단 ---", ...head, "사건(최근):"].join("\n");
  const lines = diagLines();
  let body = lines.join("\n");
  while (lines.length && top.length + 1 + body.length > room) {
    lines.shift();
    body = lines.join("\n");
  }
  return (top + "\n" + body).slice(0, Math.max(0, room));
}
