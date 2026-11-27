import Link from "next/link";
import { ShiftJobPicker } from "@/components/ShiftJobPicker";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addDays, fmtDate, isoDate, parseDate, today } from "@/lib/dates";
import { qty } from "@/lib/money";
import { Badge, Card, Drawer, Empty, Field, Notice, PageHeader, Tabs, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { can } from "@/lib/rbac";
import { addTimeOffAction, createShiftAction, decideTimeOffAction, publishWeekAction } from "@/app/actions/team";
import { describeTimeOff } from "@/services/team";
import { ShiftEditForm } from "@/components/ShiftEdit";

function fmtT(t: string | null) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ view?: string; from?: string; worker?: string; job?: string; edit?: string }> }) {
  const user = await requireUser("jobs.view");
  const canEdit = can(user.role, "labour.schedule");
  const sp = await searchParams;
  const view = sp.view === "job" || sp.view === "date" || sp.view === "timeoff" ? sp.view : "employee";
  const t0 = today();
  const start = parseDate(sp.from ?? "") ?? addDays(t0, -((t0.getUTCDay() + 6) % 7)); // Monday of this week
  const days = Array.from({ length: view === "date" ? 1 : 14 }, (_, i) => addDays(start, i));
  const end = addDays(start, days.length);
  const weekEnd = addDays(start, 6);
  const [assignments, workers, jobs, offs, drafts, pending] = await Promise.all([
    prisma.labourAssignment.findMany({
      where: { date: { gte: start, lt: end }, ...(sp.worker ? { workerId: sp.worker } : {}), ...(sp.job ? { projectId: sp.job } : {}) },
      include: { worker: true, project: { select: { id: true, number: true, name: true, location: true, jobType: true } } },
      orderBy: [{ date: "asc" }],
    }),
    prisma.worker.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { stage: { in: ["ACTIVATION", "EXECUTION", "CLOSEOUT"] }, mergedIntoId: null }, orderBy: { number: "asc" }, select: { id: true, number: true, name: true, location: true, siteContactName: true, client: { select: { name: true } } } }),
    prisma.timeOff.findMany({ where: { status: { in: ["APPROVED", "PENDING"] }, startDate: { lt: end }, endDate: { gte: start } } }),
    prisma.labourAssignment.count({ where: { date: { gte: start, lte: weekEnd }, publishedAt: null } }),
    prisma.timeOff.findMany({ where: { status: "PENDING" }, include: { worker: true }, orderBy: { startDate: "asc" } }),
  ]);
  // "Client · address" so the office picks by who and where.
  const jobChoices = jobs.map((j) => {
    const who = j.client?.name ?? j.siteContactName ?? j.name;
    return { id: j.id, number: j.number, name: j.name, label: [who, j.location].filter(Boolean).join(" · ") || `${j.number} ${j.name}` };
  }).sort((a, b) => a.label.localeCompare(b.label));
  const clashFor = async (o: { workerId: string; startDate: Date; endDate: Date }) => prisma.labourAssignment.findMany({ where: { workerId: o.workerId, date: { gte: o.startDate, lte: o.endDate } }, include: { project: { select: { number: true, name: true } } } });
  const pendingWithClash = view === "timeoff" ? await Promise.all(pending.map(async (o) => ({ ...o, clash: await clashFor(o) }))) : [];
  const recentOff = view === "timeoff" ? await prisma.timeOff.findMany({ where: { status: { in: ["APPROVED", "DECLINED"] }, endDate: { gte: addDays(t0, -30) } }, include: { worker: true }, orderBy: { startDate: "asc" }, take: 100 }) : [];
  const offOn = (workerId: string, dt: Date) => offs.find((o) => o.workerId === workerId && o.startDate <= dt && o.endDate >= dt);
  const key = (dt: Date) => isoDate(dt);
  const qsBase = (o: Record<string, string | undefined>) => "/schedule?" + new URLSearchParams(Object.entries({ view, from: isoDate(start), worker: sp.worker, job: sp.job, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  const step = view === "date" ? 1 : 7;
  const editing = canEdit && sp.edit ? await prisma.labourAssignment.findUnique({ where: { id: sp.edit }, include: { worker: true, project: { select: { number: true, name: true, location: true } } } }) : null;

  return (
    <div className="space-y-4">
      <PageHeader title="Employee Schedule" subtitle="Plan as a draft, then publish. The guys only see published shifts." actions={canEdit ? (
        <div className="flex gap-2">
          <Drawer label="Add time off" className="btn btn-secondary">
            <ActionForm action={addTimeOffAction} className="space-y-3">
              <div className="label">Employee(s) *</div>
              <div className="grid max-h-48 grid-cols-2 gap-1 overflow-auto rounded border border-slate-200 p-2">{workers.map((w) => <label key={w.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="workerIds[]" value={w.id} /> {w.name}</label>)}</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start *"><input type="date" name="startDate" required defaultValue={isoDate(t0)} className="input" /></Field>
                <Field label="End"><input type="date" name="endDate" className="input" /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="partial" /> Partial day (uses Start date)</label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From (partial)"><input type="time" name="startTime" className="input" /></Field>
                <Field label="To (partial)"><input type="time" name="endTime" className="input" /></Field>
              </div>
              <Field label="Comment"><input name="reason" className="input" /></Field>
              <Submit>Add to schedule</Submit>
            </ActionForm>
          </Drawer>
          <Drawer label="+ Create shift" className="btn btn-primary" wide>
            <ActionForm action={createShiftAction} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date *"><input type="date" name="date" required defaultValue={isoDate(t0)} className="input" /></Field>
                <Field label="Repeat until (optional)"><input type="date" name="toDate" className="input" /></Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Start *"><input type="time" name="startTime" required defaultValue="07:30" className="input" /></Field>
                <Field label="End *"><input type="time" name="endTime" required defaultValue="15:30" className="input" /></Field>
                <Field label="Break (min)"><input name="breakMin" type="number" min={0} step={5} defaultValue={30} className="input" /></Field>
              </div>
              <ShiftJobPicker jobs={jobChoices} />
              <div className="label">Employee(s) *</div>
              <div className="grid max-h-48 grid-cols-2 gap-1 overflow-auto rounded border border-slate-200 p-2">{workers.map((w) => <label key={w.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="workerIds[]" value={w.id} /> {w.name}</label>)}</div>
              <Field label="Notes"><input name="notes" className="input" placeholder="e.g. pick up wire at shop first" /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="publish" /> Publish now (they see it and get an alert)</label>
              <Submit>Save</Submit>
            </ActionForm>
          </Drawer>
        </div>
      ) : undefined} />
      {editing ? (
        <Card title={`Edit shift · ${editing.worker.name} · ${fmtDate(editing.date)}`} actions={<Link className="btn btn-ghost btn-sm" href={qsBase({ edit: undefined })}>Close</Link>}>
          <div><ShiftEditForm key={editing.id} a={editing} jobs={jobChoices.some((j) => j.id === editing.projectId) ? jobChoices : [{ id: editing.projectId, number: editing.project.number, name: editing.project.name, label: [editing.project.name, editing.project.location].filter(Boolean).join(" · ") }, ...jobChoices]} /></div>
        </Card>
      ) : null}
      <Tabs current={view} items={[
        { key: "employee", label: "By employee", href: qsBase({ view: "employee" }) },
        { key: "job", label: "By job", href: qsBase({ view: "job" }) },
        { key: "date", label: "By date", href: qsBase({ view: "date" }) },
        { key: "timeoff", label: "Time off", href: qsBase({ view: "timeoff" }), count: pending.length || undefined },
      ]} />
      {view !== "timeoff" ? (
        drafts ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <div className="text-sm text-amber-900"><b>Draft</b> · {fmtDate(start)} – {fmtDate(weekEnd)}: {drafts} shift{drafts === 1 ? "" : "s"} not published. The guys can&apos;t see {drafts === 1 ? "it" : "them"} yet.</div>
            {canEdit ? <ActionForm action={publishWeekAction} showSuccess><input type="hidden" name="from" value={isoDate(start)} /><input type="hidden" name="to" value={isoDate(weekEnd)} /><Submit className="btn bg-orange-600 text-white hover:bg-orange-700">Publish week</Submit></ActionForm> : null}
          </div>
        ) : <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{fmtDate(start)} – {fmtDate(weekEnd)}: everything is published.</div>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <Link className="btn btn-secondary btn-sm" href={qsBase({ from: isoDate(addDays(start, -step)) })} aria-label="Earlier">‹</Link>
        <Link className="btn btn-secondary btn-sm" href={qsBase({ from: isoDate(t0) })}>Today</Link>
        <Link className="btn btn-secondary btn-sm" href={qsBase({ from: isoDate(addDays(start, step)) })} aria-label="Later">›</Link>
        <form className="ml-auto flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value={view} />
          <input type="date" name="from" defaultValue={isoDate(start)} className="input w-40" aria-label="From" />
          <select name="worker" defaultValue={sp.worker ?? ""} className="input w-48" aria-label="Employee"><option value="">All employees</option>{workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          <select name="job" defaultValue={sp.job ?? ""} className="input w-56" aria-label="Job"><option value="">All jobs</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.number} {j.name}</option>)}</select>
          <button className="btn btn-secondary">Apply</button>
        </form>
      </div>

      {view === "timeoff" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={`Requests waiting (${pendingWithClash.length})`}>
            {pendingWithClash.length === 0 ? <Empty>No requests waiting.</Empty> : (
              <ul className="divide-y divide-slate-100">{pendingWithClash.map((o) => (
                <li key={o.id} className="py-3 text-sm">
                  <div><b>{o.worker.name}</b> · {describeTimeOff(o)}</div>
                  <div className="text-xs text-slate-500">{o.reason ? `${o.reason} · ` : ""}Sent {fmtDate(o.createdAt)}</div>
                  {o.clash.length ? <div className="mt-1 text-xs text-amber-700">⚠ Scheduled: {o.clash.map((c) => `${c.project.number} on ${fmtDate(c.date)}`).join(", ")}</div> : null}
                  {canEdit ? (
                    <div className="mt-2 flex gap-2">
                      <ActionForm action={decideTimeOffAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="decision" value="approve" /><Submit className="btn btn-success btn-sm">Approve</Submit></ActionForm>
                      <ActionForm action={decideTimeOffAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="decision" value="decline" /><Submit className="btn btn-secondary btn-sm">Decline</Submit></ActionForm>
                    </div>
                  ) : null}
                </li>
              ))}</ul>
            )}
          </Card>
          <Card title="Recent and upcoming">
            {recentOff.length === 0 ? <Empty>None.</Empty> : (
              <ul className="divide-y divide-slate-100 text-sm">{recentOff.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 py-2"><span><b>{o.worker.name}</b> · {describeTimeOff(o)}</span><Badge tone={o.status === "APPROVED" ? "green" : "red"}>{o.status === "APPROVED" ? "Approved" : "Declined"}</Badge></li>
              ))}</ul>
            )}
          </Card>
        </div>
      ) : view === "date" ? (
        <Card title={fmtDate(start)} bodyClass="overflow-x-auto">
          {assignments.length === 0 ? <div className="p-4"><Empty>No one scheduled.</Empty></div> : (
            <table className="table">
              <thead><tr><th>Employee</th><th>Trade</th><th>Job</th><th>Site</th><th className="num">Hours</th><th>Notes</th></tr></thead>
              <tbody>{assignments.map((a) => <tr key={a.id}><td><Link className="link" href={`/people/${a.workerId}`}>{a.worker.name}</Link></td><td>{a.worker.trade}</td><td><Link className="link font-mono text-xs" href={`/jobs/${a.projectId}/labour`}>{a.project.number}</Link> {a.project.name}</td><td className="text-xs">{a.project.location}</td><td className="num">{a.startTime ? `${fmtT(a.startTime)}–${fmtT(a.endTime)} · ` : ""}{qty(a.hours)}{a.publishedAt ? "" : " (draft)"}</td><td className="text-xs">{a.notes}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-slate-50">{view === "employee" ? "Employee" : "Job"}</th>
                {days.map((dt) => <th key={key(dt)} className={clsx("min-w-24 text-center", key(dt) === key(t0) && "bg-brand-50 text-brand-700", [0, 6].includes(dt.getUTCDay()) && "bg-slate-100")}>{dt.toLocaleDateString("en-CA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</th>)}
              </tr>
            </thead>
            <tbody>
              {(view === "employee" ? workers.filter((w) => !sp.worker || w.id === sp.worker).map((w) => ({ id: w.id, label: w.name, sub: w.trade, href: `/people/${w.id}` })) : jobs.filter((j) => !sp.job || j.id === sp.job).map((j) => ({ id: j.id, label: j.number, sub: j.name, href: `/jobs/${j.id}/labour` }))).map((row) => {
                const mine = assignments.filter((a) => (view === "employee" ? a.workerId : a.projectId) === row.id);
                if (view === "job" && !mine.length) return null;
                return (
                  <tr key={row.id}>
                    <td className="sticky left-0 bg-white"><Link className="link font-medium" href={row.href}>{row.label}</Link><div className="text-slate-500">{row.sub}</div></td>
                    {days.map((dt) => {
                      const cell = mine.filter((a) => key(a.date) === key(dt));
                      const hours = cell.reduce((s, a) => s + Number(a.hours), 0);
                      return (
                        <td key={key(dt)} className={clsx("align-top", [0, 6].includes(dt.getUTCDay()) && "bg-slate-50", view === "employee" && cell.length > 1 && "bg-amber-50")}>
                          {view === "employee" && offOn(row.id, dt) ? (() => { const o = offOn(row.id, dt)!; return <div className={clsx("mb-0.5 rounded px-1", o.status === "APPROVED" ? "bg-slate-200 text-slate-700" : "border border-dashed border-purple-300 text-purple-700")} title={o.reason ?? undefined}>{o.status === "APPROVED" ? "Off" : "Off?"}{o.startTime ? ` ${fmtT(o.startTime)}–${fmtT(o.endTime)}` : ""}</div>; })() : null}
                          {cell.map((a) => (
                            <div key={a.id} className={clsx("mb-0.5 rounded px-1", a.publishedAt ? "bg-brand-50 text-brand-800" : "border border-dashed border-amber-400 bg-amber-50 text-amber-900")} title={`${a.project.number} ${a.project.name} · ${a.publishedAt ? "Published" : "Draft"}${a.notes ? ` · ${a.notes}` : ""}`}>
                              <div className="whitespace-nowrap font-medium">{view === "employee" ? <Link href={`/jobs/${a.projectId}/labour`}>{a.project.number.replace(/^WO-\d{4}-/, "#")}</Link> : <Link href={`/people/${a.workerId}`}>{a.worker.name}</Link>}</div>{canEdit ? <Link className="block whitespace-nowrap hover:underline" href={qsBase({ edit: a.id })} title="Edit shift">{a.startTime ? `${fmtT(a.startTime)}–${fmtT(a.endTime)}` : `${qty(a.hours)}h`} ✎</Link> : <div className="whitespace-nowrap">{a.startTime ? `${fmtT(a.startTime)}–${fmtT(a.endTime)}` : `${qty(a.hours)}h`}</div>}
                            </div>
                          ))}
                          {view === "employee" && hours > 0 && cell.length > 1 ? <div className="text-amber-700">{hours}h total</div> : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {view === "job" && assignments.length === 0 ? <div className="p-4"><Empty>No assignments in this period.</Empty></div> : null}
        </div>
      )}
    </div>
  );
}
