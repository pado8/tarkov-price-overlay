// 11-23 손으로 '진행 중' 표시한 퀘스트 — 게임 로그가 생기기 전에 받은 퀘스트(새 PC·재설치·로그 정리)는 로그로 진행 중을 알 수 없어
// 직접 표시한다(사용자 결정). 손 달성 표시(tarkov.manualQuestDone)처럼 모드별(pvp·pve·season — 게임 로그 추적기와 같은 이름)로
// localStorage 에 두고, App 이 엔진에 넘긴다(POST /quests/manual-started — 지도·카드·사이트 연동이 진행 중에 더한다).
// 로그에 그 퀘스트의 완료·실패가 오면 지도 응답(manual_resolved)으로 알려 와 여기서 지운다.
import { PYTHON_API } from "./engine";
import { stat } from "./statBus";

export const MANUAL_STARTED_KEY = "tarkov.manualQuestStarted";
const EVT = "tarkov-manual-started";
export type QuestModeKey = "pvp" | "pve" | "season";

/** 지도 응답의 quest_mode(regular·pve·pvp-season) → 저장 칸 이름 */
export const questModeKey = (m?: string | null): QuestModeKey => (m === "pve" ? "pve" : m === "pvp-season" || m === "season" ? "season" : "pvp");

export function loadManualStarted(): Record<string, string[]> {
  try {
    const v = JSON.parse(localStorage.getItem(MANUAL_STARTED_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function save(v: Record<string, string[]>): void {
  try {
    localStorage.setItem(MANUAL_STARTED_KEY, JSON.stringify(v));
  } catch {}
  window.dispatchEvent(new Event(EVT));
}

/** 켜고 끄기. 하루 요약 qsm(표시)·qsu(해제). */
export function toggleManualStarted(mode: QuestModeKey, id: string): void {
  const all = loadManualStarted();
  const cur = new Set(all[mode] ?? []);
  if (cur.has(id)) {
    cur.delete(id);
    stat("qsu");
  } else {
    cur.add(id);
    stat("qsm");
  }
  save({ ...all, [mode]: [...cur] });
}

/** 로그에 완료·실패가 온 손 표시를 지운다(지도 응답 manual_resolved). */
export function pruneManualStarted(resolved?: Record<string, string[]> | null): void {
  if (!resolved) return;
  const all = loadManualStarted();
  let changed = false;
  for (const [m, ids] of Object.entries(resolved)) {
    const cur = all[m] ?? [];
    const next = cur.filter((x) => !ids.includes(x));
    if (next.length !== cur.length) {
      all[m] = next;
      changed = true;
    }
  }
  if (changed) save(all);
}

/** 엔진에 지금 목록을 넘긴다(엔진은 메모리에만 들고 있어 시작 때·바뀔 때·몇 분마다). */
export async function syncManualStarted(): Promise<void> {
  try {
    await fetch(`${PYTHON_API}/quests/manual-started`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ by_mode: loadManualStarted() }),
    });
  } catch {}
}

/** 바뀔 때 알림(같은 창 = 자체 이벤트, 다른 창 = storage). 해제 함수를 돌려준다. */
export function onManualStartedChange(fn: () => void): () => void {
  const h = (e: Event) => {
    if (e instanceof StorageEvent && e.key !== MANUAL_STARTED_KEY) return;
    fn();
  };
  window.addEventListener("storage", h);
  window.addEventListener(EVT, h);
  return () => {
    window.removeEventListener("storage", h);
    window.removeEventListener(EVT, h);
  };
}
