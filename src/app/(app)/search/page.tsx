import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { STAGE_LABELS } from "@/lib/workflow";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser("jobs.view");
  const q = (await searchParams).q?.trim() ?? "";
  const ci = { contains: q, mode: "insensitive" as const };
  const empty = q.length < 2;
  const [jobs, pos, invoices, orgs, workers, docs, cos] = empty ? [[], [], [], [], [], [], []] : await Promise.all([
    prisma.project.findMany({ where: { OR: [{ number: ci }, { name: ci }, { location: ci }, { clientProjectNo: ci }, { client: { name: ci } }] }, include: { client: true }, take: 20, orderBy: { createdAt: "desc" } }),
    prisma.purchaseOrder.findMany({ where: { OR: [{ number: ci }, { supplier: { name: ci } }] }, include: { supplier: true, project: true }, take: 10 }),
    can(user.role, "financials.view") ? prisma.invoice.findMany({ where: { number: ci }, include: { project: true }, take: 10 }) : [],
    prisma.organization.findMany({ where: { OR: [{ name: ci }, { contacts: { some: { name: ci } } }] }, take: 10 }),
    prisma.worker.findMany({ where: { name: ci }, take: 10 }),
    can(user.role, "documents.view") ? prisma.document.findMany({ where: { OR: [{ title: ci }, { versions: { some: { fileName: ci } } }] }, include: { project: true, versions: { orderBy: { revision: "desc" }, take: 1 } }, take: 15 }) : [],
    prisma.changeOrder.findMany({ where: { OR: [{ number: ci }, { title: ci }] }, include: { project: true }, take: 10 }),
  ]);
  const total = jobs.length + pos.length + invoices.length + orgs.length + workers.length + docs.length + cos.length;
  const Section = ({ title, children, n }: { title: string; children: React.ReactNode; n: number }) => (n ? <Card title={`${title} (${n})`}><ul className="space-y-1.5 text-sm">{children}</ul></Card> : null);
  return (
    <div className="space-y-6">
      <PageHeader title="Search" subtitle={empty ? "Search work orders, jobs, POs, invoices, change orders, companies, employees and documents" : `${total} result(s) for “${q}”`} />
      <form className="flex gap-2"><input name="q" defaultValue={q} autoFocus placeholder="WO number, job, PO, invoice, supplier…" className="input max-w-xl" aria-label="Search" /><button className="btn btn-primary">Search</button></form>
      {empty ? null : total === 0 ? <Empty>No results.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Jobs & leads" n={jobs.length}>{jobs.map((p) => <li key={p.id}><Link className="link font-mono text-xs" href={`/jobs/${p.id}`}>{p.number}</Link> {p.name} <span className="text-xs text-slate-500">{p.client?.name}</span> <StatusBadge status={p.stage} label={STAGE_LABELS[p.stage]} /></li>)}</Section>
          <Section title="Purchase orders" n={pos.length}>{pos.map((po) => <li key={po.id}><Link className="link font-mono text-xs" href={`/jobs/${po.projectId}/procurement/${po.id}`}>{po.number}</Link> {po.supplier.name} <span className="text-xs text-slate-500">{po.project.name}</span></li>)}</Section>
          <Section title="Invoices" n={invoices.length}>{invoices.map((i) => <li key={i.id}><Link className="link font-mono text-xs" href={`/jobs/${i.projectId}/billing#${i.id}`}>{i.number}</Link> {i.project.name} <StatusBadge status={i.status} /></li>)}</Section>
          <Section title="Change orders" n={cos.length}>{cos.map((c) => <li key={c.id}><Link className="link font-mono text-xs" href={`/jobs/${c.projectId}/changes/${c.id}`}>{c.number}</Link> {c.title} <StatusBadge status={c.status} /></li>)}</Section>
          <Section title="Clients & suppliers" n={orgs.length}>{orgs.map((o) => <li key={o.id}><Link className="link" href={`/directory/${o.id}`}>{o.name}</Link> <span className="text-xs text-slate-500">{o.type.toLowerCase().replace(/_/g, " ")}</span></li>)}</Section>
          <Section title="Employees" n={workers.length}>{workers.map((w) => <li key={w.id}><Link className="link" href={`/people/${w.id}`}>{w.name}</Link> <span className="text-xs text-slate-500">{w.trade}</span></li>)}</Section>
          <Section title="Documents" n={docs.length}>{docs.map((d) => <li key={d.id}>{d.versions[0] ? <a className="link" href={`/api/files/${d.versions[0].id}?inline=1`} target="_blank" rel="noreferrer">{d.title}</a> : d.title} <span className="text-xs text-slate-500">{d.project?.number ?? "Company"} · {d.category}</span></li>)}</Section>
        </div>
      )}
    </div>
  );
}
