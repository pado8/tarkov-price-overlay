// F2 조회 결과를 카드에 그릴지 결정하는 규칙 — App.tsx 의 F2 경로가 쓴다. 순수 함수라 dev/lookup-outcome.test.ts 로 검증한다.
//
// 배경(11-03 인게임에서 발견): "조회 키를 게임에도 전달"(키 공유)이 켜져 있으면 인벤토리 밖에서 누른 F2 는
// 대개 '스크린샷 + 지도 갱신'이 목적이라, 아이템을 못 읽었을 때 빈 결과 카드로 지도를 덮지 않는다.
// 예전 코드는 결과를 안 그리면서 상태도 "loading" 에 그대로 둬서, 카드가 보이는 화면(나란히 모드·지도 닫힘)에서
// "조회 중… 첫 호출은 OCR 모델 로딩" 문구가 카드가 사라질 때까지 남았다.

export type LookupStatus = "idle" | "loading" | "success" | "error";

/** 못 읽은 결과를 숨기고 화면을 그대로 둘지. 지도가 실제로 보일 때만(카드 안 지도 · 나란히 모드) 숨긴다.
 *  지도가 안 보이면 숨길 이유가 없다 → 평소처럼 '못 찾음' 결과를 보여 준다. */
export function keepScreenOnEmpty(o: { passthrough: boolean; matched: boolean; mapInCard: boolean; wideMode: boolean }): boolean {
  return o.passthrough && !o.matched && (o.mapInCard || o.wideMode);
}

/** 결과를 숨길 때 되돌릴 상태. 조회 직전 상태로 돌아가되, 그것도 '조회 중'(연타)이었으면
 *  이전 결과가 있으면 그 카드, 없으면 대기 문구. 절대 "loading" 을 남기지 않는다. */
export function statusAfterKept(prev: LookupStatus, hasResult: boolean): LookupStatus {
  if (prev === "loading") return hasResult ? "success" : "idle";
  return prev;
}
