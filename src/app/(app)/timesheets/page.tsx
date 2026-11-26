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
import { fmtDateTime } from "@/lib/dates";

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; worker?: string; job?: string; filter?: string }> }) {
  const user = await requireUser();
  const r = user.role;
  if (!can(r, "time.manage") && !can(r, "time.submit")) {
    const { redirect } = await import("next/navigation");
    redirect("/forbidden");
  }
  const sp = await searchParams;
  const t0 = today();
  const from = parseDate(sp.from ?? "") ?? addDays(t0, -13);
  const to = parseDate(sp.to ?? "") ?? t0;
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
  const ot = sum(entries.map((e) => e.overtimeHours));

  return (
    <div className="space-y-6">
      <PageHeader title="Timesheets" subtitle="All time entries. Management can add missed entries, edit or delete with a reason, and approve. Every change is audited." actions={
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
      } />

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
