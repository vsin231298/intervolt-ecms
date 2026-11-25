"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import {
  LayoutDashboard, Target, Briefcase, CalendarDays, Users, Clock, ShoppingCart, FileStack, Wallet, FolderOpen,
  HardHat, Building2, BarChart3, Smartphone, Settings, ShieldCheck, UserCog, Menu, X,
} from "lucide-react";

const ICONS = { LayoutDashboard, Target, Briefcase, CalendarDays, Users, Clock, ShoppingCart, FileStack, Wallet, FolderOpen, HardHat, Building2, BarChart3, Smartphone, Settings, ShieldCheck, UserCog };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; section?: string; badge?: number };

export function Sidebar({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  let lastSection: string | undefined;
  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = path === it.href || (it.href !== "/" && path.startsWith(it.href + "/")) || path === it.href;
        const header = it.section && it.section !== lastSection ? it.section : null;
        lastSection = it.section;
        return (
          <div key={it.href}>
            {header ? <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{header}</div> : null}
            <Link
              href={it.href}
              onClick={() => setOpen(false)}
              className={clsx(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                active ? "bg-accent-500 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{it.label}</span>
              {it.badge ? <span className="rounded-full bg-red-500 px-1.5 text-xs text-white">{it.badge}</span> : null}
            </Link>
          </div>
        );
      })}
    </nav>
  );
  const brand = (
    <Link href="/" className="block px-4 pb-2 pt-4">
      <span className="block rounded-md bg-white px-3 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.png" alt="Intervolt Electric Ltd." className="mx-auto h-10 w-auto" />
      </span>
      <span className="mt-1.5 block text-center text-[11px] text-slate-400">Contracting Management</span>
    </Link>
  );
  return (
    <>
      <div className="lg:hidden"><button type="button" onClick={() => setOpen(true)} className="btn btn-ghost fixed left-2 top-2 z-40" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button></div>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-brand-900 lg:flex">{brand}{nav}</aside>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-brand-900">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-2 top-3 p-2 text-slate-300" aria-label="Close menu"><X className="h-5 w-5" /></button>
            {brand}
            {nav}
          </aside>
        </div>
      ) : null}
    </>
  );
}
