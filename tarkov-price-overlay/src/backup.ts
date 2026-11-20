// 11-20 데이터 백업(1.3.6) — 사이트(구글 로그인)가 같은 PC 앱의 데이터를 백업·복원한다. 앱은 엔진(127.0.0.1)과만 이야기한다.
// 백업 대상은 '사용자가 만든 데이터와 취향'만, 허용 목록으로 둔다(새 키는 기본 제외). 설치 번호·통계·파티 세션 값·
// 한 번 닫은 안내·진단·창/모니터 위치는 빼고, 복원 때도 이 목록에 있는 키만 덮어쓴다.

export const BACKUP_KEYS: readonly string[] = [
  // 조회·카드
  "tarkov.captureRegion", "tarkov.capture.scanFitOff", "tarkov.previewAnchorMode",
  "tarkov.hotkey", "tarkov.toggleHotkey", "tarkov.hotkeyPassthrough",
  "tarkov.cardWidth", "tarkov.cardHeight", "tarkov.settingsHeight",
  "tarkov.history", "tarkov.pinned", "tarkov.questDisplayMode", "tarkov.manualQuestDone",
  "tarkov.hideoutLevels", "tarkov.hideoutMgmtLevel",
  "tarkov.soundOn", "tarkov.showInTaskbar", "tarkov.hoverDodge", "tarkov.hoverDodgeMod", "tarkov.dodgeAnyWindow",
  "tarkov.autoCheckUpdate", "tarkov.autoInstallUpdate",
  // 알림
  "tarkov.priceAlarmOn", "tarkov.priceAlarms",
  "tarkov.traderReset.on", "tarkov.traderReset.lead", "tarkov.traderReset.traders",
  // 지도
  "tarkov.radar.enabled", "tarkov.radar.bigMe", "tarkov.radar.fixed", "tarkov.radar.hiddenQuests", "tarkov.radar.lootGroups",
  "tarkov.radar.mapAlpha", "tarkov.radar.mapHold", "tarkov.radar.mapImg", "tarkov.radar.mapLayers", "tarkov.radar.mapRot.v2",
  "tarkov.radar.mapSpan", "tarkov.radar.mini", "tarkov.radar.miniSize", "tarkov.radar.miniWithWide", "tarkov.radar.myExitsOnly",
  "tarkov.radar.myKeys", "tarkov.radar.myLabels", "tarkov.radar.planSel", "tarkov.radar.plans", "tarkov.radar.showScav",
  "tarkov.radar.size", "tarkov.radar.story", "tarkov.radar.width",
  "tarkov.wideMode", "tarkov.wideMode.mapCap", "tarkov.wideMode.mapCapW", "tarkov.wideMode.mapSide",
  // 파티(별명·이름·공유 설정만 — 방 코드·주소·접속 값은 뺀다)
  "tarkov.party.name", "tarkov.party.alias", "tarkov.party.share",
];
const ALLOWED = new Set(BACKUP_KEYS);
export const BACKUP_MAX_BYTES = 200 * 1024;

/** 지금 이 PC 의 백업 대상 값(있는 키만). */
export function readBackupData(store: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of BACKUP_KEYS) {
    try {
      const v = store.getItem(k);
      if (v != null) out[k] = v;
    } catch {}
  }
  return out;
}

// data = 설정 백업(1.3.6~) · progress = 진행도 백업(엔진 /progress 응답, 1.3.6 전 사이트 백업은 이것만). 둘 중 하나는 있다.
export type PendingRestore = { saved_at?: number; app_version?: string; install_id?: string; data?: Record<string, unknown> | null; progress?: ProgressBackup | null };

/** 복원 적용: 허용 목록에 있고 문자열인 값만 덮어쓴다(설치 번호 등 나머지는 그대로). 바꾼 키 수. */
export function applyBackupData(store: Storage, data: Record<string, unknown>): number {
  let n = 0;
  for (const [k, v] of Object.entries(data || {})) {
    if (!ALLOWED.has(k) || typeof v !== "string" || v.length > BACKUP_MAX_BYTES) continue;
    try {
      store.setItem(k, v);
      n++;
    } catch {}
  }
  return n;
}

/** 백업에 든 키 중 이 판에서 실제로 적용될 수 있는 수(확인 창 표시용). */
export function restorableCount(data: Record<string, unknown> | null | undefined): number {
  return Object.entries(data || {}).filter(([k, v]) => ALLOWED.has(k) && typeof v === "string").length;
}

// ── 진행도 백업(엔진 /progress 응답 그대로 — 1.3.6 전에 사이트가 만든 백업은 이것만 있다) ──
export type ProgressBackup = {
  mode?: string;
  completed?: unknown;
  hideout?: unknown;
  faction?: unknown;
  faction_source?: unknown;
  promo_used?: unknown;
};
export type ProgressPlan = {
  mode: "pvp" | "pve" | "season" | null;
  hideout: Record<string, number> | null; // 덮어쓸 은신처 단계(없으면 null)
  questsAdd: string[]; // '직접 체크'로 더할 완료(이 PC 게임 기록·직접 체크에 이미 있는 것은 뺌)
  faction: "BEAR" | "USEC" | null; // 백업 PC 에서 직접 고른 진영일 때만
  promoAdd: string[]; // 이 PC 기록에 없는 프로모 '등록함'
};
const strList = (v: unknown, max = 3000): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64).slice(0, max) : [];

/** 백업 진행도 + 이 PC 진행도(같은 모드 /progress) + 이 PC 직접 체크 → 적용할 것. 순수 함수(시험용). */
export function planProgress(b: ProgressBackup | null | undefined, own: ProgressBackup | null | undefined, manualDone: Record<string, string[]>): ProgressPlan {
  const mode = b && (b.mode === "pvp" || b.mode === "pve" || b.mode === "season") ? b.mode : null;
  const plan: ProgressPlan = { mode, hideout: null, questsAdd: [], faction: null, promoAdd: [] };
  if (!b) return plan;
  if (b.hideout && typeof b.hideout === "object" && !Array.isArray(b.hideout)) {
    const h: Record<string, number> = {};
    for (const [k, v] of Object.entries(b.hideout as Record<string, unknown>)) {
      const n = Number(v);
      if (k.length <= 64 && Number.isInteger(n) && n > 0 && n <= 10) h[k] = n;
    }
    if (Object.keys(h).length) plan.hideout = h;
  }
  if (mode) {
    const known = new Set([...strList(own?.completed), ...(manualDone[mode] ?? [])]);
    plan.questsAdd = strList(b.completed).filter((id) => !known.has(id));
  }
  if (b.faction_source === "manual" && (b.faction === "BEAR" || b.faction === "USEC")) plan.faction = b.faction;
  const ownPromo = new Set(strList(own?.promo_used));
  plan.promoAdd = strList(b.promo_used, 200).filter((c) => /^[A-Z0-9_-]{3,24}$/.test(c) && !ownPromo.has(c));
  return plan;
}
