import { z } from "zod";
import { prisma, tx, type Tx } from "@/lib/db";
import { requirePerm, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { d } from "@/lib/money";
import { addDays } from "@/lib/dates";
import { zDate, zDateTime, zId, zNonNeg, zOptDate, zOptMoney, zOptText, zText } from "@/lib/forms";
import { changeStage } from "@/lib/workflow";
import { notifyRoles, notifyUsers } from "@/lib/notify";
import { getSetting } from "@/lib/settings";
import { createCloseoutItems, createFolders, loadProject } from "./projects";

export const prepareSchema = z.object({ estimateId: zId, finalPrice: zNonNeg, notes: zOptText() });

/** Prepare final tender pricing from a finalized estimate. Moves the lead to Ready to submit. */
export async function prepareSubmission(actor: Actor, projectId: string, input: z.infer<typeof prepareSchema>) {
  requirePerm(actor, "submission.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(["ESTIMATING", "QUOTING", "READY_TO_SUBMIT", "SUBMITTED"].includes(p.stage), "This job is not at the tender stage.");
    const est = await t.estimate.findUnique({ where: { id: input.estimateId } });
    assert(est && est.projectId === projectId, "Estimate not found.");
    assert(est.status === "FINAL", "Finalize the estimate revision before preparing the submission.");
    const pending = await t.tenderSubmission.findFirst({ where: { projectId, submittedAt: null } });
    if (pending) {
      await t.tenderSubmission.update({ where: { id: pending.id }, data: { estimateId: est.id, finalPrice: input.finalPrice, notes: input.notes, priceApprovedAt: null, priceApprovedById: null } });
    } else {
      await t.tenderSubmission.create({ data: { projectId, estimateId: est.id, finalPrice: input.finalPrice, notes: input.notes } });
    }
    if (p.stage !== "READY_TO_SUBMIT") await changeStage(t, actor, p, "READY_TO_SUBMIT", { note: `Final price prepared from estimate rev ${est.revision}` });
    await audit(t, actor, { action: "submission.prepare", entityType: "Project", entityId: projectId, projectId, summary: `${p.number}: final tender price ${input.finalPrice.toFixed(2)} prepared (estimate rev ${est.revision}, sell ${d(est.sellPrice).toFixed(2)})` });
    await notifyRoles(t, ["ADMIN", "PROJECT_MANAGER"], { type: "submission.approval", title: `Tender price needs approval: ${p.number} ${p.name}`, link: `/jobs/${projectId}/submission`, projectId }, actor.id);
  });
}

export async function approvePrice(actor: Actor, submissionId: string) {
  requirePerm(actor, "submission.approvePrice");
  return tx(async (t) => {
    const s = await t.tenderSubmission.findUnique({ where: { id: submissionId }, include: { project: true } });
    if (!s) throw new NotFoundError("Submission");
    assert(!s.submittedAt, "Already submitted.");
    await t.tenderSubmission.update({ where: { id: submissionId }, data: { priceApprovedAt: new Date(), priceApprovedById: actor.id } });
    await audit(t, actor, { action: "submission.approvePrice", entityType: "TenderSubmission", entityId: submissionId, projectId: s.projectId, summary: `${s.project.number}: tender price ${d(s.finalPrice).toFixed(2)} approved` });
  });
}

export const submittedSchema = z.object({ submittedAt: zDateTime, submittedAmount: zNonNeg, submissionMethod: zOptText(100) });

export async function recordSubmitted(actor: Actor, submissionId: string, input: z.infer<typeof submittedSchema>) {
  requirePerm(actor, "submission.edit");
  return tx(async (t) => {
    const s = await t.tenderSubmission.findUnique({ where: { id: submissionId }, include: { project: true } });
    if (!s) throw new NotFoundError("Submission");
    assert(!s.submittedAt, "Already recorded as submitted.");
    assert(s.priceApprovedAt, "The final price must be approved before submission.");
    await t.tenderSubmission.update({ where: { id: submissionId }, data: input });
    await changeStage(t, actor, s.project, "SUBMITTED", { note: `Submitted ${input.submittedAmount.toFixed(2)}${input.submissionMethod ? ` via ${input.submissionMethod}` : ""}` });
    const late = s.project.submissionDeadline && input.submittedAt > s.project.submissionDeadline;
    await audit(t, actor, { action: "submission.submit", entityType: "TenderSubmission", entityId: submissionId, projectId: s.projectId, summary: `${s.project.number}: tender submitted for ${input.submittedAmount.toFixed(2)}${late ? " (after deadline)" : ""}` });
  });
}

export const outcomeSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("AWARDED"),
    outcomeDate: zDate,
    clientPoNumber: zText(100),
    poDate: zOptDate,
    contractValue: zNonNeg,
    projectManagerId: zId,
    startDate: zDate,
    finishDate: zDate,
    notes: zOptText(),
  }),
  z.object({
    outcome: z.literal("NOT_AWARDED"),
    outcomeDate: zDate,
    outcomeReason: zText(2000).pipe(z.string().min(3, "Give a reason")),
    winningAmount: zOptMoney,
  }),
]);

/**
 * Decision branch: Awarded → create contract (locked original value), client PO, SOV, material register,
 * folders, schedule, closeout list; stage → Activation. Not awarded → close as Lost bid.
 */
export async function recordOutcome(actor: Actor, submissionId: string, input: z.infer<typeof outcomeSchema>) {
  requirePerm(actor, "submission.outcome");
  return tx(async (t) => {
    const s = await t.tenderSubmission.findUnique({ where: { id: submissionId }, include: { project: true, estimate: { include: { lines: true } } } });
    if (!s) throw new NotFoundError("Submission");
    assert(s.submittedAt, "Record the submission first.");
    assert(s.outcome === "PENDING", "The outcome has already been recorded.");
    const p = s.project;
    assert(p.stage === "SUBMITTED", "This tender is not awaiting an outcome.");

    if (input.outcome === "NOT_AWARDED") {
      await t.tenderSubmission.update({ where: { id: s.id }, data: { outcome: "NOT_AWARDED", outcomeDate: input.outcomeDate, outcomeReason: input.outcomeReason, winningAmount: input.winningAmount } });
      await changeStage(t, actor, p, "CLOSED", { closeReason: "LOST_BID", note: input.outcomeReason });
      return;
    }

    if (input.finishDate < input.startDate) throw new UserError("Finish date is before start date.");
    const pm = await t.user.findUnique({ where: { id: input.projectManagerId } });
    assert(pm && pm.active, "Choose an active project manager.");
    await t.tenderSubmission.update({ where: { id: s.id }, data: { outcome: "AWARDED", outcomeDate: input.outcomeDate, notes: input.notes ?? s.notes } });
    await t.project.update({ where: { id: p.id }, data: { awardedAt: new Date(), projectManagerId: pm.id, startDate: input.startDate, finishDate: input.finishDate } });

    // Contract: original value locked by DB trigger.
    await t.contract.create({ data: { projectId: p.id, originalValue: input.contractValue, currentValue: input.contractValue, clientPoNumber: input.clientPoNumber, poDate: input.poDate, awardedEstimateId: s.estimateId } });
    await t.clientPO.create({ data: { projectId: p.id, poNumber: input.clientPoNumber, poDate: input.poDate, amount: input.contractValue, description: "Original contract" } });
    await t.billingLine.create({ data: { projectId: p.id, description: "Base contract", scheduledValue: input.contractValue, sortOrder: 0 } });

    // Material register from the awarded estimate.
    const materials = s.estimate.lines.filter((l) => l.category === "MATERIAL");
    if (materials.length) {
      await t.materialItem.createMany({
        data: materials.map((l) => ({ projectId: p.id, estimateLineId: l.id, description: l.description, manufacturer: l.manufacturer, model: l.model, unit: l.unit, quantityRequired: l.quantity, budgetUnitCost: l.unitPrice })),
      });
    }

    // Folders, schedule, closeout checklist.
    await createFolders(t, p.id, (await getSetting("folders.template", t)) as string[]);
    const template = (await getSetting("schedule.template", t)) as string[];
    const span = Math.max(1, Math.round((input.finishDate.getTime() - input.startDate.getTime()) / 86_400_000));
    const step = span / template.length;
    await t.scheduleItem.createMany({
      data: template.map((name, i) => ({
        projectId: p.id,
        name,
        sortOrder: i,
        startDate: addDays(input.startDate, Math.floor(i * step)),
        endDate: addDays(input.startDate, Math.max(Math.floor(i * step), Math.floor((i + 1) * step) - 1)),
        isMilestone: /inspection|closeout/i.test(name),
      })),
    });
    await createCloseoutItems(t, p.id, "PROJECT");

    await changeStage(t, actor, p, "ACTIVATION", { note: `Awarded. Client PO ${input.clientPoNumber}, contract ${input.contractValue.toFixed(2)}` });
    await audit(t, actor, { action: "project.award", entityType: "Project", entityId: p.id, projectId: p.id, summary: `${p.number}: awarded, contract ${input.contractValue.toFixed(2)}, PO ${input.clientPoNumber}`, after: input });
    await notifyUsers(t, [pm.id, p.estimatorId], { type: "project.awarded", title: `Awarded: ${p.number} ${p.name}`, body: `You are project manager. Complete job activation.`, link: `/jobs/${p.id}`, projectId: p.id }, actor.id);
    await notifyRoles(t, ["PROCUREMENT", "ACCOUNTING"], { type: "project.awarded", title: `New active job: ${p.number} ${p.name}`, link: `/jobs/${p.id}`, projectId: p.id }, actor.id);
  });
}

/** Activation checklist status. */
export async function activationChecklist(projectId: string, db: Tx | typeof prisma = prisma) {
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { contract: true, _count: { select: { members: true, scheduleItems: true, shopDrawings: true, purchaseOrders: true } } },
  });
  return [
    { key: "contract", label: "Client PO and contract value recorded", done: !!p.contract, required: true },
    { key: "pm", label: "Project manager assigned", done: !!p.projectManagerId, required: true },
    { key: "team", label: "Team members assigned", done: p._count.members > 0, required: true },
    { key: "schedule", label: "Project schedule created", done: p._count.scheduleItems > 0, required: true },
    { key: "shopdrawings", label: "Shop drawing register started", done: p._count.shopDrawings > 0, required: false },
    { key: "supplierpo", label: "First supplier PO issued", done: p._count.purchaseOrders > 0, required: false },
  ];
}

/** Move an activated job into execution once the required activation items are done. */
export async function startExecution(actor: Actor, projectId: string) {
  requirePerm(actor, "project.activate");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(p.stage === "ACTIVATION", "Only jobs in activation can be started.");
    if (await getSetting("workflow.requireActivationChecklist", t)) {
      const list = await activationChecklist(projectId, t);
      const missing = list.filter((i) => i.required && !i.done);
      if (missing.length) throw new UserError(`Complete activation first: ${missing.map((m) => m.label.toLowerCase()).join("; ")}.`);
    }
    await changeStage(t, actor, p, "EXECUTION", { note: "Activation complete" });
  });
}
