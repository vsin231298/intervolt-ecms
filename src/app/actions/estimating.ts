"use server";

import { run, str, filesFrom, type ActionState } from "@/lib/action";
import * as est from "@/services/estimating";
import * as quotes from "@/services/quotes";
import * as sub from "@/services/submission";
import { uploadDocument } from "@/services/documents";
import { UserError } from "@/lib/errors";

export async function createEstimateAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const e = await est.createEstimate(actor, str(d.projectId), { basedOnId: str(d.basedOnId) || undefined, title: str(d.title) || undefined });
    return { redirectTo: `/jobs/${str(d.projectId)}/estimates/${e.id}` };
  });
}
export async function estimateRatesAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await est.updateEstimateRates(actor, str(d.estimateId), est.estimateRatesSchema.parse(d))));
}
export async function addLineAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await est.addEstimateLines(actor, str(d.estimateId), [est.estimateLineSchema.parse(d)])));
}
export async function pasteBomAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const lines = est.parseBomPaste(str(d.text), (str(d.category) || "MATERIAL") as "MATERIAL");
    if (!lines.length) throw new UserError("No rows found. Paste rows copied from Excel.");
    await est.addEstimateLines(actor, str(d.estimateId), lines.map((l) => ({ ...l, section: str(d.section) || undefined })));
    return `${lines.length} line(s) imported.`;
  });
}
export async function updateLineAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await est.updateEstimateLine(actor, str(d.lineId), est.estimateLineSchema.parse(d))));
}
export async function deleteLineAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await est.deleteEstimateLine(actor, str(d.lineId))));
}
export async function finalizeEstimateAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await est.finalizeEstimate(actor, str(d.estimateId));
    return "Revision finalized and locked.";
  });
}
export async function estimateDocAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const files = await filesFrom(fd, "files");
    if (!files.length) throw new UserError("Choose a file.");
    for (const f of files) await uploadDocument(actor, { projectId: str(d.projectId), module: "ESTIMATE", category: str(d.category) || "Drawings", entityType: "Estimate", entityId: str(d.estimateId) }, f);
  });
}

// ── Supplier quotes ──
export async function createRfqAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const rfq = await quotes.createRfq(actor, str(d.estimateId), quotes.rfqSchema.parse({ ...d, supplierIds: d.supplierIds ?? [], lineIds: d.lineIds ?? [] }));
    return { redirectTo: `/jobs/${str(d.projectId)}/quotes/${rfq.id}` };
  });
}
export async function addRfqSupplierAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await quotes.addRfqSupplier(actor, str(d.rfqId), str(d.supplierId))));
}
export async function rfqSupplierStatusAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const { parseDate } = await import("@/lib/dates");
    await quotes.setRfqSupplierStatus(actor, str(d.id), str(d.op) as "SENT", parseDate(str(d.followUpDate)) ?? undefined);
  });
}
export async function recordQuoteAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const prices: Record<string, string> = {};
    const leadTimes: Record<string, string> = {};
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("price_")) prices[k.slice(6)] = String(v);
      if (k.startsWith("lead_")) leadTimes[k.slice(5)] = String(v);
    }
    const q = await quotes.recordSupplierQuote(actor, str(d.rfqId), quotes.supplierQuoteSchema.parse({ ...d, prices, leadTimes }));
    for (const f of await filesFrom(fd, "files")) await uploadDocument(actor, { projectId: str(d.projectId), module: "QUOTE", category: "Supplier quotation", entityType: "SupplierQuote", entityId: q.id }, f);
    return "Quotation recorded.";
  });
}
export async function selectQuoteLineAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await quotes.selectQuoteLine(actor, str(d.itemId), str(d.lineId) || null)));
}
export async function selectAllAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const n = await quotes.selectAll(actor, str(d.rfqId), str(d.quoteId) ? { kind: "quote", quoteId: str(d.quoteId) } : { kind: "lowest" });
    return `${n} item(s) selected.`;
  });
}
export async function applyQuotesAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const n = await quotes.applySelectionsToEstimate(actor, str(d.rfqId), str(d.estimateId));
    return `Supplier prices applied to ${n} BOM line(s).`;
  });
}

// ── Submission ──
export async function prepareSubmissionAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await sub.prepareSubmission(actor, str(d.projectId), sub.prepareSchema.parse(d))));
}
export async function approvePriceAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await sub.approvePrice(actor, str(d.submissionId))));
}
export async function recordSubmittedAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    await sub.recordSubmitted(actor, str(d.submissionId), sub.submittedSchema.parse(d));
    for (const f of await filesFrom(fd, "files")) await uploadDocument(actor, { projectId: str(d.projectId), module: "SUBMISSION", category: "Submitted tender", entityType: "TenderSubmission", entityId: str(d.submissionId), approvalStatus: "APPROVED" }, f);
    return "Tender recorded as submitted.";
  });
}
export async function outcomeAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    await sub.recordOutcome(actor, str(d.submissionId), sub.outcomeSchema.parse(d));
    for (const f of await filesFrom(fd, "files")) await uploadDocument(actor, { projectId: str(d.projectId), module: "CONTRACT", category: "Client purchase order", approvalStatus: "APPROVED" }, f);
    return d.outcome === "AWARDED" ? { redirectTo: `/jobs/${str(d.projectId)}` } : "Recorded as lost bid. The job is closed.";
  });
}
