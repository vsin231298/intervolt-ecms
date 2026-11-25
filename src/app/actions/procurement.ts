"use server";

import { run, str, filesFrom, type ActionState } from "@/lib/action";
import { zBool } from "@/lib/forms";
import { parseDate } from "@/lib/dates";
import { UserError } from "@/lib/errors";
import * as proc from "@/services/procurement";
import * as sd from "@/services/shopDrawings";
import { uploadDocument } from "@/services/documents";

function rows(fd: FormData, fields: string[]) {
  const cols = fields.map((f) => fd.getAll(f).map(String));
  const n = Math.max(...cols.map((c) => c.length));
  const out: Record<string, string>[] = [];
  for (let i = 0; i < n; i++) {
    const r = Object.fromEntries(fields.map((f, j) => [f.replace(/^line_/, ""), cols[j][i] ?? ""]));
    if (Object.values(r).some((v) => v.trim())) out.push(r);
  }
  return out;
}

export async function createPoAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const lines = rows(fd, ["line_description", "line_quantity", "line_unit", "line_unitCost", "line_materialItemId"]).filter((l) => l.description);
    const po = await proc.createPurchaseOrder(actor, str(d.projectId), proc.poSchema.parse({ ...d, shopDrawingsRequired: zBool.parse(d.shopDrawingsRequired ?? ""), lines }));
    return { redirectTo: `/jobs/${str(d.projectId)}/procurement/${po.id}` };
  });
}
export async function poFromQuoteAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const po = await proc.createPoFromQuote(actor, str(d.quoteId), { shopDrawingsRequired: zBool.parse(d.shopDrawingsRequired ?? ""), expectedDelivery: parseDate(str(d.expectedDelivery)) ?? undefined });
    return { redirectTo: `/jobs/${po.projectId}/procurement/${po.id}` };
  });
}
export async function issuePoAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await proc.issuePurchaseOrder(actor, str(d.poId))));
}
export async function cancelPoAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await proc.cancelPurchaseOrder(actor, str(d.poId), str(d.reason))));
}
export async function poExpectedAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await proc.updatePoExpected(actor, str(d.poId), parseDate(str(d.expectedDelivery)))));
}
export async function overrideGateAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await proc.overrideDeliveryGate(actor, str(d.poId), str(d.reason))));
}
export async function receiveAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const quantities: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("qty_")) quantities[k.slice(4)] = String(v);
    const r = await proc.receiveDelivery(actor, str(d.poId), proc.receiptSchema.parse({ ...d, quantities }));
    for (const f of await filesFrom(fd, "files")) await uploadDocument(actor, { projectId: str(d.projectId), module: "PROCUREMENT", category: "Packing slip / delivery ticket", entityType: "Receipt", entityId: r.id }, f);
    return "Delivery recorded and tagged to the job.";
  });
}
export async function supplierInvoiceAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const lines = rows(fd, ["line_poLineId", "line_description", "line_quantity", "line_unitPrice"]).filter((l) => l.description && l.quantity && Number(l.quantity) > 0);
    const inv = await proc.recordSupplierInvoice(actor, str(d.projectId), proc.supplierInvoiceSchema.parse({ ...d, lines }));
    for (const f of await filesFrom(fd, "files")) await uploadDocument(actor, { projectId: str(d.projectId), module: "PROCUREMENT", category: "Supplier invoice", entityType: "SupplierInvoice", entityId: inv.id }, f);
    const fresh = await (await import("@/lib/db")).prisma.supplierInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    return fresh.matchStatus === "MATCHED" ? "Invoice recorded. 3-way match: PO, delivery and invoice agree." : `Invoice recorded with a 3-way match variance: ${fresh.matchNote}`;
  });
}
export async function supplierInvoiceOpAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const op = str(d.op);
    if (op === "approve") await proc.approveSupplierInvoice(actor, str(d.invoiceId), str(d.overrideReason) || undefined);
    else if (op === "dispute") await proc.disputeSupplierInvoice(actor, str(d.invoiceId), str(d.note) || "Disputed");
    else if (op === "recheck") await proc.recheckMatch(actor, str(d.invoiceId));
    else if (op === "pay") await proc.paySupplierInvoice(actor, str(d.invoiceId), proc.supplierPaymentSchema.parse(d));
    else throw new UserError("Unknown action");
  });
}
export async function materialRequestAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const lines = rows(fd, ["line_description", "line_quantity", "line_unit", "line_materialItemId"]).filter((l) => l.description);
    await proc.createMaterialRequest(actor, str(d.projectId), proc.materialRequestSchema.parse({ ...d, lines }));
    return "Material request sent to procurement.";
  });
}
export async function cancelMaterialRequestAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await proc.cancelMaterialRequest(actor, str(d.id))));
}
export async function manualMaterialAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await proc.addManualMaterial(actor, str(d.projectId), proc.manualMaterialSchema.parse(d))));
}
export async function manualMaterialStatusAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await proc.setManualMaterialStatus(actor, str(d.id), str(d.status) as "ORDERED")));
}
export async function usageAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const { workerForUser } = await import("@/services/labour");
    const w = await workerForUser(actor.id);
    await proc.logMaterialUsage(actor, str(d.projectId), proc.usageSchema.parse(d), w?.id);
    return "Material usage logged.";
  });
}

// ── Shop drawings ──
export async function createShopDrawingAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const [file] = await filesFrom(fd, "file");
    await sd.createShopDrawing(actor, str(d.projectId), sd.shopDrawingSchema.parse(d), file);
  });
}
export async function shopDrawingOpAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const id = str(d.shopDrawingId);
    const [file] = await filesFrom(fd, "file");
    switch (str(d.op)) {
      case "upload":
        if (!file) throw new UserError("Choose the drawing file.");
        await sd.uploadDrawingFile(actor, id, file);
        return "Drawing uploaded for Intervolt review.";
      case "pass":
        await sd.internalReview(actor, id, "PASS", str(d.notes) || undefined);
        return "Passed Intervolt review. Ready to submit to the client / consultant.";
      case "return":
        await sd.internalReview(actor, id, "RETURN", str(d.notes));
        return "Returned to preparer.";
      case "submit":
        await sd.submitToConsultant(actor, id, sd.submitSchema.parse(d));
        return "Submitted.";
      case "response":
        await sd.recordConsultantResponse(actor, id, sd.consultantResponseSchema.parse(d), file);
        return "Consultant response recorded.";
      default:
        throw new UserError("Unknown action");
    }
  });
}
