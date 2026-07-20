"use client";

import { useRef, useState } from "react";
import { useLang, useT } from "@/lib/i18n";
import { parseItemText, SAMPLE_ITEM_TEXT, type ParsedItem } from "@/lib/itemParser";
import {
  canApply,
  generateGhosts,
  GHOST_COPIES,
  KISHARA_COPIES,
  outcomeCount,
  previewOutcomeCount,
  RESET_DUCAT_ODDS,
  tierIntangibility,
  tierSulphur,
  VESPER_CURRENCIES,
  type VesperCurrency,
} from "@/lib/vesper";
import allflameData from "@/data/allflame.json";

interface LogEntry {
  id: number;
  currency: string;
  single: boolean;
  ghosts: number;
  intangibilityAfter: number;
}

const DUCATS = allflameData.ducats;

const TIER_KEY: Record<string, string> = { low: "tier_low", medium: "tier_medium", high: "tier_high" };
const TIER_CLS: Record<string, string> = {
  low: "text-emerald-400",
  medium: "text-amber-400",
  high: "text-red-400",
};
const RARITY_CLS: Record<string, string> = {
  Normal: "text-zinc-200",
  Magic: "text-sky-400",
  Rare: "text-yellow-300",
  Unique: "text-orange-400",
  Unknown: "text-zinc-400",
};

function ItemCard({ item, compact }: { item: ParsedItem; compact?: boolean }) {
  const r = item.requirements;
  const reqText = [r.str ? `Str ${r.str}` : "", r.dex ? `Dex ${r.dex}` : "", r.int ? `Int ${r.int}` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="rounded border border-zinc-700 bg-zinc-950/80 p-3 text-sm">
      <p className={`font-semibold ${RARITY_CLS[item.rarity]}`}>{item.name}</p>
      {item.baseType !== item.name && <p className={`${RARITY_CLS[item.rarity]} text-xs`}>{item.baseType}</p>}
      <p className="mt-1 text-[11px] text-zinc-500">
        {compact ? (
          <>
            {item.rarity}
            {reqText && ` · ${reqText}`}
          </>
        ) : (
          <>
            {item.rarity} · iLvl {item.itemLevel || "?"}
            {item.quality > 0 && ` · Q${item.quality}%`}
            {item.sockets && ` · ${item.sockets}`}
            {reqText && ` · ${reqText}`}
          </>
        )}
      </p>
      {item.implicits.length > 0 && (
        <div className="mt-2 border-t border-zinc-800 pt-1.5">
          {item.implicits.map((m, i) => (
            <p key={i} className="text-xs text-zinc-400">
              {m}
            </p>
          ))}
        </div>
      )}
      <div className="mt-2 border-t border-zinc-800 pt-1.5">
        {item.explicits.length === 0 ? (
          <p className="text-xs italic text-zinc-600">—</p>
        ) : (
          item.explicits.map((m, i) => (
            <p key={i} className="text-xs text-sky-300">
              {m}
            </p>
          ))
        )}
      </div>
      {item.corrupted && <p className="mt-1.5 text-xs font-medium text-red-500">Corrupted</p>}
    </div>
  );
}

export default function AllflameSimulator() {
  const t = useT();
  const { lang } = useLang();

  const [pasteText, setPasteText] = useState("");
  const [item, setItem] = useState<ParsedItem | null>(null);
  const [parseError, setParseError] = useState(false);

  const [ghosts, setGhosts] = useState<ParsedItem[] | null>(null);
  const [ghostCurrency, setGhostCurrency] = useState<string>("");

  const [intangibility, setIntangibility] = useState(0);
  const [sulphur, setSulphur] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [destroyed, setDestroyed] = useState(false);
  const [ducatMsg, setDucatMsg] = useState<"saved" | "destroyed" | null>(null);
  const intangRef = useRef(0);
  // 같은 틱 연속 클릭이 고스트 대기 상태(state)를 우회하지 못하도록 ref로도 가드
  const ghostsPendingRef = useRef(false);

  const importItem = (text: string) => {
    const parsed = parseItemText(text);
    if ("error" in parsed) {
      setParseError(true);
      return;
    }
    setParseError(false);
    ghostsPendingRef.current = false;
    setItem(parsed);
    setGhosts(null);
    setDestroyed(false);
    setDucatMsg(null);
    // 무형화는 아이템(베이스) 단위 → 새 아이템이면 리셋
    intangRef.current = 0;
    setIntangibility(0);
    setLog([]);
  };

  const craft = (c: VesperCurrency) => {
    if (!item || destroyed || ghosts || ghostsPendingRef.current) return;
    if (!canApply(item, c).ok) return;
    ghostsPendingRef.current = true;
    const cur = intangRef.current;
    // 방송 기준: 무형화가 쌓일수록 이번 제작의 고스트 개수가 점감
    const count = outcomeCount(c.id === "kishara" ? KISHARA_COPIES : GHOST_COPIES, cur);
    const after = Math.min(100, cur + tierIntangibility(c.tier));
    intangRef.current = after;
    const g = generateGhosts(item, c, count);
    setGhosts(g);
    setGhostCurrency(c.name);
    setIntangibility(after);
    setSulphur((s) => s + tierSulphur(c.tier));
    setLog((l) => [
      { id: Date.now() + l.length, currency: c.name, single: count === 1, ghosts: g.length, intangibilityAfter: after },
      ...l,
    ]);
    setDucatMsg(null);
  };

  const pickGhost = (g: ParsedItem) => {
    ghostsPendingRef.current = false;
    setItem(g);
    setGhosts(null);
  };

  const resetDucat = () => {
    if (destroyed || !item || ghosts) return;
    if (Math.random() < RESET_DUCAT_ODDS) {
      intangRef.current = 0;
      setIntangibility(0);
      setDucatMsg("saved");
    } else {
      ghostsPendingRef.current = false;
      setDestroyed(true);
      setItem(null);
      setGhosts(null);
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

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* 좌측: 아이템 + 화폐 */}
        <section className="space-y-4">
          {/* 아이템 불러오기 / 카드 */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-3 font-semibold text-zinc-200">{t("af_item_title")}</h2>
            {!item ? (
              <>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={t("af_paste_placeholder")}
                  rows={7}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-2 font-mono text-[11px] text-zinc-300 placeholder-zinc-600 focus:border-amber-600 focus:outline-none"
                />
                {parseError && (
                  <p className="mt-1 rounded border border-red-800 bg-red-950/50 px-2 py-1 text-xs text-red-300">
                    {t("af_parse_error")}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => importItem(pasteText)}
                    disabled={!pasteText.trim()}
                    className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("af_import_btn")}
                  </button>
                  <button
                    onClick={() => importItem(SAMPLE_ITEM_TEXT)}
                    className="rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
                  >
                    {t("af_sample_btn")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <ItemCard item={item} />
                <button
                  onClick={() => {
                    ghostsPendingRef.current = false;
                    setItem(null);
                    setGhosts(null);
                    setPasteText("");
                  }}
                  className="mt-2 rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
                >
                  {t("af_reimport")}
                </button>
              </>
            )}
            {destroyed && (
              <p className="mt-2 rounded border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-300">
                💥 {t("af_destroyed")}
              </p>
            )}
          </div>

          {/* 화폐 목록 */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-3 font-semibold text-zinc-200">{t("af_currency")}</h2>
            <ul className="space-y-1">
              {VESPER_CURRENCIES.map((c) => {
                const applicable = item ? canApply(item, c) : { ok: false, reason: undefined };
                const blocked = !item || destroyed || !!ghosts || !applicable.ok;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => craft(c)}
                      disabled={blocked}
                      title={!item ? t("af_no_item") : applicable.reason ?? t("af_apply")}
                      className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-sm transition-colors ${
                        blocked ? "cursor-not-allowed text-zinc-600" : "text-zinc-300 hover:bg-zinc-800"
                      }`}
                    >
                      <span>
                        {c.ducat && <span className="mr-1 text-[10px] text-amber-500">◆</span>}
                        {c.name}
                      </span>
                      {c.disabled ? (
                        <span className="text-[10px] text-red-500">✕</span>
                      ) : (
                        <span className={`text-[10px] ${TIER_CLS[c.tier]}`}>
                          +{tierIntangibility(c.tier)}% · {t(TIER_KEY[c.tier])}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* 우측: 고스트 / 상태 / 로그 / 두캇 */}
        <section className="space-y-4">
          {/* 고스트 미리보기 */}
          {ghosts && (
            <div className="rounded-lg border border-amber-700 bg-zinc-900/80 p-4">
              <h2 className="mb-1 font-semibold text-amber-300">
                {t("af_ghost_title")} <span className="text-sm font-normal text-zinc-400">({ghostCurrency})</span>
              </h2>
              <p className="mb-3 text-xs text-zinc-500">
                {ghosts.length === 1 ? t("af_single_outcome") : t("af_ghost_note")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {ghosts.map((g, i) => (
                  <div key={i} className="flex flex-col">
                    <ItemCard item={g} compact />
                    <button
                      onClick={() => pickGhost(g)}
                      className="mt-1.5 rounded bg-amber-600 px-2 py-1.5 text-xs font-medium text-black transition-colors hover:bg-amber-500"
                    >
                      {t("af_ghost_pick")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 상태 */}
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
                <p className="text-xs text-zinc-500">{t("af_next_ghosts")}</p>
                <p className="text-xl font-bold text-zinc-100">
                  {previewOutcomeCount(GHOST_COPIES, intangibility)}
                  <span className="text-sm font-normal text-zinc-500"> / {GHOST_COPIES}</span>
                </p>
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
                onClick={resetDucat}
                disabled={destroyed || !item || !!ghosts}
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
          </div>

          {/* 로그 */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <h2 className="mb-3 font-semibold text-zinc-200">{t("af_log")}</h2>
            {log.length === 0 ? (
              <p className="text-sm text-zinc-500">—</p>
            ) : (
              <ul className="max-h-52 space-y-1 overflow-y-auto pr-1 text-sm">
                {log.map((e) => (
                  <li
                    key={e.id}
                    className={`flex items-center justify-between gap-2 rounded px-2 py-1 ${
                      e.single ? "bg-red-950/40 text-red-300" : "bg-zinc-950/60 text-zinc-300"
                    }`}
                  >
                    <span>{e.currency}</span>
                    <span className="text-xs">
                      {e.single ? t("af_single_outcome") : `${e.ghosts} ${t("af_ghosts")}`} · {t("af_intangibility")}{" "}
                      {e.intangibilityAfter}%
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
