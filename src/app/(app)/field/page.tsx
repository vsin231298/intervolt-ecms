import Link from "next/link";
import { MapPin, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, today } from "@/lib/dates";
import { JOB_TYPE_LABELS } from "@/lib/workflow";
import { Badge, Empty, Notice } from "@/components/ui";
import { ClockForm } from "@/components/FieldClient";
import { assignedJobs } from "@/services/labour";
import { clockOutAction, startServiceCallAction } from "@/app/actions/labour";
import { getSetting } from "@/lib/settings";

export default async function FieldHome() {
  const user = await requireUser("field.use");
  const { worker, jobs } = await assignedJobs(user);
  const open = worker ? await prisma.clockEntry.findFirst({ where: { workerId: worker.id, clockOutAt: null }, include: { project: true } }) : null;
  const todayHours = worker ? await prisma.timeEntry.aggregate({ where: { workerId: worker.id, date: today() }, _sum: { regularHours: true, overtimeHours: true } }) : null;
  const allowServiceCalls = await getSetting("field.allowServiceCalls");
  const todays = jobs.filter((j) => j.today);
  const others = jobs.filter((j) => !j.today);
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Hi {user.name.split(" ")[0]}</h1>
        <p className="text-sm text-slate-500">{fmtDate(today())}{todayHours && (Number(todayHours._sum.regularHours ?? 0) + Number(todayHours._sum.overtimeHours ?? 0)) > 0 ? ` · ${Number(todayHours._sum.regularHours ?? 0) + Number(todayHours._sum.overtimeHours ?? 0)} h recorded today` : ""}</p>
      </div>
      {!worker ? <Notice tone="amber">Your login isn&apos;t linked to an employee profile yet, so you can&apos;t clock in. Ask the office to link it under Employees.</Notice> : null}
      {open ? (
        <div className="card space-y-3 border-emerald-300 p-4">
          <div className="text-sm">Clocked in on <Link className="link font-semibold" href={`/field/${open.projectId}`}>{open.project.number} {open.project.name}</Link> since {fmtDateTime(open.clockInAt)}</div>
          <ClockForm action={clockOutAction} label="Clock out" tone="out" />
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
          <summary className="cursor-pointer font-semibold">Start an unplanned service call</summary>
          <p className="mt-1 text-sm text-slate-600">Use this when you&apos;re sent to a call that isn&apos;t on your schedule. Do it once you&apos;re on site: your location becomes the site, and you&apos;ll need to be within range of it to clock out.</p>
          <div className="mt-3">
            <ClockForm action={startServiceCallAction} label="Start call & clock in" tone="in">
              <input name="customer" required placeholder="Customer name" className="input" />
              <input name="address" required placeholder="Address (e.g. 25 King St W, Unit 4)" className="input" />
              <input name="phone" type="tel" placeholder="Customer phone (optional)" className="input" />
              <textarea name="problem" rows={2} placeholder="What's the problem? (optional)" className="input" />
            </ClockForm>
          </div>
        </details>
      ) : null}
      {others.length ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Other jobs you&apos;re on</h2>
          <ul className="space-y-2">{others.map((j) => <JobCard key={j.project.id} j={j} />)}</ul>
        </section>
      ) : null}
    </div>
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
          {j.hours ? <div className="text-xs text-slate-500">{j.hours} h scheduled{j.notes ? ` · ${j.notes}` : ""}</div> : null}
        </div>
        <ChevronRight className="h-5 w-5 text-slate-400" />
      </Link>
    </li>
  );
}
