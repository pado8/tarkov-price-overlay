// 11-05 플리 판매 판단 — 수수료·실수령액·보관/판매 판정(순수 함수, 화면 상태와 무관).
//
// 수수료 공식은 tarkov.dev 서버 구현(the-hideout/tarkov-api resolvers/itemResolver.mjs fleaMarketFee)과
// 공식 위키 Flea market › Tax 절 그대로:
//   VO = 기준가 × (count / Q),  VR = 판매가
//   PO = log10(VO / VR) — VR < VO 이면 1.08제곱
//   PR = log10(VR / VO) — VR ≥ VO 이면 1.08제곱
//   수수료 = VO × Ti × 4^PO × Q + VR × Tr × 4^PR × Q
//   정보 센터 3단계 이상이면 × (1 − 0.3 × (1 + 은신처관리레벨/100))  (50레벨이면 −45%)
// Ti·Tr 은 json.tarkov.dev items 덤프의 fleaMarket.sellOfferFeeRate·sellRequirementFeeRate(11-05 기준 둘 다 0.05).
// 정보 센터 3단계 보너스(RagfairCommission −0.3)는 json.tarkov.dev hideout 데이터에서도 확인.

export const DEFAULT_FLEA_FEE_RATES: [number, number] = [0.05, 0.05];
export const INTELLIGENCE_CENTER_ID = "5d484fdf654e7600691aadf8";

export function fleaFeeDiscount(intelCenterLevel: number, hideoutMgmtLevel: number): number {
  if (intelCenterLevel < 3) return 0;
  const hm = Math.max(0, Math.min(51, Math.floor(hideoutMgmtLevel || 0)));
  return 0.3 * (1 + hm * 0.01);
}

/** 한 개를 sellPrice(₽)에 올릴 때의 수수료(₽). 계산할 수 없으면 null. */
export function fleaMarketFee(
  basePrice: number | null | undefined,
  sellPrice: number | null | undefined,
  rates: [number, number] = DEFAULT_FLEA_FEE_RATES,
  intelCenterLevel = 0,
  hideoutMgmtLevel = 0,
  count = 1,
  requireAll = false
): number | null {
  if (!basePrice || !sellPrice || basePrice <= 0 || sellPrice <= 0) return null;
  const [ti, tr] = rates;
  const q = requireAll ? 1 : count;
  const vo = basePrice * (count / q);
  const vr = sellPrice;
  let po = Math.log10(vo / vr);
  if (vr < vo) po = Math.pow(po, 1.08);
  let pr = Math.log10(vr / vo);
  if (vr >= vo) pr = Math.pow(pr, 1.08);
  let fee = vo * ti * Math.pow(4, po) * q + vr * tr * Math.pow(4, pr) * q;
  fee -= fee * fleaFeeDiscount(intelCenterLevel, hideoutMgmtLevel);
  if (!Number.isFinite(fee)) return null;
  return Math.round(fee);
}

export type KeepReason =
  | { kind: "quest"; name: string; count: number | null; fir: boolean; started: boolean }
  | { kind: "kappa"; name: string }
  | { kind: "hideout"; station: string; level: number; count: number };

export type SellAdvice = {
  /** 플리 수수료(₽). 플리 판매 불가·기준가 모름이면 null */
  fee: number | null;
  /** 플리 실수령(판매가 − 수수료) */
  fleaNet: number | null;
  /** 이 계산에 정보 센터 할인이 들어갔는지(0 이면 미반영) */
  discount: number;
  traderName: string | null;
  traderPrice: number | null;
  /** keep = 아직 필요한 곳이 있음 / flea·trader = 더 많이 받는 쪽 / none = 비교할 값 없음 */
  verdict: "keep" | "flea" | "trader" | "none";
  keep: KeepReason | null;
  /** 이기는 쪽이 더 받는 금액(₽) */
  margin: number | null;
};

// 택일 후보가 이보다 많은 목표(예: 「Scavenger」 음식 110종 중 아무거나)는 특정 아이템을 남길 이유로 약해서
// 보관 판정·등급 가산에 쓰지 않는다(카드 퀘스트 목록에는 그대로 보인다).
export const WEAK_ALTERNATIVES = 20;

export type AdviceQuest = {
  name: string;
  count: number | null;
  fir: boolean;
  kappa: boolean;
  status: "started" | "completed" | "failed" | null;
  alternatives?: number | null;
};

const isOpen = (q: AdviceQuest) =>
  q.status !== "completed" && q.status !== "failed" && !((q.alternatives ?? 1) > WEAK_ALTERNATIVES);

export type AdviceHideout = { station: string; station_id: string; level: number; count: number };

/**
 * keep 우선순위: 진행 중 퀘스트 → 아직 안 한(상태 모름 포함) 퀘스트 중 카파 → 아직 안 지은 은신처 → 그 밖의 안 한 퀘스트.
 * 완료·실패한 퀘스트, 이미 지은 은신처 단계는 빼고 본다(은신처 레벨을 하나도 안 넣었으면 전부 아직 필요로 본다 — 카드 목록과 같은 규칙).
 */
export function sellAdvice(input: {
  basePrice: number | null | undefined;
  fleaPrice: number | null | undefined;
  noFlea: boolean | null | undefined;
  rates: [number, number] | null | undefined;
  traders: { name: string; price: number }[];
  quests: AdviceQuest[];
  hideout: AdviceHideout[];
  hideoutLevels: Record<string, number>;
  hideoutMgmtLevel: number;
}): SellAdvice {
  const icLevel = input.hideoutLevels[INTELLIGENCE_CENTER_ID] ?? 0;
  const discount = fleaFeeDiscount(icLevel, input.hideoutMgmtLevel);
  const canFlea = !input.noFlea && !!input.fleaPrice && input.fleaPrice > 0;
  const fee = canFlea
    ? fleaMarketFee(input.basePrice, input.fleaPrice, input.rates ?? DEFAULT_FLEA_FEE_RATES, icLevel, input.hideoutMgmtLevel)
    : null;
  const fleaNet = canFlea && fee != null ? Math.max(0, (input.fleaPrice as number) - fee) : null;
  const best = input.traders.length ? input.traders.reduce((a, b) => (b.price > a.price ? b : a)) : null;

  // 같은 순위 안에서는 이 아이템을 콕 집은(택일 후보가 적은) 퀘스트를 이유로 고른다 — 살레와: 「First Aid」(후보 6)보다 「재고 부족」(1)
  const open = input.quests.filter(isOpen).sort((a, b) => (a.alternatives ?? 1) - (b.alternatives ?? 1));
  const hasLevels = Object.keys(input.hideoutLevels).length > 0;
  const hideoutOpen = input.hideout.filter((h) => !hasLevels || (input.hideoutLevels[h.station_id] ?? 0) < h.level);
  let keep: KeepReason | null = null;
  const started = open.find((q) => q.status === "started");
  const kappa = open.find((q) => q.kappa);
  if (started) keep = { kind: "quest", name: started.name, count: started.count, fir: started.fir, started: true };
  else if (kappa) keep = { kind: "kappa", name: kappa.name };
  else if (hideoutOpen.length) {
    const h = hideoutOpen[0];
    keep = { kind: "hideout", station: h.station, level: h.level, count: h.count };
  } else if (open.length) {
    const q = open[0];
    keep = { kind: "quest", name: q.name, count: q.count, fir: q.fir, started: false };
  }

  let verdict: SellAdvice["verdict"] = "none";
  let margin: number | null = null;
  if (keep) verdict = "keep";
  else if (fleaNet != null && best) {
    verdict = fleaNet > best.price ? "flea" : "trader";
    margin = Math.abs(fleaNet - best.price);
  } else if (fleaNet != null) verdict = "flea";
  else if (best) verdict = "trader";

  return {
    fee,
    fleaNet,
    discount: fee != null ? discount : 0,
    traderName: best?.name ?? null,
    traderPrice: best?.price ?? null,
    verdict,
    keep,
    margin,
  };
}

/** 아직 어딘가 필요한 아이템인지 — 루팅 등급(computeLootTier)의 퀘스트·카파 가산에 쓴다. 완료·실패·지은 단계는 빼고 본다. */
export function stillNeeded(
  quests: AdviceQuest[],
  hideout: AdviceHideout[],
  hideoutLevels: Record<string, number>
): { any: boolean; kappa: boolean } {
  const open = quests.filter(isOpen);
  const hasLevels = Object.keys(hideoutLevels).length > 0;
  const hideoutOpen = hideout.some((h) => !hasLevels || (hideoutLevels[h.station_id] ?? 0) < h.level);
  return { any: open.length > 0 || hideoutOpen, kappa: open.some((q) => q.kappa) };
}
