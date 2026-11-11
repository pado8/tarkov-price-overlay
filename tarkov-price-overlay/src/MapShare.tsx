// 지도 자료 보내기(선택·기본 꺼짐). 사용자가 켠 경우에만 사이드카 /mapshare/send 를 부른다.
// 앱을 켜면 카드 맨 위에서 한 번 묻고(MapShareAsk), 설정엔 체크 한 줄(MapShareSettings) — 내용·형식은 python-core/map_share.py.
// 11-11 닫힘: 서버가 받기를 멈추면(Worker vars.CLOSED) 묻는 창을 띄우지 않고 설정에 '지금은 받지 않아요' — 켬 값은 사용자 것이라 그대로.
import { useEffect, useRef } from "react";
import { stat } from "./statBus";

const PYTHON_API = "http://127.0.0.1:8765";
export const MAP_SHARE_KEY = "tarkov.mapShare.on"; // "1" = 켬
export const MAP_SHARE_ASKED_KEY = "tarkov.mapShare.asked"; // "1" = 묻는 창에 답함(다시 안 물음)
const FIRST_DELAY_MS = 90 * 1000; // 켠 뒤 첫 보내기(게임 시작과 겹치지 않게)
const EVERY_MS = 1 * 3600 * 1000; // 이후 확인 간격 — 실제 보내기는 사이드카가 3시간 간격으로 거른다(11-10 12→3시간)
const STATUS_URL = "https://aquapado-mapshare.aquapado.workers.dev/status"; // {ok, closed} — Cloudflare(5분 캐시)
const STATUS_TIMEOUT_MS = 4000;

type Strings = { [k: string]: string };

export function loadMapShareOn(): boolean {
  try {
    return localStorage.getItem(MAP_SHARE_KEY) === "1";
  } catch {
    return false;
  }
}

export function loadMapShareAsked(): boolean {
  try {
    return localStorage.getItem(MAP_SHARE_ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

/** 서버가 지금 받는지 — 실행 때 한 번(묻는 창 전·켜 둔 사람만). 실패·시간 초과면 열림으로 본다(지금처럼 묻는다) */
export async function fetchMapShareClosed(): Promise<boolean> {
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), STATUS_TIMEOUT_MS);
  try {
    const j = (await (await fetch(STATUS_URL, { signal: ac.signal, cache: "no-store" })).json()) as { closed?: boolean };
    return j.closed === true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

/** 한 번 묻는 창 — 좋아요 = 켬, 싫어요 = 꺼진 채. 어느 쪽이든 다시 묻지 않고 설정 체크로 바꾼다 */
export function MapShareAsk({ t, onAnswer }: { t: Strings; onAnswer: (yes: boolean) => void }) {
  return (
    <div className="mapshare-ask" role="dialog" aria-label={t.mapShareOn}>
      <div className="mapshare-ask-text">{t.mapShareAskText}</div>
      <div className="mapshare-ask-btns">
        <button type="button" className="reset-btn" onClick={() => onAnswer(true)}>{t.mapShareYes}</button>
        <button type="button" className="reset-btn" onClick={() => onAnswer(false)}>{t.mapShareNo}</button>
      </div>
    </div>
  );
}

/** 켜져 있으면 켠 뒤 90초, 이후 1시간마다 자동 보내기(사이드카가 3시간 간격·새 줄만).
 *  onClosed(closed, first) — 보내기 응답으로 안 닫힘/열림(first = 닫힘을 이 PC 가 처음 받음) */
export function useMapShareAuto(on: boolean, onClosed?: (closed: boolean, first: boolean) => void): void {
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  useEffect(() => {
    if (!on) return;
    stat("msh"); // 11-10 통계: 켜 둔 채 실행한 횟수(하루 요약) → 켠 사람 수
    const go = () => {
      fetch(`${PYTHON_API}/mapshare/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: false }) })
        .then((r) => r.json())
        .then((j: { ok?: boolean; sent?: number; skipped?: string; closed?: boolean; closed_new?: boolean; reopened?: boolean }) => {
          if (j.closed) {
            onClosedRef.current?.(true, !!j.closed_new); // 닫힘 — 보내기 통계엔 안 셈
            return;
          }
          if (j.reopened) onClosedRef.current?.(false, false);
          // 11-10 통계: 보내기 결과(하루 요약) — mss 성공 횟수·msl 보낸 줄 수·ms0 보낼 게 없음(스크린샷 없음)·msf 실패. 간격 건너뜀은 안 셈
          if (j.skipped) return;
          if (j.ok && (j.sent ?? 0) > 0) {
            stat("mss");
            stat("msl", j.sent ?? 0);
          } else if (j.ok) stat("ms0");
          else stat("msf");
        })
        .catch(() => stat("msf"));
    };
    const first = window.setTimeout(go, FIRST_DELAY_MS);
    const iv = window.setInterval(go, EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(iv);
    };
  }, [on]);
}

/** 설정 — 한 줄 설명 + 체크. 서버가 닫혀 있으면 회색 + '지금은 받지 않아요'(체크는 그대로 바꿀 수 있음) */
export function MapShareSettings({ t, on, closed, onToggle }: { t: Strings; on: boolean; closed: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className={`settings-row${closed ? " mapshare-closed" : ""}`}>
      <label>
        {t.mapShareOn}
        {closed && <span className="mapshare-closed-note"> · {t.mapShareClosed}</span>}
      </label>
      <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
    </div>
  );
}
