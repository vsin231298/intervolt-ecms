import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, isoDate, today } from "@/lib/dates";
import { d, money, qty } from "@/lib/money";
import { Card, DL, Drawer, Field, Notice, StatusBadge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { DocList } from "@/components/DocList";
import { coDecisionAction, coLineAction, coLineDeleteAction, coPricingAction, coReviseAction, coSubmitAction } from "@/app/actions/changes";

export default async function CoPage({ params }: { params: Promise<{ id: string; coId: string }> }) {
  const user = await requireUser("jobs.view");
  const { id, coId } = await params;
  const co = await prisma.changeOrder.findUnique({ where: { id: coId }, include: { lines: { orderBy: { id: "asc" } }, rfi: true, esi: true, invoices: true, contractChange: true } });
  if (!co || co.projectId !== id) notFound();
  const r = user.role;
  const draft = co.status === "DRAFT";
  const canEdit = can(r, "change.edit") && draft;
  const showMoney = can(r, "financials.view") || can(r, "change.edit");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/jobs/${id}/changes`} className="link text-sm">← Changes</Link>
        <h2 className="text-lg font-semibold">{co.number}: {co.title}</h2>
        <StatusBadge status={co.status} />
        <span className="ml-auto flex gap-2">
          <a className="btn btn-secondary btn-sm" href={`/api/export/co/${co.id}`}>Change order PDF</a>
          {canEdit ? <ActionForm action={coSubmitAction}><input type="hidden" name="coId" value={co.id} /><Submit className="btn btn-primary btn-sm">Submit to client</Submit></ActionForm> : null}
          {co.status === "REJECTED" && can(r, "change.edit") ? <ActionForm action={coReviseAction}><input type="hidden" name="coId" value={co.id} /><Submit className="btn btn-secondary btn-sm">Revise as new CO</Submit></ActionForm> : null}
        </span>
      </div>

      <Card>
        <DL cols={4} items={[
          ["Source", co.rfi ? `RFI ${co.rfi.number}` : co.esi ? `ESI ${co.esi.number}` : "Direct"],
          ["Submitted", fmtDateTime(co.submittedAt)],
          ["Decided", fmtDate(co.decidedAt)],
          ["Schedule impact", `${co.scheduleImpactDays} day(s)`],
          ["Client reference", co.clientReference ?? "—"],
          ["Client PO", co.clientPoNumber ?? "—"],
          ["Proposed", showMoney ? money(co.proposedAmount) : "—"],
          ["Approved", showMoney && co.approvedAmount ? money(co.approvedAmount) : "—"],
        ]} />
        <div className="mt-3 space-y-1 text-sm"><p className="whitespace-pre-line">{co.description}</p><p className="text-slate-500">Reason: {co.reason}</p>{co.decisionNote ? <p className="text-slate-500">Decision note: {co.decisionNote}</p> : null}</div>
        {co.contractChange ? <Notice tone="green">Contract value ledger: {money(co.contractChange.previousValue)} → {money(co.contractChange.newValue)}. The original contract value is unchanged.</Notice> : null}
      </Card>

      {showMoney ? (
        <Card title="Pricing" bodyClass="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Type</th><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Labour h/unit</th><th className="num">Material</th><th className="num">Labour hours</th>{canEdit ? <th></th> : null}</tr></thead>
            <tbody>
              {co.lines.map((l) => {
                const isLab = l.category === "LABOUR";
                return (
                  <tr key={l.id} className={d(l.quantity).lessThan(0) ? "text-red-700" : ""}>
                    <td className="text-xs">{l.category.toLowerCase()}</td>
                    <td>{l.description}{d(l.quantity).lessThan(0) ? " (credit)" : ""}</td>
                    <td className="num">{qty(l.quantity)} {l.unit}</td>
                    <td className="num">{isLab ? "—" : money(l.unitPrice)}</td>
                    <td className="num">{isLab ? "—" : qty(l.labourHoursPerUnit)}</td>
                    <td className="num">{isLab ? "—" : money(d(l.quantity).times(d(l.unitPrice)))}</td>
                    <td className="num">{qty(isLab ? d(l.quantity) : d(l.quantity).times(d(l.labourHoursPerUnit)))}</td>
                    {canEdit ? <td><ActionForm action={coLineDeleteAction}><input type="hidden" name="lineId" value={l.id} /><Submit className="btn btn-ghost btn-sm text-red-600" pendingText="…">Remove</Submit></ActionForm></td> : null}
                  </tr>
                );
              })}
              {canEdit ? (
                <tr>
                  <td colSpan={8}>
                    <ActionForm action={coLineAction} className="grid gap-2 sm:grid-cols-7">
                      <input type="hidden" name="coId" value={co.id} />
                      <select name="category" className="input" aria-label="Type"><option value="MATERIAL">Material</option><option value="LABOUR">Labour (qty = hours)</option><option value="EQUIPMENT">Equipment</option><option value="SUBCONTRACT">Subcontract</option></select>
                      <input name="description" required placeholder="Description" className="input sm:col-span-2" aria-label="Description" />
                      <input name="quantity" required placeholder="Qty (negative = credit)" className="input" aria-label="Quantity" />
                      <input name="unit" defaultValue="ea" className="input" aria-label="Unit" />
                      <input name="unitPrice" placeholder="Unit price" className="input" aria-label="Unit price" />
                      <div className="flex gap-2"><input name="labourHoursPerUnit" placeholder="Hrs/unit" className="input" aria-label="Labour hours per unit" /><Submit className="btn btn-primary">Add</Submit></div>
                    </ActionForm>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <div className="grid gap-4 border-t border-slate-100 p-4 lg:grid-cols-2">
            <DL cols={2} items={[
              ["Material / equipment / subcontract", money(co.materialCost)],
              ["Labour", `${qty(co.labourHours)} h × ${money(co.labourRate)} = ${money(co.labourCost)}`],
              ["Other costs", money(co.otherCost)],
              ["Markup", `${d(co.markupPercent).toString()}%`],
              ["Proposed price", <b key="p">{money(co.proposedAmount)}</b>],
            ]} />
            {canEdit ? (
              <ActionForm action={coPricingAction} className="grid grid-cols-2 gap-3" resetOnSuccess={false}>
                <input type="hidden" name="coId" value={co.id} />
                <Field label="Labour rate ($/h)"><input name="labourRate" defaultValue={co.labourRate.toString()} className="input" /></Field>
                <Field label="Markup %"><input name="markupPercent" defaultValue={co.markupPercent.toString()} className="input" /></Field>
                <Field label="Other costs ($)"><input name="otherCost" defaultValue={co.otherCost.toString()} className="input" /></Field>
                <Field label="Schedule impact (days)"><input name="scheduleImpactDays" defaultValue={String(co.scheduleImpactDays)} className="input" /></Field>
                <Field label="Title" className="col-span-2"><input name="title" defaultValue={co.title} className="input" /></Field>
                <Field label="Scope" className="col-span-2"><textarea name="description" defaultValue={co.description} rows={2} className="input" /></Field>
                <Field label="Reason" className="col-span-2"><input name="reason" defaultValue={co.reason} className="input" /></Field>
                <div className="col-span-2"><Submit>Save pricing</Submit></div>
              </ActionForm>
            ) : null}
          </div>
        </Card>
      ) : null}

      {co.status === "SUBMITTED" && can(r, "change.approve") ? (
        <Card title="Client decision">
          <div className="grid gap-6 lg:grid-cols-2">
            <ActionForm action={coDecisionAction} className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-4">
              <input type="hidden" name="coId" value={co.id} /><input type="hidden" name="projectId" value={id} /><input type="hidden" name="decision" value="APPROVED" />
              <div className="font-semibold text-emerald-800">Approved</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Approved amount ($)" hint="Blank = proposed"><input name="approvedAmount" placeholder={co.proposedAmount.toString()} className="input" /></Field>
                <Field label="Decision date *"><input type="date" name="decidedAt" required defaultValue={isoDate(today())} className="input" /></Field>
                <Field label="Client PO #"><input name="clientPoNumber" className="input" /></Field>
                <Field label="Client reference"><input name="clientReference" className="input" /></Field>
              </div>
              <Field label="Note"><input name="decisionNote" className="input" /></Field>
              <Field label="Signed CO / PO"><input type="file" name="files" className="text-sm" /></Field>
              <Submit className="btn btn-success">Record approval</Submit>
            </ActionForm>
            <ActionForm action={coDecisionAction} className="space-y-3 rounded-md border border-red-200 bg-red-50/40 p-4">
              <input type="hidden" name="coId" value={co.id} /><input type="hidden" name="projectId" value={id} /><input type="hidden" name="decision" value="REJECTED" />
              <div className="font-semibold text-red-800">Rejected</div>
              <Field label="Decision date *"><input type="date" name="decidedAt" required defaultValue={isoDate(today())} className="input" /></Field>
              <Field label="Reason *"><textarea name="decisionNote" required rows={3} className="input" /></Field>
              <Submit className="btn btn-danger">Record rejection</Submit>
            </ActionForm>
          </div>
        </Card>
      ) : null}

      <Card title="Documents"><DocList entityType="ChangeOrder" entityId={co.id} empty={<span className="text-sm text-slate-400">No documents attached.</span>} /></Card>
      {co.invoices.length ? <Card title="Invoiced"><ul className="text-sm">{co.invoices.map((i) => <li key={i.id}><Link className="link" href={`/jobs/${id}/billing#${i.id}`}>{i.number}</Link> {fmtDate(i.invoiceDate)} {money(i.subtotal)}</li>)}</ul></Card> : null}
    </div>
  );
}
