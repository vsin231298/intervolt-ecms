"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export function JobTabs({ tabs }: { tabs: { href: string; label: string; count?: number }[] }) {
  const path = usePathname();
  const activeHref = tabs.filter((t) => path === t.href || path.startsWith(t.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="no-print -mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={clsx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.href === activeHref ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
          {t.label}
          {t.count ? <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
