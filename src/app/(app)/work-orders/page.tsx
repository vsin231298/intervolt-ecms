import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime, parseDate } from "@/lib/dates";
import { Card, Empty, PageHeader } from "@/components/ui";
import { StatusBadge } from "@/components/WorkOrderView";
import { JOB_STATUSES, allWorkOrders } from "@/services/labour";

/** Office: every work order the guys have submitted. */
export default async function WorkOrders({ searchParams }: { searchParams: Promise<{ who?: string; status?: string; from?: string; to?: string; q?: string }> }) {
  const user = await requireUser("jobs.view");
  const sp = await searchParams;
  const [list, people] = await Promise.all([
    allWorkOrders(user, { userId: sp.who || undefined, status: sp.status || undefined, from: parseDate(sp.from) ?? undefined, to: parseDate(sp.to) ?? undefined, q: sp.q?.trim() || undefined }),
    prisma.user.findMany({ where: { id: { in: (await prisma.workOrderSignoff.findMany({ distinct: ["completedById"], select: { completedById: true } })).map((s) => s.completedById) } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const filtered = !!(sp.who || sp.status || sp.from || sp.to || sp.q);
  return (
    <div className="space-y-4">
      <PageHeader title="Work Orders" subtitle="Everything the guys have submitted from the field app." />
      <form className="card grid gap-2 p-3 sm:grid-cols-6">
        <input name="q" defaultValue={sp.q} placeholder="Search job, customer, address, work…" className="input sm:col-span-2" />
        <select name="who" defaultValue={sp.who ?? ""} className="input"><option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Any status</option>{Object.entries(JOB_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input type="date" name="from" defaultValue={sp.from} className="input" aria-label="From" />
        <input type="date" name="to" defaultValue={sp.to} className="input" aria-label="To" />
        <div className="flex gap-2 sm:col-span-6"><button className="btn btn-secondary btn-sm">Filter</button>{filtered ? <Link href="/work-orders" className="btn btn-ghost btn-sm">Clear</Link> : null}</div>
      </form>
      <Card bodyClass="overflow-x-auto p-0">
        {list.length === 0 ? <div className="p-4"><Empty>{filtered ? "Nothing matches." : "No work orders submitted yet."}</Empty></div> : (
          <table className="table">
            <thead><tr><th>Submitted</th><th>By</th><th>Job</th><th>Work done</th><th>Status</th><th>Signed</th><th>Notes</th></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.id}>
                <td className="whitespace-nowrap"><Link className="link" href={`/work-orders/${s.id}`}>{fmtDateTime(s.createdAt)}</Link></td>
                <td className="whitespace-nowrap">{s.submittedBy}</td>
                <td><Link className="link font-mono text-xs" href={`/jobs/${s.project.id}/site`}>{s.project.number}</Link> {s.project.name}<div className="text-xs text-slate-500">{s.project.location}</div></td>
                <td className="max-w-xs"><Link href={`/work-orders/${s.id}`} className="line-clamp-2 hover:underline">{s.workSummary}</Link></td>
                <td><StatusBadge status={s.jobStatus} /></td>
                <td>{s.signedAt ? "Yes" : "—"}</td>
                <td>{s._count.notes ? <span className="font-medium text-amber-700">{s._count.notes}</span> : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
