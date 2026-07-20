"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";

const TOOLS = [
  { href: "/enshrouding", titleKey: "card_enshroud_title", descKey: "card_enshroud_desc", icon: "◆" },
  { href: "/allflame", titleKey: "card_allflame_title", descKey: "card_allflame_desc", icon: "🔥" },
  { href: "/chromatic", titleKey: "card_chromatic_title", descKey: "card_chromatic_desc", icon: "●" },
];

export default function Home() {
  const t = useT();
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-bold text-amber-400">{t("home_title")}</h1>
        <p className="mt-2 text-sm text-zinc-400">{t("home_sub")}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        {TOOLS.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="group flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 transition-colors hover:border-amber-700 hover:bg-zinc-900"
          >
            <span className="text-2xl">{tool.icon}</span>
            <h2 className="mt-3 font-semibold text-zinc-100 group-hover:text-amber-300">{t(tool.titleKey)}</h2>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-zinc-400">{t(tool.descKey)}</p>
            <span className="mt-4 inline-block rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-500">
              {t("data_pending")}
            </span>
            <span className="mt-3 text-xs font-medium text-amber-500">{t("open_tool")}</span>
          </Link>
        ))}
      </div>
      <footer className="mt-12 text-center text-xs text-zinc-600">{t("footer_disclaimer")}</footer>
    </div>
  );
}
