"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import chromaticConfig from "@/data/chromatic-config.json";

const P = chromaticConfig.params;
const BENCH = chromaticConfig.benchOptions;
const TRIALS = 30000;

type Color = "R" | "G" | "B";

interface Method {
  id: string;
  labelKey: string;
  labelVars?: Record<string, number>;
  costPerTry: number;
  forcedNonWhite: number; // 색채=1(0개일 때만), 벤치=k개 강제
  isBench: boolean;
}

interface MethodResult extends Method {
  p: number;
  avgAttempts: number;
  avgCost: number;
  stdAttempts: number;
}

/** 한 번의 시도(색채 1회 or 벤치 1회)를 시뮬레이션해 성공 여부 반환 */
function rollOnce(
  sockets: number,
  weights: Record<Color, number>,
  totalW: number,
  pNonWhite: number,
  m: Method,
  want: { R: number; G: number; B: number; anyNonWhite: number },
): boolean {
  const pickColor = (): Color => {
    const r = Math.random() * totalW;
    if (r < weights.R) return "R";
    if (r < weights.R + weights.G) return "G";
    return "B";
  };

  const counts = { R: 0, G: 0, B: 0 };
  let nonWhite = 0;

  if (m.isBench) {
    // 벤치: 비백색 k개 강제, 나머지 소켓은 일반 롤
    const forced = Math.min(m.forcedNonWhite, sockets);
    for (let s = 0; s < forced; s++) {
      counts[pickColor()]++;
      nonWhite++;
    }
    for (let s = forced; s < sockets; s++) {
      if (Math.random() < pNonWhite) {
        counts[pickColor()]++;
        nonWhite++;
      }
    }
  } else {
    // 색채 오브: 전체 일반 롤, 비백색 0개면 1개 강제 (confirmed)
    for (let s = 0; s < sockets; s++) {
      if (Math.random() < pNonWhite) {
        counts[pickColor()]++;
        nonWhite++;
      }
    }
    if (nonWhite === 0) {
      counts[pickColor()]++;
      nonWhite = 1;
    }
  }

  return (
    counts.R >= want.R &&
    counts.G >= want.G &&
    counts.B >= want.B &&
    nonWhite >= want.anyNonWhite + want.R + want.G + want.B
  );
}

function NumInput({
  label,
  value,
  setValue,
  min,
  max,
  accent,
}: {
  label: string;
  value: number;
  setValue: (n: number) => void;
  min: number;
  max: number;
  accent?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className={accent ?? "text-zinc-300"}>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => setValue(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-sm text-zinc-200 focus:border-amber-600 focus:outline-none"
      />
    </label>
  );
}

export default function ChromaticCalculator() {
  const t = useT();
  const [strReq, setStrReq] = useState(100);
  const [dexReq, setDexReq] = useState(0);
  const [intReq, setIntReq] = useState(0);
  const [quality, setQuality] = useState(20);
  const [sockets, setSockets] = useState(6);
  const [wantR, setWantR] = useState(0);
  const [wantG, setWantG] = useState(0);
  const [wantB, setWantB] = useState(3);
  const [wantAny, setWantAny] = useState(0);
  const [pOverride, setPOverride] = useState<string>(""); // 비었으면 자동 계산

  const autoP = Math.min(1, P.baseNonWhiteChance.value + quality * P.qualityBonusPerPoint.value);
  const pNonWhite = pOverride.trim() !== "" && !isNaN(Number(pOverride))
    ? Math.max(0, Math.min(100, Number(pOverride))) / 100
    : autoP;

  const desiredTotal = wantR + wantG + wantB + wantAny;
  const invalid = desiredTotal > sockets || desiredTotal === 0;

  const results: MethodResult[] = useMemo(() => {
    if (invalid) return [];
    const base = P.colorWeightBase.value;
    const weights = { R: strReq + base, G: dexReq + base, B: intReq + base };
    const totalW = weights.R + weights.G + weights.B;
    if (totalW <= 0) return [];

    const methods: Method[] = [
      { id: "chrom", labelKey: "ch_method_chrom", costPerTry: 1, forcedNonWhite: 1, isBench: false },
      ...BENCH.filter((b) => b.minNonWhite <= sockets).map((b) => ({
        id: `bench${b.minNonWhite}`,
        labelKey: "ch_method_bench",
        labelVars: { n: b.minNonWhite },
        costPerTry: b.cost,
        forcedNonWhite: b.minNonWhite,
        isBench: true,
      })),
    ];

    const want = { R: wantR, G: wantG, B: wantB, anyNonWhite: wantAny };
    return methods
      .map((m) => {
        let success = 0;
        for (let i = 0; i < TRIALS; i++) {
          if (rollOnce(sockets, weights, totalW, pNonWhite, m, want)) success++;
        }
        const p = success / TRIALS;
        return {
          ...m,
          p,
          avgAttempts: p > 0 ? 1 / p : Infinity,
          avgCost: p > 0 ? m.costPerTry / p : Infinity,
          stdAttempts: p > 0 ? Math.sqrt(1 - p) / p : Infinity,
        };
      })
      .sort((a, b) => a.avgCost - b.avgCost);
  }, [strReq, dexReq, intReq, sockets, wantR, wantG, wantB, wantAny, pNonWhite, invalid]);

  const bestId = results[0]?.avgCost !== Infinity ? results[0]?.id : undefined;

  const fmt = (n: number, digits = 1) =>
    n === Infinity ? t("ch_never") : n >= 10000 ? `~${Math.round(n).toLocaleString()}` : `${n.toFixed(digits)}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-amber-400">{t("ch_title")}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t("ch_sub")}</p>
      </header>

      <div className="mb-6 rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
        ⚠ {t("ch_banner")}
      </div>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        {/* 입력 */}
        <section className="space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-3 font-semibold text-zinc-200">{t("ch_req")}</h2>
            <div className="space-y-2">
              <NumInput label="STR" value={strReq} setValue={setStrReq} min={0} max={999} accent="text-red-400" />
              <NumInput label="DEX" value={dexReq} setValue={setDexReq} min={0} max={999} accent="text-emerald-400" />
              <NumInput label="INT" value={intReq} setValue={setIntReq} min={0} max={999} accent="text-sky-400" />
              <NumInput label={t("ch_quality")} value={quality} setValue={setQuality} min={0} max={30} />
              <NumInput label={t("ch_sockets")} value={sockets} setValue={setSockets} min={1} max={6} />
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="text-zinc-300">{t("ch_nonwhite_chance")}</span>
                <input
                  type="number"
                  value={pOverride}
                  placeholder={(autoP * 100).toFixed(1)}
                  min={0}
                  max={100}
                  step={0.5}
                  onChange={(e) => setPOverride(e.target.value)}
                  className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-sm text-zinc-200 placeholder-zinc-600 focus:border-amber-600 focus:outline-none"
                />
              </label>
              <p className="text-[10px] leading-relaxed text-zinc-500">{t("ch_nonwhite_note")}</p>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-3 font-semibold text-zinc-200">{t("ch_desired")}</h2>
            <div className="space-y-2">
              <NumInput label="R" value={wantR} setValue={setWantR} min={0} max={6} accent="text-red-400" />
              <NumInput label="G" value={wantG} setValue={setWantG} min={0} max={6} accent="text-emerald-400" />
              <NumInput label="B" value={wantB} setValue={setWantB} min={0} max={6} accent="text-sky-400" />
              <NumInput label={t("ch_any_nonwhite")} value={wantAny} setValue={setWantAny} min={0} max={6} />
            </div>
            {desiredTotal > sockets && (
              <p className="mt-2 rounded border border-red-800 bg-red-950/50 px-2 py-1 text-xs text-red-300">
                {t("ch_desired_invalid")}
              </p>
            )}
          </div>
        </section>

        {/* 방법 비교 테이블 */}
        <section className="space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-1 font-semibold text-zinc-200">{t("ch_compare_title")}</h2>
            <p className="mb-3 text-xs text-zinc-500">{t("ch_compare_note")}</p>
            {invalid ? (
              <p className="py-8 text-center text-sm text-zinc-500">{t("ch_desired_invalid")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[540px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                      <th className="py-2 pr-2 font-medium">{t("ch_method")}</th>
                      <th className="py-2 pr-2 text-right font-medium">{t("ch_success")}</th>
                      <th className="py-2 pr-2 text-right font-medium">{t("ch_avg_cost")}</th>
                      <th className="py-2 pr-2 text-right font-medium">{t("ch_avg_attempts")}</th>
                      <th className="py-2 pr-2 text-right font-medium">{t("ch_cost_per_try")}</th>
                      <th className="py-2 text-right font-medium">{t("ch_std")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr
                        key={r.id}
                        className={`border-b border-zinc-800/60 ${
                          r.id === bestId ? "bg-emerald-950/40 text-emerald-200" : "text-zinc-300"
                        }`}
                      >
                        <td className="py-2 pr-2">
                          {t(r.labelKey, r.labelVars)}
                          {r.id === bestId && (
                            <span className="ml-2 rounded border border-emerald-700 px-1.5 py-0.5 text-[10px] text-emerald-400">
                              {t("ch_best")}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-2 text-right">
                          {r.p === 0 ? "0%" : r.p < 0.0001 ? "<0.01%" : `${(r.p * 100).toFixed(2)}%`}
                        </td>
                        <td className="py-2 pr-2 text-right font-semibold text-amber-400">{fmt(r.avgCost)}</td>
                        <td className="py-2 pr-2 text-right">{fmt(r.avgAttempts)}</td>
                        <td className="py-2 pr-2 text-right">{r.costPerTry}</td>
                        <td className="py-2 text-right">{fmt(r.stdAttempts)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-xs leading-relaxed text-zinc-400">
            {t("ch_rules")}
          </div>
        </section>
      </div>

      <footer className="mt-8 border-t border-zinc-800 pt-4 text-xs text-zinc-600">
        {t("data_pending")} · {t("footer_disclaimer")}
      </footer>
    </div>
  );
}
