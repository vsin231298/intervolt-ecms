import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, isoDate, today } from "@/lib/dates";
import { d, money, qty, sum } from "@/lib/money";
import { Card, DL, Drawer, Empty, Field, Notice, StatusBadge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { DocList } from "@/components/DocList";
import { drawingGate, poDisplayStatus } from "@/services/procurement";
import { SD_STATUS_LABELS } from "@/services/shopDrawings";
import { cancelPoAction, issuePoAction, overrideGateAction, poExpectedAction, receiveAction, supplierInvoiceAction, supplierInvoiceOpAction } from "@/app/actions/procurement";

export default async function PoPage({ params }: { params: Promise<{ id: string; poId: string }> }) {
  const user = await requireUser("jobs.view");
  const { id, poId } = await params;
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      supplier: true,
      materialRequest: true,
      supplierQuote: true,
      lines: { include: { materialItem: true }, orderBy: { id: "asc" } },
      receipts: { include: { lines: { include: { poLine: true } } }, orderBy: { receivedAt: "desc" } },
      supplierInvoices: { include: { payments: true, lines: true }, orderBy: { invoiceDate: "desc" } },
      shopDrawings: { include: { revisions: true } },
    },
  });
  if (!po || po.projectId !== id) notFound();
  const users = await prisma.user.findMany({ where: { id: { in: [po.createdById, po.deliveryOverrideById, ...po.receipts.map((r) => r.receivedById), ...po.supplierInvoices.map((i) => i.approvedById)].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const r = user.role;
  const showCost = can(r, "financials.view") || can(r, "procurement.edit");
  const gate = drawingGate(po, po.shopDrawings);
  const open = ["ISSUED", "PARTIALLY_RECEIVED"].includes(po.status);
  const billedByLine = (lineId: string) => sum(po.supplierInvoices.flatMap((i) => i.lines.filter((l) => l.poLineId === lineId).map((l) => l.quantity)));
  const receivedValue = sum(po.lines.map((l) => d(l.quantityReceived).times(d(l.unitCost))));
  const invoicedValue = sum(po.supplierInvoices.map((i) => i.amount));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/jobs/${id}/procurement`} className="link text-sm">← Procurement</Link>
        <h2 className="text-lg font-semibold">{po.number}</h2>
        <StatusBadge status={po.status} label={poDisplayStatus(po, po.supplierInvoices.length > 0)} />
        <span className="ml-auto flex flex-wrap gap-2">
          <a className="btn btn-secondary btn-sm" href={`/api/export/po/${po.id}`}>PO PDF</a>
          {po.status === "DRAFT" && can(r, "procurement.edit") ? <ActionForm action={issuePoAction}><input type="hidden" name="poId" value={po.id} /><Submit className="btn btn-primary btn-sm">Issue to supplier</Submit></ActionForm> : null}
          {["DRAFT", "ISSUED"].includes(po.status) && can(r, "procurement.edit") ? (
            <Drawer label="Cancel PO" className="btn btn-ghost btn-sm text-red-600">
              <ActionForm action={cancelPoAction} className="space-y-2"><input type="hidden" name="poId" value={po.id} /><Field label="Reason *"><input name="reason" required className="input" /></Field><Submit className="btn btn-danger">Cancel purchase order</Submit></ActionForm>
            </Drawer>
          ) : null}
        </span>
      </div>

      <Card>
        <DL cols={4} items={[
          ["Supplier", po.supplier.name],
          ["Issued", fmtDateTime(po.issuedAt)],
          ["Expected delivery", open && can(r, "procurement.edit") ? (
            <ActionForm key="e" action={poExpectedAction} className="flex gap-1" resetOnSuccess={false}><input type="hidden" name="poId" value={po.id} /><input type="date" name="expectedDelivery" defaultValue={po.expectedDelivery ? isoDate(po.expectedDelivery) : ""} className="input py-1" aria-label="Expected delivery" /><Submit className="btn btn-secondary btn-sm" pendingText="…">Save</Submit></ActionForm>
          ) : fmtDate(po.expectedDelivery)],
          ["Deliver to", po.deliveryAddress ?? "—"],
          ["From", [po.materialRequest ? `Request ${po.materialRequest.number}` : null, po.supplierQuote ? `Quote #${po.supplierQuote.quoteNumber}` : null].filter(Boolean).join(" · ") || "—"],
          ["Created by", nameOf(po.createdById)],
          ["Total", showCost ? money(po.total) : "—"],
          ["Received value / invoiced", showCost ? `${money(receivedValue)} / ${money(invoicedValue)}` : "—"],
        ]} />
        {po.notes ? <p className="mt-3 text-sm text-slate-600">{po.notes}</p> : null}
      </Card>

      <Card title="Supplier shop drawings">
        <div className="space-y-3">
          {po.shopDrawingsRequired ? (
            gate.cleared ? <Notice tone="green">{gate.reason}. Delivery can proceed.</Notice> : <Notice tone="amber">{gate.reason}. Deliveries are held until the drawings are approved.</Notice>
          ) : <p className="text-sm text-slate-500">Not required for this PO.</p>}
          {po.shopDrawings.length ? (
            <ul className="space-y-1 text-sm">
              {po.shopDrawings.map((sd) => {
                const latest = [...sd.revisions].sort((a, b) => b.revision - a.revision)[0];
                return <li key={sd.id}><Link className="link" href={`/jobs/${id}/shop-drawings#${sd.id}`}>{sd.number} {sd.title}</Link> rev {latest?.revision ?? 0} <StatusBadge status={latest?.status ?? "IN_PREPARATION"} label={SD_STATUS_LABELS[latest?.status ?? "IN_PREPARATION"]} /></li>;
              })}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {po.shopDrawingsRequired && can(r, "shopdrawing.edit") ? <Link className="btn btn-secondary btn-sm" href={`/jobs/${id}/shop-drawings?po=${po.id}`}>Log supplier shop drawing</Link> : null}
            {!gate.cleared && open && can(r, "procurement.overrideDelivery") ? (
              <Drawer label="Allow delivery anyway" className="btn btn-ghost btn-sm">
                <ActionForm action={overrideGateAction} className="space-y-2"><input type="hidden" name="poId" value={po.id} /><Field label="Reason (recorded in the audit trail) *"><textarea name="reason" required rows={2} className="input" /></Field><Submit className="btn btn-danger">Override hold</Submit></ActionForm>
              </Drawer>
            ) : null}
          </div>
          {po.deliveryOverrideReason ? <p className="text-xs text-slate-500">Override by {nameOf(po.deliveryOverrideById)}: {po.deliveryOverrideReason}</p> : null}
        </div>
      </Card>

      <Card title="Lines & delivery" bodyClass="overflow-x-auto">
        <ActionForm action={receiveAction}>
          <input type="hidden" name="poId" value={po.id} /><input type="hidden" name="projectId" value={id} />
          <table className="table">
            <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Outstanding</th>{showCost ? <><th className="num">Unit cost</th><th className="num">Extended</th></> : null}<th className="num">Billed</th>{open && gate.cleared && can(r, "procurement.receive") ? <th className="w-28">Receive now</th> : null}</tr></thead>
            <tbody>
              {po.lines.map((l) => {
                const out = d(l.quantity).minus(d(l.quantityReceived));
                return (
                  <tr key={l.id}>
                    <td>{l.description}{l.materialItem ? <div className="text-xs text-slate-500">Register: {l.materialItem.description}</div> : null}</td>
                    <td className="num">{qty(l.quantity)} {l.unit}</td>
                    <td className="num">{qty(l.quantityReceived)}</td>
                    <td className="num">{qty(out)}</td>
                    {showCost ? <><td className="num">{money(l.unitCost)}</td><td className="num">{money(d(l.quantity).times(d(l.unitCost)))}</td></> : null}
                    <td className="num">{qty(billedByLine(l.id))}</td>
                    {open && gate.cleared && can(r, "procurement.receive") ? <td>{out.greaterThan(0) ? <input name={`qty_${l.id}`} inputMode="decimal" className="input py-1" placeholder={qty(out)} aria-label={`Receive ${l.description}`} /> : null}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {open && gate.cleared && can(r, "procurement.receive") ? (
            <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-4">
              <Field label="Delivery date *"><input type="date" name="receivedAt" required defaultValue={isoDate(today())} className="input" /></Field>
              <Field label="Packing slip #"><input name="reference" className="input" /></Field>
              <Field label="Packing slip / photo"><input type="file" name="files" multiple className="text-sm" /></Field>
              <Field label="Notes"><input name="notes" className="input" /></Field>
              <div className="sm:col-span-4"><Submit>Confirm delivery</Submit></div>
            </div>
          ) : null}
        </ActionForm>
      </Card>

      <Card title="Deliveries" bodyClass="overflow-x-auto">
        {po.receipts.length === 0 ? <div className="p-4"><Empty>No deliveries recorded.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Packing slip</th><th>Items</th><th>Received by</th><th>Documents</th></tr></thead>
            <tbody>
              {po.receipts.map((rc) => (
                <tr key={rc.id}>
                  <td>{fmtDate(rc.receivedAt)}</td>
                  <td>{rc.reference ?? "—"}</td>
                  <td className="text-xs">{rc.lines.map((l) => `${qty(l.quantity)} ${l.poLine.unit} ${l.poLine.description}`).join("; ")}{rc.notes ? <div className="text-slate-500">{rc.notes}</div> : null}</td>
                  <td>{nameOf(rc.receivedById)}</td>
                  <td><DocList entityType="Receipt" entityId={rc.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Supplier invoices (3-way match)" bodyClass="overflow-x-auto" actions={can(r, "supplierInvoice.edit") && po.status !== "DRAFT" && po.status !== "CANCELLED" ? (
        <Drawer label="Record supplier invoice" className="btn btn-primary btn-sm" wide>
          <ActionForm action={supplierInvoiceAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} /><input type="hidden" name="supplierId" value={po.supplierId} /><input type="hidden" name="purchaseOrderId" value={po.id} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Invoice # *"><input name="invoiceNumber" required className="input" /></Field>
              <Field label="Invoice date *"><input type="date" name="invoiceDate" required defaultValue={isoDate(today())} className="input" /></Field>
              <Field label="Due date"><input type="date" name="dueDate" className="input" /></Field>
              <Field label="Tax ($)"><input name="tax" defaultValue="0" className="input" /></Field>
            </div>
            <table className="table">
              <thead><tr><th>PO line</th><th className="num">Received not billed</th><th className="w-24">Qty invoiced</th><th className="w-28">Unit price ($)</th></tr></thead>
              <tbody>
                {po.lines.map((l) => {
                  const billable = d(l.quantityReceived).minus(billedByLine(l.id));
                  return (
                    <tr key={l.id}>
                      <td>{l.description}<input type="hidden" name="line_poLineId" value={l.id} /><input type="hidden" name="line_description" value={l.description} /></td>
                      <td className="num">{qty(billable)} {l.unit}</td>
                      <td><input name="line_quantity" defaultValue={billable.greaterThan(0) ? billable.toString() : ""} inputMode="decimal" className="input py-1" aria-label={`Quantity invoiced for ${l.description}`} /></td>
                      <td><input name="line_unitPrice" defaultValue={l.unitCost.toString()} inputMode="decimal" className="input py-1" aria-label={`Unit price for ${l.description}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Field label="Invoice document"><input type="file" name="files" className="text-sm" /></Field>
            <Submit>Record & match</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {po.supplierInvoices.length === 0 ? <div className="p-4"><Empty>No supplier invoices yet.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Invoice</th><th>Date / due</th><th className="num">Amount</th><th>Match</th><th>Status</th><th className="num">Paid</th><th></th></tr></thead>
            <tbody>
              {po.supplierInvoices.map((inv) => {
                const paid = sum(inv.payments.map((p) => p.amount));
                const total = d(inv.amount).plus(d(inv.tax));
                return (
                  <tr key={inv.id}>
                    <td>{inv.invoiceNumber}<DocList entityType="SupplierInvoice" entityId={inv.id} /></td>
                    <td className="text-xs">{fmtDate(inv.invoiceDate)}<div className="text-slate-500">due {fmtDate(inv.dueDate)}</div></td>
                    <td className="num">{money(inv.amount)}<div className="text-xs text-slate-500">+ tax {money(inv.tax)}</div></td>
                    <td><StatusBadge status={inv.matchStatus} /><div className="max-w-xs text-xs text-slate-500">{inv.matchNote}</div>{inv.overrideReason ? <div className="text-xs text-amber-700">Override: {inv.overrideReason}</div> : null}</td>
                    <td><StatusBadge status={inv.status} />{inv.approvedAt ? <div className="text-xs text-slate-500">{nameOf(inv.approvedById)} {fmtDate(inv.approvedAt)}</div> : null}</td>
                    <td className="num">{money(paid)}</td>
                    <td><InvoiceOps inv={{ id: inv.id, status: inv.status, matchStatus: inv.matchStatus, balance: total.minus(paid).toFixed(2) }} role={r} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function InvoiceOps({ inv, role }: { inv: { id: string; status: string; matchStatus: string; balance: string }; role: Parameters<typeof can>[0] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {["RECEIVED", "DISPUTED"].includes(inv.status) && can(role, "supplierInvoice.edit") ? (
        <ActionForm action={supplierInvoiceOpAction}><input type="hidden" name="invoiceId" value={inv.id} /><input type="hidden" name="op" value="recheck" /><Submit className="btn btn-ghost btn-sm" pendingText="…">Re-check</Submit></ActionForm>
      ) : null}
      {["RECEIVED", "DISPUTED"].includes(inv.status) && can(role, "supplierInvoice.approve") ? (
        inv.matchStatus === "MATCHED" ? (
          <ActionForm action={supplierInvoiceOpAction}><input type="hidden" name="invoiceId" value={inv.id} /><input type="hidden" name="op" value="approve" /><Submit className="btn btn-success btn-sm" pendingText="…">Approve</Submit></ActionForm>
        ) : (
          <Drawer label="Approve…" className="btn btn-secondary btn-sm">
            <ActionForm action={supplierInvoiceOpAction} className="space-y-2"><input type="hidden" name="invoiceId" value={inv.id} /><input type="hidden" name="op" value="approve" /><Field label="Override reason for the variance *"><textarea name="overrideReason" rows={2} className="input" /></Field><Submit className="btn btn-success">Approve with override</Submit></ActionForm>
          </Drawer>
        )
      ) : null}
      {inv.status === "RECEIVED" && can(role, "supplierInvoice.edit") ? (
        <Drawer label="Dispute" className="btn btn-ghost btn-sm">
          <ActionForm action={supplierInvoiceOpAction} className="space-y-2"><input type="hidden" name="invoiceId" value={inv.id} /><input type="hidden" name="op" value="dispute" /><Field label="Note *"><input name="note" required className="input" /></Field><Submit className="btn btn-danger">Dispute</Submit></ActionForm>
        </Drawer>
      ) : null}
      {inv.status === "APPROVED" && can(role, "supplierInvoice.edit") ? (
        <Drawer label="Record payment" className="btn btn-primary btn-sm">
          <ActionForm action={supplierInvoiceOpAction} className="space-y-2">
            <input type="hidden" name="invoiceId" value={inv.id} /><input type="hidden" name="op" value="pay" />
            <Field label="Paid on *"><input type="date" name="paidAt" required defaultValue={isoDate(today())} className="input" /></Field>
            <Field label="Amount ($) *"><input name="amount" required defaultValue={inv.balance} className="input" /></Field>
            <Field label="Cheque / EFT reference"><input name="reference" className="input" /></Field>
            <Submit>Record supplier payment</Submit>
          </ActionForm>
        </Drawer>
      ) : null}
    </div>
  );
}
