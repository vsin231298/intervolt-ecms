"use server";

import { run, str, filesFrom, type ActionState } from "@/lib/action";
import { zBool } from "@/lib/forms";
import * as ch from "@/services/changes";
import { uploadDocument } from "@/services/documents";

export async function createRfiAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const r = await ch.createRfi(actor, str(d.projectId), ch.rfiSchema.parse({ ...d, sendNow: zBool.parse(d.sendNow ?? "") }));
    for (const f of await filesFrom(fd, "files")) await uploadDocument(actor, { projectId: str(d.projectId), module: "RFI", category: "RFI attachment", entityType: "Rfi", entityId: r.id }, f);
    return `${r.number} created.`;
  });
}
export async function rfiSentAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await ch.markRfiSent(actor, str(d.rfiId), new Date())));
}
export async function rfiResponseAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const res = await ch.recordRfiResponse(actor, str(d.rfiId), ch.rfiResponseSchema.parse(d));
    for (const f of await filesFrom(fd, "files")) await uploadDocument(actor, { projectId: str(d.projectId), module: "RFI", category: "RFI response", entityType: "Rfi", entityId: str(d.rfiId) }, f);
    return res.changeOrderId ? { redirectTo: `/jobs/${str(d.projectId)}/changes/${res.changeOrderId}` } : "Response recorded. No change required; RFI closed.";
  });
}
export async function esiAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const e = await ch.recordEsi(actor, str(d.projectId), ch.esiSchema.parse(d));
    for (const f of await filesFrom(fd, "files")) await uploadDocument(actor, { projectId: str(d.projectId), module: "RFI", category: "ESI", entityType: "Esi", entityId: e.id }, f);
    return "ESI recorded.";
  });
}
export async function esiDecideAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await ch.decideEsi(actor, str(d.esiId), d.changeRequired === "yes")));
}
export async function createCoAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const co = await ch.createChangeOrder(actor, str(d.projectId), ch.changeOrderSchema.parse(d));
    return { redirectTo: `/jobs/${str(d.projectId)}/changes/${co.id}` };
  });
}
export async function coLineAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await ch.addCoLine(actor, str(d.coId), ch.coLineSchema.parse(d))));
}
export async function coLineDeleteAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await ch.deleteCoLine(actor, str(d.lineId))));
}
export async function coPricingAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await ch.updateCoPricing(actor, str(d.coId), ch.coPricingSchema.parse(d))));
}
export async function coSubmitAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await ch.submitChangeOrder(actor, str(d.coId))));
}
export async function coDecisionAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    await ch.decideChangeOrder(actor, str(d.coId), ch.coDecisionSchema.parse(d));
    for (const f of await filesFrom(fd, "files")) await uploadDocument(actor, { projectId: str(d.projectId), module: "CHANGE", category: "Client approval / PO", entityType: "ChangeOrder", entityId: str(d.coId), approvalStatus: "APPROVED" }, f);
    return d.decision === "APPROVED" ? "Approved. Contract value updated (original retained) and a billing line added." : "Change order rejected.";
  });
}
export async function coReviseAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const n = await ch.reviseChangeOrder(actor, str(d.coId));
    return { redirectTo: `/jobs/${n.projectId}/changes/${n.id}` };
  });
}
