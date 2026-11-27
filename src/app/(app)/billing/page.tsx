import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { fmtDateTime } from "@/lib/dates";
import { money } from "@/lib/money";
import { Badge, Card, Empty, PageHeader, Tabs } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { StatusBadge } from "@/components/WorkOrderView";
import { billingBoard, type Tab } from "@/services/billsheet";
import { markBilledAction } from "@/app/actions/billsheet";

const day = (d: Date | null) => (d ? d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Toronto" }) : "");

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("jobs.view");
  if (!can(user.role, "project.manage") && !can(user.role, "billing.edit")) redirect("/forbidden");
  const sp = await searchParams;
  const { rows, counts } = await billingBoard(user);
  const tabs: Tab[] = ["ready", "finalize", "returning", "cancelled", "billed"];
  const tab: Tab = tabs.includes(sp.tab as Tab) ? (sp.tab as Tab) : counts.ready || !can(user.role, "project.manage") ? "ready" : "finalize";
  const list = rows.filter((r) => r.tab === tab).sort((a, b) => tab === "billed" ? (b.billedAt?.getTime() ?? 0) - (a.billedAt?.getTime() ?? 0) : (b.readyAt ?? b.lastAt)!.getTime() - (a.readyAt ?? a.lastAt)!.getTime());
  const canBill = can(user.role, "billing.edit");
  const canEdit = can(user.role, "project.manage");
  return (
    <div>
      <PageHeader title="Billing" subtitle="PM finalizes → Ready to bill → office admin invoices in QuickBooks → Billed." />
      <Tabs current={tab} items={[
        { key: "ready", label: "Ready to bill", href: "/billing?tab=ready", count: counts.ready },
        { key: "finalize", label: "To finalize", href: "/billing?tab=finalize", count: counts.finalize },
        { key: "returning", label: "Returning", href: "/billing?tab=returning", count: counts.returning },
        { key: "cancelled", label: "Cancelled", href: "/billing?tab=cancelled" },
        { key: "billed", label: "Billed", href: "/billing?tab=billed" },
      ]} />
      <p className="mb-3 text-sm text-slate-500">{{
        ready: "The PM has finished these. Invoice them in QuickBooks, then Mark billed.",
        finalize: "Last visit is Complete. The PM checks the work order, adds prices and marks Ready to bill.",
        returning: "Last visit says Needs return visit, Waiting for parts or Needs a quote.",
        cancelled: "The PM chose no bill.",
        billed: "Billed in the last 90 days.",
      }[tab]}</p>
      <Card bodyClass="overflow-x-auto p-0">
        {list.length === 0 ? <div className="p-4"><Empty>Nothing here.</Empty></div> : (
          <table className="table">
            <thead><tr>
              <th>WO #</th><th>Customer</th><th>Address</th><th>Visits</th>
              {tab === "ready" ? <><th>Finalized by</th><th className="num">Total</th>{canBill ? <th>QuickBooks invoice #</th> : null}</> : null}
              {tab === "finalize" || tab === "returning" ? <><th>Last visit</th><th>Sheet</th></> : null}
              {tab === "cancelled" ? <th>Cancelled</th> : null}
              {tab === "billed" ? <><th>Billed</th><th className="num">Total</th><th>QuickBooks #</th></> : null}
              <th></th>
            </tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id}>
                <td><Link className="link font-mono text-xs" href={`/billing/${r.id}`}>{r.number}</Link></td>
                <td className="font-medium">{r.customer}</td>
                <td className="text-sm">{r.location}</td>
                <td>{r.visits}{r.unfiled ? <div className="text-xs text-amber-700">not filed</div> : null}</td>
                {tab === "ready" ? <>
                  <td className="text-sm">{r.readyBy} · {r.readyAt ? fmtDateTime(r.readyAt) : ""}</td>
                  <td className="num font-semibold">{r.total ? money(r.total) : "—"}</td>
                  {canBill ? (
                    <td>
                      <ActionForm action={markBilledAction} className="flex items-center gap-2">
                        <input type="hidden" name="projectId" value={r.id} />
                        <input name="qbInvoiceNo" className="input w-32 py-1.5" placeholder="optional" />
                        <Submit className="btn btn-success btn-sm">Mark billed</Submit>
                      </ActionForm>
                    </td>
                  ) : null}
                </> : null}
                {tab === "finalize" || tab === "returning" ? <>
                  <td className="text-sm">{day(r.lastAt)}{r.lastBy ? ` · ${r.lastBy}` : ""} <StatusBadge status={r.lastStatus} /></td>
                  <td>{r.sheetStatus === "DRAFT" ? <Badge tone="amber">Draft{r.total ? ` · ${money(r.total)}` : ""}</Badge> : <span className="text-xs text-slate-400">Not started</span>}</td>
                </> : null}
                {tab === "cancelled" ? <td className="text-sm">{r.cancelledBy} · {day(r.cancelledAt)}{r.cancelReason ? ` · ${r.cancelReason}` : ""}</td> : null}
                {tab === "billed" ? <>
                  <td className="text-sm">{r.billedBy ?? ""} · {day(r.billedAt)}</td>
                  <td className="num">{r.total ? money(r.total) : "—"}</td>
                  <td className="text-sm">{r.qbInvoiceNo ?? "—"}</td>
                </> : null}
                <td className="whitespace-nowrap text-right"><Link className="btn btn-secondary btn-sm" href={`/billing/${r.id}`}>{(tab === "finalize" || tab === "returning") && canEdit ? "Open sheet" : "View"}</Link></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
