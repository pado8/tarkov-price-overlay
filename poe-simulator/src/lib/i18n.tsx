"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Lang = "en" | "ko";

const dict: Record<Lang, Record<string, string>> = {
  en: {
    // common
    nav_home: "Home",
    nav_enshroud: "Enshrouding",
    nav_allflame: "Allflame",
    nav_chromatic: "Chromatic",
    data_pending: "Data pending 3.29 launch (Jul 24)",
    footer_disclaimer: "Not affiliated with Grinding Gear Games.",
    footer_data: "Item data: poe.ninja (Standard) · fetched {d}",
    // shared item labels
    slot_body: "Body Armour",
    slot_helmet: "Helmet",
    slot_gloves: "Gloves",
    slot_boots: "Boots",
    slot_shield: "Shield",
    rarity_normal: "Normal",
    rarity_magic: "Magic",
    rarity_rare: "Rare",
    rarity_unique: "Unique",
    rarity_unknown: "Unknown",
    item_corrupted: "Corrupted",
    attr_str: "STR",
    attr_dex: "DEX",
    attr_int: "INT",
    // currency applicability (tooltips)
    req_normal: "Requires a Normal item",
    req_magic: "Requires a Magic item",
    req_magic_open: "Requires a Magic item with fewer than 2 mods",
    req_rare: "Requires a Rare item",
    req_rare_open: "Requires a Rare item with fewer than 6 mods",
    req_magic_rare: "Requires a Magic or Rare item",
    req_has_mods: "Requires at least one mod",
    req_rare_2mods: "Requires a Rare item with 2+ mods",
    req_attr: "Requires an attribute requirement",
    req_not_unique: "Not usable on Unique items",
    af_undisclosed: "Mechanics undisclosed",
    // home
    home_title: "PoE 3.29 Simulators",
    home_sub: "Craft-of-Exile-style planning tools for Path of Exile 3.29 — Curse of the Allflame.",
    open_tool: "Open tool →",
    card_enshroud_title: "Enshrouding Simulator",
    card_enshroud_desc:
      "Legion rework: preview Vestigial Unique transformations — required crystal, vestigial implicit, and the full outcome pool.",
    card_allflame_title: "Allflame Crafting Simulator",
    card_allflame_desc:
      "League mechanic: plan Vesper crafts — ghost previews, Intangibility build-up, Dead Man's Sulphur budget, and Ducats.",
    card_chromatic_title: "Chromatic Calculator",
    card_chromatic_desc:
      "Socket rework: estimate Chromatic Orb odds for non-white sockets and compare with the new bench crafts.",
    // enshrouding
    ens_title: "Enshrouding Simulator",
    ens_sub: "PoE 3.29 Curse of the Allflame — Legion Vestigial Unique transformation. Pick a Unique armour to see its possible outcomes.",
    ens_search: "Search {n} uniques…",
    ens_select_hint: "Select a Unique armour on the left to simulate Enshrouding.",
    ens_corrupted: "Item is corrupted",
    ens_required_crystal: "Required crystal",
    ens_crystal_unknown: "Not yet confirmed",
    ens_unconfirmed: "(unconfirmed)",
    ens_vestigial: "Vestigial Implicit",
    ens_status_confirmed: "Confirmed",
    ens_status_reported: "Reported (unverified)",
    ens_status_unknown: "Unknown — data expected after league launch (Jul 24)",
    ens_no_data: "The vestigial implicit derived from this Unique has not been datamined yet.",
    ens_outcomes: "Possible outcomes",
    ens_filter: "Filter outcomes…",
    ens_pool_note:
      "Same-slot Uniques obtainable via the Ancient Orb pool. Boss-exclusive filtering will be refined once 3.29 data is datamined.",
    ens_pool_click: "Click an item to see its modifiers.",
    ens_source: "Source",
    reason_corrupted: "Corrupted Uniques cannot be Enshrouded",
    reason_fatelorn: "Fatelorn Uniques cannot be Enshrouded",
    // allflame
    af_title: "Allflame Crafting Simulator",
    af_sub: "Vesper preview crafting: pick a currency, watch Intangibility stack, and budget Dead Man's Sulphur.",
    af_banner:
      "Ghost count, Sulphur costs, Intangibility values and the mod pool are placeholder assumptions — new/rerolled mods use a simplified generic pool until the real 3.29 mod data is injected (src/data/allflame.json, generic-mods.json).",
    af_currency: "Currency & Ducats",
    af_apply: "Craft",
    af_excluded: "Not usable with Vesper",
    af_item_title: "Item",
    af_paste_placeholder: "Paste an item here (Ctrl+C on the item in game, then Ctrl+V)…",
    af_import_btn: "Import item",
    af_sample_btn: "Sample item",
    af_sample_hint: "Or load an item from the 3.29 reveal:",
    af_reimport: "Import another item",
    af_parse_error: "Could not parse the item text. Copy the item in game with Ctrl+C and paste the full text.",
    af_no_item: "Import an item first to use currency.",
    af_ghost_title: "Ghost previews — pick one",
    af_ghost_note: "Vesper shows multiple possible outcomes. The one you pick becomes real; the rest vanish.",
    af_ghost_pick: "Choose this outcome",
    af_state: "Session state",
    af_intangibility: "Intangibility",
    af_sulphur_spent: "Sulphur spent",
    af_crafts: "Crafts",
    af_single_risk: "Next craft: single-outcome risk",
    af_next_ghosts: "Next craft: ghost previews",
    af_log: "Craft log",
    af_ghosts: "ghost previews",
    af_single_outcome: "single outcome — Intangibility proc",
    af_reset_recomb: "Fresh base (recombinate)",
    af_reset_ducat: "Reset Ducat (50/50 gamble)",
    af_destroyed: "Item destroyed by the Ducat gamble! Start a fresh base.",
    af_ducat_saved: "Ducat gamble succeeded — all Intangibility removed.",
    af_ducats_ref: "Ducat reference",
    af_status_reported: "reported",
    af_status_assumed: "assumed",
    tier_low: "Low",
    tier_medium: "Medium",
    tier_high: "High",
    // chromatic
    ch_title: "Chromatic Calculator",
    ch_sub: "3.29 socket rework: sockets default to White; a Chromatic Orb forces one non-white socket.",
    ch_banner:
      "Roll chances are estimates with assumed parameters — real formulas will be injected after datamining (src/data/chromatic-config.json).",
    ch_req: "Attribute requirements",
    ch_quality: "Item quality",
    ch_sockets: "Sockets",
    ch_desired: "Desired sockets",
    ch_any_nonwhite: "Any non-white",
    ch_compare_title: "Method comparison",
    ch_compare_note: "Sorted by average cost in Chromatic Orbs — cheapest first. Monte Carlo, 30k trials per method.",
    ch_method: "Method",
    ch_method_chrom: "Chromatic Orb spam",
    ch_method_bench: "Bench: at least {n} non-white",
    ch_success: "Success chance",
    ch_avg_cost: "Avg cost (Chrom.)",
    ch_avg_attempts: "Avg attempts",
    ch_cost_per_try: "Cost / try",
    ch_std: "Std dev (attempts)",
    ch_best: "BEST",
    ch_nonwhite_chance: "Non-white chance / socket (%)",
    ch_nonwhite_note: "Auto = assumed base + quality bonus. Override with a measured value once the league is live.",
    ch_method_omen: "Chromatic + Omen of Trichromatism",
    ch_omen_price: "Omen price (in Chromatics)",
    ch_omen_note:
      "Omen of Trichromatism guarantees at least one R, G and B socket on the next Chromatic (confirmed). Its price is market-driven — enter your league's rate.",
    ch_rules:
      "Confirmed rules: sockets are White by default · a Chromatic forces one non-white socket, others roll normally · gems gain +10% quality in matching coloured sockets · Chromatics are rarer and no longer vendor-purchasable.",
    ch_desired_invalid: "Desired sockets exceed the socket count.",
    ch_never: "practically never",
  },
  ko: {
    // common
    nav_home: "홈",
    nav_enshroud: "휩싸는 수정",
    nav_allflame: "올플레임",
    nav_chromatic: "색채의 오브",
    data_pending: "데이터 대기 중 — 3.29 오픈(7/24) 후 주입",
    footer_disclaimer: "Grinding Gear Games와 무관한 팬 제작 도구입니다.",
    footer_data: "아이템 데이터: poe.ninja (스탠다드) · {d} 수집",
    // shared item labels
    slot_body: "갑옷",
    slot_helmet: "투구",
    slot_gloves: "장갑",
    slot_boots: "장화",
    slot_shield: "방패",
    rarity_normal: "일반",
    rarity_magic: "마법",
    rarity_rare: "희귀",
    rarity_unique: "고유",
    rarity_unknown: "알 수 없음",
    item_corrupted: "타락한",
    attr_str: "힘",
    attr_dex: "민첩",
    attr_int: "지능",
    // currency applicability (tooltips)
    req_normal: "일반 아이템에만 사용 가능",
    req_magic: "마법 아이템에만 사용 가능",
    req_magic_open: "마법 아이템 + 모드 2개 미만 필요",
    req_rare: "희귀 아이템에만 사용 가능",
    req_rare_open: "희귀 아이템 + 모드 6개 미만 필요",
    req_magic_rare: "마법 또는 희귀 아이템 필요",
    req_has_mods: "모드가 1개 이상 필요",
    req_rare_2mods: "희귀 아이템 + 모드 2개 이상 필요",
    req_attr: "능력치 요구가 있는 아이템 필요",
    req_not_unique: "고유 아이템에는 사용 불가",
    af_undisclosed: "메커니즘 미공개",
    // home
    home_title: "PoE 3.29 시뮬레이터",
    home_sub: "Path of Exile 3.29 '올플레임의 저주'를 위한 craftofexile류 플래닝 도구 모음.",
    open_tool: "열기 →",
    card_enshroud_title: "휩싸는 수정 시뮬레이터",
    card_enshroud_desc:
      "군단 리워크: 고유 아이템 변환 미리보기 — 필요 휩싸는 수정, 흔적 고정 속성, 변환 결과 풀 전체.",
    card_allflame_title: "올플레임 크래프팅 시뮬레이터",
    card_allflame_desc:
      "신규 리그 메커니즘: 베스퍼 크래프팅 플래닝 — 고스트 미리보기, 무형화 누적, 망자의 유황 예산, 두카트.",
    card_chromatic_title: "색채의 오브 계산기",
    card_chromatic_desc: "홈 리워크: 하얀색이 아닌 홈을 위한 색채의 오브 기대 개수 추정 + 신규 작업대 제작 비교.",
    // enshrouding
    ens_title: "휩싸는 수정 시뮬레이터",
    ens_sub: "PoE 3.29 올플레임의 저주 — 군단 고유 아이템 변환(흔적 고정 속성). 고유 방어구를 선택하면 가능한 결과를 보여줍니다.",
    ens_search: "고유 {n}종 검색…",
    ens_select_hint: "왼쪽에서 고유 방어구를 선택하면 변환을 시뮬레이션합니다.",
    ens_corrupted: "타락한 아이템",
    ens_required_crystal: "필요 수정",
    ens_crystal_unknown: "미확정",
    ens_unconfirmed: "(미확정)",
    ens_vestigial: "흔적 고정 속성",
    ens_status_confirmed: "확정",
    ens_status_reported: "보고됨 (미검증)",
    ens_status_unknown: "미확인 — 리그 오픈(7/24) 후 데이터 예정",
    ens_no_data: "이 고유 아이템의 흔적 고정 속성은 아직 데이터마이닝되지 않았습니다.",
    ens_outcomes: "가능한 변환 결과",
    ens_filter: "결과 필터…",
    ens_pool_note:
      "같은 슬롯에서 고대의 오브로 획득 가능한 고유 아이템 풀입니다. 보스 전용 제외 목록은 3.29 데이터마이닝 후 정밀화됩니다.",
    ens_pool_click: "항목을 클릭하면 모드를 볼 수 있습니다.",
    ens_source: "출처",
    reason_corrupted: "타락한 고유 아이템은 변환할 수 없습니다",
    reason_fatelorn: "Fatelorn 고유 아이템은 변환할 수 없습니다",
    // allflame
    af_title: "올플레임 크래프팅 시뮬레이터",
    af_sub: "베스퍼(Vesper) 미리보기 크래프팅: 화폐를 골라 적용하며 무형화 누적과 망자의 유황 예산을 계획하세요.",
    af_banner:
      "고스트 개수·유황 비용·무형화 수치·모드 풀은 가정값입니다 — 신규/재굴림 모드는 간이 모드 풀로 근사하며, 3.29 실데이터 주입 후 교체됩니다 (allflame.json, generic-mods.json).",
    af_currency: "화폐 & 두카트",
    af_apply: "제작",
    af_excluded: "베스퍼 사용 불가",
    af_item_title: "아이템",
    af_paste_placeholder: "아이템을 붙여넣으세요 (게임에서 아이템에 대고 Ctrl+C → 여기에 Ctrl+V)…",
    af_import_btn: "아이템 불러오기",
    af_sample_btn: "예시 아이템",
    af_sample_hint: "또는 3.29 공식 리빌에 나온 아이템 불러오기:",
    af_reimport: "다른 아이템 불러오기",
    af_parse_error: "아이템 텍스트를 해석하지 못했습니다. 게임에서 Ctrl+C로 복사한 전체 텍스트를 붙여넣어 주세요.",
    af_no_item: "먼저 아이템을 불러와야 화폐를 쓸 수 있습니다.",
    af_ghost_title: "고스트 미리보기 — 하나를 선택하세요",
    af_ghost_note: "베스퍼는 가능한 결과 여러 개를 보여줍니다. 선택한 것만 실물이 되고 나머지는 사라집니다.",
    af_ghost_pick: "이 결과 선택",
    af_state: "세션 상태",
    af_intangibility: "무형화",
    af_sulphur_spent: "유황 사용량",
    af_crafts: "제작 횟수",
    af_single_risk: "다음 제작: 단일 결과 위험",
    af_next_ghosts: "다음 제작: 고스트 개수",
    af_log: "제작 로그",
    af_ghosts: "개 고스트 미리보기",
    af_single_outcome: "단일 결과 — 무형화 발동",
    af_reset_recomb: "새 베이스 (재조합)",
    af_reset_ducat: "리셋 두카트 (50/50 도박)",
    af_destroyed: "두카트 도박으로 아이템이 파괴됐습니다! 새 베이스로 시작하세요.",
    af_ducat_saved: "두카트 도박 성공 — 무형화가 모두 제거됐습니다.",
    af_ducats_ref: "두카트 정보",
    af_status_reported: "보고됨",
    af_status_assumed: "가정값",
    tier_low: "낮음",
    tier_medium: "중간",
    tier_high: "높음",
    // chromatic
    ch_title: "색채의 오브 계산기",
    ch_sub: "3.29 홈 리워크: 홈 기본값은 하얀색이며, 색채의 오브는 하얀색이 아닌 홈 1개를 강제합니다.",
    ch_banner:
      "확률은 가정 파라미터 기반 추정치입니다 — 데이터마이닝 후 실제 공식을 주입합니다 (src/data/chromatic-config.json).",
    ch_req: "능력치 요구",
    ch_quality: "아이템 퀄리티",
    ch_sockets: "홈 개수",
    ch_desired: "원하는 홈",
    ch_any_nonwhite: "하얀색 아닌 아무 색",
    ch_compare_title: "제작 방법 비교",
    ch_compare_note: "평균 비용(색채의 오브) 오름차순 정렬 — 가장 싼 방법이 맨 위. 방법당 몬테카를로 3만 회.",
    ch_method: "방법",
    ch_method_chrom: "색채의 오브 스팸",
    ch_method_bench: "작업대: 하얀색 아닌 홈 {n}개 이상",
    ch_success: "성공 확률",
    ch_avg_cost: "평균 비용 (색채의 오브)",
    ch_avg_attempts: "평균 시도",
    ch_cost_per_try: "시도당 비용",
    ch_std: "표준편차 (시도)",
    ch_best: "최적",
    ch_nonwhite_chance: "홈당 하얀색 아닌 확률 (%)",
    ch_nonwhite_note: "비워두면 자동(가정 기본값+퀄리티 보너스). 리그 오픈 후 실측값으로 덮어쓰세요.",
    ch_method_omen: "색채의 오브 + 삼색성의 징조",
    ch_omen_price: "징조 가격 (색채의 오브 환산)",
    ch_omen_note:
      "삼색성의 징조(Omen of Trichromatism)는 다음 색채의 오브 사용 시 R/G/B 홈 각 1개 이상을 보장합니다(확정). 가격은 시장가라 리그 시세를 직접 입력하세요.",
    ch_rules:
      "확정 룰: 홈 기본값은 하얀색 · 색채의 오브는 하얀색이 아닌 홈 1개를 강제하고 나머지는 일반 롤 · 젬 색과 홈 색이 일치하면 젬 퀄리티 +10% · 색채의 오브는 더 희귀해지고 상점 구매 불가.",
    ch_desired_invalid: "원하는 홈 수가 전체 홈 개수를 초과합니다.",
    ch_never: "사실상 불가능",
  },
};

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "en",
  setLang: () => {},
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    const saved = localStorage.getItem("poe-sim-lang");
    if (saved === "ko" || saved === "en") setLangState(saved);
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("poe-sim-lang", l);
  };
  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
}

export function useLang() {
  return useContext(LangCtx);
}

/** t("key") 또는 t("key", {n: 5}) — {n} 치환 */
export function useT() {
  const { lang } = useLang();
  return (key: string, vars?: Record<string, string | number>) => {
    let s = dict[lang][key] ?? dict.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
