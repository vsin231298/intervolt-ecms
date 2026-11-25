import { Download, FileText } from "lucide-react";
import { documentsFor } from "@/services/documents";
import { fmtDateTime } from "@/lib/dates";
import { StatusBadge } from "./ui";

export function fileSize(n: number) {
  return n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Attachments of a record (all versions kept, newest first). */
export async function DocList({ entityType, entityId, empty = null }: { entityType: string; entityId: string; empty?: React.ReactNode }) {
  const docs = await documentsFor(entityType, entityId);
  if (!docs.length) return <>{empty}</>;
  return (
    <ul className="space-y-1.5 text-sm">
      {docs.map((doc) => {
        const latest = doc.versions[0];
        return (
          <li key={doc.id} className="flex flex-wrap items-center gap-2">
            <FileText className="h-4 w-4 text-slate-400" />
            <a className="link" href={`/api/files/${latest.id}?inline=1`} target="_blank" rel="noreferrer">{doc.title}</a>
            <span className="text-xs text-slate-500">rev {latest.revision} · {fileSize(latest.sizeBytes)} · {latest.uploadedBy.name} · {fmtDateTime(latest.uploadedAt)}</span>
            {latest.approvalStatus !== "NONE" ? <StatusBadge status={latest.approvalStatus} /> : null}
            <a href={`/api/files/${latest.id}`} className="text-slate-400 hover:text-brand-600" aria-label="Download"><Download className="h-4 w-4" /></a>
            {doc.versions.length > 1 ? (
              <details className="w-full pl-6 text-xs text-slate-500">
                <summary className="cursor-pointer">{doc.versions.length - 1} earlier revision(s)</summary>
                <ul className="mt-1 space-y-0.5">
                  {doc.versions.slice(1).map((v) => (
                    <li key={v.id}><a className="link" href={`/api/files/${v.id}`}>rev {v.revision} — {v.fileName}</a> · {fmtDateTime(v.uploadedAt)} {v.approvalStatus !== "NONE" ? `· ${v.approvalStatus.toLowerCase()}` : ""}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
