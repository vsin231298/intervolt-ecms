import { z } from "zod";
import type { ShopDrawingStatus } from "@prisma/client";
import { tx } from "@/lib/db";
import { requirePerm, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { zDateTime, zOptDate, zOptId, zOptText, zText } from "@/lib/forms";
import { notifyRoles, notifyUsers } from "@/lib/notify";
import { loadProject } from "./projects";
import { uploadDocument, type UploadFile } from "./documents";

export const SD_STATUS_LABELS: Record<ShopDrawingStatus, string> = {
  IN_PREPARATION: "In preparation",
  INTERNAL_REVIEW: "Intervolt review",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  APPROVED_AS_NOTED: "Approved as noted",
  REVISE_AND_RESUBMIT: "Revise and resubmit",
};

export const shopDrawingSchema = z.object({
  number: zOptText(50),
  title: zText(300),
  specSection: zOptText(50),
  purchaseOrderId: zOptId,
  supplierId: zOptId,
  requiredBy: zOptDate,
});

export async function createShopDrawing(actor: Actor, projectId: string, input: z.infer<typeof shopDrawingSchema>, file?: UploadFile) {
  requirePerm(actor, "shopdrawing.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(["ACTIVATION", "EXECUTION", "CLOSEOUT"].includes(p.stage), "Shop drawings are tracked on active jobs.");
    if (input.purchaseOrderId) {
      const po = await t.purchaseOrder.findUnique({ where: { id: input.purchaseOrderId } });
      assert(po && po.projectId === projectId, "PO not found on this job.");
      if (!input.supplierId) input.supplierId = po.supplierId;
      if (!po.shopDrawingsRequired) await t.purchaseOrder.update({ where: { id: po.id }, data: { shopDrawingsRequired: true } });
    }
    const count = await t.shopDrawing.count({ where: { projectId } });
    const number = input.number || `SD-${String(count + 1).padStart(3, "0")}`;
    const exists = await t.shopDrawing.findUnique({ where: { projectId_number: { projectId, number } } });
    if (exists) throw new UserError(`Shop drawing ${number} already exists on this job.`);
    const sd = await t.shopDrawing.create({ data: { projectId, number, title: input.title, specSection: input.specSection, purchaseOrderId: input.purchaseOrderId, supplierId: input.supplierId } });
    let documentId: string | undefined;
    if (file) documentId = (await uploadDocument(actor, { projectId, module: "SHOP_DRAWING", category: "Shop drawing", title: `${number} ${input.title}`, entityType: "ShopDrawing", entityId: sd.id, revisionLabel: "Rev 0" }, file, t)).documentId;
    await t.shopDrawingRevision.create({ data: { shopDrawingId: sd.id, revision: 0, status: file ? "INTERNAL_REVIEW" : "IN_PREPARATION", preparedById: actor.id, requiredBy: input.requiredBy, documentId } });
    await audit(t, actor, { action: "shopdrawing.create", entityType: "ShopDrawing", entityId: sd.id, projectId, summary: `${p.number}: shop drawing ${number} "${input.title}" created${input.purchaseOrderId ? " (linked to PO)" : ""}` });
    if (file && p.projectManagerId) await notifyUsers(t, [p.projectManagerId], { type: "shopdrawing.review", title: `Shop drawing ${number} ready for Intervolt review`, link: `/jobs/${projectId}/shop-drawings`, projectId }, actor.id);
    return sd;
  });
}

async function latestRevision(t: Parameters<Parameters<typeof tx>[0]>[0], shopDrawingId: string) {
  const sd = await t.shopDrawing.findUnique({ where: { id: shopDrawingId }, include: { revisions: { orderBy: { revision: "desc" }, take: 1 }, project: true } });
  if (!sd) throw new NotFoundError("Shop drawing");
  return { sd, rev: sd.revisions[0] };
}

/** Upload the drawing file for the current revision (or attach a revised drawing). Never overwrites. */
export async function uploadDrawingFile(actor: Actor, shopDrawingId: string, file: UploadFile) {
  requirePerm(actor, "shopdrawing.edit");
  return tx(async (t) => {
    const { sd, rev } = await latestRevision(t, shopDrawingId);
    assert(["IN_PREPARATION", "INTERNAL_REVIEW"].includes(rev.status), "This revision has been submitted. Revised drawings go on a new revision.");
    const up = await uploadDocument(actor, { projectId: sd.projectId, module: "SHOP_DRAWING", category: "Shop drawing", title: `${sd.number} ${sd.title}`, entityType: "ShopDrawing", entityId: sd.id, documentId: rev.documentId ?? undefined, revisionLabel: `Rev ${rev.revision}` }, file, t);
    await t.shopDrawingRevision.update({ where: { id: rev.id }, data: { documentId: up.documentId, status: "INTERNAL_REVIEW", internalReviewAt: null, internalReviewById: null } });
    await audit(t, actor, { action: "shopdrawing.upload", entityType: "ShopDrawing", entityId: sd.id, projectId: sd.projectId, summary: `${sd.number} rev ${rev.revision}: drawing uploaded for Intervolt review` });
    if (sd.project.projectManagerId) await notifyUsers(t, [sd.project.projectManagerId], { type: "shopdrawing.review", title: `Shop drawing ${sd.number} rev ${rev.revision} ready for Intervolt review`, link: `/jobs/${sd.projectId}/shop-drawings`, projectId: sd.projectId }, actor.id);
  });
}

/** Intervolt internal review: pass (ready to submit to consultant) or return to preparer. */
export async function internalReview(actor: Actor, shopDrawingId: string, decision: "PASS" | "RETURN", notes?: string) {
  requirePerm(actor, "shopdrawing.decide");
  return tx(async (t) => {
    const { sd, rev } = await latestRevision(t, shopDrawingId);
    assert(rev.status === "INTERNAL_REVIEW", "This revision is not awaiting Intervolt review.");
    assert(rev.documentId, "Upload the drawing before reviewing.");
    if (decision === "RETURN") assert(notes && notes.trim().length > 2, "Add review notes when returning a drawing.");
    await t.shopDrawingRevision.update({ where: { id: rev.id }, data: { internalReviewAt: new Date(), internalReviewById: actor.id, internalReviewNotes: notes, status: decision === "PASS" ? "INTERNAL_REVIEW" : "IN_PREPARATION" } });
    await audit(t, actor, { action: "shopdrawing.internalReview", entityType: "ShopDrawing", entityId: sd.id, projectId: sd.projectId, summary: `${sd.number} rev ${rev.revision}: Intervolt review ${decision === "PASS" ? "passed" : "returned"}${notes ? ` — ${notes}` : ""}` });
  });
}

export const submitSchema = z.object({ submittedAt: zDateTime, requiredBy: zOptDate });

export async function submitToConsultant(actor: Actor, shopDrawingId: string, input: z.infer<typeof submitSchema>) {
  requirePerm(actor, "shopdrawing.edit");
  return tx(async (t) => {
    const { sd, rev } = await latestRevision(t, shopDrawingId);
    assert(rev.status === "INTERNAL_REVIEW" && rev.internalReviewAt && rev.documentId, "The drawing must pass Intervolt review before it is submitted.");
    await t.shopDrawingRevision.update({ where: { id: rev.id }, data: { status: "SUBMITTED", submittedAt: input.submittedAt, requiredBy: input.requiredBy ?? rev.requiredBy } });
    await audit(t, actor, { action: "shopdrawing.submit", entityType: "ShopDrawing", entityId: sd.id, projectId: sd.projectId, summary: `${sd.number} rev ${rev.revision}: submitted to client / consultant` });
  });
}

export const consultantResponseSchema = z.object({
  status: z.enum(["UNDER_REVIEW", "APPROVED", "APPROVED_AS_NOTED", "REVISE_AND_RESUBMIT"]),
  returnedAt: zOptDate,
  consultantComments: zOptText(),
});

/** Decision branch: Approved / Approved as noted → alert procurement; Revise and resubmit → new revision. */
export async function recordConsultantResponse(actor: Actor, shopDrawingId: string, input: z.infer<typeof consultantResponseSchema>, markedUpFile?: UploadFile) {
  requirePerm(actor, "shopdrawing.decide");
  return tx(async (t) => {
    const { sd, rev } = await latestRevision(t, shopDrawingId);
    assert(["SUBMITTED", "UNDER_REVIEW"].includes(rev.status), "This revision is not with the consultant.");
    if (input.status === "REVISE_AND_RESUBMIT" || input.status === "APPROVED_AS_NOTED") {
      assert(input.consultantComments || markedUpFile, "Record the consultant comments or attach the marked-up drawing.");
    }
    const done = input.status !== "UNDER_REVIEW";
    if (markedUpFile) {
      await uploadDocument(actor, { projectId: sd.projectId, module: "SHOP_DRAWING", category: "Consultant review", title: `${sd.number} rev ${rev.revision} — consultant response`, entityType: "ShopDrawing", entityId: sd.id }, markedUpFile, t);
    }
    await t.shopDrawingRevision.update({
      where: { id: rev.id },
      data: {
        status: input.status,
        consultantComments: input.consultantComments ?? rev.consultantComments,
        returnedAt: done ? input.returnedAt ?? new Date() : null,
        approvedAt: input.status === "APPROVED" || input.status === "APPROVED_AS_NOTED" ? input.returnedAt ?? new Date() : null,
      },
    });
    if (input.status === "APPROVED" || input.status === "APPROVED_AS_NOTED") {
      if (rev.documentId) {
        const latest = await t.documentVersion.findFirst({ where: { documentId: rev.documentId }, orderBy: { revision: "desc" } });
        if (latest) {
          await t.documentVersion.updateMany({ where: { documentId: rev.documentId, approvalStatus: "APPROVED" }, data: { approvalStatus: "SUPERSEDED" } });
          await t.documentVersion.update({ where: { id: latest.id }, data: { approvalStatus: "APPROVED", approvedAt: new Date() } });
        }
      }
      await notifyRoles(t, ["PROCUREMENT"], { type: "shopdrawing.approved", title: `Shop drawing approved: ${sd.number} ${sd.title}`, body: `${sd.project.number} — materials can proceed${sd.purchaseOrderId ? " to delivery" : ""}`, link: `/jobs/${sd.projectId}/shop-drawings`, projectId: sd.projectId }, actor.id);
      if (sd.project.projectManagerId) await notifyUsers(t, [sd.project.projectManagerId], { type: "shopdrawing.approved", title: `Shop drawing ${SD_STATUS_LABELS[input.status].toLowerCase()}: ${sd.number}`, link: `/jobs/${sd.projectId}/shop-drawings`, projectId: sd.projectId }, actor.id);
    }
    if (input.status === "REVISE_AND_RESUBMIT") {
      await t.shopDrawingRevision.create({ data: { shopDrawingId: sd.id, revision: rev.revision + 1, status: "IN_PREPARATION", documentId: rev.documentId, requiredBy: rev.requiredBy } });
      if (sd.project.projectManagerId) await notifyUsers(t, [sd.project.projectManagerId], { type: "shopdrawing.rar", title: `Revise and resubmit: ${sd.number} ${sd.title}`, body: input.consultantComments, link: `/jobs/${sd.projectId}/shop-drawings`, projectId: sd.projectId }, actor.id);
    }
    await audit(t, actor, { action: "shopdrawing.response", entityType: "ShopDrawing", entityId: sd.id, projectId: sd.projectId, summary: `${sd.number} rev ${rev.revision}: ${SD_STATUS_LABELS[input.status]}${input.consultantComments ? ` — ${input.consultantComments}` : ""}`, before: { status: rev.status }, after: { status: input.status } });
  });
}
