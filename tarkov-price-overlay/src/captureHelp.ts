// 첫 설정 도움 상자와 캡처 영역 기본값 배율 — App.tsx 가 쓴다. 순수 함수라 dev/capture-help.test.ts 로 검증한다.
//
// 11-07 통계(실패 상위 설치 × 도움 상자): 1.2.7 반복 실패자 10명 중 9명이 상자를 봤지만, 평소 잘 읽히던 사람이
//   빈 화면을 반복하며 '캡처 맞추기'를 수십 번 눌러도 회복 0인 경우가 있었다 → 캡처 영역이 아니라 툴팁 없는 곳
//   (빈 칸·인벤토리 밖·툴팁 뜨기 전)에서 누른 것으로 보고, 그땐 '툴팁이 뜬 뒤 누르세요' 안내를 먼저 보인다.
// 같은 날 해상도별 품질: 울트라와이드(2560×1080·3440×1440)는 실패 중 잡음 비율이 높았다 — 기본값 배율이
//   가로/1920 이라 세로를 따라 커지는 툴팁보다 상자가 컸다 → 가로·세로 배율 중 작은 쪽.

export type HelpMode = "capture" | "tip";

/** 상자를 띄울 때 어떤 안내를 보일지. everOk = 한 번이라도 성공, sessionOk = 이번 세션 성공 수,
 *  failKinds = 최근 실패 종류(empty/junk/no_match, 최대 10), actions = 상자의 조치 버튼을 누른 뒤 아직 회복 못 한 횟수 */
export function chooseHelpMode(everOk: boolean, sessionOk: number, failKinds: string[], actions: number): HelpMode {
  if (actions >= 3) return "tip";
  const emptyShare = failKinds.length ? failKinds.filter((k) => k === "empty").length / failKinds.length : 0;
  return everOk && sessionOk >= 5 && emptyShare >= 0.7 ? "tip" : "capture";
}

/** 캡처 영역 기본값 배율(1920×1080 = 1). 1 아래로는 안 줄인다. */
export function captureScale(monitorWidth: number, monitorHeight?: number): number {
  const byWidth = monitorWidth / 1920;
  const byHeight = monitorHeight ? monitorHeight / 1080 : byWidth;
  return Math.max(Math.min(byWidth, byHeight), 1.0);
}

/** 11-10 통계(하루 요약 bxm·bxf): 저장된 캡처 상자 높이가 조회 때 커서가 있는 모니터의 기본값(70 × captureScale)과
 *  20% 넘게 다르면 true. 상자는 첫 실행 때 주 모니터 바탕화면 기준으로 정해지는데, 게임을 다른 해상도·모니터에서 돌리면
 *  어긋난다(4K@150 실패 가설). 직접 맞춘 상자도 true 가 될 수 있다 — 콘솔에서 실패율을 어긋남/맞음으로 나눠 본다. */
export function boxMismatch(boxHeight: number, monitorWidth: number, monitorHeight: number, baseHeight = 70): boolean {
  if (!(boxHeight > 0 && monitorWidth > 0 && monitorHeight > 0)) return false;
  const expected = baseHeight * captureScale(monitorWidth, monitorHeight);
  return Math.abs(boxHeight - expected) / expected > 0.2;
}
