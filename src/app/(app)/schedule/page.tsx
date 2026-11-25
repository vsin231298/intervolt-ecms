import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addDays, fmtDate, isoDate, parseDate, today } from "@/lib/dates";
import { qty } from "@/lib/money";
import { Card, Empty, PageHeader, Tabs, clsx } from "@/components/ui";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ view?: string; from?: string; worker?: string; job?: string }> }) {
  await requireUser("jobs.view");
  const sp = await searchParams;
  const view = sp.view === "job" || sp.view === "date" ? sp.view : "employee";
  const t0 = today();
  const start = parseDate(sp.from ?? "") ?? addDays(t0, -((t0.getUTCDay() + 6) % 7)); // Monday of this week
  const days = Array.from({ length: view === "date" ? 1 : 14 }, (_, i) => addDays(start, i));
  const end = addDays(start, days.length);
  const [assignments, workers, jobs] = await Promise.all([
    prisma.labourAssignment.findMany({
      where: { date: { gte: start, lt: end }, ...(sp.worker ? { workerId: sp.worker } : {}), ...(sp.job ? { projectId: sp.job } : {}) },
      include: { worker: true, project: { select: { id: true, number: true, name: true, location: true, jobType: true } } },
      orderBy: [{ date: "asc" }],
    }),
    prisma.worker.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { stage: { in: ["ACTIVATION", "EXECUTION", "CLOSEOUT"] } }, orderBy: { number: "asc" }, select: { id: true, number: true, name: true } }),
  ]);
  const key = (dt: Date) => isoDate(dt);
  const qsBase = (o: Record<string, string | undefined>) => "/schedule?" + new URLSearchParams(Object.entries({ view, from: isoDate(start), worker: sp.worker, job: sp.job, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  const step = view === "date" ? 1 : 7;

  return (
    <div className="space-y-4">
      <PageHeader title="Employee Schedule" subtitle="Who is working where. Schedule crews from a job's Labour tab." />
      <Tabs current={view} items={[
        { key: "employee", label: "By employee", href: qsBase({ view: "employee" }) },
        { key: "job", label: "By job", href: qsBase({ view: "job" }) },
        { key: "date", label: "By date", href: qsBase({ view: "date" }) },
      ]} />
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

      {view === "date" ? (
        <Card title={fmtDate(start)} bodyClass="overflow-x-auto">
          {assignments.length === 0 ? <div className="p-4"><Empty>No one scheduled.</Empty></div> : (
            <table className="table">
              <thead><tr><th>Employee</th><th>Trade</th><th>Job</th><th>Site</th><th className="num">Hours</th><th>Notes</th></tr></thead>
              <tbody>{assignments.map((a) => <tr key={a.id}><td><Link className="link" href={`/people/${a.workerId}`}>{a.worker.name}</Link></td><td>{a.worker.trade}</td><td><Link className="link font-mono text-xs" href={`/jobs/${a.projectId}/labour`}>{a.project.number}</Link> {a.project.name}</td><td className="text-xs">{a.project.location}</td><td className="num">{qty(a.hours)}</td><td className="text-xs">{a.notes}</td></tr>)}</tbody>
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
                          {cell.map((a) => (
                            <div key={a.id} className="mb-0.5 rounded bg-brand-50 px-1 text-brand-800" title={a.notes ?? undefined}>
                              {view === "employee" ? <Link href={`/jobs/${a.projectId}/labour`}>{a.project.number}</Link> : <Link href={`/people/${a.workerId}`}>{a.worker.name}</Link>} · {qty(a.hours)}h
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
