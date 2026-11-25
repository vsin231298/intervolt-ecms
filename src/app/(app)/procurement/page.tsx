import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, today } from "@/lib/dates";
import { money, qty } from "@/lib/money";
import { Card, Empty, PageHeader, StatusBadge, Tabs, clsx } from "@/components/ui";
import { poDisplayStatus } from "@/services/procurement";

export default async function ProcurementPage({ searchParams }: { searchParams: Promise<{ tab?: string; filter?: string; q?: string }> }) {
  const user = await requireUser("jobs.view");
  const sp = await searchParams;
  const tab = ["requests", "quotes", "invoices"].includes(sp.tab ?? "") ? sp.tab! : "pos";
  const t0 = today();
  const showCost = can(user.role, "financials.view") || can(user.role, "procurement.edit");
  const q = sp.q?.trim();

  const [pos, mrs, rfqs, sinvs] = await Promise.all([
    tab === "pos" ? prisma.purchaseOrder.findMany({
      where: {
        ...(sp.filter === "late" ? { expectedDelivery: { lt: t0 }, status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] } } : sp.filter === "open" ? { status: { in: ["DRAFT", "ISSUED", "PARTIALLY_RECEIVED"] } } : sp.filter === "held" ? { shopDrawingsRequired: true, deliveryOverrideReason: null, status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] } } : {}),
        ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" as const } }, { supplier: { name: { contains: q, mode: "insensitive" as const } } }, { project: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
      },
      include: { supplier: true, project: true, shopDrawings: { include: { revisions: true } }, supplierInvoices: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }) : [],
    tab === "requests" ? prisma.materialRequest.findMany({ where: { status: "REQUESTED" }, include: { project: true, lines: true }, orderBy: { neededBy: "asc" } }) : [],
    tab === "quotes" ? prisma.quoteRequest.findMany({ include: { project: true, suppliers: { include: { supplier: true } } }, orderBy: { createdAt: "desc" }, take: 200 }) : [],
    tab === "invoices" ? prisma.supplierInvoice.findMany({ where: { status: { in: ["RECEIVED", "DISPUTED", "APPROVED"] } }, include: { project: true, supplier: true, purchaseOrder: true, payments: true }, orderBy: { invoiceDate: "asc" } }) : [],
  ]);
  const rows = sp.filter === "held" ? pos.filter((p) => poDisplayStatus(p, false) === "Drawings pending") : pos;

  return (
    <div className="space-y-6">
      <PageHeader title="Procurement" subtitle="Purchase orders, material requests, supplier quotes and supplier invoices across all jobs" />
      <Tabs current={tab} items={[
        { key: "pos", label: "Purchase orders", href: "/procurement" },
        { key: "requests", label: "Material requests", href: "/procurement?tab=requests" },
        { key: "quotes", label: "Supplier quotes (RFQs)", href: "/procurement?tab=quotes" },
        { key: "invoices", label: "Supplier invoices", href: "/procurement?tab=invoices" },
      ]} />

      {tab === "pos" ? (
        <Card bodyClass="overflow-x-auto" actions={
          <form className="flex flex-wrap gap-2">
            <select name="filter" defaultValue={sp.filter ?? ""} className="input w-52" aria-label="Filter"><option value="">All</option><option value="open">Open</option><option value="late">Late deliveries</option><option value="held">Held for shop drawings</option></select>
            <input name="q" defaultValue={q} placeholder="PO, supplier, job…" className="input w-56" aria-label="Search" />
            <button className="btn btn-secondary">Filter</button>
          </form>
        }>
          {rows.length === 0 ? <div className="p-4"><Empty>No purchase orders match.</Empty></div> : (
            <table className="table">
              <thead><tr><th>PO #</th><th>Job</th><th>Supplier</th><th>Issued</th><th>Expected</th><th>Status</th>{showCost ? <th className="num">Total</th> : null}</tr></thead>
              <tbody>
                {rows.map((po) => {
                  const late = po.expectedDelivery && po.expectedDelivery < t0 && ["ISSUED", "PARTIALLY_RECEIVED"].includes(po.status);
                  return (
                    <tr key={po.id}>
                      <td className="font-mono text-xs"><Link className="link" href={`/jobs/${po.projectId}/procurement/${po.id}`}>{po.number}</Link></td>
                      <td className="text-xs">{po.project.number}<div className="text-slate-500">{po.project.name}</div></td>
                      <td>{po.supplier.name}</td>
                      <td>{fmtDate(po.issuedAt)}</td>
                      <td className={clsx(late && "font-semibold text-red-600")}>{fmtDate(po.expectedDelivery)}{late ? " late" : ""}</td>
                      <td><StatusBadge status={po.status} label={poDisplayStatus(po, po.supplierInvoices.length > 0)} /></td>
                      {showCost ? <td className="num">{money(po.total)}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      ) : tab === "requests" ? (
        <Card bodyClass="overflow-x-auto">
          {mrs.length === 0 ? <div className="p-4"><Empty>No open material requests.</Empty></div> : (
            <table className="table">
              <thead><tr><th>Request</th><th>Job</th><th>Needed by</th><th>Items</th><th></th></tr></thead>
              <tbody>
                {mrs.map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono text-xs">{m.number}</td>
                    <td className="text-xs">{m.project.number}<div className="text-slate-500">{m.project.name}</div></td>
                    <td className={clsx(m.neededBy && m.neededBy < t0 && "font-semibold text-red-600")}>{fmtDate(m.neededBy)}</td>
                    <td className="text-xs">{m.lines.map((l) => `${qty(l.quantity)} ${l.unit} ${l.description}`).join("; ")}</td>
                    <td>{can(user.role, "procurement.edit") ? <Link className="btn btn-primary btn-sm" href={`/jobs/${m.projectId}/procurement?mr=${m.id}#new-po`}>Create PO</Link> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : tab === "quotes" ? (
        <Card bodyClass="overflow-x-auto">
          {rfqs.length === 0 ? <div className="p-4"><Empty>No RFQs.</Empty></div> : (
            <table className="table">
              <thead><tr><th>RFQ</th><th>Job</th><th>Title</th><th>Due</th><th>Suppliers</th></tr></thead>
              <tbody>
                {rfqs.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs"><Link className="link" href={`/jobs/${r.projectId}/quotes/${r.id}`}>{r.number}</Link></td>
                    <td className="text-xs">{r.project.number}<div className="text-slate-500">{r.project.name}</div></td>
                    <td>{r.title}</td>
                    <td className={clsx(r.dueDate && r.dueDate < t0 && r.suppliers.some((s) => s.status === "PENDING") && "font-semibold text-red-600")}>{fmtDate(r.dueDate)}</td>
                    <td className="space-x-2 text-xs">{r.suppliers.map((s) => <span key={s.id}>{s.supplier.name} <StatusBadge status={s.status} /></span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card bodyClass="overflow-x-auto">
          {sinvs.length === 0 ? <div className="p-4"><Empty>No open supplier invoices.</Empty></div> : (
            <table className="table">
              <thead><tr><th>Invoice</th><th>Supplier</th><th>Job / PO</th><th>Due</th><th>Match</th><th>Status</th>{showCost ? <th className="num">Amount</th> : null}</tr></thead>
              <tbody>
                {sinvs.map((s) => (
                  <tr key={s.id}>
                    <td>{s.invoiceNumber}<div className="text-xs text-slate-500">{fmtDate(s.invoiceDate)}</div></td>
                    <td>{s.supplier.name}</td>
                    <td className="text-xs">{s.project.number}{s.purchaseOrder ? <div><Link className="link" href={`/jobs/${s.projectId}/procurement/${s.purchaseOrder.id}`}>{s.purchaseOrder.number}</Link></div> : null}</td>
                    <td className={clsx(s.dueDate && s.dueDate < t0 && "font-semibold text-red-600")}>{fmtDate(s.dueDate)}</td>
                    <td><StatusBadge status={s.matchStatus} /></td>
                    <td><StatusBadge status={s.status} /></td>
                    {showCost ? <td className="num">{money(s.amount)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
