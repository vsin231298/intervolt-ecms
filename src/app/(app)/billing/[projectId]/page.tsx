import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { fmtDateTime } from "@/lib/dates";
import { money } from "@/lib/money";
import { NotFoundError } from "@/lib/errors";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { StatusBadge } from "@/components/WorkOrderView";
import { BillingSheetForm, PrintButton } from "@/components/BillingSheetForm";
import { getSheet, totals } from "@/services/billsheet";
import { cancelJobBillingAction, markBilledAction, reopenSheetAction } from "@/app/actions/billsheet";

const STATUS: Record<string, { label: string; tone: "amber" | "green" | "blue" | "gray" | "red" }> = {
  NEW: { label: "Not started", tone: "gray" }, DRAFT: { label: "Draft", tone: "amber" }, READY: { label: "Ready to bill", tone: "green" },
  BILLED: { label: "Billed", tone: "blue" }, CANCELLED: { label: "Cancelled · no bill", tone: "red" },
};
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
const KIND = { LABOUR: "Labour", MATERIAL: "Materials", OTHER: "Other" } as const;

export default async function BillingSheetPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requireUser("jobs.view");
  const { projectId } = await params;
  const s = await getSheet(user, projectId).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const canEdit = can(user.role, "project.manage");
  const canBill = can(user.role, "billing.edit");
  const editable = canEdit && (s.status === "NEW" || s.status === "DRAFT");
  const st = STATUS[s.status];
  const t = totals(s.lines, s.taxPercent);
  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ href: "/billing", label: "Billing" }]}
        title={`${s.project.number} · ${s.project.client?.name ?? s.project.siteContactName ?? s.project.name}`}
        subtitle={`${s.project.location ?? "No address"} · Billing sheet`}
        actions={<div className="no-print flex items-center gap-2"><Badge tone={st.tone}>{st.label}</Badge>{!editable ? <PrintButton /> : null}<Link className="btn btn-ghost" href={`/work-orders?tab=all&q=${encodeURIComponent(s.project.number)}`}>Work orders</Link></div>}
      />
      {s.unfiled ? <Notice tone="amber">Some work orders on this job aren&apos;t filed yet. <Link className="link" href="/work-orders?tab=review">File them</Link> before Ready to bill.</Notice> : null}
      {s.status === "READY" ? <Notice tone="green">Ready to bill · {s.who(s.sheet?.readyById)} · {s.sheet?.readyAt ? fmtDateTime(s.sheet.readyAt) : ""}</Notice> : null}
      {s.status === "BILLED" ? <Notice tone="blue">Billed by {s.who(s.sheet?.billedById)} · {s.sheet?.billedAt ? fmtDateTime(s.sheet.billedAt) : ""}{s.sheet?.qbInvoiceNo ? ` · QuickBooks invoice ${s.sheet.qbInvoiceNo}` : ""}</Notice> : null}
      {s.status === "CANCELLED" ? <Notice tone="red">Cancelled, no bill · {s.who(s.sheet?.cancelledById)}{s.sheet?.cancelReason ? ` · ${s.sheet.cancelReason}` : ""}</Notice> : null}

      {editable ? (
        <BillingSheetForm projectId={projectId} description={s.description} lines={s.lines} taxPercent={s.taxPercent} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="Description"><p className="whitespace-pre-line text-base">{s.description || "—"}</p></Card>
            <Card title="Lines" bodyClass="overflow-x-auto p-0">
              <table className="table">
                <thead><tr><th>Type</th><th>Description</th><th className="num">Qty / hrs</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
                <tbody>{s.lines.map((l, i) => (
                  <tr key={i}><td className="text-xs text-slate-500">{KIND[l.kind]}</td><td>{l.description}{l.date || l.who ? <div className="text-xs text-slate-500">{day(l.date)}{l.date && l.who ? " · " : ""}{l.who}</div> : null}</td><td className="num">{l.quantity}</td><td className="num">{l.unitPrice == null ? "—" : money(l.unitPrice)}</td><td className="num">{l.unitPrice == null ? "—" : money(l.quantity * l.unitPrice)}</td></tr>
                ))}</tbody>
              </table>
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Total">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>Labour</span><span>{money(t.labour)}</span></div>
                <div className="flex justify-between"><span>Materials</span><span>{money(t.materials)}</span></div>
                <div className="flex justify-between"><span>Other</span><span>{money(t.other)}</span></div>
                <div className="flex justify-between border-t border-slate-200 pt-1"><span>Subtotal</span><span>{money(t.subtotal)}</span></div>
                <div className="flex justify-between"><span>HST {s.taxPercent}%</span><span>{money(t.tax)}</span></div>
                <div className="flex justify-between text-lg font-semibold"><span>Total</span><span>{money(t.total)}</span></div>
              </div>
              <div className="no-print mt-4 space-y-2">
                {s.status === "READY" && canBill ? (
                  <ActionForm action={markBilledAction} className="space-y-2">
                    <input type="hidden" name="projectId" value={projectId} />
                    <input name="qbInvoiceNo" className="input py-2.5" placeholder="QuickBooks invoice # (optional)" />
                    <Submit className="btn btn-success w-full py-3">Mark billed</Submit>
                  </ActionForm>
                ) : null}
                {(s.status === "READY" || s.status === "CANCELLED") && canEdit ? (
                  <ActionForm action={reopenSheetAction}><input type="hidden" name="projectId" value={projectId} /><Submit className="btn btn-secondary w-full">Reopen to edit</Submit></ActionForm>
                ) : null}
              </div>
            </Card>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Visits (as the guys wrote them)" bodyClass="p-0">
            {s.visits.length === 0 ? <p className="p-4 text-sm text-slate-500">No work orders.</p> : (
              <ul className="divide-y divide-slate-100">{s.visits.map((v) => (
                <li key={v.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">{fmtDateTime(v.createdAt)} · {v.by} <StatusBadge status={v.jobStatus} /> <Link className="link no-print" href={`/work-orders/${v.id}`}>Open (photos, signature)</Link></div>
                  <div className="mt-1 whitespace-pre-line">{v.workSummary}</div>
                </li>
              ))}</ul>
            )}
          </Card>
        </div>
        {editable ? (
          <div className="no-print">
            <Card title="No bill for this job?">
              <ActionForm action={cancelJobBillingAction} className="space-y-2">
                <input type="hidden" name="projectId" value={projectId} />
                <input name="reason" className="input py-2.5" placeholder="Reason (e.g. warranty callback)" />
                <Submit className="btn btn-ghost w-full text-red-600">Cancel job (no bill)</Submit>
              </ActionForm>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
