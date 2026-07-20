"use client";

import { useMemo, useState } from "react";
import type { Slot, UniqueItem } from "@/lib/types";
import {
  ALL_UNIQUES,
  DATA_FETCHED_AT,
  getCrystalForSlot,
  getEligibility,
  getOutputPool,
  getVestigial,
} from "@/lib/enshrouding";
import { useLang, useT } from "@/lib/i18n";

const SLOTS: Slot[] = ["Body Armour", "Helmet", "Gloves", "Boots", "Shield"];

const SLOT_KEY: Record<Slot, string> = {
  "Body Armour": "slot_body",
  Helmet: "slot_helmet",
  Gloves: "slot_gloves",
  Boots: "slot_boots",
  Shield: "slot_shield",
};

const STATUS_KEY: Record<string, { key: string; cls: string }> = {
  confirmed: { key: "ens_status_confirmed", cls: "bg-emerald-900 text-emerald-300 border-emerald-700" },
  reported: { key: "ens_status_reported", cls: "bg-amber-900 text-amber-300 border-amber-700" },
  unknown: { key: "ens_status_unknown", cls: "bg-zinc-800 text-zinc-400 border-zinc-700" },
};

export default function Simulator() {
  const t = useT();
  const { lang } = useLang();
  const [slot, setSlot] = useState<Slot>("Body Armour");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UniqueItem | null>(null);
  const [corrupted, setCorrupted] = useState(false);
  const [poolSearch, setPoolSearch] = useState("");

  const slotTotal = useMemo(() => ALL_UNIQUES.filter((u) => u.slot === slot).length, [slot]);

  const slotUniques = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ALL_UNIQUES.filter(
      (u) => u.slot === slot && (!q || u.name.toLowerCase().includes(q) || u.baseType.toLowerCase().includes(q)),
    );
  }, [slot, search]);

  const pool = useMemo(() => {
    if (!selected) return [];
    const q = poolSearch.trim().toLowerCase();
    return getOutputPool(selected).filter((u) => !q || u.name.toLowerCase().includes(q));
  }, [selected, poolSearch]);

  const eligibility = selected ? getEligibility(selected, { corrupted }) : null;
  const vestigial = selected ? getVestigial(selected) : null;
  const crystal = selected ? getCrystalForSlot(selected.slot) : undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-amber-400">{t("ens_title")}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t("ens_sub")}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* 좌측: 슬롯 + 유니크 선택 */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-3 flex flex-wrap gap-1">
            {SLOTS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSlot(s);
                  setSelected(null);
                }}
                className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  slot === s ? "bg-amber-600 text-black" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {t(SLOT_KEY[s])}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("ens_search", { n: slotTotal })}
            className="mb-3 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-amber-600 focus:outline-none"
          />
          <ul className="max-h-[520px] space-y-1 overflow-y-auto pr-1">
            {slotUniques.map((u) => (
              <li key={u.detailsId}>
                <button
                  onClick={() => setSelected(u)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                    selected?.detailsId === u.detailsId
                      ? "bg-amber-900/40 text-amber-300"
                      : "text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u.icon} alt="" className="h-8 w-8 shrink-0 object-contain" loading="lazy" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{u.name}</span>
                    <span className="block truncate text-xs text-zinc-500">{u.baseType}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* 우측: 결과 */}
        <section className="space-y-4">
          {!selected ? (
            <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
              {t("ens_select_hint")}
            </div>
          ) : (
            <>
              {/* 선택 아이템 + 적격성 */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={selected.icon} alt="" className="h-16 w-16 object-contain" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold text-amber-300">{selected.name}</h2>
                    <p className="text-sm text-zinc-400">
                      {selected.baseType} · {t(SLOT_KEY[selected.slot])}
                    </p>
                    <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                      <input
                        type="checkbox"
                        checked={corrupted}
                        onChange={(e) => setCorrupted(e.target.checked)}
                        className="accent-red-600"
                      />
                      {t("ens_corrupted")}
                    </label>
                  </div>
                  <div className="text-right text-xs text-zinc-400">
                    <p className="font-medium text-zinc-300">{t("ens_required_crystal")}</p>
                    <p className="mt-0.5 text-amber-400">
                      {crystal ? (lang === "ko" && crystal.name_ko ? crystal.name_ko : crystal.name) : t("ens_crystal_unknown")}
                    </p>
                    {crystal && !crystal.confirmed && <p className="text-zinc-500">{t("ens_unconfirmed")}</p>}
                  </div>
                </div>
                {eligibility && !eligibility.eligible && (
                  <div className="mt-3 rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                    {eligibility.reasons.map((r) => (
                      <p key={r}>✕ {t(r)}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* 흔적 모드 */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-zinc-200">{t("ens_vestigial")}</h3>
                  {vestigial && (
                    <span className={`rounded border px-2 py-0.5 text-xs ${STATUS_KEY[vestigial.status].cls}`}>
                      {t(STATUS_KEY[vestigial.status].key)}
                    </span>
                  )}
                </div>
                {vestigial?.mod ? (
                  <p className="text-sm text-sky-300">{vestigial.mod}</p>
                ) : (
                  <p className="text-sm text-zinc-500">{vestigial?.notes ?? t("ens_no_data")}</p>
                )}
                {vestigial?.source && (
                  <p className="mt-1 text-xs text-zinc-600">
                    {t("ens_source")}: {vestigial.source}
                  </p>
                )}
              </div>

              {/* 결과 풀 */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-zinc-200">
                    {t("ens_outcomes")} <span className="text-sm font-normal text-zinc-500">({pool.length})</span>
                  </h3>
                  <input
                    value={poolSearch}
                    onChange={(e) => setPoolSearch(e.target.value)}
                    placeholder={t("ens_filter")}
                    className="w-48 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-amber-600 focus:outline-none"
                  />
                </div>
                <p className="mb-3 text-xs text-zinc-500">{t("ens_pool_note")}</p>
                <ul className="grid max-h-[420px] grid-cols-2 gap-1 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
                  {pool.map((u) => (
                    <li
                      key={u.detailsId}
                      className="flex items-center gap-2 rounded bg-zinc-950/60 px-2 py-1.5 text-xs text-zinc-300"
                      title={`${u.name} — ${u.baseType}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u.icon} alt="" className="h-7 w-7 shrink-0 object-contain" loading="lazy" />
                      <span className="truncate">{u.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>
      </div>

      <footer className="mt-8 border-t border-zinc-800 pt-4 text-xs text-zinc-600">
        {t("footer_data", { d: DATA_FETCHED_AT.slice(0, 10) })} · {t("data_pending")} · {t("footer_disclaimer")}
      </footer>
    </div>
  );
}
