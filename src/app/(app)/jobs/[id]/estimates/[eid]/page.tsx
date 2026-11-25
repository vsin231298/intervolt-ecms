import Link from "next/link";
import { notFound } from "next/navigation";
import type { LineCategory } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { money, qty } from "@/lib/money";
import { Card, DL, Drawer, Field, Inline, Notice, StatusBadge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { DocList } from "@/components/DocList";
import { addLineAction, deleteLineAction, estimateDocAction, estimateRatesAction, finalizeEstimateAction, pasteBomAction, updateLineAction } from "@/app/actions/estimating";

const CATS: { key: LineCategory; label: string }[] = [
  { key: "MATERIAL", label: "Materials (BOM)" },
  { key: "LABOUR", label: "Labour" },
  { key: "EQUIPMENT", label: "Equipment" },
  { key: "SUBCONTRACT", label: "Subcontractors" },
];

function LineFields({ l }: { l?: { category: LineCategory; section: string | null; description: string; manufacturer: string | null; model: string | null; quantity: unknown; unit: string; unitPrice: unknown; labourHoursPerUnit: unknown } }) {
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <Field label="Category"><select name="category" defaultValue={l?.category ?? "MATERIAL"} className="input">{CATS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
      <Field label="Section"><input name="section" defaultValue={l?.section ?? ""} placeholder="e.g. Lighting" className="input" /></Field>
      <Field label="Description *" className="sm:col-span-4"><input name="description" required defaultValue={l?.description ?? ""} className="input" /></Field>
      <Field label="Manufacturer"><input name="manufacturer" defaultValue={l?.manufacturer ?? ""} className="input" /></Field>
      <Field label="Model"><input name="model" defaultValue={l?.model ?? ""} className="input" /></Field>
      <Field label="Quantity *"><input name="quantity" required inputMode="decimal" defaultValue={l ? String(l.quantity) : ""} className="input" /></Field>
      <Field label="Unit"><input name="unit" defaultValue={l?.unit ?? "ea"} className="input" /></Field>
      <Field label="Unit price ($)" hint="Not used for labour lines"><input name="unitPrice" inputMode="decimal" defaultValue={l ? String(l.unitPrice) : "0"} className="input" /></Field>
      <Field label="Labour hrs / unit" hint="Labour lines: qty = hours"><input name="labourHoursPerUnit" inputMode="decimal" defaultValue={l ? String(l.labourHoursPerUnit) : "0"} className="input" /></Field>
    </div>
  );
}

export default async function EstimateDetail({ params }: { params: Promise<{ id: string; eid: string }> }) {
  const user = await requireUser("jobs.view");
  const { id, eid } = await params;
  const e = await prisma.estimate.findUnique({ where: { id: eid }, include: { lines: { orderBy: [{ section: "asc" }, { sortOrder: "asc" }] }, project: true } });
  if (!e || e.projectId !== id) notFound();
  const editable = e.status === "DRAFT" && can(user.role, "estimate.edit");
  const quoted = new Set(e.lines.filter((l) => l.supplierQuoteLineId).map((l) => l.id));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/jobs/${id}/estimates`} className="link text-sm">← All revisions</Link>
        <h2 className="text-lg font-semibold">Rev {e.revision}: {e.title}</h2>
        <StatusBadge status={e.status} />
        <div className="ml-auto flex flex-wrap gap-2">
          <a className="btn btn-secondary btn-sm" href={`/api/export/estimate/${e.id}?format=xlsx`}>Export Excel</a>
          <a className="btn btn-secondary btn-sm" href={`/api/export/estimate/${e.id}?format=pdf`}>Export PDF</a>
          {can(user.role, "quote.edit") && e.lines.some((l) => l.category === "MATERIAL") ? <Link className="btn btn-secondary btn-sm" href={`/jobs/${id}/quotes?estimate=${e.id}`}>Request supplier quotes</Link> : null}
          {e.status === "DRAFT" && can(user.role, "estimate.finalize") ? (
            <ActionForm action={finalizeEstimateAction}><input type="hidden" name="estimateId" value={e.id} /><Submit className="btn btn-success btn-sm">Finalize & lock</Submit></ActionForm>
          ) : null}
        </div>
      </div>
      {e.status !== "DRAFT" ? <Notice>This revision is {e.status.toLowerCase()} {e.finalizedAt ? `(${fmtDateTime(e.finalizedAt)})` : ""} and locked. To change it, create a new revision from it on the revisions page.</Notice> : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Pricing summary" className="xl:col-span-1">
          <DL cols={1} items={[
            ["Material", money(e.materialTotal)],
            ["Labour", `${qty(e.labourHours)} hrs × ${money(e.labourRate)} = ${money(e.labourTotal)}`],
            ["Equipment", money(e.equipmentTotal)],
            ["Subcontractors", money(e.subcontractTotal)],
            ["Direct cost", <b key="d">{money(e.directCost)}</b>],
            [`Overhead (${e.overheadPercent.toString()}%)`, money(e.overheadAmount)],
            [`Profit (${e.profitPercent.toString()}%)`, money(e.profitAmount)],
            ["Sell price", <b key="s" className="text-lg text-brand-700">{money(e.sellPrice)}</b>],
          ]} />
          {editable ? (
            <Drawer label="Edit rates & markups" className="btn btn-secondary btn-sm mt-4">
              <ActionForm action={estimateRatesAction} className="space-y-3" resetOnSuccess={false}>
                <input type="hidden" name="estimateId" value={e.id} />
                <Field label="Title"><input name="title" defaultValue={e.title} className="input" /></Field>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Labour $/hr"><input name="labourRate" defaultValue={e.labourRate.toString()} className="input" /></Field>
                  <Field label="Overhead %"><input name="overheadPercent" defaultValue={e.overheadPercent.toString()} className="input" /></Field>
                  <Field label="Profit %"><input name="profitPercent" defaultValue={e.profitPercent.toString()} className="input" /></Field>
                </div>
                <Field label="Notes / exclusions"><textarea name="notes" rows={3} defaultValue={e.notes ?? ""} className="input" /></Field>
                <Submit>Save & recalculate</Submit>
              </ActionForm>
            </Drawer>
          ) : null}
          {e.notes ? <p className="mt-3 whitespace-pre-wrap text-xs text-slate-600">{e.notes}</p> : null}
        </Card>
        <Card title="Drawings & specifications used" className="xl:col-span-2" actions={editable ? (
          <Drawer label="Upload">
            <ActionForm action={estimateDocAction} className="space-y-3">
              <input type="hidden" name="estimateId" value={e.id} /><input type="hidden" name="projectId" value={id} />
              <Field label="Files"><input type="file" name="files" multiple required className="text-sm" /></Field>
              <Field label="Category"><select name="category" className="input"><option>Drawings</option><option>Specifications</option><option>Takeoff</option><option>Other</option></select></Field>
              <Submit>Upload</Submit>
            </ActionForm>
          </Drawer>
        ) : null}>
          <DocList entityType="Estimate" entityId={e.id} empty={<p className="text-sm text-slate-500">No files attached to this revision. Tender drawings are in the job&apos;s Documents tab.</p>} />
        </Card>
      </div>

      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Inline label="+ Add line">
            <ActionForm action={addLineAction} className="space-y-3" closeDetails={false}>
              <input type="hidden" name="estimateId" value={e.id} />
              <LineFields />
              <Submit>Add line</Submit>
            </ActionForm>
          </Inline>
          <Inline label="Paste BOM from Excel">
            <ActionForm action={pasteBomAction} className="space-y-3">
              <input type="hidden" name="estimateId" value={e.id} />
              <p className="text-xs text-slate-500">Copy rows from Excel with columns: Description, Manufacturer, Model, Quantity, Unit, Unit price, Labour hrs/unit. A header row is ignored.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Category"><select name="category" className="input">{CATS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
                <Field label="Section"><input name="section" className="input" /></Field>
              </div>
              <textarea name="text" rows={8} required className="input font-mono text-xs" placeholder={"Panelboard 225A\tSchneider\tNQ42L225\t6\tea\t2450\t10"} />
              <Submit>Import rows</Submit>
            </ActionForm>
          </Inline>
        </div>
      ) : null}

      {CATS.map((cat) => {
        const lines = e.lines.filter((l) => l.category === cat.key);
        if (!lines.length) return null;
        return (
          <Card key={cat.key} title={`${cat.label} (${lines.length})`} bodyClass="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Section</th><th>Description</th><th>Manufacturer / model</th><th className="num">Qty</th><th>Unit</th>{cat.key !== "LABOUR" ? <th className="num">Unit price</th> : null}{cat.key !== "LABOUR" ? <th className="num">Total</th> : null}<th className="num">Labour hrs</th>{editable ? <th></th> : null}</tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="text-xs text-slate-500">{l.section}</td>
                    <td>{l.description}{quoted.has(l.id) ? <span className="ml-2 rounded bg-emerald-50 px-1 text-[10px] font-medium text-emerald-700">supplier price</span> : null}</td>
                    <td className="text-xs">{[l.manufacturer, l.model].filter(Boolean).join(" · ")}</td>
                    <td className="num">{qty(l.quantity)}</td>
                    <td>{l.unit}</td>
                    {cat.key !== "LABOUR" ? <td className="num">{money(l.unitPrice)}</td> : null}
                    {cat.key !== "LABOUR" ? <td className="num">{money(l.materialTotal)}</td> : null}
                    <td className="num">{qty(l.labourHours)}</td>
                    {editable ? (
                      <td className="whitespace-nowrap">
                        <div className="flex gap-1">
                          <Drawer label="Edit" className="btn btn-ghost btn-sm">
                            <ActionForm action={updateLineAction} className="space-y-3" resetOnSuccess={false}>
                              <input type="hidden" name="lineId" value={l.id} />
                              <LineFields l={l} />
                              <Submit>Save line</Submit>
                            </ActionForm>
                          </Drawer>
                          <ActionForm action={deleteLineAction}><input type="hidden" name="lineId" value={l.id} /><Submit className="btn btn-ghost btn-sm text-red-600" pendingText="…">Delete</Submit></ActionForm>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        );
      })}
      {e.lines.length === 0 ? <Notice tone="amber">No lines yet. Add lines one at a time or paste a BOM from Excel.</Notice> : null}
    </div>
  );
}
