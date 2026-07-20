"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang, useT } from "@/lib/i18n";

const NAV = [
  { href: "/", key: "nav_home" },
  { href: "/enshrouding", key: "nav_enshroud" },
  { href: "/allflame", key: "nav_allflame" },
  { href: "/chromatic", key: "nav_chromatic" },
];

export default function Header() {
  const pathname = usePathname();
  const { lang, setLang } = useLang();
  const t = useT();

  return (
    <header className="border-b border-zinc-800 bg-zinc-900/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <nav className="flex flex-wrap items-center gap-1">
          <span className="mr-3 text-sm font-bold text-amber-400">PoE 3.29</span>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                pathname === n.href ? "bg-amber-600 text-black" : "text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {t(n.key)}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => setLang(lang === "en" ? "ko" : "en")}
          className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-amber-600 hover:text-amber-400"
          aria-label="Toggle language"
        >
          {lang === "en" ? "한국어" : "EN"}
        </button>
      </div>
    </header>
  );
}
