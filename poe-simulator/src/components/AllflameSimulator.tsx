"use client";

import { useRef, useState } from "react";
import { useLang, useT } from "@/lib/i18n";
import allflameData from "@/data/allflame.json";

type Tier = "low" | "medium" | "high";

interface Currency {
  name: string;
  tier: Tier;
  excluded?: boolean;
}

interface LogEntry {
  id: number;
  currency: string;
  single: boolean;
  ghosts: number;
  intangibilityAfter: number;
}

const CFG = allflameData.config;
const CURRENCIES = allflameData.currencies as Currency[];
const DUCATS = allflameData.ducats;

const TIER_KEY: Record<Tier, string> = { low: "tier_low", medium: "tier_medium", high: "tier_high" };
const TIER_CLS: Record<Tier, string> = {
  low: "text-emerald-400",
  medium: "text-amber-400",
  high: "text-red-400",
};

function tierValue(map: Record<string, unknown>, tier: Tier): number {
  return Number(map[tier]) || 0;
}

export default function AllflameSimulator() {
  const t = useT();
  const { lang } = useLang();
  const [intangibility, setIntangibility] = useState(0);
  const [sulphur, setSulphur] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [destroyed, setDestroyed] = useState(false);
  const [ducatMsg, setDucatMsg] = useState<"saved" | "destroyed" | null>(null);

  // React 배칭으로 같은 틱에 연속 클릭 시 상태가 낡지 않도록 ref로 미러링
  const intangRef = useRef(0);

  const applyCraft = (c: Currency) => {
    if (destroyed || c.excluded) return;
    const cur = intangRef.current;
    const single = Math.random() * 100 < cur;
    const after = Math.min(100, cur + tierValue(CFG.intangibilityTiers, c.tier));
    intangRef.current = after;
    setLog((l) => [
      { id: Date.now() + l.length, currency: c.name, single, ghosts: single ? 1 : CFG.ghostCopies.value, intangibilityAfter: after },
      ...l,
    ]);
    setIntangibility(after);
    setSulphur((s) => s + tierValue(CFG.sulphurCostTiers, c.tier));
    setDucatMsg(null);
  };

  const freshBase = () => {
    intangRef.current = 0;
    setIntangibility(0);
    setSulphur(0);
    setLog([]);
    setDestroyed(false);
    setDucatMsg(null);
  };

  const resetDucat = () => {
    if (destroyed) return;
    if (Math.random() < CFG.resetDucatOdds.value) {
      intangRef.current = 0;
      setIntangibility(0);
      setDucatMsg("saved");
    } else {
      setDestroyed(true);
      setDucatMsg("destroyed");
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-amber-400">{t("af_title")}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t("af_sub")}</p>
      </header>

      <div className="mb-6 rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
        ⚠ {t("af_banner")}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* 좌측: 화폐 선택 */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 font-semibold text-zinc-200">{t("af_currency")}</h2>
          <ul className="space-y-1">
            {CURRENCIES.map((c) => (
              <li key={c.name}>
                <button
                  onClick={() => applyCraft(c)}
                  disabled={destroyed || c.excluded}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-sm transition-colors ${
                    c.excluded || destroyed
                      ? "cursor-not-allowed text-zinc-600"
                      : "text-zinc-300 hover:bg-zinc-800"
                  }`}
                  title={c.excluded ? t("af_excluded") : t("af_apply")}
                >
                  <span>{c.name}</span>
                  {c.excluded ? (
                    <span className="text-[10px] text-red-500">✕ {t("af_excluded")}</span>
                  ) : (
                    <span className={`text-[10px] ${TIER_CLS[c.tier]}`}>
                      +{tierValue(CFG.intangibilityTiers, c.tier)}% · {t(TIER_KEY[c.tier])}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* 우측: 상태 + 로그 + 두캇 */}
        <section className="space-y-4">
          {/* 세션 상태 */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-3 font-semibold text-zinc-200">{t("af_state")}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded bg-zinc-950/60 p-3">
                <p className="text-xs text-zinc-500">{t("af_intangibility")}</p>
                <p className={`text-xl font-bold ${intangibility >= 50 ? "text-red-400" : "text-zinc-100"}`}>
                  {intangibility}%
                </p>
              </div>
              <div className="rounded bg-zinc-950/60 p-3">
                <p className="text-xs text-zinc-500">{t("af_single_risk")}</p>
                <p className="text-xl font-bold text-zinc-100">{intangibility}%</p>
              </div>
              <div className="rounded bg-zinc-950/60 p-3">
                <p className="text-xs text-zinc-500">{t("af_sulphur_spent")}</p>
                <p className="text-xl font-bold text-amber-400">{sulphur}</p>
              </div>
              <div className="rounded bg-zinc-950/60 p-3">
                <p className="text-xs text-zinc-500">{t("af_crafts")}</p>
                <p className="text-xl font-bold text-zinc-100">{log.length}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={freshBase}
                className="rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
              >
                {t("af_reset_recomb")}
              </button>
              <button
                onClick={resetDucat}
                disabled={destroyed}
                className="rounded bg-red-900/60 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("af_reset_ducat")}
              </button>
            </div>
            {ducatMsg === "saved" && (
              <p className="mt-2 rounded border border-emerald-800 bg-emerald-950/50 px-3 py-2 text-xs text-emerald-300">
                ✓ {t("af_ducat_saved")}
              </p>
            )}
            {destroyed && (
              <p className="mt-2 rounded border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-300">
                💥 {t("af_destroyed")}
              </p>
            )}
          </div>

          {/* 제작 로그 */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-3 font-semibold text-zinc-200">{t("af_log")}</h2>
            {log.length === 0 ? (
              <p className="text-sm text-zinc-500">—</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto pr-1 text-sm">
                {log.map((e) => (
                  <li
                    key={e.id}
                    className={`flex items-center justify-between gap-2 rounded px-2 py-1 ${
                      e.single ? "bg-red-950/40 text-red-300" : "bg-zinc-950/60 text-zinc-300"
                    }`}
                  >
                    <span>{e.currency}</span>
                    <span className="text-xs">
                      {e.single ? t("af_single_outcome") : `${e.ghosts} ${t("af_ghosts")}`} ·{" "}
                      {t("af_intangibility")} {e.intangibilityAfter}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 두캇 정보 */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-3 font-semibold text-zinc-200">{t("af_ducats_ref")}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {DUCATS.map((d) => (
                <div key={d.name} className="rounded bg-zinc-950/60 p-3">
                  <p className="flex items-center justify-between text-sm font-medium text-amber-300">
                    {d.name}
                    <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">
                      {t("af_status_reported")}
                    </span>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    {lang === "ko" ? d.effect_ko : d.effect_en}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <footer className="mt-8 border-t border-zinc-800 pt-4 text-xs text-zinc-600">
        {t("data_pending")} · {t("footer_disclaimer")}
      </footer>
    </div>
  );
}
