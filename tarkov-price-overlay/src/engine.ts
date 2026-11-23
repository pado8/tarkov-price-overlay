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
 *  알림을 먼저 듣고 나서 지금 값을 물어 그 사이 바뀐 것을 놓치지 않는다. 1.5초 안에 답이 없으면 기본 포트로 그린다. */
export async function initEnginePort(): Promise<void> {
  try {
    await listen<number>("engine-port", (e) => apply(e.payload));
  } catch {}
  try {
    const p = await Promise.race([invoke<number>("engine_port"), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
    apply(p);
  } catch {}
}
