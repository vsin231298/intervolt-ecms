import { z } from "zod";
import { LineCategory } from "@prisma/client";
import { tx, type Tx } from "@/lib/db";
import { requirePerm, requireAny, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { d, pct, round2, sum } from "@/lib/money";
import { nextProjectNumber } from "@/lib/numbering";
import { zDate, zDateTime, zId, zInt, zMoney, zNonNeg, zOptDate, zOptId, zOptMoney, zOptText, zPercent, zText } from "@/lib/forms";
import { notifyUsers } from "@/lib/notify";
import { getSetting } from "@/lib/settings";
import { loadProject } from "./projects";

// ─────────────── RFIs ───────────────

export const rfiSchema = z.object({
  subject: zText(300),
  question: zText(10000),
  requiredBy: zOptDate,
  responsibleId: zOptId,
  sendNow: z.boolean().default(false),
});

export async function createRfi(actor: Actor, projectId: string, input: z.infer<typeof rfiSchema>) {
  requireAny(actor, ["rfi.create", "change.edit"]);
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(p.stage !== "CLOSED", "This job is closed.");
    const number = await nextProjectNumber(t, p.id, p.number, "RFI");
    const rfi = await t.rfi.create({ data: { projectId, number, subject: input.subject, question: input.question, requiredBy: input.requiredBy, responsibleId: input.responsibleId ?? p.projectManagerId, sentAt: input.sendNow ? new Date() : null, createdById: actor.id } });
    await audit(t, actor, { action: "rfi.create", entityType: "Rfi", entityId: rfi.id, projectId, summary: `${number}: "${input.subject}" ${input.sendNow ? "created and sent" : "drafted"}` });
    return rfi;
  });
}

export async function markRfiSent(actor: Actor, rfiId: string, sentAt: Date) {
  requireAny(actor, ["rfi.create", "change.edit"]);
  return tx(async (t) => {
    const r = await t.rfi.findUnique({ where: { id: rfiId } });
    if (!r) throw new NotFoundError("RFI");
    assert(!r.sentAt, "Already sent.");
    await t.rfi.update({ where: { id: rfiId }, data: { sentAt } });
    await audit(t, actor, { action: "rfi.send", entityType: "Rfi", entityId: rfiId, projectId: r.projectId, summary: `${r.number}: sent to consultant` });
  });
}

export const rfiResponseSchema = z.object({
  response: zText(10000),
  respondedAt: zDateTime,
  respondedBy: zOptText(200),
  changeRequired: z.enum(["yes", "no"]),
});

/** Decision branch: Change required → close RFI and open a draft change order; No change → close. */
export async function recordRfiResponse(actor: Actor, rfiId: string, input: z.infer<typeof rfiResponseSchema>) {
  requirePerm(actor, "change.edit");
  return tx(async (t) => {
    const r = await t.rfi.findUnique({ where: { id: rfiId }, include: { project: true } });
    if (!r) throw new NotFoundError("RFI");
    assert(r.status === "OPEN", "This RFI already has a response.");
    const changeRequired = input.changeRequired === "yes";
    await t.rfi.update({ where: { id: rfiId }, data: { response: input.response, respondedAt: input.respondedAt, respondedBy: input.respondedBy, changeRequired, status: changeRequired ? "ANSWERED" : "CLOSED", sentAt: r.sentAt ?? input.respondedAt } });
    let coId: string | null = null;
    let esiNumber: string | null = null;
    if (changeRequired) {
      // Workflow: RFI → Change needed → ESI → Intervolt estimates the ESI (draft change order) → submit to client.
      esiNumber = await nextProjectNumber(t, r.projectId, r.project.number, "ESI");
      const esi = await t.esi.create({ data: { projectId: r.projectId, number: esiNumber, issuedBy: input.respondedBy, receivedAt: input.respondedAt, description: `From ${r.number} (${r.subject}): ${input.response}`, changeRequired: true, status: "ACTIONED" } });
      const co = await createChangeOrderTx(t, actor, r.projectId, { title: `ESI ${esiNumber}: ${r.subject}`.slice(0, 300), description: input.response, reason: `Change needed per ${r.number} response`, rfiId: r.id, esiId: esi.id });
      coId = co.id;
    }
    await audit(t, actor, { action: "rfi.respond", entityType: "Rfi", entityId: rfiId, projectId: r.projectId, summary: `${r.number}: response recorded — ${changeRequired ? `change needed (ESI ${esiNumber} created, pricing drafted)` : "no change"}` });
    return { changeOrderId: coId };
  });
}

// ─────────────── ESIs ───────────────

export const esiSchema = z.object({
  number: zOptText(50),
  issuedBy: zOptText(200),
  receivedAt: zDate,
  description: zText(10000),
  changeRequired: z.enum(["yes", "no", "unknown"]).default("unknown"),
});

export async function recordEsi(actor: Actor, projectId: string, input: z.infer<typeof esiSchema>) {
  requirePerm(actor, "change.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const number = input.number || (await nextProjectNumber(t, p.id, p.number, "ESI"));
    const dup = await t.esi.findUnique({ where: { projectId_number: { projectId, number } } });
    if (dup) throw new UserError(`ESI ${number} is already recorded.`);
    const changeRequired = input.changeRequired === "unknown" ? null : input.changeRequired === "yes";
    const esi = await t.esi.create({ data: { projectId, number, issuedBy: input.issuedBy, receivedAt: input.receivedAt, description: input.description, changeRequired, status: changeRequired === false ? "CLOSED" : changeRequired ? "ACTIONED" : "OPEN" } });
    if (changeRequired) {
      await createChangeOrderTx(t, actor, projectId, { title: `Extra work per ESI ${number}`, description: input.description, reason: `Engineer's site instruction ${number}${input.issuedBy ? ` from ${input.issuedBy}` : ""}`, esiId: esi.id });
    }
    await audit(t, actor, { action: "esi.create", entityType: "Esi", entityId: esi.id, projectId, summary: `${p.number}: ESI ${number} recorded${changeRequired ? " (change order drafted)" : changeRequired === false ? " (no change)" : ""}` });
    return esi;
  });
}

export async function decideEsi(actor: Actor, esiId: string, changeRequired: boolean) {
  requirePerm(actor, "change.edit");
  return tx(async (t) => {
    const esi = await t.esi.findUnique({ where: { id: esiId } });
    if (!esi) throw new NotFoundError("ESI");
    assert(esi.status === "OPEN", "This ESI has already been actioned.");
    await t.esi.update({ where: { id: esiId }, data: { changeRequired, status: changeRequired ? "ACTIONED" : "CLOSED" } });
    if (changeRequired) await createChangeOrderTx(t, actor, esi.projectId, { title: `Extra work per ESI ${esi.number}`, description: esi.description, reason: `Engineer's site instruction ${esi.number}`, esiId });
    await audit(t, actor, { action: "esi.decide", entityType: "Esi", entityId: esiId, projectId: esi.projectId, summary: `ESI ${esi.number}: ${changeRequired ? "change required" : "no change"}` });
  });
}

// ─────────────── Change orders ───────────────

export const changeOrderSchema = z.object({
  title: zText(300),
  description: zText(10000),
  reason: zText(2000),
  rfiId: zOptId,
  esiId: zOptId,
});

async function createChangeOrderTx(t: Tx, actor: Actor, projectId: string, input: z.infer<typeof changeOrderSchema>) {
  const p = await loadProject(t, projectId);
  assert(["ACTIVATION", "EXECUTION", "CLOSEOUT"].includes(p.stage), "Change orders apply to active jobs.");
  const number = await nextProjectNumber(t, p.id, p.number, "CO");
  const est = await t.contract.findUnique({ where: { projectId } }).then((c) => (c?.awardedEstimateId ? t.estimate.findUnique({ where: { id: c.awardedEstimateId } }) : null));
  const co = await t.changeOrder.create({
    data: {
      projectId,
      number,
      ...input,
      labourRate: est?.labourRate ?? (await getSetting("estimate.labourRate", t)),
      markupPercent: await getSetting("change.markupPercent", t),
      createdById: actor.id,
    },
  });
  await audit(t, actor, { action: "change.create", entityType: "ChangeOrder", entityId: co.id, projectId, summary: `${number}: "${input.title}" drafted` });
  return co;
}

export async function createChangeOrder(actor: Actor, projectId: string, input: z.infer<typeof changeOrderSchema>) {
  requirePerm(actor, "change.edit");
  return tx((t) => createChangeOrderTx(t, actor, projectId, input));
}

export const coLineSchema = z.object({
  category: z.nativeEnum(LineCategory),
  description: zText(300),
  /** Negative quantity = credit (material or labour removed from scope). */
  quantity: zMoney.refine((v) => v !== 0, "Quantity cannot be 0"),
  unit: zText(20).default("ea"),
  unitPrice: zNonNeg.default(0),
  labourHoursPerUnit: zNonNeg.default(0),
});
export const coPricingSchema = z.object({
  labourRate: zNonNeg,
  markupPercent: zPercent,
  otherCost: zNonNeg.default(0),
  scheduleImpactDays: zInt.default(0),
  title: zText(300),
  description: zText(10000),
  reason: zText(2000),
});

async function recalcCo(t: Tx, coId: string) {
  const co = await t.changeOrder.findUniqueOrThrow({ where: { id: coId }, include: { lines: true } });
  const materialCost = round2(sum(co.lines.filter((l) => l.category !== "LABOUR").map((l) => d(l.quantity).times(d(l.unitPrice)))));
  const labourHours = round2(sum(co.lines.map((l) => (l.category === "LABOUR" ? d(l.quantity) : d(l.quantity).times(d(l.labourHoursPerUnit))))));
  const labourCost = round2(labourHours.times(d(co.labourRate)));
  const direct = materialCost.plus(labourCost).plus(d(co.otherCost));
  const proposedAmount = direct.plus(pct(direct, co.markupPercent));
  return t.changeOrder.update({ where: { id: coId }, data: { materialCost, labourHours, labourCost, proposedAmount } });
}

async function loadDraftCo(t: Tx, coId: string) {
  const co = await t.changeOrder.findUnique({ where: { id: coId }, include: { project: true } });
  if (!co) throw new NotFoundError("Change order");
  assert(co.status === "DRAFT", "Only draft change orders can be edited. Rejected changes can be revised as a new change order.");
  return co;
}

export async function addCoLine(actor: Actor, coId: string, input: z.infer<typeof coLineSchema>) {
  requirePerm(actor, "change.edit");
  return tx(async (t) => {
    const co = await loadDraftCo(t, coId);
    await t.changeOrderLine.create({ data: { ...input, changeOrderId: coId } });
    await recalcCo(t, coId);
    await audit(t, actor, { action: "change.line.add", entityType: "ChangeOrder", entityId: coId, projectId: co.projectId, summary: `${co.number}: line "${input.description}" added` });
  });
}
export async function deleteCoLine(actor: Actor, lineId: string) {
  requirePerm(actor, "change.edit");
  return tx(async (t) => {
    const l = await t.changeOrderLine.findUnique({ where: { id: lineId } });
    if (!l) throw new NotFoundError("Line");
    const co = await loadDraftCo(t, l.changeOrderId);
    await t.changeOrderLine.delete({ where: { id: lineId } });
    await recalcCo(t, co.id);
    await audit(t, actor, { action: "change.line.delete", entityType: "ChangeOrder", entityId: co.id, projectId: co.projectId, summary: `${co.number}: line "${l.description}" removed`, before: l });
  });
}
export async function updateCoPricing(actor: Actor, coId: string, input: z.infer<typeof coPricingSchema>) {
  requirePerm(actor, "change.edit");
  return tx(async (t) => {
    const co = await loadDraftCo(t, coId);
    await t.changeOrder.update({ where: { id: coId }, data: input });
    await recalcCo(t, coId);
    await audit(t, actor, { action: "change.update", entityType: "ChangeOrder", entityId: coId, projectId: co.projectId, summary: `${co.number}: pricing / details updated`, before: co, after: input });
  });
}

export async function submitChangeOrder(actor: Actor, coId: string) {
  requirePerm(actor, "change.edit");
  return tx(async (t) => {
    const co = await loadDraftCo(t, coId);
    const updated = await recalcCo(t, coId);
    assert(d(updated.proposedAmount).abs().greaterThan(0) || updated.scheduleImpactDays !== 0, "Price the change (or record a schedule impact) before submitting.");
    await t.changeOrder.update({ where: { id: coId }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    await audit(t, actor, { action: "change.submit", entityType: "ChangeOrder", entityId: coId, projectId: co.projectId, summary: `${co.number}: submitted for approval at ${d(updated.proposedAmount).toFixed(2)}` });
  });
}

export const coDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVED"), approvedAmount: zOptMoney, decidedAt: zDate, clientReference: zOptText(100), clientPoNumber: zOptText(100), decisionNote: zOptText() }),
  z.object({ decision: z.literal("REJECTED"), decidedAt: zDate, decisionNote: zText(2000).pipe(z.string().min(3, "Give the reason")) }),
]);

/**
 * Approved → append to the contract value ledger (original value untouched), add a billing line,
 * optionally record the client PO. Rejected → closed with reason.
 */
export async function decideChangeOrder(actor: Actor, coId: string, input: z.infer<typeof coDecisionSchema>) {
  requirePerm(actor, "change.approve");
  return tx(async (t) => {
    const co = await t.changeOrder.findUnique({ where: { id: coId }, include: { project: true } });
    if (!co) throw new NotFoundError("Change order");
    assert(co.status === "SUBMITTED", "Only submitted change orders can be approved or rejected.");
    if (input.decision === "REJECTED") {
      await t.changeOrder.update({ where: { id: coId }, data: { status: "REJECTED", decidedAt: input.decidedAt, decisionNote: input.decisionNote } });
      await audit(t, actor, { action: "change.reject", entityType: "ChangeOrder", entityId: coId, projectId: co.projectId, summary: `${co.number}: rejected — ${input.decisionNote}` });
      return;
    }
    const amount = round2(input.approvedAmount ?? co.proposedAmount);
    const contract = await t.contract.findUnique({ where: { projectId: co.projectId } });
    assert(contract, "The job has no contract. Record the client PO and contract value first.");
    await t.changeOrder.update({ where: { id: coId }, data: { status: "APPROVED", approvedAmount: amount, decidedAt: input.decidedAt, clientReference: input.clientReference, clientPoNumber: input.clientPoNumber, decisionNote: input.decisionNote } });
    const newValue = d(contract.currentValue).plus(amount);
    await t.contractValueChange.create({ data: { contractId: contract.id, changeOrderId: coId, amount, previousValue: contract.currentValue, newValue, reason: `${co.number} ${co.title}`, byId: actor.id } });
    await t.contract.update({ where: { id: contract.id }, data: { currentValue: newValue } });
    const max = await t.billingLine.aggregate({ where: { projectId: co.projectId }, _max: { sortOrder: true } });
    await t.billingLine.create({ data: { projectId: co.projectId, description: `${co.number} ${co.title}`, scheduledValue: amount, changeOrderId: coId, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    if (input.clientPoNumber) {
      const existing = await t.clientPO.findUnique({ where: { projectId_poNumber: { projectId: co.projectId, poNumber: input.clientPoNumber } } });
      if (existing) await t.clientPO.update({ where: { id: existing.id }, data: { amount: d(existing.amount).plus(amount) } });
      else await t.clientPO.create({ data: { projectId: co.projectId, poNumber: input.clientPoNumber, amount, poDate: input.decidedAt, description: `${co.number} ${co.title}` } });
    }
    if (co.scheduleImpactDays && co.project.finishDate) {
      await t.project.update({ where: { id: co.projectId }, data: { finishDate: new Date(co.project.finishDate.getTime() + co.scheduleImpactDays * 86_400_000) } });
    }
    await audit(t, actor, {
      action: "change.approve",
      entityType: "ChangeOrder",
      entityId: coId,
      projectId: co.projectId,
      summary: `${co.number}: approved for ${amount.toFixed(2)}. Contract ${d(contract.currentValue).toFixed(2)} → ${newValue.toFixed(2)} (original ${d(contract.originalValue).toFixed(2)} retained)${co.scheduleImpactDays ? `; finish date moved ${co.scheduleImpactDays} day(s)` : ""}`,
      before: { contractValue: contract.currentValue },
      after: { contractValue: newValue },
    });
    await notifyUsers(t, [co.project.projectManagerId], { type: "change.approved", title: `${co.number} approved`, body: `${amount.toFixed(2)} added to contract`, link: `/jobs/${co.projectId}/changes`, projectId: co.projectId }, actor.id);
  });
}

/** Rejected changes can be revised into a new draft carrying the same lines. */
export async function reviseChangeOrder(actor: Actor, coId: string) {
  requirePerm(actor, "change.edit");
  return tx(async (t) => {
    const co = await t.changeOrder.findUnique({ where: { id: coId }, include: { lines: true } });
    if (!co) throw new NotFoundError("Change order");
    assert(co.status === "REJECTED", "Only rejected change orders can be revised.");
    const n = await createChangeOrderTx(t, actor, co.projectId, { title: `${co.title} (revised)`, description: co.description, reason: `Revision of ${co.number}: ${co.decisionNote ?? ""}`.trim(), rfiId: co.rfiId ?? undefined, esiId: co.esiId ?? undefined });
    await t.changeOrder.update({ where: { id: n.id }, data: { labourRate: co.labourRate, markupPercent: co.markupPercent, otherCost: co.otherCost, scheduleImpactDays: co.scheduleImpactDays } });
    if (co.lines.length) await t.changeOrderLine.createMany({ data: co.lines.map(({ id: _id, changeOrderId: _c, ...l }) => ({ ...l, changeOrderId: n.id })) });
    await recalcCo(t, n.id);
    return n;
  });
}

export const zDecidedAt = zDate;
export const zCoId = zId;
