// 11-23 시세 엔진 주소 — 포트는 Rust 가 후보(8765 → 18765 → 28765) 중 비어 있는 첫 포트로 고른다(깃허브 이슈 #3:
// Anki 확장 AnkiConnect 가 8765 를 기본으로 써서 엔진이 못 떴다). 다른 모듈은 `import { PYTHON_API }` 로 읽는다 —
// ES 모듈 바인딩이라 아래에서 바꾸면 읽는 쪽도 바로 새 값을 본다. 가이드 사이트도 같은 순서로 찾는다(바꾸면 사이트 세션에 알릴 것).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const DEFAULT_ENGINE_PORT = 8765;
export let enginePort = DEFAULT_ENGINE_PORT;
export let PYTHON_API = `http://127.0.0.1:${DEFAULT_ENGINE_PORT}`;

function apply(p: unknown): void {
  if (typeof p === "number" && Number.isInteger(p) && p > 0 && p < 65536) {
    enginePort = p;
    PYTHON_API = `http://127.0.0.1:${p}`;
  }
}

/** 화면을 그리기 전에 한 번 — 엔진이 다른 포트로 다시 뜨면(포트를 다른 프로그램이 잡음) Rust 가 'engine-port' 로 알린다.
 *  알림을 먼저 듣고 나서 지금 값을 물어 그 사이 바뀐 것을 놓치지 않는다. 1.5초 안에 답이 없으면 기본 포트로 먼저 그린다.
 *  11-23 점검: 늦게 온 답도 반영한다(전엔 버려서 그 창이 엔진이 다시 뜰 때까지 기본 포트에 남았다). 다만 그 사이 알림을
 *  받았으면 알림 값이 더 새것이라 답은 버린다. 알림 등록이 멈춰도 화면은 그린다. */
export async function initEnginePort(): Promise<void> {
  let notified = false;
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const listening = listen<number>("engine-port", (e) => {
    notified = true;
    apply(e.payload);
  }).catch(() => {});
  await Promise.race([listening, wait(1500)]);
  const asked = invoke<number>("engine_port")
    .then((p) => {
      if (!notified) apply(p);
    })
    .catch(() => {});
  await Promise.race([asked, wait(1500)]);
}
