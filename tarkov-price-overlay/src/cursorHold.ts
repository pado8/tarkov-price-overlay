// 커서가 카드 위인지 최종 판정 — App.tsx 클릭 투과 폴링이 쓴다. 순수 함수라 dev/cursor-hold.test.ts 로 검증한다.
//
// 11-05 인게임(사용자): 타르코프가 켜진 채 오른쪽 모니터 → 왼쪽 모니터로 카드를 끌면 창이 자꾸 사라졌다.
// 판정은 창 위치·배율·커서를 따로 읽어 비교해서, 빠르게 끌거나 배율이 다른 모니터(가운데 125%)를 지나는 순간
// 카드 밖으로 잘못 읽힐 수 있다 → 끄는 도중 클릭 투과가 켜져 끌기가 끊기고 숨김 타이머가 걸렸다(게임이 CPU 를 쓰면 더 잘 남).
// → 카드 위에서 왼쪽 버튼을 누르기 시작했고 아직 누른 채면(끌기·슬라이더 조작 중) 계속 카드 위로 본다.
//   게임에서 누른 채(사격 등) 커서가 카드를 스치는 건 붙잡지 않는다 — 누르기 시작한 곳이 카드 밖이므로.
export type HoldState = { over: boolean; left: boolean; pressOnCard: boolean };
export const HOLD_START: HoldState = { over: false, left: false, pressOnCard: false };

export function holdStep(s: HoldState, hit: boolean, leftDown: boolean): HoldState {
  const pressOnCard = leftDown ? (s.left ? s.pressOnCard : hit || s.over) : false;
  return { over: hit || (leftDown && pressOnCard), left: leftDown, pressOnCard };
}
