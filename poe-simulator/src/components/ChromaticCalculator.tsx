"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import chromaticConfig from "@/data/chromatic-config.json";

const P = chromaticConfig.params;
const BENCH = chromaticConfig.benchOptions;
const TRIALS = 50000;

type Color = "R" | "G" | "B";

/** 3.29 모델: 각 소켓은 비백색 확률 p로 롤, 비백색이면 능력치 가중치로 색 결정. 색채 오브는 비백색 0개면 1개를 강제. */
function simulateChromatic(
  sockets: number,
  weights: Record<Color, number>,
  pNonWhite: number,
  want: { R: number; G: number; B: number; anyNonWhite: number },
): number {
  const totalW = weights.R + weights.G + weights.B;
  if (totalW <= 0) return 0;
  const pickColor = (): Color => {
    const r = Math.random() * totalW;
    if (r < weights.R) return "R";
    if (r < weights.R + weights.G) return "G";
    return "B";
  };

  let success = 0;
  for (let i = 0; i < TRIALS; i++) {
    const counts = { R: 0, G: 0, B: 0 };
    let nonWhite = 0;
    for (let s = 0; s < sockets; s++) {
      if (Math.random() < pNonWhite) {
        counts[pickColor()]++;
        nonWhite++;
      }
    }
    // 색채 오브: 비백색 1개 강제 (confirmed)
    if (nonWhite === 0) {
      counts[pickColor()]++;
      nonWhite = 1;
    }
    if (
      counts.R >= want.R &&
      counts.G >= want.G &&
      counts.B >= want.B &&
      nonWhite >= want.anyNonWhite + want.R + want.G + want.B
    ) {
      success++;
    }
  }
  return success / TRIALS;
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

  const desiredTotal = wantR + wantG + wantB + wantAny;
  const invalid = desiredTotal > sockets || desiredTotal === 0;

  const pSuccess = useMemo(() => {
    if (invalid) return 0;
    const pNonWhite = Math.min(1, P.baseNonWhiteChance.value + quality * P.qualityBonusPerPoint.value);
    const base = P.colorWeightBase.value;
    return simulateChromatic(
      sockets,
      { R: strReq + base, G: dexReq + base, B: intReq + base },
      pNonWhite,
      { R: wantR, G: wantG, B: wantB, anyNonWhite: wantAny },
    );
  }, [strReq, dexReq, intReq, quality, sockets, wantR, wantG, wantB, wantAny, invalid]);

  const expected = pSuccess > 0 ? Math.ceil(1 / pSuccess) : Infinity;
  const benchApplicable = wantR === 0 && wantG === 0 && wantB === 0 && wantAny >= 2;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-amber-400">{t("ch_title")}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t("ch_sub")}</p>
      </header>

      <div className="mb-6 rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
        ⚠ {t("ch_banner")}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
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

        {/* 결과 */}
        <section className="space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-3 font-semibold text-zinc-200">{t("ch_result")}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded bg-zinc-950/60 p-3">
                <p className="text-xs text-zinc-500">{t("ch_p_per_orb")}</p>
                <p className="text-2xl font-bold text-zinc-100">
                  {invalid ? "—" : `${(pSuccess * 100).toFixed(2)}%`}
                </p>
              </div>
              <div className="rounded bg-zinc-950/60 p-3">
                <p className="text-xs text-zinc-500">{t("ch_expected")}</p>
                <p className="text-2xl font-bold text-amber-400">
                  {invalid ? "—" : expected === Infinity ? t("ch_never") : `~${expected}`}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-2 font-semibold text-zinc-200">{t("ch_bench")}</h2>
            <p className="mb-3 text-xs text-zinc-500">{t("ch_bench_note")}</p>
            <ul className="space-y-1 text-sm">
              {BENCH.map((b) => (
                <li
                  key={b.minNonWhite}
                  className={`flex items-center justify-between rounded px-2.5 py-1.5 ${
                    benchApplicable && wantAny === b.minNonWhite
                      ? "bg-emerald-950/50 text-emerald-300"
                      : "bg-zinc-950/60 text-zinc-300"
                  }`}
                >
                  <span>{t(`ch_bench_${b.minNonWhite}`)}</span>
                  <span className="rounded border border-emerald-800 px-1.5 py-0.5 text-[10px] text-emerald-400">
                    confirmed
                  </span>
                </li>
              ))}
            </ul>
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
