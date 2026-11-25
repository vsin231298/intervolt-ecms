import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";

export { clsx };

export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {crumbs?.length ? (
          <nav className="mb-1 flex flex-wrap gap-1 text-xs text-slate-500">
            {crumbs.map((c, i) => (
              <span key={c.href}>
                {i > 0 && <span className="mx-1">/</span>}
                <Link href={c.href} className="hover:text-brand-600">{c.label}</Link>
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="truncate text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClass = "p-4", id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; id?: string }) {
  return (
    <section id={id} className={clsx("card", className)}>
      {title || actions ? (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

const TONES = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  purple: "bg-violet-50 text-violet-700 ring-violet-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  // stages
  OPPORTUNITY: "blue", UNDER_REVIEW: "purple", ESTIMATING: "purple", QUOTING: "purple", READY_TO_SUBMIT: "amber", SUBMITTED: "amber",
  ACTIVATION: "teal", EXECUTION: "green", CLOSEOUT: "teal", CLOSED: "gray",
  // generic
  DRAFT: "gray", FINAL: "green", SUPERSEDED: "gray", PENDING: "amber", RECEIVED: "green", DECLINED: "gray",
  ISSUED: "blue", PARTIALLY_RECEIVED: "amber", CANCELLED: "gray", OPEN: "amber", ANSWERED: "blue",
  APPROVED: "green", REJECTED: "red", INVOICED: "teal", PARTIALLY_PAID: "amber", PAID: "green", VOID: "gray",
  SCHEDULED: "blue", PASSED: "green", FAILED: "red", IN_PROGRESS: "blue", COMPLETED: "green", COMPLETE: "green", WAIVED: "purple",
  IN_PREPARATION: "gray", INTERNAL_REVIEW: "purple", UNDER_REVIEW_SD: "amber", APPROVED_AS_NOTED: "teal", REVISE_AND_RESUBMIT: "red",
  NOT_STARTED: "gray", DONE: "green", MATCHED: "green", VARIANCE: "red", NOT_CHECKED: "gray", DISPUTED: "red",
  AWARDED: "green", NOT_AWARDED: "red", REQUIRED: "gray", ORDERED: "blue", REQUESTED: "amber", ACTIONED: "blue",
  NOT_DOABLE: "gray", LOST_BID: "red",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const text = label ?? status.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return <Badge tone={STATUS_TONE[status] ?? "gray"}>{text}</Badge>;
}

export function Stat({ label, value, sub, href, tone }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; tone?: Tone }) {
  const inner = (
    <div className={clsx("card h-full p-4 transition", href && "hover:border-brand-200 hover:shadow")}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx("mt-1 text-2xl font-semibold tabular-nums", tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : tone === "green" ? "text-emerald-600" : "text-slate-900")}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
      <div>{children}</div>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function DL({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 | 4 }) {
  return (
    <dl className={clsx("grid gap-x-6 gap-y-3 text-sm", cols === 1 ? "grid-cols-1" : cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4")}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium text-slate-500">{k}</dt>
          <dd className="mt-0.5 break-words text-slate-900">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Collapsible inline panel used for "add" / "edit" forms. */
export function Drawer({ label, children, className = "btn btn-secondary btn-sm", open, wide }: { label: ReactNode; children: ReactNode; className?: string; open?: boolean; wide?: boolean }) {
  return (
    <details className="group relative" open={open}>
      <summary className={className}>{label}</summary>
      <div className={clsx("z-20 mt-2 rounded-lg border border-slate-200 bg-white p-4 shadow-lg", wide ? "w-full" : "w-full sm:absolute sm:right-0 sm:w-[28rem]")}>{children}</div>
    </details>
  );
}

export function Inline({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="btn btn-secondary btn-sm">{label}</summary>
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">{children}</div>
    </details>
  );
}

/** Sortable table header that links with ?sort=key&dir=asc|desc, preserving other params. */
export function SortTh({ label, k, params, className }: { label: string; k: string; params: Record<string, string | undefined>; className?: string }) {
  const active = params.sort === k;
  const dir = active && params.dir === "asc" ? "desc" : "asc";
  const q = new URLSearchParams(Object.entries({ ...params, sort: k, dir }).filter(([, v]) => v) as [string, string][]);
  return (
    <th className={className}>
      <Link href={`?${q.toString()}`} className="inline-flex items-center gap-1 hover:text-slate-800">
        {label}
        <span className="text-[10px]">{active ? (params.dir === "asc" ? "▲" : "▼") : ""}</span>
      </Link>
    </th>
  );
}

export function Tabs({ items, current }: { items: { href: string; label: string; key: string; count?: number }[]; current: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {items.map((t) => (
        <Link key={t.key} href={t.href} className={clsx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.key === current ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
          {t.label}
          {t.count ? <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}

export function Notice({ tone = "blue", children }: { tone?: "blue" | "amber" | "red" | "green"; children: ReactNode }) {
  const c = { blue: "border-blue-200 bg-blue-50 text-blue-800", amber: "border-amber-200 bg-amber-50 text-amber-900", red: "border-red-200 bg-red-50 text-red-800", green: "border-emerald-200 bg-emerald-50 text-emerald-800" }[tone];
  return <div className={clsx("rounded-md border px-3 py-2 text-sm", c)}>{children}</div>;
}

export function Options({ items, empty = "—" }: { items: { value: string; label: string }[]; empty?: string | false }) {
  return (
    <>
      {empty !== false ? <option value="">{empty}</option> : null}
      {items.map((i) => (
        <option key={i.value} value={i.value}>{i.label}</option>
      ))}
    </>
  );
}

export function Progress({ value, tone = "blue" }: { value: number; tone?: "blue" | "green" | "amber" | "red" }) {
  const c = { blue: "bg-brand-500", green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500" }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={clsx("h-full rounded-full", c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
