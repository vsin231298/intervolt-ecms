import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { addDays, fmtDate, isoDate, today } from "@/lib/dates";
import { money, qty } from "@/lib/money";
import { workerOptions } from "@/lib/lookups";
import { Card, Drawer, Empty, Field, Options, Progress, Stat } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { TimeEntries } from "@/components/TimeEntries";
import { labourSummary } from "@/services/labour";
import { addTimeAction, removeAssignmentAction, scheduleWorkersAction, updateAssignmentAction } from "@/app/actions/labour";

export default async function LabourPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const t0 = today();
  const [summary, workers, assignments, entries, cos, openClocks, project] = await Promise.all([
    labourSummary(id),
    workerOptions(),
    prisma.labourAssignment.findMany({ where: { projectId: id, date: { gte: addDays(t0, -1) } }, include: { worker: true }, orderBy: [{ date: "asc" }, { worker: { name: "asc" } }], take: 300 }),
    prisma.timeEntry.findMany({ where: { projectId: id }, include: { worker: true, project: { select: { id: true, number: true, name: true } } }, orderBy: [{ date: "desc" }], take: 300 }),
    prisma.changeOrder.findMany({ where: { projectId: id, status: { in: ["APPROVED", "SUBMITTED", "DRAFT"] } }, orderBy: { number: "asc" } }),
    prisma.clockEntry.findMany({ where: { projectId: id, clockOutAt: null }, include: { worker: true } }),
    prisma.project.findUniqueOrThrow({ where: { id } }),
  ]);
  const r = user.role;
  const showCost = can(r, "financials.view");
  const canSchedule = can(r, "labour.schedule") && project.stage !== "CLOSED";
  const canTime = (can(r, "time.submit") || can(r, "time.manage")) && project.stage !== "CLOSED";
  const used = summary.estHours.isZero() ? 0 : Number(summary.actualHours.dividedBy(summary.estHours).times(100));
  const coOptions = cos.map((c) => ({ value: c.id, label: `${c.number} ${c.title}` }));
  const byDate = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const k = isoDate(a.date);
    byDate.set(k, [...(byDate.get(k) ?? []), a]);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Estimated hours" value={qty(summary.estHours)} sub="estimate + approved COs" />
        <Stat label="Actual hours" value={qty(summary.actualHours)} sub={`${qty(summary.regular)} reg · ${qty(summary.overtime)} OT`} />
        <Stat label="Remaining hours" value={qty(summary.variance)} tone={summary.variance.lessThan(0) ? "red" : "green"} />
        {showCost ? <Stat label="Labour cost" value={money(summary.actualCost)} sub={`estimate ${money(summary.estCost)}`} tone={summary.actualCost.greaterThan(summary.estCost) && !summary.estCost.isZero() ? "red" : undefined} /> : <Stat label="On site now" value={openClocks.length} />}
      </div>
      {!summary.estHours.isZero() ? <div className="card p-4"><div className="mb-1 flex justify-between text-sm"><span>Hours used</span><span className="num">{used.toFixed(0)}%</span></div><Progress value={used} tone={used > 100 ? "red" : used > 85 ? "amber" : "blue"} /></div> : null}

      {openClocks.length ? (
        <Card title="Clocked in now">
          <ul className="text-sm">{openClocks.map((c) => <li key={c.id}>{c.worker.name} since {c.clockInAt.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", timeZone: "America/Toronto" })}</li>)}</ul>
        </Card>
      ) : null}

      <Card title="Crew schedule" bodyClass="overflow-x-auto" actions={canSchedule ? (
        <Drawer label="Schedule workers" className="btn btn-primary btn-sm" wide>
          <ActionForm action={scheduleWorkersAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <div>
              <div className="label">Workers *</div>
              <div className="grid max-h-48 grid-cols-2 gap-1 overflow-auto rounded border border-slate-200 p-2">
                {workers.map((w) => <label key={w.value} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="workerIds[]" value={w.value} /> {w.label}</label>)}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="From *"><input type="date" name="fromDate" required defaultValue={isoDate(t0)} className="input" /></Field>
              <Field label="To *"><input type="date" name="toDate" required defaultValue={isoDate(t0)} className="input" /></Field>
              <Field label="Hours / day"><input name="hours" defaultValue="8" className="input" /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="includeWeekends" /> Include weekends</label>
            <Field label="Notes"><input name="notes" className="input" /></Field>
            <Submit>Schedule</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {byDate.size === 0 ? <div className="p-4"><Empty>No upcoming crew assignments.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Crew</th></tr></thead>
            <tbody>
              {[...byDate.entries()].map(([k, list]) => (
                <tr key={k}>
                  <td className="whitespace-nowrap">{fmtDate(list[0].date)}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      {list.map((a) => (
                        <span key={a.id} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-xs">
                          {a.worker.name} · {qty(a.hours)}h{a.notes ? ` · ${a.notes}` : ""}
                          {canSchedule ? (
                            <Drawer label="✎" className="text-slate-400 hover:text-brand-600">
                              <ActionForm action={updateAssignmentAction} className="space-y-2" resetOnSuccess={false}>
                                <input type="hidden" name="id" value={a.id} />
                                <Field label="Hours"><input name="hours" defaultValue={a.hours.toString()} className="input" /></Field>
                                <Field label="Notes"><input name="notes" defaultValue={a.notes ?? ""} className="input" /></Field>
                                <Submit>Save</Submit>
                              </ActionForm>
                              <ActionForm action={removeAssignmentAction} className="mt-2"><input type="hidden" name="id" value={a.id} /><Submit className="btn btn-ghost btn-sm text-red-600">Remove from schedule</Submit></ActionForm>
                            </Drawer>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Time entries" bodyClass="" actions={canTime ? (
        <Drawer label="Add time" className="btn btn-secondary btn-sm">
          <ActionForm action={addTimeAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employee *"><select name="workerId" required className="input"><Options items={workers} empty="Choose…" /></select></Field>
              <Field label="Date *"><input type="date" name="date" required defaultValue={isoDate(t0)} className="input" /></Field>
              <Field label="Regular hours *"><input name="regularHours" required defaultValue="8" className="input" /></Field>
              <Field label="Overtime hours"><input name="overtimeHours" defaultValue="0" className="input" /></Field>
              <Field label="Cost code"><input name="costCode" className="input" /></Field>
              <Field label="Change order"><select name="changeOrderId" className="input"><Options items={coOptions} empty="Base contract" /></select></Field>
            </div>
            <Field label="Work description"><input name="description" className="input" /></Field>
            <Submit>Add entry</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        <TimeEntries rows={entries} canManage={can(r, "time.manage")} showCost={showCost} formId="approve-job-time" coOptions={coOptions} />
      </Card>
    </div>
  );
}
