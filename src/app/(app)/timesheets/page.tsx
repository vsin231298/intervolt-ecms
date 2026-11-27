import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { addDays, isoDate, parseDate, today } from "@/lib/dates";
import { money, qty, sum } from "@/lib/money";
import { workerOptions } from "@/lib/lookups";
import { Card, Drawer, Empty, Field, Options, PageHeader, Stat } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { TimeEntries } from "@/components/TimeEntries";
import { addTimeAction, officeClockOutAction } from "@/app/actions/labour";
import { crewFlags } from "@/services/labour";
import Link from "next/link";
import { fmtDate, fmtDateTime } from "@/lib/dates";

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ week?: string; from?: string; to?: string; worker?: string; job?: string; filter?: string }> }) {
  const user = await requireUser();
  const r = user.role;
  if (!can(r, "time.manage") && !can(r, "time.submit") && !can(r, "time.view")) {
    const { redirect } = await import("next/navigation");
    redirect("/forbidden");
  }
  const sp = await searchParams;
  const t0 = today();
  // Week picker (Mon–Sun). Default is this week unless a custom From/To is given.
  const monday = (dt: Date) => addDays(dt, -((dt.getUTCDay() + 6) % 7));
  const thisWeek = monday(t0);
  const pf = parseDate(sp.from ?? ""), pt = parseDate(sp.to ?? "");
  // A From/To that is exactly one Mon–Sun week stays in week mode.
  const isWeek = !!pf && !!pt && pf.getUTCDay() === 1 && isoDate(addDays(pf, 6)) === isoDate(pt);
  const custom = !sp.week && !!(sp.from || sp.to) && !isWeek;
  const weekStart = custom ? null : monday(parseDate(sp.week ?? "") ?? (isWeek ? pf! : t0));
  const from = weekStart ?? parseDate(sp.from ?? "") ?? addDays(t0, -13);
  const to = weekStart ? addDays(weekStart, 6) : parseDate(sp.to ?? "") ?? t0;
  const wk = weekStart ?? thisWeek;
  const qs = (o: Record<string, string | undefined>) => "/timesheets?" + new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
  const weekHref = (w: Date) => qs({ week: isoDate(w), worker: sp.worker, job: sp.job, filter: sp.filter });
  const short = (dt: Date) => dt.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
  const pendingOnly = sp.filter === "pending";
  const [entries, workers, jobs, openClocks] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { date: { gte: from, lte: to }, ...(sp.worker ? { workerId: sp.worker } : {}), ...(sp.job ? { projectId: sp.job } : {}), ...(pendingOnly ? { approvedAt: null } : {}) },
      include: { worker: true, project: { select: { id: true, number: true, name: true } } },
      orderBy: [{ date: "desc" }, { worker: { name: "asc" } }],
      take: 1000,
    }),
    workerOptions(),
    prisma.project.findMany({ where: { stage: { notIn: ["OPPORTUNITY", "UNDER_REVIEW", "ESTIMATING", "QUOTING", "READY_TO_SUBMIT", "SUBMITTED"] } }, orderBy: { number: "desc" }, select: { id: true, number: true, name: true, stage: true } }),
    prisma.clockEntry.findMany({ where: { clockOutAt: null }, include: { worker: true, project: true }, orderBy: { clockInAt: "asc" } }),
  ]);
  const flags = can(r, "time.manage") ? await crewFlags(from, to) : [];
  const showCost = can(r, "financials.view");
  const canManage = can(r, "time.manage");
  const reg = sum(entries.map((e) => e.regularHours));
  // Weekly hours per person
  const days = weekStart ? [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i)) : [];
  const byWorker = new Map<string, { id: string; name: string; reg: number; ot: number; day: number[] }>();
  for (const e of entries) {
    const w = byWorker.get(e.workerId) ?? { id: e.workerId, name: e.worker.name, reg: 0, ot: 0, day: days.map(() => 0) };
    w.reg += Number(e.regularHours); w.ot += Number(e.overtimeHours);
    const i = days.findIndex((d) => isoDate(d) === isoDate(e.date));
    if (i >= 0) w.day[i] += Number(e.regularHours) + Number(e.overtimeHours);
    byWorker.set(e.workerId, w);
  }
  const people = [...byWorker.values()].sort((a, b) => a.name.localeCompare(b.name));
  const ot = sum(entries.map((e) => e.overtimeHours));

  return (
    <div className="space-y-6">
      <PageHeader title="Timesheets" subtitle={canManage ? "All time entries. Management can add missed entries, edit or delete with a reason, and approve. Every change is audited." : "Everyone's hours, week by week. View only."} actions={canManage ? (
        <Drawer label="Add missed entry" className="btn btn-primary" wide>
          <ActionForm action={addTimeAction} className="grid gap-3 sm:grid-cols-3">
            <Field label="Job *" className="sm:col-span-3"><select name="projectId" required className="input"><Options items={jobs.filter((j) => j.stage !== "CLOSED").map((j) => ({ value: j.id, label: `${j.number} ${j.name}` }))} empty="Choose…" /></select></Field>
            <Field label="Employee *"><select name="workerId" required className="input"><Options items={workers} empty="Choose…" /></select></Field>
            <Field label="Date *"><input type="date" name="date" required defaultValue={isoDate(t0)} className="input" /></Field>
            <Field label="Cost code"><input name="costCode" className="input" /></Field>
            <Field label="Regular hours *"><input name="regularHours" required defaultValue="8" className="input" /></Field>
            <Field label="Overtime hours"><input name="overtimeHours" defaultValue="0" className="input" /></Field>
            <Field label="Description"><input name="description" className="input" /></Field>
            <div className="sm:col-span-3"><Submit>Add entry</Submit></div>
          </ActionForm>
        </Drawer>
      ) : undefined} />

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <Link className="btn btn-secondary px-4 py-2 text-lg" href={weekHref(addDays(wk, -7))} aria-label="Previous week">‹</Link>
        <Link className={"btn px-4 py-2 " + (weekStart ? "btn-primary" : "btn-secondary")} href={weekHref(wk)}>{short(wk)} – {short(addDays(wk, 6))}</Link>
        <Link className="btn btn-secondary px-4 py-2 text-lg" href={weekHref(addDays(wk, 7))} aria-label="Next week">›</Link>
        {isoDate(wk) !== isoDate(thisWeek) || !weekStart ? <Link className="btn btn-ghost btn-sm" href={weekHref(thisWeek)}>This week</Link> : null}
        {!weekStart ? <span className="ml-auto text-sm text-slate-600">Custom dates: {fmtDate(from)} – {fmtDate(to)}</span> : null}
      </div>

      <form className="card flex flex-wrap items-end gap-3 p-4">
        <Field label="From"><input type="date" name="from" defaultValue={isoDate(from)} className="input" /></Field>
        <Field label="To"><input type="date" name="to" defaultValue={isoDate(to)} className="input" /></Field>
        <Field label="Employee"><select name="worker" defaultValue={sp.worker ?? ""} className="input w-48"><Options items={workers} empty="All" /></select></Field>
        <Field label="Job"><select name="job" defaultValue={sp.job ?? ""} className="input w-56"><Options items={jobs.map((j) => ({ value: j.id, label: `${j.number} ${j.name}` }))} empty="All" /></select></Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="filter" value="pending" defaultChecked={pendingOnly} /> Pending approval only</label>
        <button className="btn btn-secondary">Apply</button>
        <a className="btn btn-ghost" href={`/api/export/timesheets?from=${isoDate(from)}&to=${isoDate(to)}${sp.worker ? `&worker=${sp.worker}` : ""}${sp.job ? `&job=${sp.job}` : ""}`}>Export Excel</a>
      </form>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Entries" value={entries.length} />
        <Stat label="Regular hours" value={qty(reg)} />
        <Stat label="Overtime hours" value={qty(ot)} />
        {showCost ? <Stat label="Labour cost" value={money(sum(entries.map((e) => e.cost)))} /> : <Stat label="Pending approval" value={entries.filter((e) => !e.approvedAt).length} />}
      </div>

      <Card title={weekStart ? `Weekly hours: ${short(wk)} – ${short(addDays(wk, 6))}` : "Hours by employee"}>
        {people.length === 0 ? <Empty>No hours for this {weekStart ? "week" : "selection"}.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Employee</th>{days.map((d) => <th key={d.toISOString()} className="num">{d.toLocaleDateString("en-CA", { weekday: "short", day: "numeric", timeZone: "UTC" })}</th>)}<th className="num">Regular</th><th className="num">OT</th><th className="num">Total</th></tr></thead>
              <tbody>
                {people.map((w) => (
                  <tr key={w.id}>
                    <td><Link className="link font-medium" href={qs({ week: weekStart ? isoDate(weekStart) : undefined, from: weekStart ? undefined : isoDate(from), to: weekStart ? undefined : isoDate(to), worker: w.id })}>{w.name}</Link></td>
                    {w.day.map((h, i) => <td key={i} className="num text-slate-600">{h ? qty(h) : "–"}</td>)}
                    <td className="num">{qty(w.reg)}</td><td className="num">{qty(w.ot)}</td><td className="num font-semibold">{qty(w.reg + w.ot)}</td>
                  </tr>
                ))}
              </tbody>
              {people.length > 1 ? <tfoot><tr className="font-semibold"><td>Total</td>{days.map((_, i) => <td key={i} className="num">{qty(sum(people.map((w) => w.day[i])))}</td>)}<td className="num">{qty(reg)}</td><td className="num">{qty(ot)}</td><td className="num">{qty(Number(reg) + Number(ot))}</td></tr></tfoot> : null}
            </table>
          </div>
        )}
        {sp.worker ? <p className="mt-2 text-sm"><Link className="link" href={qs({ week: weekStart ? isoDate(weekStart) : undefined, from: weekStart ? undefined : isoDate(from), to: weekStart ? undefined : isoDate(to) })}>Show everyone</Link></p> : null}
      </Card>

      {flags.length ? (
        <Card title={`Service call crews to check (${flags.length})`}>
          <ul className="space-y-2 text-sm">{flags.map((f, i) => (
            <li key={i} className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-amber-900">
              <span className="whitespace-nowrap font-semibold">{f.kind === "NO_HOURS" ? "Co-worker, no hours" : "Co-worker stayed late"}:</span>
              <span>{f.text} <Link href={`/jobs/${f.projectId}/labour`} className="link">Open job</Link></span>
            </li>
          ))}</ul>
        </Card>
      ) : null}

      {openClocks.length ? (
        <Card title="Currently clocked in">
          <ul className="space-y-2 text-sm">{openClocks.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <span><b>{c.worker.name}</b> on {c.project.number} {c.project.name} since {fmtDateTime(c.clockInAt)}</span>
              {can(r, "time.manage") ? (
                <Drawer label="Clock out for them" className="btn btn-ghost btn-sm">
                  <ActionForm action={officeClockOutAction} className="space-y-3">
                    <input type="hidden" name="id" value={c.id} />
                    <p className="text-sm text-slate-600">Use this when someone left site without clocking out. It skips the site range check and is recorded in the audit trail.</p>
                    <Field label="Clock-out time (blank = now)"><input type="datetime-local" name="at" className="input" /></Field>
                    <Submit>Clock out {c.worker.name}</Submit>
                  </ActionForm>
                </Drawer>
              ) : null}
            </li>
          ))}</ul>
        </Card>
      ) : null}

      <Card title="Time entries">
        {entries.length === 0 ? <Empty>No entries for this selection.</Empty> : <TimeEntries rows={entries} canManage={canManage} showCost={showCost} showProject formId="approve-timesheets" />}
      </Card>
    </div>
  );
}
