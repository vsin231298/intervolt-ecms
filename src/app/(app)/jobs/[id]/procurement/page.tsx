import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, today } from "@/lib/dates";
import { money, qty } from "@/lib/money";
import { orgOptions } from "@/lib/lookups";
import { Card, Drawer, Empty, Field, Notice, Options, StatusBadge, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { poDisplayStatus } from "@/services/procurement";
import { cancelMaterialRequestAction, createPoAction, materialRequestAction } from "@/app/actions/procurement";

const LINES = 8;

export default async function ProcurementTab({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mr?: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const sp = await searchParams;
  const [project, requests, pos, items, suppliers] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id } }),
    prisma.materialRequest.findMany({ where: { projectId: id }, include: { lines: true, purchaseOrders: true }, orderBy: { createdAt: "desc" } }),
    prisma.purchaseOrder.findMany({ where: { projectId: id }, include: { supplier: true, shopDrawings: { include: { revisions: true } }, supplierInvoices: true }, orderBy: { createdAt: "desc" } }),
    prisma.materialItem.findMany({ where: { projectId: id, isManual: false }, orderBy: { description: "asc" } }),
    orgOptions(["SUPPLIER", "SUBCONTRACTOR"]),
  ]);
  const requesters = await prisma.user.findMany({ where: { id: { in: requests.map((r) => r.requestedById) } }, select: { id: true, name: true } });
  const fromMr = requests.find((r) => r.id === sp.mr);
  const active = ["ACTIVATION", "EXECUTION", "CLOSEOUT"].includes(project.stage);
  const canPo = can(user.role, "procurement.edit") && active;
  const canMr = (can(user.role, "procurement.edit") || can(user.role, "materials.edit") || can(user.role, "dailyreport.submit")) && active;
  const t0 = today();
  const itemOpts = items.map((i) => ({ value: i.id, label: i.description }));

  return (
    <div className="space-y-6">
      <Card title="Material requests" bodyClass="overflow-x-auto" actions={canMr ? (
        <Drawer label="Request material" className="btn btn-secondary btn-sm" wide>
          <ActionForm action={materialRequestAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Needed by"><input type="date" name="neededBy" className="input" /></Field>
              <Field label="Notes"><input name="notes" className="input" /></Field>
            </div>
            <LineInputs itemOpts={itemOpts} withCost={false} />
            <Submit>Send request</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {requests.length === 0 ? <div className="p-4"><Empty>No material requests.</Empty></div> : (
          <table className="table">
            <thead><tr><th>MR #</th><th>Requested by</th><th>Needed by</th><th>Items</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.number}</td>
                  <td>{requesters.find((u) => u.id === r.requestedById)?.name}<div className="text-xs text-slate-500">{fmtDate(r.createdAt)}</div></td>
                  <td className={clsx(r.status === "REQUESTED" && r.neededBy && r.neededBy < t0 && "font-semibold text-red-600")}>{fmtDate(r.neededBy)}</td>
                  <td className="text-xs">{r.lines.map((l) => `${qty(l.quantity)} ${l.unit} ${l.description}`).join("; ")}{r.notes ? <div className="text-slate-500">{r.notes}</div> : null}</td>
                  <td><StatusBadge status={r.status} />{r.purchaseOrders.map((po) => <div key={po.id}><Link className="link text-xs" href={`/jobs/${id}/procurement/${po.id}`}>{po.number}</Link></div>)}</td>
                  <td>
                    {r.status === "REQUESTED" && canPo ? (
                      <div className="flex gap-1">
                        <Link href={`/jobs/${id}/procurement?mr=${r.id}#new-po`} className="btn btn-primary btn-sm">Create PO</Link>
                        <ActionForm action={cancelMaterialRequestAction}><input type="hidden" name="id" value={r.id} /><Submit className="btn btn-ghost btn-sm" pendingText="…">Cancel</Submit></ActionForm>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Purchase orders" bodyClass="overflow-x-auto">
        {pos.length === 0 ? <div className="p-4"><Empty>No purchase orders yet.</Empty></div> : (
          <table className="table">
            <thead><tr><th>PO #</th><th>Supplier</th><th>Issued</th><th>Expected</th><th>Shop drawings</th><th>Status</th><th className="num">Total</th></tr></thead>
            <tbody>
              {pos.map((po) => {
                const late = po.expectedDelivery && po.expectedDelivery < t0 && ["ISSUED", "PARTIALLY_RECEIVED"].includes(po.status);
                return (
                  <tr key={po.id}>
                    <td className="font-mono text-xs"><Link className="link" href={`/jobs/${id}/procurement/${po.id}`}>{po.number}</Link></td>
                    <td>{po.supplier.name}</td>
                    <td>{fmtDate(po.issuedAt)}</td>
                    <td className={clsx(late && "font-semibold text-red-600")}>{fmtDate(po.expectedDelivery)}{late ? " late" : ""}</td>
                    <td className="text-xs">{po.shopDrawingsRequired ? `${po.shopDrawings.length} submitted` : "Not required"}</td>
                    <td><StatusBadge status={po.status} label={poDisplayStatus(po, po.supplierInvoices.length > 0)} /></td>
                    <td className="num">{money(po.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {canPo ? (
        <Card title={fromMr ? `New purchase order for ${fromMr.number}` : "New purchase order"} id="new-po">
          {suppliers.length === 0 ? <Notice tone="amber">Add a supplier in <Link className="link" href="/directory">Clients & Suppliers</Link> first.</Notice> : (
            <ActionForm action={createPoAction} className="space-y-3">
              <input type="hidden" name="projectId" value={id} />
              {fromMr ? <input type="hidden" name="materialRequestId" value={fromMr.id} /> : null}
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Supplier *"><select name="supplierId" required className="input"><Options items={suppliers} empty="Choose…" /></select></Field>
                <Field label="Expected delivery"><input type="date" name="expectedDelivery" className="input" /></Field>
                <Field label="Deliver to" className="sm:col-span-2"><input name="deliveryAddress" defaultValue={project.location ?? ""} className="input" /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shopDrawingsRequired" /> Supplier must submit shop drawings; delivery is held until they are approved</label>
              <LineInputs itemOpts={itemOpts} withCost prefill={fromMr?.lines.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unit: l.unit, materialItemId: l.materialItemId ?? "" }))} />
              <Field label="Notes"><input name="notes" className="input" /></Field>
              <Submit>Create draft PO</Submit>
            </ActionForm>
          )}
        </Card>
      ) : !active ? <Notice>Purchase orders open once the job is activated.</Notice> : null}
    </div>
  );
}

function LineInputs({ itemOpts, withCost, prefill = [] }: { itemOpts: { value: string; label: string }[]; withCost: boolean; prefill?: { description: string; quantity: string; unit: string; materialItemId: string }[] }) {
  const n = Math.max(LINES, prefill.length + 2);
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>Register item</th><th>Description *</th><th className="w-24">Qty</th><th className="w-20">Unit</th>{withCost ? <th className="w-28">Unit cost ($)</th> : null}</tr></thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => {
            const p = prefill[i];
            return (
              <tr key={i}>
                <td><select name="line_materialItemId" defaultValue={p?.materialItemId ?? ""} className="input py-1 text-xs" aria-label={`Line ${i + 1} register item`}><Options items={itemOpts} empty="—" /></select></td>
                <td><input name="line_description" defaultValue={p?.description} className="input py-1" aria-label={`Line ${i + 1} description`} /></td>
                <td><input name="line_quantity" defaultValue={p?.quantity} inputMode="decimal" className="input py-1" aria-label={`Line ${i + 1} quantity`} /></td>
                <td><input name="line_unit" defaultValue={p?.unit ?? "ea"} className="input py-1" aria-label={`Line ${i + 1} unit`} /></td>
                {withCost ? <td><input name="line_unitCost" inputMode="decimal" className="input py-1" aria-label={`Line ${i + 1} unit cost`} /></td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-slate-500">Blank rows are ignored. Pick a register item to tag the line to the job material register.</p>
    </div>
  );
}
