import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, isoDate, isoDateTimeLocal, today } from "@/lib/dates";
import { orgOptions } from "@/lib/lookups";
import { Card, Drawer, Empty, Field, Notice, Options, StatusBadge, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { DocList } from "@/components/DocList";
import { SD_STATUS_LABELS } from "@/services/shopDrawings";
import { createShopDrawingAction, shopDrawingOpAction } from "@/app/actions/procurement";

export default async function ShopDrawingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ po?: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const sp = await searchParams;
  const [project, drawings, pos, suppliers] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id } }),
    prisma.shopDrawing.findMany({ where: { projectId: id }, include: { revisions: { orderBy: { revision: "desc" } }, purchaseOrder: { include: { supplier: true } } }, orderBy: { number: "asc" } }),
    prisma.purchaseOrder.findMany({ where: { projectId: id, status: { not: "CANCELLED" } }, include: { supplier: true }, orderBy: { number: "asc" } }),
    orgOptions(["SUPPLIER", "SUBCONTRACTOR"]),
  ]);
  const r = user.role;
  const active = ["ACTIVATION", "EXECUTION", "CLOSEOUT"].includes(project.stage);
  const canEdit = can(r, "shopdrawing.edit") && active;
  const canDecide = can(r, "shopdrawing.decide");
  const t0 = today();
  const supplierName = (sid: string | null) => suppliers.find((s) => s.value === sid)?.label;

  return (
    <div className="space-y-6">
      <Notice>Flow: supplier or Intervolt prepares the drawing → Intervolt review → submitted to client / consultant → Approved, Approved as noted, or Revise and resubmit (creates a new revision). Deliveries on a linked PO are held until the latest revision is approved.</Notice>
      {canEdit ? (
        <Card title="Log a shop drawing">
          <ActionForm action={createShopDrawingAction} className="grid gap-3 sm:grid-cols-6">
            <input type="hidden" name="projectId" value={id} />
            <Field label="Title *" className="sm:col-span-2"><input name="title" required className="input" placeholder="e.g. Main switchboard MSB-1" /></Field>
            <Field label="Number" hint="Blank = auto"><input name="number" className="input" /></Field>
            <Field label="Spec section"><input name="specSection" className="input" placeholder="26 24 13" /></Field>
            <Field label="Linked PO" className="sm:col-span-2"><select name="purchaseOrderId" defaultValue={sp.po ?? ""} className="input"><Options items={pos.map((p) => ({ value: p.id, label: `${p.number} — ${p.supplier.name}` }))} empty="None (Intervolt drawing)" /></select></Field>
            <Field label="Supplier" className="sm:col-span-2"><select name="supplierId" className="input"><Options items={suppliers} empty="From PO / none" /></select></Field>
            <Field label="Required by"><input type="date" name="requiredBy" className="input" /></Field>
            <Field label="Drawing file" className="sm:col-span-3"><input type="file" name="file" className="text-sm" /></Field>
            <div className="sm:col-span-6"><Submit>Add shop drawing</Submit></div>
          </ActionForm>
        </Card>
      ) : null}

      {drawings.length === 0 ? <Empty>No shop drawings on this job.</Empty> : drawings.map((sd) => {
        const rev = sd.revisions[0];
        const ready = rev.status === "INTERNAL_REVIEW" && !!rev.internalReviewAt;
        const overdue = ["SUBMITTED", "UNDER_REVIEW"].includes(rev.status) && rev.requiredBy && rev.requiredBy < t0;
        return (
          <Card key={sd.id} id={sd.id} title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{sd.number}</span> {sd.title} <StatusBadge status={rev.status} label={ready ? "Ready to submit" : SD_STATUS_LABELS[rev.status]} /> <span className="text-xs font-normal text-slate-500">rev {rev.revision}</span></span>}>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-1 text-sm">
                {sd.specSection ? <div>Spec {sd.specSection}</div> : null}
                <div>{sd.purchaseOrder ? <>PO <Link className="link" href={`/jobs/${id}/procurement/${sd.purchaseOrder.id}`}>{sd.purchaseOrder.number}</Link> · {sd.purchaseOrder.supplier.name}</> : supplierName(sd.supplierId) ?? "Intervolt drawing"}</div>
                <div className={clsx(overdue && "font-semibold text-red-600")}>Response required by {fmtDate(rev.requiredBy)}</div>
                {rev.submittedAt ? <div>Submitted {fmtDateTime(rev.submittedAt)}</div> : null}
                {rev.returnedAt ? <div>Returned {fmtDate(rev.returnedAt)}</div> : null}
                {rev.internalReviewNotes ? <div className="text-xs text-slate-500">Intervolt review: {rev.internalReviewNotes}</div> : null}
                {rev.consultantComments ? <div className="text-xs text-slate-500">Consultant: {rev.consultantComments}</div> : null}
              </div>
              <div className="lg:col-span-2"><DocList entityType="ShopDrawing" entityId={sd.id} empty={<span className="text-sm text-slate-400">No drawing file uploaded yet.</span>} /></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {canEdit && ["IN_PREPARATION", "INTERNAL_REVIEW"].includes(rev.status) ? (
                <Drawer label={rev.documentId ? "Upload revised file" : "Upload drawing"}>
                  <ActionForm action={shopDrawingOpAction} className="space-y-2"><input type="hidden" name="shopDrawingId" value={sd.id} /><input type="hidden" name="op" value="upload" /><input type="file" name="file" required className="text-sm" /><Submit>Upload</Submit></ActionForm>
                </Drawer>
              ) : null}
              {canDecide && rev.status === "INTERNAL_REVIEW" && !rev.internalReviewAt ? (
                <>
                  <ActionForm action={shopDrawingOpAction}><input type="hidden" name="shopDrawingId" value={sd.id} /><input type="hidden" name="op" value="pass" /><Submit className="btn btn-success btn-sm">Pass Intervolt review</Submit></ActionForm>
                  <Drawer label="Return to preparer" className="btn btn-ghost btn-sm">
                    <ActionForm action={shopDrawingOpAction} className="space-y-2"><input type="hidden" name="shopDrawingId" value={sd.id} /><input type="hidden" name="op" value="return" /><Field label="Review notes *"><textarea name="notes" required rows={2} className="input" /></Field><Submit className="btn btn-danger">Return</Submit></ActionForm>
                  </Drawer>
                </>
              ) : null}
              {canEdit && ready ? (
                <Drawer label="Submit to client / consultant" className="btn btn-primary btn-sm">
                  <ActionForm action={shopDrawingOpAction} className="space-y-2">
                    <input type="hidden" name="shopDrawingId" value={sd.id} /><input type="hidden" name="op" value="submit" />
                    <Field label="Submitted at *"><input type="datetime-local" name="submittedAt" required defaultValue={isoDateTimeLocal(new Date())} className="input" /></Field>
                    <Field label="Response required by"><input type="date" name="requiredBy" defaultValue={rev.requiredBy ? isoDate(rev.requiredBy) : ""} className="input" /></Field>
                    <Submit>Mark submitted</Submit>
                  </ActionForm>
                </Drawer>
              ) : null}
              {canDecide && ["SUBMITTED", "UNDER_REVIEW"].includes(rev.status) ? (
                <Drawer label="Record response" className="btn btn-primary btn-sm">
                  <ActionForm action={shopDrawingOpAction} className="space-y-2">
                    <input type="hidden" name="shopDrawingId" value={sd.id} /><input type="hidden" name="op" value="response" />
                    <Field label="Status *"><select name="status" required className="input">
                      <option value="UNDER_REVIEW">Under review</option><option value="APPROVED">Approved</option><option value="APPROVED_AS_NOTED">Approved as noted</option><option value="REVISE_AND_RESUBMIT">Revise and resubmit</option>
                    </select></Field>
                    <Field label="Returned on"><input type="date" name="returnedAt" defaultValue={isoDate(today())} className="input" /></Field>
                    <Field label="Comments" hint="Required for Approved as noted and Revise and resubmit"><textarea name="consultantComments" rows={2} className="input" /></Field>
                    <Field label="Marked-up drawing"><input type="file" name="file" className="text-sm" /></Field>
                    <Submit>Save response</Submit>
                  </ActionForm>
                </Drawer>
              ) : null}
            </div>
            {sd.revisions.length > 1 ? (
              <details className="mt-3 text-xs text-slate-500">
                <summary className="cursor-pointer">Revision history ({sd.revisions.length})</summary>
                <ul className="mt-1 space-y-0.5">{sd.revisions.map((rv) => <li key={rv.id}>Rev {rv.revision}: {SD_STATUS_LABELS[rv.status]}{rv.submittedAt ? ` · submitted ${fmtDate(rv.submittedAt)}` : ""}{rv.returnedAt ? ` · returned ${fmtDate(rv.returnedAt)}` : ""}{rv.consultantComments ? ` · “${rv.consultantComments}”` : ""}</li>)}</ul>
              </details>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
