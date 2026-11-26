import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, isoDate, today } from "@/lib/dates";
import { Badge, Card, Drawer, Empty, Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { DocList } from "@/components/DocList";
import { JOB_STATUSES } from "@/services/labour";
import { dailyReportAction, fieldUpdateAction, resolveIssueAction } from "@/app/actions/labour";

export default async function SitePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const sp = await searchParams;
  const [updates, reports, signoffs, project] = await Promise.all([
    prisma.fieldUpdate.findMany({ where: { projectId: id, ...(sp.show === "issues" ? { kind: "ISSUE", resolvedAt: null } : {}) }, include: { author: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.dailyReport.findMany({ where: { projectId: id }, orderBy: { date: "desc" }, take: 60 }),
    prisma.workOrderSignoff.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } }),
    prisma.project.findUniqueOrThrow({ where: { id } }),
  ]);
  const people = await prisma.user.findMany({ where: { id: { in: [...reports.map((r) => r.createdById), ...signoffs.map((s) => s.completedById), ...updates.map((u) => u.resolvedById)].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const nameOf = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? "—";
  const coWorkerNames = new Map((await prisma.worker.findMany({ where: { id: { in: signoffs.flatMap((s) => s.coWorkerIds) } }, select: { id: true, name: true } })).map((w) => [w.id, w.name]));
  const r = user.role;
  const openIssues = updates.filter((u) => u.kind === "ISSUE" && !u.resolvedAt).length;
  const live = project.stage !== "CLOSED";

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title={<span>Site updates & issues {openIssues ? <Badge tone="red">{openIssues} open</Badge> : null}</span>} actions={
        <div className="flex gap-2">
          <a href={`/jobs/${id}/site${sp.show === "issues" ? "" : "?show=issues"}`} className="btn btn-ghost btn-sm">{sp.show === "issues" ? "Show all" : "Open issues only"}</a>
          {live && can(r, "dailyreport.submit") ? (
            <Drawer label="Post update" className="btn btn-secondary btn-sm">
              <ActionForm action={fieldUpdateAction} className="space-y-2">
                <input type="hidden" name="projectId" value={id} />
                <Field label="Type"><select name="kind" className="input"><option value="UPDATE">Progress update</option><option value="ISSUE">Issue / problem</option></select></Field>
                <Field label="Message *"><textarea name="message" required rows={3} className="input" /></Field>
                <Field label="Photos"><input type="file" name="photos" accept="image/*" multiple className="text-sm" /></Field>
                <Submit>Post</Submit>
              </ActionForm>
            </Drawer>
          ) : null}
        </div>
      }>
        {updates.length === 0 ? <Empty>No site updates.</Empty> : (
          <ul className="space-y-4">
            {updates.map((u) => (
              <li key={u.id} className={u.kind === "ISSUE" && !u.resolvedAt ? "rounded border-l-4 border-red-400 bg-red-50/50 p-3" : "border-l-4 border-slate-200 pl-3"}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {u.kind === "ISSUE" ? <Badge tone={u.resolvedAt ? "gray" : "red"}>{u.resolvedAt ? "Issue resolved" : "Issue"}</Badge> : <Badge tone="blue">Update</Badge>}
                  <span>{u.author.name} · {fmtDateTime(u.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm">{u.message}</p>
                <div className="mt-1"><DocList entityType="FieldUpdate" entityId={u.id} /></div>
                {u.resolvedAt ? <div className="mt-1 text-xs text-slate-500">Resolved by {nameOf(u.resolvedById)} {fmtDateTime(u.resolvedAt)}</div> : null}
                {u.kind === "ISSUE" && !u.resolvedAt && can(r, "project.manage") ? <ActionForm action={resolveIssueAction} className="mt-2"><input type="hidden" name="id" value={u.id} /><Submit className="btn btn-success btn-sm">Mark resolved</Submit></ActionForm> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="space-y-6">
        <Card title="Daily reports" actions={live && can(r, "dailyreport.submit") ? (
          <Drawer label="Daily report" className="btn btn-primary btn-sm" wide>
            <ActionForm action={dailyReportAction} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="projectId" value={id} />
              <Field label="Date *"><input type="date" name="date" required defaultValue={isoDate(today())} className="input" /></Field>
              <Field label="Weather"><input name="weather" className="input" /></Field>
              <Field label="Manpower on site"><input name="manpower" inputMode="numeric" className="input" /></Field>
              <Field label="Work performed *" className="sm:col-span-3"><textarea name="workPerformed" required rows={3} className="input" /></Field>
              <Field label="Delays"><textarea name="delays" rows={2} className="input" /></Field>
              <Field label="Safety"><textarea name="safetyNotes" rows={2} className="input" /></Field>
              <Field label="Visitors / inspectors"><textarea name="visitors" rows={2} className="input" /></Field>
              <Field label="Site photos" className="sm:col-span-3"><input type="file" name="files" accept="image/*" multiple className="text-sm" /></Field>
              <p className="text-xs text-slate-500 sm:col-span-3">One report per day; saving again for the same date updates it.</p>
              <div className="sm:col-span-3"><Submit>Save report</Submit></div>
            </ActionForm>
          </Drawer>
        ) : null}>
          {reports.length === 0 ? <Empty>No daily reports.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {reports.map((d) => (
                <li key={d.id} className="py-3 text-sm">
                  <div className="flex flex-wrap gap-2 font-medium">{fmtDate(d.date)} <span className="font-normal text-slate-500">· {d.manpower} on site{d.weather ? ` · ${d.weather}` : ""} · by {nameOf(d.createdById)}</span></div>
                  <p className="whitespace-pre-line">{d.workPerformed}</p>
                  {d.delays ? <p className="text-amber-700">Delays: {d.delays}</p> : null}
                  {d.safetyNotes ? <p className="text-slate-600">Safety: {d.safetyNotes}</p> : null}
                  {d.visitors ? <p className="text-slate-600">Visitors: {d.visitors}</p> : null}
                  <DocList entityType="DailyReport" entityId={d.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Work order completion & customer sign-off">
          {signoffs.length === 0 ? <Empty>No completion reports yet. Electricians complete these from the field app.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {signoffs.map((s) => (
                <li key={s.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{fmtDateTime(s.createdAt)}</b> by {nameOf(s.completedById)}
                    {s.jobStatus && s.jobStatus in JOB_STATUSES ? <Badge tone={s.jobStatus === "COMPLETE" ? "green" : "amber"}>{JOB_STATUSES[s.jobStatus as keyof typeof JOB_STATUSES]}</Badge>
                      : s.markedComplete ? <Badge tone="green">Work order complete</Badge> : <Badge>Progress report</Badge>}
                    {s.signedAt ? <Badge tone="blue">Signed by {s.customerName ?? "customer"}</Badge> : null}
                  </div>
                  <p className="mt-1 whitespace-pre-line">{s.workSummary}</p>
                  {s.coWorkerIds.length ? <p className="mt-1 text-slate-600">Co-worker(s): {s.coWorkerIds.map((id) => coWorkerNames.get(id) ?? "removed employee").join(", ")}</p> : null}
                  {Array.isArray(s.materialsUsed) && s.materialsUsed.length ? (
                    <div className="mt-1 text-slate-600">Materials used: {(s.materialsUsed as { item: string; quantity: string }[]).map((m) => `${m.quantity ? `${m.quantity} × ` : ""}${m.item}`).join("; ")}</div>
                  ) : null}
                  {s.parkingAmount != null ? <p className="mt-1 text-slate-600">Parking: ${Number(s.parkingAmount).toFixed(2)}{s.parkingReceiptDocId ? " (receipt below)" : " (no receipt)"}</p> : null}
                  {s.signatureDocId || s.parkingReceiptDocId ? <DocList entityType="WorkOrderSignoff" entityId={s.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
