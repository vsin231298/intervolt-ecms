import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import type { ProjectStage } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { money, toNum } from "@/lib/money";
import { userOptions } from "@/lib/lookups";
import { CLOSE_REASON_LABELS, STAGE_LABELS } from "@/lib/workflow";
import { Card, DL, Drawer, Field, Notice, Options, Progress, Stat, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { cancelJobAction, reopenJobAction, reviewDecisionAction, startExecutionAction, startReviewAction } from "@/app/actions/jobs";
import { startCloseoutAction } from "@/app/actions/closeout";
import { activationChecklist } from "@/services/submission";
import { projectFinancials } from "@/services/billing";
import { closeoutStatus } from "@/services/closeout";

const PROJECT_FLOW: ProjectStage[] = ["OPPORTUNITY", "UNDER_REVIEW", "ESTIMATING", "QUOTING", "READY_TO_SUBMIT", "SUBMITTED", "ACTIVATION", "EXECUTION", "CLOSEOUT", "CLOSED"];
const DIRECT_FLOW: ProjectStage[] = ["EXECUTION", "CLOSEOUT", "CLOSED"];

export default async function JobOverview({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const p = await prisma.project.findUnique({
    where: { id },
    include: {
      client: true, consultant: true, gc: true, estimator: true, projectManager: true, contract: true,
      reviews: { orderBy: { decidedAt: "desc" }, take: 1 },
      submissions: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { purchaseOrders: true, shopDrawings: true, rfis: true, changeOrders: true, inspections: true, documents: true } },
    },
  });
  if (!p) notFound();
  const r = user.role;
  const flow = p.jobType === "PROJECT" ? PROJECT_FLOW : DIRECT_FLOW;
  const idx = flow.indexOf(p.stage);
  const [estimators, activity, fin, checklist, closeout] = await Promise.all([
    userOptions(["ESTIMATOR", "PROJECT_MANAGER", "ADMIN"]),
    prisma.auditLog.findMany({ where: { projectId: id }, orderBy: { at: "desc" }, take: 10, include: { user: true } }),
    p.contract && can(r, "financials.view") ? projectFinancials(id) : null,
    p.stage === "ACTIVATION" ? activationChecklist(id) : null,
    ["EXECUTION", "CLOSEOUT"].includes(p.stage) ? closeoutStatus(id) : null,
  ]);

  return (
    <div className="space-y-6">
      {/* Stage stepper */}
      <div className="card overflow-x-auto p-4">
        <ol className="flex min-w-max items-center gap-2">
          {flow.map((s, i) => {
            const done = i < idx || (p.stage === "CLOSED" && s === "CLOSED");
            const current = i === idx && p.stage !== "CLOSED";
            return (
              <li key={s} className="flex items-center gap-2">
                <span className={clsx("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", done ? "bg-emerald-500 text-white" : current ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-500")}>{done ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
                <span className={clsx("text-xs font-medium", current ? "text-brand-700" : done ? "text-slate-700" : "text-slate-400")}>{s === "CLOSED" && p.closeReason ? CLOSE_REASON_LABELS[p.closeReason] : STAGE_LABELS[s]}</span>
                {i < flow.length - 1 ? <span className="h-px w-6 bg-slate-300" /> : null}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Next step">
            <NextStep />
          </Card>
          <Card title="Job summary">
            <DL cols={3} items={[
              ["Work Order #", <span key="n" className="font-mono">{p.number}</span>],
              ["Client", p.client?.name],
              ["Consultant", p.consultant?.name],
              ["General contractor", p.gc?.name],
              ["Client reference #", p.clientProjectNo],
              ["Location", p.location],
              ["Estimator", p.estimator?.name],
              ["Project manager", p.projectManager?.name],
              ["Invitation date", fmtDate(p.invitationDate)],
              ["Submission deadline", fmtDateTime(p.submissionDeadline)],
              ["Start / finish", `${fmtDate(p.startDate)} → ${fmtDate(p.finishDate)}`],
              ["Estimated value", p.estimatedValue ? money(p.estimatedValue) : "—"],
            ]} />
            {p.scope ? <div className="mt-4 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">{p.scope}</div> : null}
          </Card>
          {fin ? (
            <Card title="Financial snapshot" actions={<Link href={`/jobs/${id}/billing`} className="link text-xs">Billing & payments</Link>}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Original contract" value={money(fin.originalValue)} />
                <Stat label="Current contract" value={money(fin.currentValue)} sub={`${money(fin.approvedChanges)} approved changes`} />
                <Stat label="Billed to date" value={money(fin.billed)} sub={`${toNum(fin.billedPercent).toFixed(0)}% · ${money(fin.outstanding)} outstanding`} />
                <Stat label="Margin to date" value={money(fin.margin)} tone={toNum(fin.margin) < 0 ? "red" : "green"} sub={`Cost ${money(fin.cost)}`} />
              </div>
              <div className="mt-3"><Progress value={toNum(fin.billedPercent)} /></div>
            </Card>
          ) : null}
        </div>
        <div className="space-y-6">
          <Card title="At a glance">
            <ul className="space-y-2 text-sm">
              {[
                ["Documents", p._count.documents, "documents"],
                ["Purchase orders", p._count.purchaseOrders, "procurement"],
                ["Shop drawings", p._count.shopDrawings, "shop-drawings"],
                ["RFIs", p._count.rfis, "changes"],
                ["Change orders", p._count.changeOrders, "changes"],
                ["Inspections", p._count.inspections, "inspections"],
              ].map(([label, n, href]) => (
                <li key={label as string} className="flex justify-between"><Link href={`/jobs/${id}/${href}`} className="hover:text-brand-700">{label}</Link><span className="tabular-nums text-slate-600">{n}</span></li>
              ))}
            </ul>
          </Card>
          <Card title="Recent activity" actions={<Link href={`/jobs/${id}/activity`} className="link text-xs">Full history</Link>}>
            <ul className="space-y-3 text-sm">
              {activity.map((a) => (
                <li key={a.id}>
                  <div className="text-slate-800">{a.summary}</div>
                  <div className="text-xs text-slate-500">{a.user?.name ?? "System"} · {fmtDateTime(a.at)}</div>
                </li>
              ))}
            </ul>
          </Card>
          {p.stage !== "CLOSED" && (can(r, "leads.decide") || can(r, "project.manage")) ? (
            <Drawer label="Cancel this job" className="btn btn-ghost btn-sm text-red-600">
              <ActionForm action={cancelJobAction} className="space-y-3">
                <input type="hidden" name="projectId" value={id} />
                <Field label="Reason for cancelling *"><textarea name="reason" required rows={2} className="input" /></Field>
                <Submit className="btn btn-danger">Cancel job</Submit>
              </ActionForm>
            </Drawer>
          ) : null}
        </div>
      </div>
    </div>
  );

  function NextStep() {
    if (p!.stage === "OPPORTUNITY" || p!.stage === "UNDER_REVIEW") {
      return (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Review the tender documents and decide whether Intervolt will bid. <Link className="link" href={`/jobs/${id}/documents`}>Open tender documents</Link></p>
          {p!.stage === "OPPORTUNITY" && can(r, "leads.edit") ? (
            <ActionForm action={startReviewAction}><input type="hidden" name="projectId" value={id} /><Submit className="btn btn-secondary">Mark review started</Submit></ActionForm>
          ) : null}
          {can(r, "leads.decide") ? (
            <div className="grid gap-4 md:grid-cols-2">
              <ActionForm action={reviewDecisionAction} className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
                <input type="hidden" name="projectId" value={id} />
                <input type="hidden" name="decision" value="DOABLE" />
                <div className="text-sm font-semibold text-emerald-800">Doable: assign an estimator</div>
                <Field label="Estimator *"><select name="estimatorId" required className="input" defaultValue={p!.estimatorId ?? ""}><Options items={estimators} empty="Choose…" /></select></Field>
                <Field label="Notes"><input name="reason" className="input" /></Field>
                <Submit className="btn btn-success">Doable — start estimating</Submit>
              </ActionForm>
              <ActionForm action={reviewDecisionAction} className="space-y-3 rounded-md border border-red-200 bg-red-50/40 p-3">
                <input type="hidden" name="projectId" value={id} />
                <input type="hidden" name="decision" value="NOT_DOABLE" />
                <div className="text-sm font-semibold text-red-800">Not bidding: close the lead</div>
                <Field label="Reason *"><textarea name="reason" required rows={3} className="input" /></Field>
                <Submit className="btn btn-danger">Not bidding — close</Submit>
              </ActionForm>
            </div>
          ) : <Notice>Waiting for a Project Manager or Administrator to make the Doable / Not bidding decision.</Notice>}
        </div>
      );
    }
    if (["ESTIMATING", "QUOTING"].includes(p!.stage)) {
      return (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-600">Build the estimate and BOM, request supplier quotes, then finalize an estimate revision.</span>
          <Link href={`/jobs/${id}/estimates`} className="btn btn-primary">Estimates & BOM</Link>
          <Link href={`/jobs/${id}/quotes`} className="btn btn-secondary">Supplier quotes</Link>
          <Link href={`/jobs/${id}/submission`} className="btn btn-secondary">Prepare submission</Link>
        </div>
      );
    }
    if (["READY_TO_SUBMIT", "SUBMITTED"].includes(p!.stage)) {
      const s = p!.submissions[0];
      return (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-600">{p!.stage === "SUBMITTED" ? `Submitted ${fmtDate(s?.submittedAt)} for ${money(s?.submittedAmount)}. Record the outcome when the client decides.` : s?.priceApprovedAt ? "Final price approved. Record the submission." : "Final price is waiting for approval."}</span>
          <Link href={`/jobs/${id}/submission`} className="btn btn-primary">{p!.stage === "SUBMITTED" ? "Record outcome" : "Tender submission"}</Link>
        </div>
      );
    }
    if (p!.stage === "ACTIVATION" && checklist) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Awarded. Complete job activation, then start execution.</p>
          <ul className="space-y-1.5 text-sm">
            {checklist.map((c) => (
              <li key={c.key} className="flex items-center gap-2">
                <span className={clsx("flex h-5 w-5 items-center justify-center rounded-full text-xs", c.done ? "bg-emerald-500 text-white" : "border border-slate-300 text-slate-300")}>{c.done ? "✓" : ""}</span>
                <span className={c.done ? "text-slate-700" : "text-slate-900"}>{c.label}</span>
                {!c.required ? <span className="text-xs text-slate-400">(optional)</span> : null}
                {!c.done ? <Link className="link text-xs" href={`/jobs/${id}/${c.key === "team" || c.key === "pm" ? "info" : c.key === "schedule" ? "tasks" : c.key === "shopdrawings" ? "shop-drawings" : c.key === "supplierpo" ? "procurement" : "billing"}`}>Go</Link> : null}
              </li>
            ))}
          </ul>
          {can(r, "project.activate") ? <ActionForm action={startExecutionAction}><input type="hidden" name="projectId" value={id} /><Submit>Start execution</Submit></ActionForm> : null}
        </div>
      );
    }
    if (p!.stage === "EXECUTION") {
      return (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">Work in progress. Track procurement, labour, changes and billing from the tabs above.</p>
          {closeout ? <p className="text-slate-600">Closeout readiness: <b>{closeout.rows.length - closeout.blocking.length}</b> of {closeout.rows.length} items satisfied.</p> : null}
          {can(r, "closeout.close") ? <ActionForm action={startCloseoutAction}><input type="hidden" name="projectId" value={id} /><Submit className="btn btn-secondary">Start closeout</Submit></ActionForm> : null}
        </div>
      );
    }
    if (p!.stage === "CLOSEOUT") {
      return (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-600">{closeout?.ready ? "All mandatory closeout items are complete or waived." : `${closeout?.blocking.length ?? 0} mandatory closeout item(s) still open.`}</span>
          <Link href={`/jobs/${id}/closeout`} className="btn btn-primary">Closeout checklist</Link>
        </div>
      );
    }
    return (
      <div className="space-y-3 text-sm">
        <p>Closed {fmtDate(p!.closedAt)} — <b>{p!.closeReason ? CLOSE_REASON_LABELS[p!.closeReason] : ""}</b>{p!.closeNote ? `: ${p!.closeNote}` : ""}</p>
        {can(r, "admin.settings") ? (
          <Drawer label="Reopen (administrator)">
            <ActionForm action={reopenJobAction} className="space-y-3">
              <input type="hidden" name="projectId" value={id} />
              <Field label="Reason for reopening *"><input name="note" required className="input" /></Field>
              <Submit>Reopen job</Submit>
            </ActionForm>
          </Drawer>
        ) : null}
      </div>
    );
  }
}
