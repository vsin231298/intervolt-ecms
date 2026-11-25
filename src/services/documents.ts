import { prisma, tx, type Tx } from "@/lib/db";
import { requirePerm, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { can } from "@/lib/rbac";
import { ForbiddenError, NotFoundError, UserError, assert } from "@/lib/errors";
import { makeStorageKey, sha256, storage, validateUpload } from "@/lib/storage";
import type { ApprovalStatus } from "@prisma/client";

export type UploadFile = { name: string; type: string; data: Buffer };

export type UploadMeta = {
  projectId?: string | null;
  folderId?: string | null;
  module: string;
  category: string;
  title?: string;
  entityType?: string;
  entityId?: string;
  workerId?: string | null;
  expiresAt?: Date | null;
  revisionLabel?: string;
  note?: string;
  /** Upload as a new version of this existing document. */
  documentId?: string;
  approvalStatus?: ApprovalStatus;
};

/** Store a file and return the stored version. Files are never overwritten. */
export async function storeFile(file: UploadFile) {
  const err = validateUpload(file.name, file.data.length);
  if (err) throw new UserError(err);
  const key = makeStorageKey(file.name);
  await storage().put(key, file.data, file.type || "application/octet-stream");
  return { key, hash: sha256(file.data) };
}

/**
 * Upload a document (or a new revision). Can run inside an existing transaction (`t`) so that
 * a business record and its attachment are created together.
 */
export async function uploadDocument(actor: Actor, meta: UploadMeta, file: UploadFile, t?: Tx) {
  if (!can(actor.role, "documents.upload") && !can(actor.role, "field.use")) throw new ForbiddenError();
  if (!meta.projectId) requirePerm(actor, "company.documents");
  const stored = await storeFile(file);
  const run = async (t: Tx) => {
    let docId = meta.documentId;
    let revision = 1;
    if (docId) {
      const doc = await t.document.findUnique({ where: { id: docId }, include: { versions: { orderBy: { revision: "desc" }, take: 1 } } });
      if (!doc) throw new NotFoundError("Document");
      revision = (doc.versions[0]?.revision ?? 0) + 1;
      await t.document.update({ where: { id: docId }, data: { updatedAt: new Date(), ...(meta.expiresAt !== undefined ? { expiresAt: meta.expiresAt } : {}) } });
    } else {
      let folderId = meta.folderId ?? null;
      if (!folderId && meta.projectId) folderId = await defaultFolderFor(t, meta.projectId, meta.module);
      const doc = await t.document.create({
        data: {
          projectId: meta.projectId ?? null,
          folderId,
          module: meta.module,
          category: meta.category,
          title: meta.title?.trim() || file.name,
          entityType: meta.entityType,
          entityId: meta.entityId,
          workerId: meta.workerId ?? null,
          expiresAt: meta.expiresAt ?? null,
        },
      });
      docId = doc.id;
    }
    const v = await t.documentVersion.create({
      data: {
        documentId: docId!,
        revision,
        revisionLabel: meta.revisionLabel,
        storageKey: stored.key,
        fileName: file.name.slice(0, 250),
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.data.length,
        sha256: stored.hash,
        note: meta.note,
        approvalStatus: meta.approvalStatus ?? "NONE",
        uploadedById: actor.id,
      },
    });
    await audit(t, actor, {
      action: revision > 1 ? "document.revise" : "document.upload",
      entityType: "Document",
      entityId: docId!,
      projectId: meta.projectId ?? null,
      summary: `${revision > 1 ? `Revision ${revision} uploaded` : "Uploaded"}: ${file.name}`,
    });
    return { documentId: docId!, versionId: v.id, revision };
  };
  return t ? run(t) : tx(run);
}

const MODULE_FOLDER: Record<string, string> = {
  TENDER: "Tender Documents",
  ESTIMATE: "Estimates",
  QUOTE: "Supplier Quotes",
  SUBMISSION: "Submission",
  CONTRACT: "Contract & POs",
  SHOP_DRAWING: "Shop Drawings",
  PROCUREMENT: "Procurement",
  SITE: "Site Reports & Photos",
  FIELD: "Site Reports & Photos",
  RFI: "RFIs & ESIs",
  CHANGE: "Change Orders",
  BILLING: "Billing",
  INSPECTION: "Inspections",
  COMMISSIONING: "Commissioning",
  CLOSEOUT: "Closeout",
};

async function defaultFolderFor(t: Tx, projectId: string, module: string) {
  const name = MODULE_FOLDER[module];
  if (!name) return null;
  const f = await t.documentFolder.upsert({
    where: { projectId_name: { projectId, name } },
    create: { projectId, name, sortOrder: 100 },
    update: {},
  });
  return f.id;
}

/** Approve / reject a version. Approving supersedes earlier approved versions (their files remain). */
export async function setVersionApproval(actor: Actor, versionId: string, status: "APPROVED" | "REJECTED" | "PENDING") {
  requirePerm(actor, "documents.approve");
  return tx(async (t) => {
    const v = await t.documentVersion.findUnique({ where: { id: versionId }, include: { document: true } });
    if (!v) throw new NotFoundError("Document version");
    if (status === "APPROVED") {
      await t.documentVersion.updateMany({
        where: { documentId: v.documentId, approvalStatus: "APPROVED", id: { not: versionId } },
        data: { approvalStatus: "SUPERSEDED" },
      });
    }
    await t.documentVersion.update({ where: { id: versionId }, data: { approvalStatus: status, approvedAt: status === "APPROVED" ? new Date() : null } });
    await audit(t, actor, {
      action: "document.approval",
      entityType: "Document",
      entityId: v.documentId,
      projectId: v.document.projectId,
      summary: `${v.document.title} rev ${v.revision} marked ${status.toLowerCase()}`,
      before: { approvalStatus: v.approvalStatus },
      after: { approvalStatus: status },
    });
  });
}

/** Permission check + bytes for a download. Field users may only download files of jobs assigned to them. */
export async function readVersionForDownload(actor: Actor, versionId: string) {
  const v = await prisma.documentVersion.findUnique({ where: { id: versionId }, include: { document: true } });
  if (!v) throw new NotFoundError("File");
  if (!can(actor.role, "documents.view")) {
    assert(v.document.projectId, "Not permitted.");
    const ok = await isAssignedToProject(actor, v.document.projectId!);
    if (!ok) throw new ForbiddenError();
  }
  if (!v.document.projectId && !can(actor.role, "company.documents") && !can(actor.role, "documents.view")) throw new ForbiddenError();
  const data = await storage().get(v.storageKey);
  return { version: v, data };
}

export async function isAssignedToProject(actor: Actor, projectId: string) {
  const worker = await prisma.worker.findUnique({ where: { userId: actor.id } });
  const [member, assignment] = await Promise.all([
    prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: actor.id } } }),
    worker ? prisma.labourAssignment.findFirst({ where: { projectId, workerId: worker.id } }) : null,
  ]);
  return !!member || !!assignment;
}

export async function documentsFor(entityType: string, entityId: string) {
  return prisma.document.findMany({
    where: { entityType, entityId },
    include: { versions: { orderBy: { revision: "desc" }, include: { uploadedBy: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
}
