"use server";

import { run, str, filesFrom, type ActionState } from "@/lib/action";
import { parseDate } from "@/lib/dates";
import { UserError } from "@/lib/errors";
import { setVersionApproval, uploadDocument } from "@/services/documents";

export async function uploadAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const files = await filesFrom(fd, "files");
    if (!files.length) throw new UserError("Choose at least one file.");
    if (str(d.documentId) && files.length > 1) throw new UserError("Upload one file as the new revision.");
    for (const f of files) {
      await uploadDocument(actor, {
        projectId: str(d.projectId) || null,
        folderId: str(d.folderId) || null,
        module: str(d.module) || (str(d.projectId) ? "GENERAL" : "COMPANY"),
        category: str(d.category) || "General",
        title: files.length === 1 ? str(d.title) || undefined : undefined,
        documentId: str(d.documentId) || undefined,
        revisionLabel: str(d.revisionLabel) || undefined,
        note: str(d.note) || undefined,
        workerId: str(d.workerId) || null,
        expiresAt: parseDate(str(d.expiresAt)),
      }, f);
    }
    return `${files.length} file(s) uploaded.`;
  });
}

export async function approvalAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await setVersionApproval(actor, str(d.versionId), str(d.status) as "APPROVED")));
}
