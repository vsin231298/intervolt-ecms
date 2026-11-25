import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, isoDate, isoDateTimeLocal, today } from "@/lib/dates";
import { money } from "@/lib/money";
import { userOptions } from "@/lib/lookups";
import { Card, DL, Empty, Field, Notice, Options, StatusBadge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { DocList } from "@/components/DocList";
import { approvePriceAction, outcomeAction, prepareSubmissionAction, recordSubmittedAction } from "@/app/actions/estimating";

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const [p, submissions, finals, pms, approvers] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id } }),
    prisma.tenderSubmission.findMany({ where: { projectId: id }, include: { estimate: true }, orderBy: { createdAt: "desc" } }),
    prisma.estimate.findMany({ where: { projectId: id, status: "FINAL" } }),
    userOptions(["PROJECT_MANAGER", "ADMIN"]),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const current = submissions[0];
  const r = user.role;
  const late = p.submissionDeadline && p.submissionDeadline < new Date() && !current?.submittedAt;
  return (
    <div className="space-y-6">
      <Card title="Deadline">
        <DL cols={3} items={[["Submission deadline", <span key="d" className={late ? "font-semibold text-red-600" : ""}>{fmtDateTime(p.submissionDeadline)}{late ? " (passed)" : ""}</span>], ["Stage", p.stage.toLowerCase().replace(/_/g, " ")], ["Final estimates", finals.length ? finals.map((e) => `Rev ${e.revision} ${money(e.sellPrice)}`).join(", ") : "None finalized"]]} />
      </Card>

      {["ESTIMATING", "QUOTING", "READY_TO_SUBMIT"].includes(p.stage) && can(r, "submission.edit") ? (
        <Card title="1. Prepare final tender pricing">
          {finals.length === 0 ? <Notice tone="amber">Finalize an estimate revision first (Estimates & BOM tab).</Notice> : (
            <ActionForm action={prepareSubmissionAction} className="flex flex-wrap items-end gap-3" resetOnSuccess={false}>
              <input type="hidden" name="projectId" value={id} />
              <Field label="Estimate revision"><select name="estimateId" className="input w-64">{finals.map((e) => <option key={e.id} value={e.id}>Rev {e.revision} — sell {money(e.sellPrice)}</option>)}</select></Field>
              <Field label="Final tender price ($) *"><input name="finalPrice" required defaultValue={current && !current.submittedAt ? current.finalPrice.toString() : finals[0].sellPrice.toString()} className="input w-44" /></Field>
              <Field label="Notes (qualifications, exclusions)"><input name="notes" defaultValue={current?.notes ?? ""} className="input w-80" /></Field>
              <Submit>{current && !current.submittedAt ? "Update price" : "Prepare submission"}</Submit>
            </ActionForm>
          )}
        </Card>
      ) : null}

      {current && !current.submittedAt ? (
        <Card title="2. Approve and submit">
          <div className="space-y-4">
            <p className="text-sm">Final price <b>{money(current.finalPrice)}</b> from estimate rev {current.estimate.revision} — {current.priceApprovedAt ? <span className="text-emerald-700">approved by {approvers.find((u) => u.id === current.priceApprovedById)?.name} {fmtDateTime(current.priceApprovedAt)}</span> : <span className="text-amber-700">awaiting approval</span>}</p>
            {!current.priceApprovedAt && can(r, "submission.approvePrice") ? (
              <ActionForm action={approvePriceAction}><input type="hidden" name="submissionId" value={current.id} /><Submit className="btn btn-success">Approve final price</Submit></ActionForm>
            ) : null}
            {current.priceApprovedAt && can(r, "submission.edit") ? (
              <ActionForm action={recordSubmittedAction} className="grid gap-3 sm:grid-cols-4">
                <input type="hidden" name="submissionId" value={current.id} /><input type="hidden" name="projectId" value={id} />
                <Field label="Submitted at *"><input type="datetime-local" name="submittedAt" required defaultValue={isoDateTimeLocal(new Date())} className="input" /></Field>
                <Field label="Submitted amount ($) *"><input name="submittedAmount" required defaultValue={current.finalPrice.toString()} className="input" /></Field>
                <Field label="Method"><select name="submissionMethod" className="input"><option>Email</option><option>Bid portal</option><option>Hand delivered</option><option>Courier</option></select></Field>
                <Field label="Submitted documents"><input type="file" name="files" multiple className="text-sm" /></Field>
                <div className="sm:col-span-4"><Submit>Record as submitted</Submit></div>
              </ActionForm>
            ) : null}
          </div>
        </Card>
      ) : null}

      {current?.submittedAt && current.outcome === "PENDING" && can(r, "submission.outcome") ? (
        <Card title="3. Tender outcome">
          <div className="grid gap-6 lg:grid-cols-2">
            <ActionForm action={outcomeAction} className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-4">
              <input type="hidden" name="submissionId" value={current.id} /><input type="hidden" name="projectId" value={id} /><input type="hidden" name="outcome" value="AWARDED" />
              <div className="font-semibold text-emerald-800">Awarded — activate the job</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Award date *"><input type="date" name="outcomeDate" required defaultValue={isoDate(today())} className="input" /></Field>
                <Field label="Client PO # *"><input name="clientPoNumber" required className="input" /></Field>
                <Field label="PO date"><input type="date" name="poDate" className="input" /></Field>
                <Field label="Contract value ($) *" hint="Locked as the original contract value"><input name="contractValue" required defaultValue={current.submittedAmount?.toString()} className="input" /></Field>
                <Field label="Project manager *"><select name="projectManagerId" required defaultValue={p.projectManagerId ?? ""} className="input"><Options items={pms} empty="Choose…" /></select></Field>
                <Field label="Client PO document"><input type="file" name="files" className="text-sm" /></Field>
                <Field label="Start date *"><input type="date" name="startDate" required className="input" /></Field>
                <Field label="Finish date *"><input type="date" name="finishDate" required className="input" /></Field>
              </div>
              <Field label="Notes"><input name="notes" className="input" /></Field>
              <Submit className="btn btn-success">Record award</Submit>
            </ActionForm>
            <ActionForm action={outcomeAction} className="space-y-3 rounded-md border border-red-200 bg-red-50/40 p-4">
              <input type="hidden" name="submissionId" value={current.id} /><input type="hidden" name="projectId" value={id} /><input type="hidden" name="outcome" value="NOT_AWARDED" />
              <div className="font-semibold text-red-800">Not awarded — close as lost bid</div>
              <Field label="Decision date *"><input type="date" name="outcomeDate" required defaultValue={isoDate(today())} className="input" /></Field>
              <Field label="Reason *"><textarea name="outcomeReason" required rows={3} className="input" /></Field>
              <Field label="Winning amount ($), if known"><input name="winningAmount" className="input" /></Field>
              <Submit className="btn btn-danger">Record lost bid</Submit>
            </ActionForm>
          </div>
        </Card>
      ) : null}

      <Card title="Submission history" bodyClass="overflow-x-auto">
        {submissions.length === 0 ? <div className="p-4"><Empty>No submissions yet.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Prepared</th><th>Estimate</th><th className="num">Final price</th><th>Approved</th><th>Submitted</th><th className="num">Amount</th><th>Outcome</th><th>Documents</th></tr></thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id}>
                  <td className="text-xs">{fmtDate(s.createdAt)}</td>
                  <td>Rev {s.estimate.revision}</td>
                  <td className="num">{money(s.finalPrice)}</td>
                  <td className="text-xs">{fmtDateTime(s.priceApprovedAt)}</td>
                  <td className="text-xs">{fmtDateTime(s.submittedAt)}{s.submissionMethod ? <div className="text-slate-500">{s.submissionMethod}</div> : null}</td>
                  <td className="num">{s.submittedAmount ? money(s.submittedAmount) : "—"}</td>
                  <td><StatusBadge status={s.outcome} />{s.outcomeReason ? <div className="text-xs text-slate-500">{s.outcomeReason}</div> : null}{s.winningAmount ? <div className="text-xs text-slate-500">Winner {money(s.winningAmount)}</div> : null}</td>
                  <td><DocList entityType="TenderSubmission" entityId={s.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
