import { requireUser } from "@/lib/auth";
import { DocumentLibrary } from "@/components/DocumentLibrary";

export default async function JobDocuments({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const actor = await requireUser("documents.view");
  const { id } = await params;
  return <DocumentLibrary actor={actor} projectId={id} sp={await searchParams} basePath={`/jobs/${id}/documents`} />;
}
