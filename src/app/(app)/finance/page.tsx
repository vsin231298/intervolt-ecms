import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate, today } from "@/lib/dates";
import { d, money, sum } from "@/lib/money";
import { Card, Empty, PageHeader, Stat, StatusBadge, Tabs, clsx } from "@/components/ui";
import { receivablesAging } from "@/services/billing";
import { financeOverview } from "@/services/dashboard";

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ tab?: string; filter?: string }> }) {
  await requireUser("financials.view");
  const sp = await searchParams;
  const tab = ["payables", "jobs"].includes(sp.tab ?? "") ? sp.tab! : "receivables";
  const t0 = today();

  return (
    <div className="space-y-6">
      <PageHeader title="Finance" subtitle="Receivables, payables and job profitability. Amounts in CAD." actions={<a className="btn btn-secondary" href="/reports">Reports & exports</a>} />
      <Tabs current={tab} items={[
        { key: "receivables", label: "Receivables (AR)", href: "/finance" },
        { key: "payables", label: "Payables (suppliers)", href: "/finance?tab=payables" },
        { key: "jobs", label: "Job profitability", href: "/finance?tab=jobs" },
      ]} />
      {tab === "receivables" ? <Receivables overdueOnly={sp.filter === "overdue"} t0={t0} /> : tab === "payables" ? <Payables t0={t0} /> : <Jobs />}
    </div>
  );
}

async function Receivables({ overdueOnly, t0 }: { overdueOnly: boolean; t0: Date }) {
  const rows = await receivablesAging(t0);
  const buckets = ["Current", "1–30", "31–60", "61–90", "90+"] as const;
  const totals = buckets.map((b) => sum(rows.filter((r) => r.bucket === b).map((r) => r.balance)));
  const list = overdueOnly ? rows.filter((r) => r.daysOverdue > 0) : rows;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total outstanding" value={money(sum(rows.map((r) => r.balance)))} />
        {buckets.map((b, i) => <Stat key={b} label={b === "Current" ? "Not yet due" : `${b} days overdue`} value={money(totals[i])} tone={i >= 3 && totals[i].greaterThan(0) ? "red" : i >= 1 && totals[i].greaterThan(0) ? "amber" : undefined} />)}
      </div>
      <Card title="Open client invoices" bodyClass="overflow-x-auto" actions={<a className="btn btn-ghost btn-sm" href={overdueOnly ? "/finance" : "/finance?filter=overdue"}>{overdueOnly ? "Show all" : "Overdue only"}</a>}>
        {list.length === 0 ? <div className="p-4"><Empty>No open invoices.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Invoice</th><th>Job</th><th>Client</th><th>Date</th><th>Due</th><th className="num">Days overdue</th><th>Status</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {list.map(({ invoice: i, balance, daysOverdue }) => (
                <tr key={i.id}>
                  <td className="font-mono text-xs"><Link className="link" href={`/jobs/${i.projectId}/billing#${i.id}`}>{i.number}</Link></td>
                  <td className="text-xs">{i.project.number}<div className="text-slate-500">{i.project.name}</div></td>
                  <td>{i.project.client?.name ?? "—"}</td>
                  <td>{fmtDate(i.invoiceDate)}</td>
                  <td>{fmtDate(i.dueDate)}</td>
                  <td className={clsx("num", daysOverdue > 60 ? "font-semibold text-red-600" : daysOverdue > 0 && "text-amber-700")}>{daysOverdue || "—"}</td>
                  <td><StatusBadge status={i.status} /></td>
                  <td className="num font-medium">{money(balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

async function Payables({ t0 }: { t0: Date }) {
  const invs = await prisma.supplierInvoice.findMany({ where: { status: { in: ["RECEIVED", "DISPUTED", "APPROVED"] } }, include: { supplier: true, project: true, purchaseOrder: true, payments: true }, orderBy: [{ dueDate: "asc" }] });
  const rows = invs.map((s) => ({ s, balance: d(s.amount).plus(d(s.tax)).minus(sum(s.payments.map((p) => p.amount))) }));
  const approved = rows.filter((r) => r.s.status === "APPROVED");
  const awaiting = rows.filter((r) => r.s.status !== "APPROVED");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Approved, to pay" value={money(sum(approved.map((r) => r.balance)))} sub={`${approved.length} invoice(s)`} />
        <Stat label="Awaiting approval / disputed" value={money(sum(awaiting.map((r) => r.balance)))} sub={`${awaiting.length} invoice(s)`} tone={awaiting.length ? "amber" : undefined} />
        <Stat label="Overdue to suppliers" value={money(sum(rows.filter((r) => r.s.dueDate && r.s.dueDate < t0).map((r) => r.balance)))} tone="red" />
      </div>
      <Card title="Supplier invoices not yet paid" bodyClass="overflow-x-auto">
        {rows.length === 0 ? <div className="p-4"><Empty>Nothing owed to suppliers.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Supplier</th><th>Invoice</th><th>Job / PO</th><th>Due</th><th>3-way match</th><th>Status</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {rows.map(({ s, balance }) => (
                <tr key={s.id}>
                  <td>{s.supplier.name}</td>
                  <td>{s.invoiceNumber}<div className="text-xs text-slate-500">{fmtDate(s.invoiceDate)}</div></td>
                  <td className="text-xs">{s.project.number}{s.purchaseOrder ? <div><Link className="link" href={`/jobs/${s.projectId}/procurement/${s.purchaseOrder.id}`}>{s.purchaseOrder.number}</Link></div> : null}</td>
                  <td className={clsx(s.dueDate && s.dueDate < t0 && "font-semibold text-red-600")}>{fmtDate(s.dueDate)}</td>
                  <td><StatusBadge status={s.matchStatus} /></td>
                  <td><StatusBadge status={s.status} /></td>
                  <td className="num">{money(balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

async function Jobs() {
  const { projectRows } = await financeOverview();
  return (
    <Card title="Active jobs" bodyClass="overflow-x-auto">
      {projectRows.length === 0 ? <div className="p-4"><Empty>No active jobs with contracts.</Empty></div> : (
        <table className="table">
          <thead><tr><th>Job</th><th className="num">Original</th><th className="num">Revised</th><th className="num">Billed</th><th className="num">Received</th><th className="num">Cost to date</th><th className="num">Est. cost</th><th className="num">Margin</th></tr></thead>
          <tbody>
            {projectRows.map(({ project: p, f }) => (
              <tr key={p.id}>
                <td><Link className="link font-mono text-xs" href={`/jobs/${p.id}/billing`}>{p.number}</Link><div className="text-xs text-slate-500">{p.name}</div></td>
                <td className="num">{money(f.originalValue)}</td>
                <td className="num">{money(f.currentValue)}</td>
                <td className="num">{money(f.billed)}<div className="text-xs text-slate-500">{f.billedPercent.toFixed(0)}%</div></td>
                <td className="num">{money(f.received)}</td>
                <td className="num">{money(f.cost)}</td>
                <td className={clsx("num", f.cost.greaterThan(f.estCost) && !f.estCost.isZero() && "text-red-600")}>{money(f.estCost)}</td>
                <td className={clsx("num", f.margin.lessThan(0) ? "text-red-600" : "text-emerald-700")}>{money(f.margin)}<div className="text-xs">{f.marginPercent.toFixed(1)}%</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
