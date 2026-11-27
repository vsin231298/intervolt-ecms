import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { PageHeader } from "@/components/ui";
import { WorkOrderView } from "@/components/WorkOrderView";
import { workOrderForOffice } from "@/services/labour";

/** Office: one submitted work order. */
export default async function OfficeWorkOrder({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const s = await workOrderForOffice(user, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        crumbs={[{ href: "/work-orders", label: "Work Orders" }]}
        title={`${s.project.number} ${s.project.name}`}
        subtitle={`${s.submittedBy} · ${fmtDateTime(s.createdAt)}${s.forDate ? ` · requested, for ${s.forDate.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}` : ""}${s.project.location ? ` · ${s.project.location}` : ""}`}
        actions={<div className="flex gap-2"><Link className="btn btn-primary" href={`/billing/${s.project.id}`}>Billing sheet</Link><Link className="btn btn-secondary" href={`/jobs/${s.project.id}/site`}>Open job</Link></div>}
      />
      <WorkOrderView s={s} submittedBy={s.submittedBy} />
    </div>
  );
}
