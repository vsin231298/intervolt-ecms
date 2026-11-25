import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Tabs } from "@/components/ui";
import { DocumentLibrary } from "@/components/DocumentLibrary";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ scope?: string; q?: string; module?: string; category?: string; filter?: string }> }) {
  const user = await requireUser();
  if (!can(user.role, "documents.view") && !can(user.role, "company.documents")) redirect("/forbidden");
  const sp = await searchParams;
  const scope = sp.scope === "all" && can(user.role, "documents.view") ? "all" : "company";
  return (
    <div className="space-y-6">
      <PageHeader title="Documents" subtitle="Company library (certificates, WSIB, insurance, safety, templates and forms) and a search across every job's documents. Approved revisions are never overwritten." />
      <Tabs current={scope} items={[
        { key: "company", label: "Company library", href: "/documents?scope=company" },
        ...(can(user.role, "documents.view") ? [{ key: "all", label: "Search all documents", href: "/documents?scope=all" }] : []),
      ]} />
      <DocumentLibrary actor={user} companyOnly={scope === "company"} sp={{ ...sp, scope }} basePath="/documents" />
    </div>
  );
}
