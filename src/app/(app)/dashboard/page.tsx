import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { addDays, fmtDate, fmtDateTime, today } from "@/lib/dates";
import { money, moneyShort, toNum } from "@/lib/money";
import { prisma } from "@/lib/db";
import { JOB_TYPE_LABELS, STAGE_LABELS } from "@/lib/workflow";
import { Badge, Card, Empty, PageHeader, Stat, StatusBadge, Tabs } from "@/components/ui";
import { BarsChart, HBarsChart } from "@/components/Charts";
import { agenda, claimsPipeline, financeOverview, operationsKpis, type ClaimBucket } from "@/services/dashboard";
import { signals } from "@/services/automation";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("jobs.view");
  const { tab = "operations" } = await searchParams;
  const showFinance = can(user.role, "financials.view");
  const tabs = [
    { key: "operations", label: "Operations", href: "/dashboard?tab=operations" },
    { key: "projects", label: "Projects", href: "/dashboard?tab=projects" },
    ...(showFinance ? [{ key: "finance", label: "Finance", href: "/dashboard?tab=finance" }] : []),
  ];
  return (
    <div>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${user.name.split(" ")[0]}`} subtitle={fmtDate(today())} actions={<>
        {can(user.role, "leads.edit") ? <Link href="/leads/new" className="btn btn-secondary">New lead</Link> : null}
        {can(user.role, "jobs.create") ? <Link href="/jobs/new" className="btn btn-primary">New work order</Link> : null}
      </>} />
      <Tabs items={tabs} current={tab} />
      {tab === "projects" ? <ProjectsTab /> : tab === "finance" && showFinance ? <FinanceTab /> : <OperationsTab userId={user.id} />}
    </div>
  );
}

async function OperationsTab({ userId }: { userId: string }) {
  const [k, sig, items, recentJobs] = await Promise.all([
    operationsKpis(),
    signals(),
    agenda(userId, today(), addDays(today(), 8)),
    prisma.project.findMany({ where: { stage: { in: ["ACTIVATION", "EXECUTION", "CLOSEOUT"] } }, include: { client: true, projectManager: true }, orderBy: { updatedAt: "desc" }, take: 10 }),
  ]);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Active jobs" value={k.active} href="/jobs?status=active" sub={`${k.byType.PROJECT ?? 0} projects · ${k.byType.SMALL_JOB ?? 0} small · ${k.byType.SERVICE ?? 0} service`} />
        <Stat label="New leads" value={k.newLeads} href="/leads?stage=new" />
        <Stat label="Tenders in progress" value={k.awaitingSubmission} href="/leads?stage=pricing" sub={`${k.deadlines} due in 14 days`} />
        <Stat label="Awarded (90 days)" value={k.awarded90} tone="green" href="/jobs?status=active" />
        <Stat label="Lost bids (90 days)" value={k.lost90} href="/jobs?status=lost" />
        <Stat label="Pending shop drawings" value={k.sdPending} href="/claims?type=sd" />
        <Stat label="Quotes outstanding" value={k.quotesOutstanding} href="/procurement?tab=quotes" />
        <Stat label="Deliveries pending" value={k.deliveriesPending} href="/procurement" />
        <Stat label="Active RFIs" value={k.rfis} href="/claims?type=rfi" />
        <Stat label="Pending change orders" value={k.cos} href="/claims?type=co" />
        <Stat label="Invoices awaiting payment" value={k.invoicesAwaiting} href="/finance" />
        <Stat label="Overdue invoices" value={k.invoicesOverdue} tone={k.invoicesOverdue ? "red" : undefined} href="/finance?filter=overdue" />
        <Stat label="In execution" value={k.execution} href="/jobs?stage=EXECUTION" />
        <Stat label="Approaching closeout" value={k.approachingCloseout} href="/jobs?stage=CLOSEOUT" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Signals" className="xl:col-span-1">
          <ul className="divide-y divide-slate-100">
            {sig.map((s) => (
              <li key={s.key}>
                <Link href={s.href} className="flex items-center justify-between py-2 text-sm hover:text-brand-700">
                  <span>{s.label}</span>
                  <Badge tone={s.count === 0 ? "gray" : s.tone === "red" ? "red" : s.tone === "amber" ? "amber" : "blue"}>{s.count}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="My schedule — next 7 days" actions={<Link href="/calendar" className="link text-xs">Open calendar</Link>} className="xl:col-span-2">
          {items.length === 0 ? <Empty>Nothing scheduled. Meetings, inspections, tender deadlines, task due dates and deliveries on your jobs appear here.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {items.slice(0, 14).map((i) => (
                <li key={i.kind + i.id} className="flex items-start gap-3 py-2 text-sm">
                  <div className="w-36 shrink-0 text-xs text-slate-500">{i.kind === "Meeting" || i.kind === "Inspection" || i.kind === "Tender due" ? fmtDateTime(i.at) : fmtDate(i.at)}</div>
                  <Badge tone={i.kind === "Meeting" ? "blue" : i.kind === "Inspection" ? "purple" : i.kind === "Tender due" ? "red" : i.kind === "Delivery" ? "teal" : "amber"}>{i.kind}</Badge>
                  <Link href={i.href} className="min-w-0 flex-1 hover:text-brand-700"><span className="font-medium">{i.title}</span>{i.sub ? <span className="ml-2 text-slate-500">{i.sub}</span> : null}</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Active jobs" actions={<Link href="/jobs?status=active" className="link text-xs">View all jobs</Link>} bodyClass="overflow-x-auto">
        {recentJobs.length === 0 ? <div className="p-4"><Empty>No active jobs yet.</Empty></div> : (
          <table className="table">
            <thead><tr><th>WO #</th><th>Job</th><th>Type</th><th>Client</th><th>PM</th><th>Stage</th><th>Finish</th></tr></thead>
            <tbody>
              {recentJobs.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap font-mono text-xs"><Link className="link" href={`/jobs/${p.id}`}>{p.number}</Link></td>
                  <td>{p.name}</td>
                  <td><Badge>{JOB_TYPE_LABELS[p.jobType]}</Badge></td>
                  <td>{p.client?.name ?? "—"}</td>
                  <td>{p.projectManager?.name ?? <span className="text-amber-600">Unassigned</span>}</td>
                  <td><StatusBadge status={p.stage} label={STAGE_LABELS[p.stage]} /></td>
                  <td className="whitespace-nowrap">{fmtDate(p.finishDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const BUCKETS: { key: ClaimBucket; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "approvedNotInvoiced", label: "Approved (not invoiced)" },
  { key: "approvedWithPo", label: "Approved (with PO)" },
  { key: "approvedInvoiced", label: "Approved (invoiced)" },
];

async function ProjectsTab() {
  const { coRows, rfiRows, sdRows } = await claimsPipeline();
  const fin = await financeOverview();
  const labour = await prisma.project.findMany({ where: { stage: { in: ["EXECUTION", "CLOSEOUT"] }, contract: { isNot: null } }, take: 12, orderBy: { updatedAt: "desc" }, select: { id: true, number: true } });
  const { labourSummary } = await import("@/services/labour");
  const labourData = [];
  for (const p of labour) {
    const s = await labourSummary(p.id);
    labourData.push({ job: p.number, estimated: toNum(s.estHours), actual: toNum(s.actualHours) });
  }
  const matData = fin.projectRows.map((r) => ({ job: r.project.number, estimated: toNum(r.f.estMaterial), actual: toNum(r.f.materialActual) }));
  return (
    <div className="space-y-6">
      <Card title="Claims pipeline" actions={<Link href="/claims" className="link text-xs">Open claims register</Link>} bodyClass="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Type</th>{BUCKETS.map((b) => <th key={b.key} className="num">{b.label}</th>)}<th className="num">Rejected / R&amp;R</th></tr></thead>
          <tbody>
            <tr>
              <td className="font-medium">ESIs / Change orders</td>
              {BUCKETS.map((b) => {
                const rows = coRows.filter((r) => r.bucket === b.key);
                return <td key={b.key} className="num"><Link className="link" href={`/claims?type=co&bucket=${b.key}`}>{rows.length}</Link><div className="text-xs text-slate-500">{moneyShort(rows.reduce((a, r) => a + toNum(r.value), 0))}</div></td>;
              })}
              <td className="num">{coRows.filter((r) => r.bucket === "rejected").length}</td>
            </tr>
            <tr>
              <td className="font-medium">RFIs</td>
              <td className="num"><Link className="link" href="/claims?type=rfi&bucket=draft">{rfiRows.filter((r) => r.bucket === "draft").length}</Link></td>
              <td className="num"><Link className="link" href="/claims?type=rfi&bucket=submitted">{rfiRows.filter((r) => r.bucket === "submitted").length}</Link></td>
              <td className="num" title="Answered">{rfiRows.filter((r) => r.bucket === "approvedNotInvoiced").length} <span className="text-xs text-slate-500">answered</span></td>
              <td className="num text-slate-300">—</td><td className="num text-slate-300">—</td><td className="num text-slate-300">—</td>
            </tr>
            <tr>
              <td className="font-medium">Shop drawings</td>
              <td className="num"><Link className="link" href="/claims?type=sd&bucket=draft">{sdRows.filter((r) => r.bucket === "draft").length}</Link></td>
              <td className="num"><Link className="link" href="/claims?type=sd&bucket=submitted">{sdRows.filter((r) => r.bucket === "submitted").length}</Link></td>
              <td className="num">{sdRows.filter((r) => r.bucket === "approvedNotInvoiced").length} <span className="text-xs text-slate-500">approved</span></td>
              <td className="num text-slate-300">—</td><td className="num text-slate-300">—</td>
              <td className="num">{sdRows.filter((r) => r.bucket === "rejected").length}</td>
            </tr>
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-slate-500">QuickBooks sync for approved-not-invoiced claims is planned for a later phase.</p>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Labour hours: estimated vs actual (active jobs)"><BarsChart data={labourData} xKey="job" unit="number" series={[{ key: "estimated", label: "Estimated hours" }, { key: "actual", label: "Actual hours" }]} /></Card>
        <Card title="Material cost: estimated vs actual (active jobs)"><BarsChart data={matData} xKey="job" series={[{ key: "estimated", label: "Estimated" }, { key: "actual", label: "Actual / committed" }]} /></Card>
      </div>
      <Card title="Project profitability (current contract value minus actual cost)">
        <HBarsChart data={fin.projectRows.map((r) => ({ job: `${r.project.number}`, margin: Math.round(toNum(r.f.margin)) }))} labelKey="job" series={[{ key: "margin", label: "Margin to date" }]} />
      </Card>
    </div>
  );
}

async function FinanceTab() {
  const f = await financeOverview();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Outstanding receivables" value={moneyShort(f.outstanding)} href="/finance" />
        <Stat label="Overdue" value={moneyShort(f.overdue)} tone={toNum(f.overdue) > 0 ? "red" : undefined} href="/finance?filter=overdue" />
        <Stat label="Invoices awaiting payment" value={f.open.length} href="/finance" />
        <Stat label="Tender success rate (12 mo)" value={f.successRate === null ? "—" : `${f.successRate.toFixed(0)}%`} sub={`${f.won} won of ${f.decided} decided`} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Monthly revenue: invoiced vs collected"><BarsChart data={f.revenue} xKey="month" series={[{ key: "invoiced", label: "Invoiced (before tax)" }, { key: "collected", label: "Collected" }]} /></Card>
        <Card title="Receivables aging"><BarsChart data={f.aging} xKey="bucket" series={[{ key: "amount", label: "Outstanding" }]} /></Card>
        <Card title="Tender outcomes by month"><BarsChart data={f.tenders} xKey="month" unit="number" series={[{ key: "awarded", label: "Awarded" }, { key: "lost", label: "Lost" }]} /></Card>
        <Card title="Job financial overview" bodyClass="overflow-x-auto">
          {f.projectRows.length === 0 ? <div className="p-4"><Empty>No active contracts.</Empty></div> : (
            <table className="table">
              <thead><tr><th>Job</th><th className="num">Contract</th><th className="num">Billed</th><th className="num">Outstanding</th><th className="num">Cost</th><th className="num">Margin</th></tr></thead>
              <tbody>
                {f.projectRows.map(({ project: p, f: x }) => (
                  <tr key={p.id}>
                    <td><Link className="link" href={`/jobs/${p.id}/billing`}>{p.number}</Link><div className="text-xs text-slate-500">{p.name}</div></td>
                    <td className="num">{money(x.currentValue)}</td>
                    <td className="num">{money(x.billed)}</td>
                    <td className="num">{money(x.outstanding)}</td>
                    <td className="num">{money(x.cost)}</td>
                    <td className={`num ${toNum(x.margin) < 0 ? "text-red-600" : ""}`}>{money(x.margin)}<div className="text-xs text-slate-500">{toNum(x.marginPercent).toFixed(1)}%</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
