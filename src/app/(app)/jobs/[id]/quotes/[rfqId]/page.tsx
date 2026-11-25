import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, isoDate, today } from "@/lib/dates";
import { money, qty } from "@/lib/money";
import { Card, Drawer, Field, Notice, Options, StatusBadge, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { DocList } from "@/components/DocList";
import { getRfqComparison } from "@/services/quotes";
import { addRfqSupplierAction, applyQuotesAction, recordQuoteAction, rfqSupplierStatusAction, selectAllAction, selectQuoteLineAction } from "@/app/actions/estimating";
import { poFromQuoteAction } from "@/app/actions/procurement";

export default async function RfqPage({ params }: { params: Promise<{ id: string; rfqId: string }> }) {
  const user = await requireUser("jobs.view");
  const { id, rfqId } = await params;
  const cmp = await getRfqComparison(rfqId);
  if (!cmp || cmp.rfq.projectId !== id) notFound();
  const { rfq, quotes, rows, totals, bestOverall } = cmp;
  const canEdit = can(user.role, "quote.edit");
  const [drafts, allSuppliers] = await Promise.all([
    prisma.estimate.findMany({ where: { projectId: id, status: "DRAFT" }, orderBy: { revision: "desc" } }),
    prisma.organization.findMany({ where: { type: { in: ["SUPPLIER", "SUBCONTRACTOR"] }, active: true, id: { notIn: rfq.suppliers.map((s) => s.supplierId) } }, orderBy: { name: "asc" } }),
  ]);
  const active = ["ACTIVATION", "EXECUTION", "CLOSEOUT"].includes(rfq.project.stage);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/jobs/${id}/quotes`} className="link text-sm">← All RFQs</Link>
        <h2 className="text-lg font-semibold">{rfq.number}: {rfq.title}</h2>
        <span className="text-sm text-slate-500">Due {fmtDate(rfq.dueDate)}</span>
      </div>

      <Card title="Suppliers on this request" bodyClass="overflow-x-auto" actions={canEdit && allSuppliers.length ? (
        <Drawer label="Add supplier">
          <ActionForm action={addRfqSupplierAction} className="flex items-end gap-2">
            <input type="hidden" name="rfqId" value={rfq.id} />
            <select name="supplierId" required className="input flex-1"><Options items={allSuppliers.map((s) => ({ value: s.id, label: s.name }))} empty="Choose…" /></select>
            <Submit>Add</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        <table className="table">
          <thead><tr><th>Supplier</th><th>Status</th><th>Sent</th><th>Follow-up</th><th></th></tr></thead>
          <tbody>
            {rfq.suppliers.map((s) => (
              <tr key={s.id}>
                <td>{s.supplier.name}<div className="text-xs text-slate-500">{s.supplier.email}</div></td>
                <td><StatusBadge status={s.status} /></td>
                <td className="text-xs">{fmtDateTime(s.sentAt)}</td>
                <td className={clsx("text-xs", s.status === "PENDING" && s.followUpDate && s.followUpDate < today() && "font-semibold text-red-600")}>{fmtDate(s.followUpDate)}{s.lastFollowUpAt ? <div className="text-slate-500">last {fmtDate(s.lastFollowUpAt)}</div> : null}</td>
                <td>
                  {canEdit && s.status === "PENDING" ? (
                    <div className="flex flex-wrap gap-1">
                      {!s.sentAt ? <ActionForm action={rfqSupplierStatusAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="SENT" /><Submit className="btn btn-secondary btn-sm" pendingText="…">Mark sent</Submit></ActionForm> : null}
                      <Drawer label="Follow up" className="btn btn-ghost btn-sm">
                        <ActionForm action={rfqSupplierStatusAction} className="flex items-end gap-2">
                          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="FOLLOWED_UP" />
                          <Field label="Next follow-up"><input type="date" name="followUpDate" className="input" /></Field>
                          <Submit>Log follow-up</Submit>
                        </ActionForm>
                      </Drawer>
                      <ActionForm action={rfqSupplierStatusAction}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="op" value="DECLINED" /><Submit className="btn btn-ghost btn-sm" pendingText="…">Declined</Submit></ActionForm>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {canEdit ? (
        <Drawer label="Record a supplier quotation" className="btn btn-primary" wide>
          <ActionForm action={recordQuoteAction} className="space-y-4">
            <input type="hidden" name="rfqId" value={rfq.id} /><input type="hidden" name="projectId" value={id} />
            <div className="grid gap-3 sm:grid-cols-6">
              <Field label="Supplier *" className="sm:col-span-2"><select name="supplierId" required className="input"><Options items={rfq.suppliers.map((s) => ({ value: s.supplierId, label: s.supplier.name }))} empty="Choose…" /></select></Field>
              <Field label="Quote # *"><input name="quoteNumber" required className="input" /></Field>
              <Field label="Quote date *"><input type="date" name="quoteDate" required defaultValue={isoDate(today())} className="input" /></Field>
              <Field label="Valid until"><input type="date" name="validUntil" className="input" /></Field>
              <Field label="Lead time (days)"><input name="leadTimeDays" inputMode="numeric" className="input" /></Field>
              <Field label="Freight ($)"><input name="freight" defaultValue="0" className="input" /></Field>
              <Field label="Quote document" className="sm:col-span-3"><input type="file" name="files" className="text-sm" /></Field>
            </div>
            <table className="table">
              <thead><tr><th>Item</th><th className="num">Qty</th><th>Unit</th><th className="w-36">Unit price ($)</th><th className="w-28">Lead (days)</th></tr></thead>
              <tbody>
                {rfq.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.description}<div className="text-xs text-slate-500">{[it.manufacturer, it.model].filter(Boolean).join(" · ")}</div></td>
                    <td className="num">{qty(it.quantity)}</td><td>{it.unit}</td>
                    <td><input name={`price_${it.id}`} inputMode="decimal" className="input" aria-label={`Unit price for ${it.description}`} /></td>
                    <td><input name={`lead_${it.id}`} inputMode="numeric" className="input" aria-label={`Lead time for ${it.description}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Field label="Notes"><input name="notes" className="input" /></Field>
            <Submit>Save quotation</Submit>
          </ActionForm>
        </Drawer>
      ) : null}

      <Card title="Quote comparison" bodyClass="overflow-x-auto" actions={canEdit && quotes.length ? (
        <ActionForm action={selectAllAction}><input type="hidden" name="rfqId" value={rfq.id} /><Submit className="btn btn-secondary btn-sm">Select lowest price for every item</Submit></ActionForm>
      ) : null}>
        {quotes.length === 0 ? <div className="p-4 text-sm text-slate-500">No quotations recorded yet.</div> : (
          <table className="table">
            <thead>
              <tr>
                <th>Item</th><th className="num">Qty</th>
                {quotes.map((q) => (
                  <th key={q.id} className="num">
                    {q.supplier.name}
                    <div className="font-normal normal-case text-slate-400">#{q.quoteNumber}{q.validUntil ? ` · valid ${fmtDate(q.validUntil)}` : ""}{q.leadTimeDays ? ` · ${q.leadTimeDays}d` : ""}</div>
                  </th>
                ))}
                <th>Selected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item.id}>
                  <td>{r.item.description}</td>
                  <td className="num">{qty(r.item.quantity)} {r.item.unit}</td>
                  {r.prices.map((p, i) => (
                    <td key={i} className={clsx("num", p && p.lineId === r.lowestLineId && "bg-emerald-50 font-semibold text-emerald-800", p?.expired && "text-slate-400 line-through")}>
                      {p ? <>{money(p.unitPrice)}<div className="text-xs font-normal text-slate-500">{money(p.extended)}{p.leadTimeDays ? ` · ${p.leadTimeDays}d` : ""}</div></> : <span className="text-slate-300">—</span>}
                    </td>
                  ))}
                  <td>
                    {canEdit ? (
                      <ActionForm action={selectQuoteLineAction} className="flex gap-1" resetOnSuccess={false}>
                        <input type="hidden" name="itemId" value={r.item.id} />
                        <select name="lineId" defaultValue={r.item.selectedQuoteLineId ?? ""} className="input py-1 text-xs" aria-label="Selected supplier">
                          <option value="">None</option>
                          {r.prices.map((p, i) => (p ? <option key={p.lineId} value={p.lineId}>{quotes[i].supplier.name} {money(p.unitPrice)}</option> : null))}
                        </select>
                        <Submit className="btn btn-secondary btn-sm" pendingText="…">Set</Submit>
                      </ActionForm>
                    ) : r.item.selectedQuoteLineId ? "Selected" : "—"}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td>Total (incl. freight)</td><td></td>
                {totals.map((t) => (
                  <td key={t.quote.id} className={clsx("num", t.quote.id === bestOverall && "bg-emerald-50 text-emerald-800")}>
                    {money(t.total)}
                    <div className="text-xs font-normal text-slate-500">{t.complete ? "all items" : `${t.covered}/${rows.length} items`}{t.expired ? " · expired" : ""}{t.quote.id === bestOverall ? " · most competitive" : ""}</div>
                  </td>
                ))}
                <td></td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>

      {quotes.length ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Link selected prices to the BOM">
            {drafts.length === 0 ? <Notice>Create a new draft estimate revision to apply supplier prices; finalized revisions are locked.</Notice> : (
              <ActionForm action={applyQuotesAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="rfqId" value={rfq.id} />
                <Field label="Draft revision"><select name="estimateId" className="input w-64">{drafts.map((e) => <option key={e.id} value={e.id}>Rev {e.revision} — {e.title}</option>)}</select></Field>
                <Submit>Apply selected prices</Submit>
              </ActionForm>
            )}
          </Card>
          <Card title="Quotation documents">
            <div className="space-y-2">
              {quotes.map((q) => <div key={q.id}><div className="text-sm font-medium">{q.supplier.name} #{q.quoteNumber}</div><DocList entityType="SupplierQuote" entityId={q.id} empty={<span className="text-xs text-slate-400">No file attached</span>} /></div>)}
            </div>
          </Card>
          {active && can(user.role, "procurement.edit") ? (
            <Card title="Issue purchase orders from selected quotes" className="lg:col-span-2">
              <div className="space-y-3">
                {quotes.map((q) => {
                  const n = rows.filter((r) => r.item.selectedQuoteLineId && q.lines.some((l) => l.id === r.item.selectedQuoteLineId)).length;
                  if (!n) return null;
                  return (
                    <ActionForm key={q.id} action={poFromQuoteAction} className="flex flex-wrap items-end gap-3 rounded border border-slate-200 p-3">
                      <input type="hidden" name="quoteId" value={q.id} />
                      <div className="min-w-48 text-sm"><b>{q.supplier.name}</b><div className="text-xs text-slate-500">{n} selected item(s)</div></div>
                      <Field label="Expected delivery"><input type="date" name="expectedDelivery" className="input" /></Field>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="shopDrawingsRequired" defaultChecked /> Supplier shop drawings required before delivery</label>
                      <Submit>Create PO</Submit>
                    </ActionForm>
                  );
                })}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
