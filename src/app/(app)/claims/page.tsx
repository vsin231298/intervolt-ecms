import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { fmtDate, today } from "@/lib/dates";
import { money, sum } from "@/lib/money";
import { Card, Empty, PageHeader, Stat, StatusBadge, Tabs, clsx } from "@/components/ui";
import { claimsPipeline, type ClaimBucket } from "@/services/dashboard";
import { SD_STATUS_LABELS } from "@/services/shopDrawings";

const BUCKETS: { key: ClaimBucket; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "submitted", label: "Submitted" },
  { key: "approvedNotInvoiced", label: "Approved, not invoiced" },
  { key: "approvedWithPo", label: "Approved with PO" },
  { key: "approvedInvoiced", label: "Approved & invoiced" },
  { key: "rejected", label: "Rejected / revise" },
];

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ type?: string; bucket?: string }> }) {
  const user = await requireUser("jobs.view");
  const sp = await searchParams;
  const type = sp.type === "rfi" || sp.type === "sd" ? sp.type : "co";
  const bucket = BUCKETS.find((b) => b.key === sp.bucket)?.key;
  const { coRows, rfiRows, sdRows } = await claimsPipeline();
  const showMoney = can(user.role, "financials.view") || can(user.role, "change.edit");
  const t0 = today();
  const rows = type === "co" ? coRows : type === "rfi" ? rfiRows : sdRows;
  const count = (k: ClaimBucket) => rows.filter((r) => r.bucket === k).length;
  const qs = (b?: string) => `/claims?type=${type}${b ? `&bucket=${b}` : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Claims & Submittals" subtitle="Change orders (incl. ESIs), RFIs and shop drawings across all jobs. QuickBooks sync can be added later." />
      <Tabs current={type} items={[
        { key: "co", label: "Change orders / ESIs", href: "/claims?type=co", count: coRows.filter((r) => r.bucket !== "approvedInvoiced" && r.bucket !== "rejected").length },
        { key: "rfi", label: "RFIs", href: "/claims?type=rfi", count: rfiRows.filter((r) => r.rfi.status === "OPEN").length },
        { key: "sd", label: "Shop drawings", href: "/claims?type=sd", count: sdRows.filter((r) => r.bucket === "submitted").length },
      ]} />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {BUCKETS.filter((b) => type === "co" || !["approvedWithPo", "approvedInvoiced"].includes(b.key)).map((b) => (
          <Link key={b.key} href={bucket === b.key ? qs() : qs(b.key)} className={clsx("rounded-lg", bucket === b.key && "ring-2 ring-brand-500")}>
            <Stat label={type === "rfi" && b.key === "approvedNotInvoiced" ? "Answered / closed" : type === "sd" && b.key === "approvedNotInvoiced" ? "Approved" : b.label} value={count(b.key)} sub={type === "co" && showMoney ? money(sum(coRows.filter((r) => r.bucket === b.key).map((r) => r.value))) : undefined} />
          </Link>
        ))}
      </div>

      {type === "co" ? (
        <Card bodyClass="overflow-x-auto">
          {(() => {
            const list = coRows.filter((r) => !bucket || r.bucket === bucket);
            if (!list.length) return <div className="p-4"><Empty>Nothing here.</Empty></div>;
            return (
              <table className="table">
                <thead><tr><th>CO #</th><th>Job</th><th>Title</th><th>Source</th><th>Status</th><th>Client PO</th>{showMoney ? <><th className="num">Value</th><th className="num">Invoiced</th></> : null}</tr></thead>
                <tbody>
                  {list.map(({ co, invoiced, value }) => (
                    <tr key={co.id}>
                      <td className="font-mono text-xs"><Link className="link" href={`/jobs/${co.projectId}/changes/${co.id}`}>{co.number}</Link></td>
                      <td className="text-xs"><Link className="hover:text-brand-700" href={`/jobs/${co.projectId}`}>{co.project.number}</Link><div className="text-slate-500">{co.project.name}</div></td>
                      <td>{co.title}</td>
                      <td className="text-xs">{co.esi ? `ESI ${co.esi.number}` : co.rfi ? `RFI ${co.rfi.number}` : "Direct"}</td>
                      <td><StatusBadge status={co.status} /></td>
                      <td className="text-xs">{co.clientPoNumber ?? "—"}</td>
                      {showMoney ? <><td className="num">{money(value)}</td><td className="num">{money(invoiced)}</td></> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </Card>
      ) : type === "rfi" ? (
        <Card bodyClass="overflow-x-auto">
          {(() => {
            const list = rfiRows.filter((r) => !bucket || r.bucket === bucket);
            if (!list.length) return <div className="p-4"><Empty>Nothing here.</Empty></div>;
            return (
              <table className="table">
                <thead><tr><th>RFI</th><th>Job</th><th>Subject</th><th>Sent</th><th>Required by</th><th>Status</th></tr></thead>
                <tbody>
                  {list.map(({ rfi }) => (
                    <tr key={rfi.id}>
                      <td className="font-mono text-xs"><Link className="link" href={`/jobs/${rfi.projectId}/changes`}>{rfi.number}</Link></td>
                      <td className="text-xs">{rfi.project.number}<div className="text-slate-500">{rfi.project.name}</div></td>
                      <td>{rfi.subject}</td>
                      <td className="text-xs">{fmtDate(rfi.sentAt)}</td>
                      <td className={clsx("text-xs", rfi.status === "OPEN" && rfi.requiredBy && rfi.requiredBy < t0 && "font-semibold text-red-600")}>{fmtDate(rfi.requiredBy)}</td>
                      <td><StatusBadge status={rfi.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </Card>
      ) : (
        <Card bodyClass="overflow-x-auto">
          {(() => {
            const list = sdRows.filter((r) => !bucket || r.bucket === bucket);
            if (!list.length) return <div className="p-4"><Empty>Nothing here.</Empty></div>;
            return (
              <table className="table">
                <thead><tr><th>Drawing</th><th>Job</th><th>Title</th><th>Rev</th><th>Required by</th><th>Status</th></tr></thead>
                <tbody>
                  {list.map(({ sd, status }) => {
                    const rev = sd.revisions[0];
                    return (
                      <tr key={sd.id}>
                        <td className="font-mono text-xs"><Link className="link" href={`/jobs/${sd.projectId}/shop-drawings#${sd.id}`}>{sd.number}</Link></td>
                        <td className="text-xs">{sd.project.number}<div className="text-slate-500">{sd.project.name}</div></td>
                        <td>{sd.title}</td>
                        <td>{rev?.revision ?? 0}</td>
                        <td className={clsx("text-xs", ["SUBMITTED", "UNDER_REVIEW"].includes(status) && rev?.requiredBy && rev.requiredBy < t0 && "font-semibold text-red-600")}>{fmtDate(rev?.requiredBy)}</td>
                        <td><StatusBadge status={status} label={SD_STATUS_LABELS[status]} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </Card>
      )}
    </div>
  );
}
