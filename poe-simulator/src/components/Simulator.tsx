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

const SLOTS: Slot[] = ["Body Armour", "Helmet", "Gloves", "Boots", "Shield"];

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  confirmed: { text: "Confirmed", cls: "bg-emerald-900 text-emerald-300 border-emerald-700" },
  reported: { text: "Reported (unverified)", cls: "bg-amber-900 text-amber-300 border-amber-700" },
  unknown: { text: "Unknown — data expected after league launch (Jul 24)", cls: "bg-zinc-800 text-zinc-400 border-zinc-700" },
};

export default function Simulator() {
  const [slot, setSlot] = useState<Slot>("Body Armour");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<UniqueItem | null>(null);
  const [corrupted, setCorrupted] = useState(false);
  const [poolSearch, setPoolSearch] = useState("");

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
        <h1 className="text-2xl font-bold text-amber-400">Enshrouding Simulator</h1>
        <p className="mt-1 text-sm text-zinc-400">
          PoE 3.29 Curse of the Allflame — Legion Vestigial Unique transformation. Pick a Unique armour to see its
          possible outcomes.
        </p>
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
                {s}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${slotUniques.length} uniques…`}
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
              Select a Unique armour on the left to simulate Enshrouding.
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
                      {selected.baseType} · {selected.slot}
                    </p>
                    <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                      <input
                        type="checkbox"
                        checked={corrupted}
                        onChange={(e) => setCorrupted(e.target.checked)}
                        className="accent-red-600"
                      />
                      Item is corrupted
                    </label>
                  </div>
                  <div className="text-right text-xs text-zinc-400">
                    <p className="font-medium text-zinc-300">Required crystal</p>
                    <p className="mt-0.5 text-amber-400">
                      {crystal ? crystal.name : "Not yet confirmed"}
                    </p>
                    {crystal && !crystal.confirmed && <p className="text-zinc-500">(unconfirmed)</p>}
                  </div>
                </div>
                {eligibility && !eligibility.eligible && (
                  <div className="mt-3 rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                    {eligibility.reasons.map((r) => (
                      <p key={r}>✕ {r}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* 흔적 모드 */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-zinc-200">Vestigial Implicit</h3>
                  {vestigial && (
                    <span className={`rounded border px-2 py-0.5 text-xs ${STATUS_LABEL[vestigial.status].cls}`}>
                      {STATUS_LABEL[vestigial.status].text}
                    </span>
                  )}
                </div>
                {vestigial?.mod ? (
                  <p className="text-sm text-sky-300">{vestigial.mod}</p>
                ) : (
                  <p className="text-sm text-zinc-500">
                    {vestigial?.notes ??
                      "The vestigial implicit derived from this Unique has not been datamined yet."}
                  </p>
                )}
                {vestigial?.source && <p className="mt-1 text-xs text-zinc-600">Source: {vestigial.source}</p>}
              </div>

              {/* 결과 풀 */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-zinc-200">
                    Possible outcomes <span className="text-sm font-normal text-zinc-500">({pool.length})</span>
                  </h3>
                  <input
                    value={poolSearch}
                    onChange={(e) => setPoolSearch(e.target.value)}
                    placeholder="Filter outcomes…"
                    className="w-48 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-amber-600 focus:outline-none"
                  />
                </div>
                <p className="mb-3 text-xs text-zinc-500">
                  Same-slot Uniques obtainable via the Ancient Orb pool. Boss-exclusive filtering will be refined once
                  3.29 data is datamined.
                </p>
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
        Item data: poe.ninja (Standard) · fetched {DATA_FETCHED_AT.slice(0, 10)} · Vestigial data pending 3.29 launch
        (2026-07-24). Not affiliated with Grinding Gear Games.
      </footer>
    </div>
  );
}
