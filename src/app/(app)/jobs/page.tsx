import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { JobsTable, type SP } from "@/components/JobsTable";

export const metadata = { title: "Jobs" };


export default async function JobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("jobs.view");
  const sp = await searchParams;
  return (
    <div>
      <PageHeader title="All jobs" subtitle="Every lead, tender and job, tracked by its Work Order Number from day one." actions={<>
        {can(user.role, "leads.edit") ? <Link href="/leads/new" className="btn btn-secondary">New lead</Link> : null}
        {can(user.role, "jobs.create") ? <Link href="/jobs/new" className="btn btn-primary">New small job / service call</Link> : null}
      </>} />
      <JobsTable sp={sp} basePath="/jobs" />
    </div>
  );
}

