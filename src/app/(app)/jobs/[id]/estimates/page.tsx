import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { money, qty } from "@/lib/money";
import { Card, Empty, Field, Inline, StatusBadge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { createEstimateAction } from "@/app/actions/estimating";
import { compareEstimates } from "@/services/estimating";

export default async function EstimatesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const sp = await searchParams;
  const project = await prisma.project.findUniqueOrThrow({ where: { id } });
  const estimates = await prisma.estimate.findMany({ where: { projectId: id }, orderBy: { revision: "desc" }, include: { _count: { select: { lines: true } } } });
  const canEdit = can(user.role, "estimate.edit") && project.stage !== "CLOSED";
  let comparison: ReturnType<typeof compareEstimates> | null = null;
  let a = null, b = null;
  if (sp.a && sp.b) {
    [a, b] = await Promise.all([prisma.estimate.findUnique({ where: { id: sp.a }, include: { lines: true } }), prisma.estimate.findUnique({ where: { id: sp.b }, include: { lines: true } })]);
    if (a && b) comparison = compareEstimates(a, b);
  }
  return (
    <div className="space-y-6">
      <Card title="Estimate revisions" actions={canEdit ? (
        <Inline label="New revision">
          <ActionForm action={createEstimateAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="projectId" value={id} />
            <Field label="Title"><input name="title" placeholder="e.g. Rev 2 — addendum 1" className="input w-64" /></Field>
            <Field label="Copy lines from"><select name="basedOnId" className="input w-56"><option value="">Start blank</option>{estimates.map((e) => <option key={e.id} value={e.id}>Rev {e.revision} — {e.title}</option>)}</select></Field>
            <Submit>Create</Submit>
          </ActionForm>
        </Inline>
      ) : null} bodyClass="overflow-x-auto">
        {estimates.length === 0 ? <div className="p-4"><Empty>No estimates yet. Create the first revision to start the BOM.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Rev</th><th>Title</th><th>Status</th><th className="num">Lines</th><th className="num">Material</th><th className="num">Labour hrs</th><th className="num">Direct cost</th><th className="num">Sell price</th><th>Updated</th><th>Export</th></tr></thead>
            <tbody>
              {estimates.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono"><Link className="link" href={`/jobs/${id}/estimates/${e.id}`}>{e.revision}</Link></td>
                  <td><Link className="hover:text-brand-700" href={`/jobs/${id}/estimates/${e.id}`}>{e.title}</Link></td>
                  <td><StatusBadge status={e.status} /></td>
                  <td className="num">{e._count.lines}</td>
                  <td className="num">{money(e.materialTotal)}</td>
                  <td className="num">{qty(e.labourHours)}</td>
                  <td className="num">{money(e.directCost)}</td>
                  <td className="num font-semibold">{money(e.sellPrice)}</td>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(e.updatedAt)}</td>
                  <td className="whitespace-nowrap text-xs"><a className="link" href={`/api/export/estimate/${e.id}?format=xlsx`}>Excel</a> · <a className="link" href={`/api/export/estimate/${e.id}?format=pdf`}>PDF</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {estimates.length > 1 ? (
        <Card title="Compare revisions">
          <form className="flex flex-wrap items-end gap-3">
            <Field label="Previous"><select name="a" defaultValue={sp.a ?? estimates[1].id} className="input w-56">{estimates.map((e) => <option key={e.id} value={e.id}>Rev {e.revision} — {e.title}</option>)}</select></Field>
            <Field label="Revised"><select name="b" defaultValue={sp.b ?? estimates[0].id} className="input w-56">{estimates.map((e) => <option key={e.id} value={e.id}>Rev {e.revision} — {e.title}</option>)}</select></Field>
            <button className="btn btn-secondary">Compare</button>
          </form>
          {comparison && a && b ? (
            <div className="mt-4 overflow-x-auto">
              <div className="mb-3 grid gap-3 text-sm sm:grid-cols-3">
                <div>Rev {a.revision} sell: <b>{money(a.sellPrice)}</b></div>
                <div>Rev {b.revision} sell: <b>{money(b.sellPrice)}</b></div>
                <div>Difference: <b className={Number(b.sellPrice) - Number(a.sellPrice) >= 0 ? "text-red-600" : "text-emerald-600"}>{money(Number(b.sellPrice) - Number(a.sellPrice))}</b></div>
              </div>
              <table className="table">
                <thead><tr><th>Change</th><th>Item</th><th className="num">Qty (prev → rev)</th><th className="num">Unit price (prev → rev)</th><th className="num">Δ cost</th></tr></thead>
                <tbody>
                  {comparison.filter((r) => r.change !== "same").map((r) => (
                    <tr key={r.key}>
                      <td><StatusBadge status={r.change === "added" ? "APPROVED" : r.change === "removed" ? "REJECTED" : "PENDING"} label={r.change} /></td>
                      <td>{r.description}<div className="text-xs text-slate-500">{r.category.toLowerCase()}</div></td>
                      <td className="num">{r.a ? qty(r.a.quantity) : "—"} → {r.b ? qty(r.b.quantity) : "—"}</td>
                      <td className="num">{r.a ? money(r.a.unitPrice) : "—"} → {r.b ? money(r.b.unitPrice) : "—"}</td>
                      <td className="num">{money(r.delta)}</td>
                    </tr>
                  ))}
                  {comparison.every((r) => r.change === "same") ? <tr><td colSpan={5} className="text-center text-slate-500">No line differences.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
