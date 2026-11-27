import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime, parseDate } from "@/lib/dates";
import { Badge, Card, Drawer, Empty, Field, PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { can } from "@/lib/rbac";
import { isoDate, today } from "@/lib/dates";
import { cancelWorkOrderRequestAction, requestWorkOrderAction } from "@/app/actions/team";
import { StatusBadge } from "@/components/WorkOrderView";
import { JOB_STATUSES, allWorkOrders, officeWorkOrderRequests } from "@/services/labour";

/** Office: every work order the guys have submitted. */
export default async function WorkOrders({ searchParams }: { searchParams: Promise<{ who?: string; status?: string; from?: string; to?: string; q?: string }> }) {
  const user = await requireUser("jobs.view");
  const sp = await searchParams;
  const [list, people] = await Promise.all([
    allWorkOrders(user, { userId: sp.who || undefined, status: sp.status || undefined, from: parseDate(sp.from) ?? undefined, to: parseDate(sp.to) ?? undefined, q: sp.q?.trim() || undefined }),
    prisma.user.findMany({ where: { id: { in: (await prisma.workOrderSignoff.findMany({ distinct: ["completedById"], select: { completedById: true } })).map((s) => s.completedById) } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const filtered = !!(sp.who || sp.status || sp.from || sp.to || sp.q);
  const canAsk = can(user.role, "labour.schedule");
  const [requests, crew, jobs] = await Promise.all([
    officeWorkOrderRequests(user),
    canAsk ? prisma.worker.findMany({ where: { active: true, userId: { not: null } }, orderBy: { name: "asc" }, select: { userId: true, name: true } }) : [],
    canAsk ? prisma.project.findMany({ where: { stage: { in: ["ACTIVATION", "EXECUTION", "CLOSEOUT", "CLOSED"] } }, orderBy: { number: "desc" }, take: 300, select: { id: true, number: true, name: true } }) : [],
  ]);
  const openReq = requests.filter((r) => !r.doneAt);
  const day = (d: Date) => d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div className="space-y-4">
      <PageHeader title="Work Orders" subtitle="Everything the guys have submitted from the field app." actions={canAsk ? (
        <Drawer label="Request work order" className="btn btn-primary">
          <ActionForm action={requestWorkOrderAction} className="space-y-3">
            <div className="label">Who *</div>
            <div className="grid max-h-48 grid-cols-2 gap-1 overflow-auto rounded border border-slate-200 p-2">{crew.map((w) => <label key={w.userId} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="userIds[]" value={w.userId!} /> {w.name}</label>)}</div>
            <Field label="Job *"><select name="projectId" required defaultValue="" className="input"><option value="" disabled>Choose…</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.number} {j.name}</option>)}</select></Field>
            <Field label="Day of the work *"><input type="date" name="date" required max={isoDate(today())} defaultValue={isoDate(today())} className="input" /></Field>
            <Field label="Note (optional)"><input name="note" className="input" placeholder="e.g. need materials used" /></Field>
            <p className="text-xs text-slate-500">They get an alert and a &quot;Work order needed&quot; card in the field app.</p>
            <Submit>Send request</Submit>
          </ActionForm>
        </Drawer>
      ) : undefined} />
      {requests.length ? (
        <Card title={`Requested${openReq.length ? ` · ${openReq.length} waiting` : ""}`} bodyClass="p-0">
          <ul className="divide-y divide-slate-100 text-sm">{requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="min-w-0 flex-1"><b>{r.who}</b> · <span className="font-mono text-xs">{r.project.number}</span> {r.project.name} · {day(r.date)}{r.note ? <span className="text-slate-500"> · {r.note}</span> : null}<span className="block text-xs text-slate-500">Asked by {r.by} · {fmtDateTime(r.createdAt)}</span></span>
              {r.doneAt ? (
                r.signoffId ? <Link href={`/work-orders/${r.signoffId}`}><Badge tone="green">Received</Badge></Link> : <Badge tone="green">Received</Badge>
              ) : (
                <>
                  <Badge tone="amber">Waiting</Badge>
                  {canAsk ? <ActionForm action={cancelWorkOrderRequestAction}><input type="hidden" name="id" value={r.id} /><Submit className="btn btn-ghost btn-sm text-red-600">Cancel</Submit></ActionForm> : null}
                </>
              )}
            </li>
          ))}</ul>
        </Card>
      ) : null}
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
                <td className="whitespace-nowrap"><Link className="link" href={`/work-orders/${s.id}`}>{fmtDateTime(s.createdAt)}</Link>{s.forDate ? <div className="text-xs text-amber-700">Requested · for {day(s.forDate)}</div> : null}</td>
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
