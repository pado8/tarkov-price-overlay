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
    ens_source: "Source",
    reason_corrupted: "Corrupted Uniques cannot be Enshrouded",
    reason_fatelorn: "Fatelorn Uniques cannot be Enshrouded",
    // allflame
    af_title: "Allflame Crafting Simulator",
    af_sub: "Vesper preview crafting: pick a currency, watch Intangibility stack, and budget Dead Man's Sulphur.",
    af_banner:
      "Ghost count, Sulphur costs and Intangibility values are placeholder assumptions — real numbers will be injected after datamining (src/data/allflame.json).",
    af_currency: "Currency",
    af_apply: "Craft",
    af_excluded: "Not usable with Vesper",
    af_state: "Session state",
    af_intangibility: "Intangibility",
    af_sulphur_spent: "Sulphur spent",
    af_crafts: "Crafts",
    af_single_risk: "Next craft: single-outcome risk",
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
    ch_result: "Results",
    ch_p_per_orb: "Success chance per Chromatic",
    ch_expected: "Expected Chromatics",
    ch_bench: "Bench comparison (confirmed costs)",
    ch_bench_note: "New bench crafts guarantee a minimum number of non-white sockets, regardless of colour.",
    ch_bench_2: "At least 2 non-white — 5 Chromatics",
    ch_bench_3: "At least 3 non-white — 20 Chromatics",
    ch_bench_4: "At least 4 non-white — 75 Chromatics",
    ch_rules:
      "Confirmed rules: sockets are White by default · a Chromatic forces one non-white socket, others roll normally · gems gain +10% quality in matching coloured sockets · Chromatics are rarer and no longer vendor-purchasable.",
    ch_desired_invalid: "Desired sockets exceed the socket count.",
    ch_never: "practically never",
  },
  ko: {
    // common
    nav_home: "홈",
    nav_enshroud: "인슈라우딩",
    nav_allflame: "올플레임",
    nav_chromatic: "색채 오브",
    data_pending: "데이터 대기 중 — 3.29 오픈(7/24) 후 주입",
    footer_disclaimer: "Grinding Gear Games와 무관한 팬 제작 도구입니다.",
    // home
    home_title: "PoE 3.29 시뮬레이터",
    home_sub: "Path of Exile 3.29 '올플레임의 저주'를 위한 craftofexile류 플래닝 도구 모음.",
    open_tool: "열기 →",
    card_enshroud_title: "인슈라우딩 시뮬레이터",
    card_enshroud_desc:
      "군단 리워크: 유니크 변환(흔적 유니크) 미리보기 — 필요 크리스탈, 흔적 암시적 모드, 변환 결과 풀 전체.",
    card_allflame_title: "올플레임 크래프팅 시뮬레이터",
    card_allflame_desc:
      "신규 리그 메커니즘: 베스퍼 크래프팅 플래닝 — 고스트 미리보기, 무형화 누적, 망자의 유황 예산, 두캇.",
    card_chromatic_title: "색채 오브 계산기",
    card_chromatic_desc: "소켓 리워크: 비백색 소켓을 위한 색채 오브 기대 개수 추정 + 신규 벤치 제작 비교.",
    // enshrouding
    ens_title: "인슈라우딩 시뮬레이터",
    ens_sub: "PoE 3.29 올플레임의 저주 — 군단 흔적 유니크 변환. 유니크 방어구를 선택하면 가능한 결과를 보여줍니다.",
    ens_search: "유니크 {n}종 검색…",
    ens_select_hint: "왼쪽에서 유니크 방어구를 선택하면 인슈라우딩을 시뮬레이션합니다.",
    ens_corrupted: "타락한 아이템",
    ens_required_crystal: "필요 크리스탈",
    ens_crystal_unknown: "미확정",
    ens_unconfirmed: "(미확정)",
    ens_vestigial: "흔적 암시적 모드",
    ens_status_confirmed: "확정",
    ens_status_reported: "보고됨 (미검증)",
    ens_status_unknown: "미확인 — 리그 오픈(7/24) 후 데이터 예정",
    ens_no_data: "이 유니크의 흔적 암시적 모드는 아직 데이터마이닝되지 않았습니다.",
    ens_outcomes: "가능한 변환 결과",
    ens_filter: "결과 필터…",
    ens_pool_note:
      "같은 슬롯에서 Ancient Orb로 획득 가능한 유니크 풀입니다. 보스 전용 제외 목록은 3.29 데이터마이닝 후 정밀화됩니다.",
    ens_source: "출처",
    reason_corrupted: "타락한 유니크는 인슈라우딩할 수 없습니다",
    reason_fatelorn: "Fatelorn 유니크는 인슈라우딩할 수 없습니다",
    // allflame
    af_title: "올플레임 크래프팅 시뮬레이터",
    af_sub: "베스퍼 미리보기 크래프팅: 화폐를 골라 적용하며 무형화 누적과 망자의 유황 예산을 계획하세요.",
    af_banner:
      "고스트 개수·유황 비용·무형화 수치는 가정값(placeholder)입니다 — 데이터마이닝 후 실측값을 주입합니다 (src/data/allflame.json).",
    af_currency: "화폐",
    af_apply: "제작",
    af_excluded: "베스퍼 사용 불가",
    af_state: "세션 상태",
    af_intangibility: "무형화",
    af_sulphur_spent: "유황 사용량",
    af_crafts: "제작 횟수",
    af_single_risk: "다음 제작: 단일 결과 위험",
    af_log: "제작 로그",
    af_ghosts: "개 고스트 미리보기",
    af_single_outcome: "단일 결과 — 무형화 발동",
    af_reset_recomb: "새 베이스 (재조합)",
    af_reset_ducat: "리셋 두캇 (50/50 도박)",
    af_destroyed: "두캇 도박으로 아이템이 파괴됐습니다! 새 베이스로 시작하세요.",
    af_ducat_saved: "두캇 도박 성공 — 무형화가 모두 제거됐습니다.",
    af_ducats_ref: "두캇 정보",
    af_status_reported: "보고됨",
    af_status_assumed: "가정값",
    tier_low: "낮음",
    tier_medium: "중간",
    tier_high: "높음",
    // chromatic
    ch_title: "색채 오브 계산기",
    ch_sub: "3.29 소켓 리워크: 소켓 기본값은 백색이며, 색채 오브는 비백색 소켓 1개를 강제합니다.",
    ch_banner:
      "확률은 가정 파라미터 기반 추정치입니다 — 데이터마이닝 후 실제 공식을 주입합니다 (src/data/chromatic-config.json).",
    ch_req: "능력치 요구",
    ch_quality: "아이템 퀄리티",
    ch_sockets: "소켓 수",
    ch_desired: "원하는 소켓",
    ch_any_nonwhite: "아무 비백색",
    ch_result: "결과",
    ch_p_per_orb: "색채 오브 1개당 성공 확률",
    ch_expected: "기대 색채 오브 개수",
    ch_bench: "벤치 제작 비교 (확정 비용)",
    ch_bench_note: "신규 벤치 제작은 색상과 무관하게 비백색 소켓 최소 개수를 보장합니다.",
    ch_bench_2: "비백색 2개 이상 — 색채 오브 5개",
    ch_bench_3: "비백색 3개 이상 — 색채 오브 20개",
    ch_bench_4: "비백색 4개 이상 — 색채 오브 75개",
    ch_rules:
      "확정 룰: 소켓 기본값은 백색 · 색채 오브는 비백색 1개를 강제하고 나머지는 일반 롤 · 젬 색과 소켓 색이 일치하면 젬 퀄리티 +10% · 색채 오브는 더 희귀해지고 상점 구매 불가.",
    ch_desired_invalid: "원하는 소켓 수가 전체 소켓 수를 초과합니다.",
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
