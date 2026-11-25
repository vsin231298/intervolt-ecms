import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { PageHeader, Stat } from "@/components/ui";
import { JobsTable } from "@/components/JobsTable";

export const metadata = { title: "Leads & Tenders" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("jobs.view");
  const sp = await searchParams;
  const counts = await prisma.project.groupBy({ by: ["stage"], where: { jobType: "PROJECT" }, _count: true });
  const c = (s: string[]) => counts.filter((x) => s.includes(x.stage)).reduce((a, x) => a + x._count, 0);
  return (
    <div>
      <PageHeader title="Leads & tenders" subtitle="Tender invitations from receipt to award. Awarded tenders move to Active Jobs automatically with the same WO #." actions={can(user.role, "leads.edit") ? <Link href="/leads/new" className="btn btn-primary">New lead</Link> : null} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="New / in review" value={c(["OPPORTUNITY", "UNDER_REVIEW"])} href="/leads?stage=new" />
        <Stat label="Estimating & quoting" value={c(["ESTIMATING", "QUOTING"])} href="/leads?stage=pricing" />
        <Stat label="Ready to submit" value={c(["READY_TO_SUBMIT"])} href="/leads?stage=READY_TO_SUBMIT" />
        <Stat label="Submitted, awaiting result" value={c(["SUBMITTED"])} href="/leads?stage=SUBMITTED" />
      </div>
      <JobsTable sp={{ status: sp.status ?? (sp.stage ? undefined : "tenders"), ...sp }} basePath="/leads" leadsOnly />
    </div>
  );
}
