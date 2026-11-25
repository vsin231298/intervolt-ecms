import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CLOSE_REASON_LABELS, JOB_TYPE_LABELS, STAGE_LABELS } from "@/lib/workflow";
import { Badge, StatusBadge } from "@/components/ui";
import { JobTabs } from "@/components/JobTabs";

export default async function JobLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireUser("jobs.view");
  const { id } = await params;
  const p = await prisma.project.findUnique({
    where: { id },
    include: {
      client: true,
      projectManager: true,
      _count: {
        select: {
          rfis: { where: { status: "OPEN" } },
          changeOrders: { where: { status: { in: ["DRAFT", "SUBMITTED"] } } },
          deficiencies: { where: { status: { not: "COMPLETED" } } },
          tasks: { where: { status: { not: "DONE" } } },
          fieldUpdates: { where: { kind: "ISSUE", resolvedAt: null } },
        },
      },
    },
  });
  if (!p) notFound();
  const isProject = p.jobType === "PROJECT";
  const base = `/jobs/${p.id}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/info`, label: "Info & Team" },
    { href: `${base}/documents`, label: "Documents" },
    ...(isProject ? [{ href: `${base}/estimates`, label: "Estimates & BOM" }, { href: `${base}/quotes`, label: "Supplier Quotes" }, { href: `${base}/submission`, label: "Tender Submission" }] : []),
    { href: `${base}/tasks`, label: "Schedule & Tasks", count: p._count.tasks },
    { href: `${base}/procurement`, label: "Purchase Orders" },
    ...(isProject || p.stage !== "EXECUTION" ? [{ href: `${base}/shop-drawings`, label: "Shop Drawings" }] : [{ href: `${base}/shop-drawings`, label: "Shop Drawings" }]),
    { href: `${base}/materials`, label: "Materials" },
    { href: `${base}/labour`, label: "Labour" },
    { href: `${base}/site`, label: "Site Reports", count: p._count.fieldUpdates },
    { href: `${base}/changes`, label: "RFIs, ESIs & Changes", count: p._count.rfis + p._count.changeOrders },
    { href: `${base}/billing`, label: "Billing & Payments" },
    { href: `${base}/inspections`, label: "Inspections & Commissioning", count: p._count.deficiencies },
    { href: `${base}/closeout`, label: "Closeout" },
    { href: `${base}/activity`, label: "Activity" },
  ];
  return (
    <div>
      <div className="mb-4">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Link href={isProject && ["OPPORTUNITY", "UNDER_REVIEW", "ESTIMATING", "QUOTING", "READY_TO_SUBMIT", "SUBMITTED"].includes(p.stage) ? "/leads" : "/jobs"} className="hover:text-brand-600">{isProject && ["OPPORTUNITY", "UNDER_REVIEW", "ESTIMATING", "QUOTING", "READY_TO_SUBMIT", "SUBMITTED"].includes(p.stage) ? "Leads & tenders" : "Jobs"}</Link>
          <span>/</span>
          <span className="font-mono">{p.number}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold sm:text-2xl">{p.name}</h1>
          <StatusBadge status={p.stage === "CLOSED" && p.closeReason ? p.closeReason : p.stage} label={p.stage === "CLOSED" && p.closeReason ? `Closed · ${CLOSE_REASON_LABELS[p.closeReason]}` : STAGE_LABELS[p.stage]} />
          <Badge>{JOB_TYPE_LABELS[p.jobType]}</Badge>
        </div>
        <div className="mt-1 text-sm text-slate-500">
          <span className="font-mono font-medium text-slate-700">{p.number}</span>
          {p.client ? <> · {p.client.name}</> : null}
          {p.location ? <> · {p.location}</> : null}
          {p.projectManager ? <> · PM {p.projectManager.name}</> : null}
        </div>
      </div>
      <JobTabs tabs={tabs} />
      {children}
    </div>
  );
}
