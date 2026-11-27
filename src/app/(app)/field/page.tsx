import Link from "next/link";
import { MapPin, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, today, TZ } from "@/lib/dates";
import { JOB_TYPE_LABELS } from "@/lib/workflow";
import { Badge, Empty, Notice, clsx } from "@/components/ui";
import { ClockForm } from "@/components/FieldClient";
import { ServiceCall } from "@/components/ServiceCall";
import { assignedJobs, myWeek, firstClockInToday, joinableServiceCalls, needsWorkOrder, pendingOfficeDropOff } from "@/services/labour";
import { clockOutAction, doneAtOfficeAction, joinServiceCallAction, startServiceCallAction } from "@/app/actions/labour";
import { getSetting } from "@/lib/settings";

export default async function FieldHome() {
  const user = await requireUser("field.use");
  const { worker, jobs } = await assignedJobs(user);
  const open = worker ? await prisma.clockEntry.findFirst({ where: { workerId: worker.id, clockOutAt: null }, include: { project: true } }) : null;
  const todayHours = worker ? await prisma.timeEntry.aggregate({ where: { workerId: worker.id, date: today() }, _sum: { regularHours: true, overtimeHours: true } }) : null;
  const allowServiceCalls = await getSetting("field.allowServiceCalls");
  const woMissing = open ? await needsWorkOrder(prisma, user.id, open) : false;
  const joinable = worker && !open && allowServiceCalls ? await joinableServiceCalls(user) : [];
  const crewChoices = worker && !open && allowServiceCalls ? await prisma.worker.findMany({ where: { active: true, id: { not: worker.id } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const firstToday = worker && !open ? await firstClockInToday(worker.id) : false;
  const dropOff = worker && !open ? await pendingOfficeDropOff(worker.id) : null;
  const todays = jobs.filter((j) => j.today);
  const others = jobs.filter((j) => !j.today);
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Hi {user.name.split(" ")[0]}</h1>
        <p className="text-sm text-slate-500">{fmtDate(today())}{todayHours && (Number(todayHours._sum.regularHours ?? 0) + Number(todayHours._sum.overtimeHours ?? 0)) > 0 ? ` · ${Number(todayHours._sum.regularHours ?? 0) + Number(todayHours._sum.overtimeHours ?? 0)} h recorded today` : ""}</p>
      </div>
      {!worker ? <Notice tone="amber">Login not linked to an employee. Call office.</Notice> : null}
      {open ? (
        <div className="card space-y-3 border-emerald-300 p-4">
          <div className="text-sm">Clocked in on <Link className="link font-semibold" href={`/field/${open.projectId}`}>{open.project.number} {open.project.name}</Link> since {fmtDateTime(open.clockInAt)}</div>
          {woMissing
            ? <Link href={`/field/${open.projectId}#clock`} className="btn w-full bg-amber-500 py-4 text-lg text-white hover:bg-amber-600">Fill work order</Link>
            : <ClockForm action={clockOutAction} label="Clock out" tone="out" />}
        </div>
      ) : worker && !dropOff ? (
        <div className="card p-4"><div className="text-xs text-slate-500">Current status</div><div className="text-lg font-semibold">Clocked out</div><div className="text-sm text-slate-600">{todays.length ? "Tap today's job below to clock in." : "Not scheduled today."}</div></div>
      ) : null}
      {dropOff ? (
        <div className="card space-y-3 border-amber-300 p-4">
          <div className="text-sm">Left site at {new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(dropOff.clockOutAt!)}. Tap when done at office.</div>
          <ClockForm action={doneAtOfficeAction} label="Done at office" tone="out" notes={false} office={false} />
          <p className="flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" /> Must be at office.</p>
        </div>
      ) : null}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Today&apos;s jobs</h2>
        {todays.length === 0 ? <Empty>You&apos;re not scheduled on a job today.</Empty> : (
          <ul className="space-y-2">{todays.map((j) => <JobCard key={j.project.id} j={j} />)}</ul>
        )}
      </section>
      {worker && !open && allowServiceCalls ? (
        <details className="card p-4">
          <summary className="cursor-pointer font-semibold">Service call</summary>
          <p className="mb-3 mt-1 text-sm text-slate-500">Tap when on site.</p>
          <ServiceCall within={300} joinAction={joinServiceCallAction} startAction={startServiceCallAction} coWorkers={crewChoices} officeFirst={firstToday}
            calls={joinable.map((j) => ({ id: j.project.id, client: j.project.siteContactName ?? j.project.name, crew: j.crew.join(", "), location: j.project.location, lat: j.project.siteLat, lng: j.project.siteLng, namedMe: j.namedMe }))} />
        </details>
      ) : null}
      {worker ? <MyWeek workerId={worker.id} /> : null}
      {others.length ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Other jobs you&apos;re on</h2>
          <ul className="space-y-2">{others.map((j) => <JobCard key={j.project.id} j={j} />)}</ul>
        </section>
      ) : null}
    </div>
  );
}

function t12(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

async function MyWeek({ workerId }: { workerId: string }) {
  const days = await myWeek(workerId);
  if (!days.some((d) => d.shifts.length || d.off)) return null;
  const t0 = today().getTime();
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">My week</h2>
        <Link href="/time-off" className="text-xs text-brand-700">Request time off</Link>
      </div>
      <div className="card divide-y divide-slate-100 px-4 py-1">
        {days.map((d) => (
          <div key={d.date.getTime()} className={clsx("flex gap-3 py-2.5 text-sm", d.date.getTime() === t0 && "-mx-2 rounded-md bg-emerald-50 px-2")}>
            <div className="w-12 shrink-0 font-semibold text-slate-700">{d.date.toLocaleDateString("en-CA", { weekday: "short", timeZone: "UTC" })}<div className="text-xs font-normal text-slate-400">{d.date.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" })}</div></div>
            <div className="min-w-0 flex-1 space-y-1.5">
              {d.off ? <div className="text-slate-500">Time off{d.off.startTime ? ` ${t12(d.off.startTime)} – ${t12(d.off.endTime!)}` : ""}</div> : null}
              {d.shifts.map((s) => (
                <Link key={s.id} href={`/field/${s.projectId}`} className="block">
                  <div className="font-medium">{s.project.name}</div>
                  <div className="text-xs text-slate-500">{[s.project.location, s.startTime ? `${t12(s.startTime)} – ${t12(s.endTime!)}` : `${Number(s.hours)} h`, s.with.length ? `with ${s.with.join(", ")}` : null].filter(Boolean).join(" · ")}</div>
                </Link>
              ))}
              {!d.off && !d.shifts.length ? <div className="text-slate-400">Off</div> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function JobCard({ j }: { j: Awaited<ReturnType<typeof assignedJobs>>["jobs"][number] }) {
  const p = j.project;
  return (
    <li>
      <Link href={`/field/${p.id}`} className="card flex items-center gap-3 p-4 hover:border-brand-300">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="font-mono text-xs text-slate-500">{p.number}</span><Badge>{JOB_TYPE_LABELS[p.jobType]}</Badge></div>
          <div className="font-semibold">{p.name}</div>
          {p.location ? <div className="flex items-center gap-1 text-sm text-slate-600"><MapPin className="h-3.5 w-3.5" />{p.location}</div> : null}
          {j.hours ? <div className="text-xs text-slate-500">{j.startTime ? `${t12(j.startTime)} – ${t12(j.endTime!)} · ` : ""}{j.hours} h{j.notes ? ` · ${j.notes}` : ""}</div> : null}
        </div>
        <ChevronRight className="h-5 w-5 text-slate-400" />
      </Link>
    </li>
  );
}
