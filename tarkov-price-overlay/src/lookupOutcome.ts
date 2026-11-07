// F2 조회 결과·새 스크린샷이 카드에 무엇을 띄울지 정하는 규칙 — App.tsx 가 쓴다. 순수 함수라 dev/lookup-outcome.test.ts 로 검증한다.
//
// 화면 모드 두 가지
//   · 나란히 모드(wideMode): 왼쪽 시세 카드 + 오른쪽 지도가 늘 함께 보인다
//   · 보통 모드: 카드 하나에 시세 또는 지도(radarActive) 중 하나
// 단축키
//   · 따로: F2 = 시세, 게임 스크린샷 키 = 지도
//   · 같은 키(passthrough, '조회 키를 게임에도 전달'): F2 한 번에 조회 + 게임 스크린샷이 같이 일어난다
//     → 11-03 사용자 결정: 조회 결과가 화면을 정한다. 읽었으면 시세, 못 읽었거나 조회할 게 없으면 지도.
//       같은 누름이 만든 스크린샷은 지도 데이터만 조용히 갱신(시세 카드를 덮지 않음).
// 11-03 고친 버그: 예전엔 같은 키 + 못 읽음이면 결과를 안 그리면서 상태를 "loading" 에 둬서 카드가 "조회 중…"에 멈췄고,
//   보통 모드에선 스크린샷 감지가 늦으면 '못 찾음', 빠르면 지도 — 둘 중 먼저 끝난 쪽이 이겼다(시세가 떴다가 지도에 덮이기도).

export type LookupStatus = "idle" | "loading" | "success" | "error";

/** 조회 직전 상태로 되돌릴 때 쓸 값 — 직전도 '조회 중'(연타)이었으면 이전 결과가 있으면 그 카드, 없으면 대기 문구.
 *  절대 "loading" 을 남기지 않는다. */
export function statusAfterKept(prev: LookupStatus, hasResult: boolean): LookupStatus {
  if (prev === "loading") return hasResult ? "success" : "idle";
  return prev;
}

export type LookupView =
  | { kind: "result" } // 조회 결과(시세 또는 '못 찾음')를 카드에
  | { kind: "keep"; status: LookupStatus } // 화면 그대로(나란히 모드: 지도는 오른쪽에 이미 있음), 상태만 되돌림
  | { kind: "map"; status: LookupStatus }; // 카드 자리에 지도(이미 열려 있으면 그대로), 상태만 되돌림

// 11-04 인게임: 같은 키 + 못 읽음에서 직전 상태(마지막 시세 카드)로 되돌리면 '빈 칸인데 마지막 아이템이 나온다'로 보였다
//   (나란히 모드 왼쪽 칸에 그대로 남음) → 카드는 대기 문구로. 지도·나란히 화면 결정은 그대로.
export function viewAfterLookup(o: { passthrough: boolean; matched: boolean; wideMode: boolean; prev: LookupStatus; hasResult: boolean }): LookupView {
  if (o.matched || !o.passthrough) return { kind: "result" };
  const status: LookupStatus = "idle";
  return o.wideMode ? { kind: "keep", status } : { kind: "map", status };
}

/** 같은 키로 누른 뒤 이 시간 안에 감지된 스크린샷은 그 누름이 만든 것으로 본다(게임 저장 + 1초 폴링 + 폴더 훑기 지연). */
export const SHARED_SHOT_WINDOW_MS = 6000;

/** 새 스크린샷이 감지됐을 때: 지도를 띄울지(popup), 데이터만 갱신할지(refresh), 화면은 건드리지 않고 데이터만(quiet).
 *  11-04 인게임: 같은 키면 Shift+F2(숨기기 토글)도 게임에 가서 스크린샷이 찍힌다 → 방금 숨긴 카드·지도가 다시 떴다.
 *  토글 직후 스크린샷은 quiet — 숨겼으면 숨긴 채, 보였으면 보이던 화면 그대로. */
export function shotAction(o: { wideMode: boolean; passthrough: boolean; lookupInFlight: boolean; msSincePress: number; msSinceToggle?: number }): "popup" | "refresh" | "quiet" {
  if (o.passthrough && (o.msSinceToggle ?? Infinity) < SHARED_SHOT_WINDOW_MS) return "quiet";
  if (o.wideMode) return "refresh"; // 지도가 늘 오른쪽에 있음
  if (o.passthrough && (o.lookupInFlight || o.msSincePress < SHARED_SHOT_WINDOW_MS)) return "refresh"; // 같은 누름 — 조회 결과가 화면을 정한다
  return "popup";
}

/** 못 찾음 통계 분류(lookup_nomatch detail) — 대시보드가 '캡처 빗나감'과 '읽었는데 매칭 실패'를 가르는 기준.
 *   empty    = 아무 글자도 못 읽음(캡처 영역이 툴팁을 벗어남·툴팁 없는 곳에서 누름)
 *   junk     = 글자 조각만(3자 미만·문자 없음) — 캡처가 툴팁 가장자리만 스침
 *   no_match = 이름으로 보이는 글자를 읽었지만 카탈로그에 없음(오독·별칭 누락·새 아이템)
 * 11-07: 라틴·한글만 '글자'로 쳐서 러시아어 클라(키릴)·중국어 클라(한자)에서 읽은 이름이 전부 junk 로 떨어졌다 —
 *   RU 사용자의 진짜 오독이 '캡처 영역 문제'로 잘못 집계됨. 키릴(U+0400~04FF)·한자(U+4E00~9FFF)도 글자로 본다.
 *   한자 이름은 2자(钥匙 등)도 흔해 최소 길이를 2 로 둔다. */
export function nomatchCategory(raw?: string | null): string {
  const t = (raw || "").trim();
  if (!t) return "empty";
  const minLen = /[一-鿿]/.test(t) ? 2 : 3;
  if (t.length < minLen || !/[a-zA-Z가-힣Ѐ-ӿ一-鿿]/.test(t)) return "junk";
  return "no_match";
}
