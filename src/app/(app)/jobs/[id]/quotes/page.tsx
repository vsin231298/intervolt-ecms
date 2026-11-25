import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { money, qty } from "@/lib/money";
import { Card, Empty, Field, Notice, StatusBadge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { createRfqAction } from "@/app/actions/estimating";

export default async function QuotesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ estimate?: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const sp = await searchParams;
  const [rfqs, estimates, suppliers] = await Promise.all([
    prisma.quoteRequest.findMany({ where: { projectId: id }, include: { suppliers: { include: { supplier: true } }, _count: { select: { items: true, quotes: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.estimate.findMany({ where: { projectId: id }, orderBy: { revision: "desc" }, include: { lines: { where: { category: { in: ["MATERIAL", "EQUIPMENT", "SUBCONTRACT"] } }, orderBy: { sortOrder: "asc" } } } }),
    prisma.organization.findMany({ where: { type: { in: ["SUPPLIER", "SUBCONTRACTOR"] }, active: true }, orderBy: { name: "asc" } }),
  ]);
  const est = estimates.find((e) => e.id === sp.estimate) ?? estimates[0];
  return (
    <div className="space-y-6">
      <Card title="Quotation requests (RFQs)" bodyClass="overflow-x-auto">
        {rfqs.length === 0 ? <div className="p-4"><Empty>No RFQs yet.</Empty></div> : (
          <table className="table">
            <thead><tr><th>RFQ #</th><th>Title</th><th>Due</th><th className="num">Items</th><th>Suppliers</th><th className="num">Quotes</th></tr></thead>
            <tbody>
              {rfqs.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs"><Link className="link" href={`/jobs/${id}/quotes/${r.id}`}>{r.number}</Link></td>
                  <td><Link className="hover:text-brand-700" href={`/jobs/${id}/quotes/${r.id}`}>{r.title}</Link></td>
                  <td>{fmtDate(r.dueDate)}</td>
                  <td className="num">{r._count.items}</td>
                  <td className="space-x-1">{r.suppliers.map((s) => <span key={s.id} className="inline-flex items-center gap-1 text-xs">{s.supplier.name} <StatusBadge status={s.status} /></span>)}</td>
                  <td className="num">{r._count.quotes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {can(user.role, "quote.edit") ? (
        <Card title="New quotation request from the BOM">
          {!est ? <Notice tone="amber">Create an estimate with BOM lines first.</Notice> : suppliers.length === 0 ? <Notice tone="amber">Add suppliers in <Link className="link" href="/directory">Clients & Suppliers</Link> first.</Notice> : (
            <>
              <form className="mb-3 flex items-end gap-2">
                <Field label="Estimate revision"><select name="estimate" defaultValue={est.id} className="input w-72">{estimates.map((e) => <option key={e.id} value={e.id}>Rev {e.revision} — {e.title} ({e.status.toLowerCase()})</option>)}</select></Field>
                <button className="btn btn-secondary">Load lines</button>
              </form>
              <ActionForm action={createRfqAction} className="space-y-4">
                <input type="hidden" name="projectId" value={id} />
                <input type="hidden" name="estimateId" value={est.id} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="RFQ title *" className="sm:col-span-2"><input name="title" required defaultValue="Material pricing" className="input" /></Field>
                  <Field label="Quotes due"><input type="date" name="dueDate" className="input" /></Field>
                </div>
                <div>
                  <div className="label">Suppliers *</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {suppliers.map((s) => <label key={s.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="supplierIds[]" value={s.id} /> {s.name}</label>)}
                  </div>
                </div>
                <div className="max-h-80 overflow-auto rounded border border-slate-200">
                  <table className="table">
                    <thead><tr><th><span className="sr-only">Include</span></th><th>Item</th><th>Manufacturer / model</th><th className="num">Qty</th><th>Unit</th><th className="num">Est. unit price</th></tr></thead>
                    <tbody>
                      {est.lines.map((l) => (
                        <tr key={l.id}>
                          <td><input type="checkbox" name="lineIds[]" value={l.id} defaultChecked={l.category === "MATERIAL"} aria-label={`Include ${l.description}`} /></td>
                          <td>{l.description}</td>
                          <td className="text-xs">{[l.manufacturer, l.model].filter(Boolean).join(" · ")}</td>
                          <td className="num">{qty(l.quantity)}</td>
                          <td>{l.unit}</td>
                          <td className="num">{money(l.unitPrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Field label="Notes to suppliers"><textarea name="notes" rows={2} className="input" /></Field>
                <Submit>Create RFQ</Submit>
              </ActionForm>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
