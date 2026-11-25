"use server";

import { run, str, type ActionState } from "@/lib/action";
import { zBool, zDate } from "@/lib/forms";
import * as b from "@/services/billing";

export async function sovAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const desc = fd.getAll("sov_description").map(String);
    const vals = fd.getAll("sov_value").map(String);
    const lines = desc.map((description, i) => ({ description, scheduledValue: vals[i] })).filter((l) => l.description.trim());
    await b.setBaseSchedule(actor, str(d.projectId), b.sovSchema.parse({ lines }));
    return "Schedule of values saved.";
  });
}
export async function createDrawAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const percents: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("pct_")) percents[k.slice(4)] = String(v);
    const dr = await b.createDraw(actor, str(d.projectId), b.drawSchema.parse({ ...d, percents }));
    return `Draw #${dr.drawNumber} prepared.`;
  });
}
export async function drawOpAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const op = str(d.op);
    if (op === "delete") await b.deleteDraftDraw(actor, str(d.drawId));
    else if (op === "invoice") await b.invoiceDraw(actor, str(d.drawId), { invoiceDate: zDate.parse(d.invoiceDate), clientPoId: str(d.clientPoId) || undefined });
    else await b.setDrawStatus(actor, str(d.drawId), op as "SUBMITTED" | "APPROVED");
  });
}
export async function manualInvoiceAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const inv = await b.createManualInvoice(actor, str(d.projectId), b.manualInvoiceSchema.parse({ ...d, applyHoldback: zBool.parse(d.applyHoldback ?? ""), isFinal: zBool.parse(d.isFinal ?? "") }));
    return `Invoice ${inv.number} created as draft.`;
  });
}
export async function holdbackReleaseAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const inv = await b.createHoldbackRelease(actor, str(d.projectId), zDate.parse(d.invoiceDate));
    return `Holdback release invoice ${inv.number} created.`;
  });
}
export async function invoiceOpAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const op = str(d.op) as "SUBMIT" | "APPROVE" | "VOID" | "MARK_FINAL";
    await b.setInvoiceStatus(actor, str(d.invoiceId), op, { approvedAmount: d.approvedAmount ? Number(String(d.approvedAmount).replace(/[$,]/g, "")) : undefined, reason: str(d.reason) || undefined });
  });
}
export async function paymentAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await b.recordPayment(actor, str(d.invoiceId), b.paymentSchema.parse(d));
    return "Payment recorded.";
  });
}
