import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, isoDate, today } from "@/lib/dates";
import { money, qty, sum } from "@/lib/money";
import { orgOptions } from "@/lib/lookups";
import { Card, Drawer, Empty, Field, Options, Stat, StatusBadge, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { materialRegister } from "@/services/procurement";
import { manualMaterialAction, manualMaterialStatusAction, usageAction } from "@/app/actions/procurement";

const MANUAL = ["ORDERED", "RECEIVED", "CANCELLED", "INVOICED"] as const;

export default async function MaterialsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const sp = await searchParams;
  const [reg, usage, suppliers, project] = await Promise.all([
    materialRegister(id),
    prisma.materialUsage.findMany({ where: { projectId: id }, include: { materialItem: true, worker: true }, orderBy: { usedOn: "desc" }, take: 200 }),
    orgOptions(["SUPPLIER", "SUBCONTRACTOR"]),
    prisma.project.findUniqueOrThrow({ where: { id } }),
  ]);
  const r = user.role;
  const showCost = can(r, "financials.view") || can(r, "procurement.edit");
  const canEdit = can(r, "materials.edit") && project.stage !== "CLOSED";
  const rows = sp.view === "manual" ? reg.filter((x) => x.item.isManual) : sp.view === "late" ? reg.filter((x) => x.late) : sp.view === "toorder" ? reg.filter((x) => x.toOrder.greaterThan(0)) : reg;
  const budget = sum(reg.map((x) => x.budgetCost));
  const committed = sum(reg.map((x) => x.committedCost));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Register items" value={reg.length} />
        <Stat label="Still to order" value={reg.filter((x) => x.toOrder.greaterThan(0)).length} href={`/jobs/${id}/materials?view=toorder`} />
        <Stat label="Late deliveries" value={reg.filter((x) => x.late).length} tone={reg.some((x) => x.late) ? "red" : undefined} href={`/jobs/${id}/materials?view=late`} />
        {showCost ? <Stat label="Committed vs budget" value={money(committed)} sub={`budget ${money(budget)}`} tone={committed.greaterThan(budget) ? "red" : undefined} /> : <Stat label="Manual entries" value={reg.filter((x) => x.item.isManual).length} />}
      </div>

      <Card title="Material register" bodyClass="overflow-x-auto" actions={
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex gap-1 text-xs">
            {[["", "All"], ["toorder", "To order"], ["late", "Late"], ["manual", "Manual"]].map(([k, l]) => <a key={k} href={`/jobs/${id}/materials${k ? `?view=${k}` : ""}`} className={clsx("rounded px-2 py-1", (sp.view ?? "") === k ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-100")}>{l}</a>)}
          </nav>
          {canEdit ? (
            <Drawer label="Add manual entry" className="btn btn-primary btn-sm" wide>
              <ActionForm action={manualMaterialAction} className="grid gap-3 sm:grid-cols-4">
                <input type="hidden" name="projectId" value={id} />
                <Field label="Description *" className="sm:col-span-2"><input name="description" required className="input" /></Field>
                <Field label="Manufacturer"><input name="manufacturer" className="input" /></Field>
                <Field label="Model / part #"><input name="model" className="input" /></Field>
                <Field label="Quantity *"><input name="quantity" required inputMode="decimal" className="input" /></Field>
                <Field label="Unit"><input name="unit" defaultValue="ea" className="input" /></Field>
                <Field label="Unit cost ($)"><input name="unitCost" defaultValue="0" inputMode="decimal" className="input" /></Field>
                <Field label="Supplier"><select name="supplierId" className="input"><Options items={suppliers} empty="—" /></select></Field>
                <Field label="Ordered by"><input name="orderedByName" defaultValue={user.name} className="input" /></Field>
                <Field label="Order date"><input type="date" name="orderedAt" defaultValue={isoDate(today())} className="input" /></Field>
                <Field label="Status"><select name="status" className="input">{MANUAL.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></Field>
                <div className="sm:col-span-4"><Submit>Add to register</Submit></div>
              </ActionForm>
            </Drawer>
          ) : null}
        </div>
      }>
        {rows.length === 0 ? <div className="p-4"><Empty>No materials here.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Item</th><th>Supplier</th><th className="num">Required</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Outstanding</th><th className="num">Used</th><th>Status</th>{showCost ? <th className="num">Budget / committed</th> : null}</tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.item.id}>
                  <td>{x.item.description}<div className="text-xs text-slate-500">{[x.item.manufacturer, x.item.model].filter(Boolean).join(" · ")}{x.item.isManual ? ` · manual, ordered by ${x.item.orderedByName ?? "—"} ${fmtDate(x.item.orderedAt)}` : ""}</div></td>
                  <td className="text-xs">{x.suppliers.join(", ") || "—"}</td>
                  <td className="num">{qty(x.required)} {x.item.unit}</td>
                  <td className="num">{qty(x.ordered)}</td>
                  <td className="num">{qty(x.received)}</td>
                  <td className={clsx("num", x.late && "font-semibold text-red-600")}>{qty(x.outstanding)}{x.late ? " late" : ""}</td>
                  <td className="num">{qty(x.used)}</td>
                  <td>
                    {x.item.isManual && canEdit ? (
                      <ActionForm action={manualMaterialStatusAction} className="flex gap-1" resetOnSuccess={false}>
                        <input type="hidden" name="id" value={x.item.id} />
                        <select name="status" defaultValue={x.status} className="input py-1 text-xs" aria-label="Status">{MANUAL.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select>
                        <Submit className="btn btn-ghost btn-sm" pendingText="…">Set</Submit>
                      </ActionForm>
                    ) : <StatusBadge status={x.status} />}
                  </td>
                  {showCost ? <td className="num">{money(x.budgetCost)}<div className={clsx("text-xs", x.committedCost.greaterThan(x.budgetCost) ? "text-red-600" : "text-slate-500")}>{money(x.committedCost)}</div></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Material used on site" bodyClass="overflow-x-auto" actions={project.stage !== "CLOSED" && (canEdit || can(r, "dailyreport.submit")) ? (
        <Drawer label="Log usage" className="btn btn-secondary btn-sm">
          <ActionForm action={usageAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <Field label="Register item"><select name="materialItemId" className="input"><Options items={reg.map((x) => ({ value: x.item.id, label: x.item.description }))} empty="Other (describe below)" /></select></Field>
            <Field label="Description (if not in register)"><input name="description" className="input" /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Qty *"><input name="quantity" required inputMode="decimal" className="input" /></Field>
              <Field label="Unit"><input name="unit" className="input" placeholder="ea" /></Field>
              <Field label="Date *"><input type="date" name="usedOn" required defaultValue={isoDate(today())} className="input" /></Field>
            </div>
            <Field label="Note"><input name="note" className="input" /></Field>
            <Submit>Log usage</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {usage.length === 0 ? <div className="p-4"><Empty>No usage logged.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Item</th><th className="num">Qty</th><th>By</th><th>Note</th></tr></thead>
            <tbody>{usage.map((u) => <tr key={u.id}><td>{fmtDate(u.usedOn)}</td><td>{u.materialItem?.description ?? u.description}</td><td className="num">{qty(u.quantity)} {u.unit}</td><td>{u.worker?.name ?? "Office"}</td><td className="text-xs">{u.note}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
