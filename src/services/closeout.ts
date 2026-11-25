import { z } from "zod";
import { prisma, tx, type Tx } from "@/lib/db";
import { requirePerm, requireAny, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { d, sum } from "@/lib/money";
import { zDate, zDateTime, zOptDate, zOptId, zOptText, zText } from "@/lib/forms";
import { notifyUsers } from "@/lib/notify";
import { changeStage } from "@/lib/workflow";
import { loadProject } from "./projects";
import { invoiceBalance } from "./billing";

// ─────────────── Inspections ───────────────

export const inspectionSchema = z.object({
  type: zText(200),
  isEsa: z.boolean().default(false),
  isFinal: z.boolean().default(false),
  scheduledAt: zDateTime,
  inspector: zOptText(200),
  esaNotificationNo: zOptText(100),
  notes: zOptText(),
  reinspectionOfId: zOptId,
});

export async function scheduleInspection(actor: Actor, projectId: string, input: z.infer<typeof inspectionSchema>) {
  requirePerm(actor, "inspection.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(["ACTIVATION", "EXECUTION", "CLOSEOUT"].includes(p.stage), "Inspections are scheduled on active jobs.");
    const i = await t.inspection.create({ data: { ...input, projectId } });
    await audit(t, actor, { action: "inspection.schedule", entityType: "Inspection", entityId: i.id, projectId, summary: `${p.number}: ${input.type} inspection scheduled ${input.scheduledAt.toISOString().slice(0, 10)}` });
    await notifyUsers(t, [p.projectManagerId], { type: "inspection.scheduled", title: `${input.type} inspection scheduled: ${p.number}`, link: `/jobs/${projectId}/inspections`, projectId }, actor.id);
    return i;
  });
}

export const inspectionResultSchema = z.object({
  result: z.enum(["PASSED", "FAILED", "CANCELLED"]),
  resultDate: zDate,
  notes: zOptText(),
  deficiencies: z.array(z.object({ description: zText(1000), location: zOptText(200), assignedToId: zOptId, dueDate: zOptDate })).default([]),
});

/** Decision branch: Passed / Failed. A failed inspection must list at least one deficiency. */
export async function recordInspectionResult(actor: Actor, inspectionId: string, input: z.infer<typeof inspectionResultSchema>) {
  requirePerm(actor, "inspection.edit");
  return tx(async (t) => {
    const i = await t.inspection.findUnique({ where: { id: inspectionId }, include: { project: true } });
    if (!i) throw new NotFoundError("Inspection");
    assert(i.result === "SCHEDULED", "A result has already been recorded.");
    if (input.result === "FAILED") assert(input.deficiencies.length > 0, "A failed inspection needs at least one deficiency.");
    await t.inspection.update({ where: { id: inspectionId }, data: { result: input.result, resultDate: input.resultDate, notes: input.notes ?? i.notes } });
    for (const def of input.deficiencies) {
      await t.deficiency.create({ data: { ...def, projectId: i.projectId, inspectionId } });
    }
    await audit(t, actor, { action: "inspection.result", entityType: "Inspection", entityId: inspectionId, projectId: i.projectId, summary: `${i.project.number}: ${i.type} ${input.result.toLowerCase()}${input.deficiencies.length ? ` with ${input.deficiencies.length} deficienc${input.deficiencies.length === 1 ? "y" : "ies"}` : ""}` });
    if (input.result === "FAILED") {
      const sup = await t.projectMember.findMany({ where: { projectId: i.projectId } });
      await notifyUsers(t, [i.project.projectManagerId, ...sup.map((s) => s.userId)], { type: "inspection.failed", title: `Inspection failed: ${i.type} on ${i.project.number}`, body: `${input.deficiencies.length} deficiencies to correct; schedule a re-inspection.`, link: `/jobs/${i.projectId}/inspections`, projectId: i.projectId }, actor.id);
    }
    const assignees = input.deficiencies.map((x) => x.assignedToId);
    if (assignees.some(Boolean)) await notifyUsers(t, assignees, { type: "deficiency.assigned", title: `Deficiency assigned on ${i.project.number}`, link: `/jobs/${i.projectId}/inspections`, projectId: i.projectId }, actor.id);
  });
}

export const deficiencySchema = z.object({ description: zText(1000), location: zOptText(200), assignedToId: zOptId, dueDate: zOptDate });

export async function addDeficiency(actor: Actor, projectId: string, input: z.infer<typeof deficiencySchema>) {
  requirePerm(actor, "inspection.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const def = await t.deficiency.create({ data: { ...input, projectId } });
    await audit(t, actor, { action: "deficiency.add", entityType: "Deficiency", entityId: def.id, projectId, summary: `${p.number}: deficiency added — ${input.description}` });
    if (input.assignedToId) await notifyUsers(t, [input.assignedToId], { type: "deficiency.assigned", title: `Deficiency assigned on ${p.number}`, body: input.description, link: `/jobs/${projectId}/inspections`, projectId }, actor.id);
    return def;
  });
}

export async function updateDeficiency(actor: Actor, id: string, status: "OPEN" | "IN_PROGRESS" | "COMPLETED", correctiveAction?: string) {
  requireAny(actor, ["inspection.edit", "field.use"]);
  return tx(async (t) => {
    const def = await t.deficiency.findUnique({ where: { id }, include: { project: true } });
    if (!def) throw new NotFoundError("Deficiency");
    if (status === "COMPLETED") assert(correctiveAction || def.correctiveAction, "Describe the corrective action taken.");
    await t.deficiency.update({ where: { id }, data: { status, correctiveAction: correctiveAction ?? def.correctiveAction, completedAt: status === "COMPLETED" ? new Date() : null } });
    await audit(t, actor, { action: "deficiency.update", entityType: "Deficiency", entityId: id, projectId: def.projectId, summary: `${def.project.number}: deficiency "${def.description.slice(0, 60)}" → ${status.toLowerCase().replace("_", " ")}`, before: { status: def.status }, after: { status, correctiveAction } });
  });
}

// ─────────────── Commissioning ───────────────

export const commissioningSchema = z.object({ system: zText(200), test: zText(300), scheduledAt: zOptDate });

export async function addCommissioningItem(actor: Actor, projectId: string, input: z.infer<typeof commissioningSchema>) {
  requirePerm(actor, "inspection.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const c = await t.commissioningItem.create({ data: { ...input, projectId } });
    await audit(t, actor, { action: "commissioning.add", entityType: "CommissioningItem", entityId: c.id, projectId, summary: `${p.number}: commissioning "${input.system} — ${input.test}" added` });
    return c;
  });
}

export const commissioningResultSchema = z.object({ result: z.enum(["PASSED", "FAILED"]), performedAt: zDate, performedBy: zOptText(200), notes: zOptText() });

export async function recordCommissioning(actor: Actor, id: string, input: z.infer<typeof commissioningResultSchema>) {
  requirePerm(actor, "inspection.edit");
  return tx(async (t) => {
    const c = await t.commissioningItem.findUnique({ where: { id }, include: { project: true } });
    if (!c) throw new NotFoundError("Commissioning item");
    await t.commissioningItem.update({ where: { id }, data: input });
    await audit(t, actor, { action: "commissioning.result", entityType: "CommissioningItem", entityId: id, projectId: c.projectId, summary: `${c.project.number}: ${c.system} — ${c.test}: ${input.result.toLowerCase()}`, before: { result: c.result }, after: input });
  });
}

// ─────────────── Closeout ───────────────

/** System-verified closeout conditions. */
export async function evaluateAutoChecks(projectId: string, db: Tx | typeof prisma = prisma) {
  const [inspections, commissioning, drawings, deficiencies, invoices, supplierInvoices, signoffs] = await Promise.all([
    db.inspection.findMany({ where: { projectId } }),
    db.commissioningItem.findMany({ where: { projectId } }),
    db.shopDrawing.findMany({ where: { projectId }, include: { revisions: { orderBy: { revision: "desc" }, take: 1 } } }),
    db.deficiency.count({ where: { projectId, status: { not: "COMPLETED" } } }),
    db.invoice.findMany({ where: { projectId, status: { not: "VOID" } } }),
    db.supplierInvoice.findMany({ where: { projectId } }),
    db.workOrderSignoff.findMany({ where: { projectId, markedComplete: true } }),
  ]);
  const finalInsp = inspections.filter((i) => i.isFinal);
  const checks: Record<string, { ok: boolean; detail: string }> = {
    FINAL_INSPECTION_PASSED: finalInsp.some((i) => i.result === "PASSED")
      ? { ok: true, detail: "Final inspection passed" }
      : { ok: false, detail: finalInsp.length ? "Final inspection not yet passed" : "No final inspection recorded" },
    COMMISSIONING_PASSED: commissioning.length === 0
      ? { ok: false, detail: "No commissioning items recorded" }
      : commissioning.every((c) => c.result === "PASSED") ? { ok: true, detail: `${commissioning.length} item(s) passed` } : { ok: false, detail: `${commissioning.filter((c) => c.result !== "PASSED").length} item(s) not passed` },
    SHOP_DRAWINGS_APPROVED: (() => {
      const pending = drawings.filter((sd) => !["APPROVED", "APPROVED_AS_NOTED"].includes(sd.revisions[0]?.status ?? ""));
      return pending.length ? { ok: false, detail: `${pending.length} not approved: ${pending.slice(0, 5).map((x) => x.number).join(", ")}` } : { ok: true, detail: `${drawings.length} approved` };
    })(),
    DEFICIENCIES_COMPLETE: deficiencies === 0 ? { ok: true, detail: "No open deficiencies" } : { ok: false, detail: `${deficiencies} open deficienc${deficiencies === 1 ? "y" : "ies"}` },
    FINAL_INVOICE_ISSUED: invoices.some((i) => i.isFinal && i.status !== "DRAFT") ? { ok: true, detail: "Final invoice issued" } : { ok: false, detail: "No invoice marked final" },
    PAYMENTS_RECEIVED: (() => {
      const bal = sum(invoices.map((i) => invoiceBalance(i)));
      const drafts = invoices.filter((i) => i.status === "DRAFT").length;
      return bal.isZero() && !drafts && invoices.length ? { ok: true, detail: "All invoices paid" } : { ok: false, detail: invoices.length ? `${bal.toFixed(2)} outstanding${drafts ? `, ${drafts} draft invoice(s)` : ""}` : "No invoices issued" };
    })(),
    SUPPLIER_INVOICES_PAID: (() => {
      const unpaid = supplierInvoices.filter((s) => s.status !== "PAID");
      return unpaid.length ? { ok: false, detail: `${unpaid.length} supplier invoice(s) unpaid` } : { ok: true, detail: "All supplier invoices paid" };
    })(),
    WORK_ORDER_SIGNED: signoffs.length ? { ok: true, detail: "Work order completed" } : { ok: false, detail: "Work order not marked complete" },
  };
  return checks;
}

export async function closeoutStatus(projectId: string, db: Tx | typeof prisma = prisma) {
  const [items, checks] = await Promise.all([db.closeoutItem.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }), evaluateAutoChecks(projectId, db)]);
  const rows = items.map((it) => {
    const auto = it.autoCheck ? checks[it.autoCheck] : null;
    const satisfied = it.status === "WAIVED" || (it.status === "COMPLETE" && (!auto || auto.ok));
    return { item: it, auto, satisfied };
  });
  const blocking = rows.filter((r) => r.item.mandatory && !r.satisfied);
  return { rows, blocking, ready: blocking.length === 0 };
}

export async function startCloseout(actor: Actor, projectId: string) {
  requirePerm(actor, "closeout.close");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(p.stage === "EXECUTION", "Only jobs in progress can move to closeout.");
    await changeStage(t, actor, p, "CLOSEOUT", { note: "Closeout started" });
  });
}

/** Mark an item complete. Items with a system check can only be completed when the check passes. */
export async function completeCloseoutItem(actor: Actor, itemId: string, notes?: string) {
  requirePerm(actor, "closeout.edit");
  return tx(async (t) => {
    const it = await t.closeoutItem.findUnique({ where: { id: itemId }, include: { project: true } });
    if (!it) throw new NotFoundError("Closeout item");
    if (it.autoCheck) {
      const checks = await evaluateAutoChecks(it.projectId, t);
      const c = checks[it.autoCheck];
      if (c && !c.ok) throw new UserError(`Cannot mark complete: ${c.detail}. Resolve it or have an authorized user waive the item.`);
    }
    await t.closeoutItem.update({ where: { id: itemId }, data: { status: "COMPLETE", completedAt: new Date(), completedById: actor.id, notes: notes ?? it.notes, waivedAt: null, waivedById: null, waiverReason: null } });
    await audit(t, actor, { action: "closeout.complete", entityType: "CloseoutItem", entityId: itemId, projectId: it.projectId, summary: `${it.project.number}: closeout "${it.name}" completed` });
  });
}

export async function waiveCloseoutItem(actor: Actor, itemId: string, reason: string) {
  requirePerm(actor, "closeout.waive");
  assert(reason.trim().length >= 5, "A waiver needs a reason.");
  return tx(async (t) => {
    const it = await t.closeoutItem.findUnique({ where: { id: itemId }, include: { project: true } });
    if (!it) throw new NotFoundError("Closeout item");
    await t.closeoutItem.update({ where: { id: itemId }, data: { status: "WAIVED", waivedAt: new Date(), waivedById: actor.id, waiverReason: reason } });
    await audit(t, actor, { action: "closeout.waive", entityType: "CloseoutItem", entityId: itemId, projectId: it.projectId, summary: `${it.project.number}: closeout "${it.name}" WAIVED by ${actor.name} — ${reason}` });
  });
}

export async function reopenCloseoutItem(actor: Actor, itemId: string) {
  requirePerm(actor, "closeout.edit");
  return tx(async (t) => {
    const it = await t.closeoutItem.findUnique({ where: { id: itemId }, include: { project: true } });
    if (!it) throw new NotFoundError("Closeout item");
    assert(it.status !== "WAIVED" || (await import("@/lib/rbac")).can(actor.role, "closeout.waive"), "Only an authorized user can undo a waiver.");
    await t.closeoutItem.update({ where: { id: itemId }, data: { status: "OPEN", completedAt: null, completedById: null, waivedAt: null, waivedById: null, waiverReason: null } });
    await audit(t, actor, { action: "closeout.reopen", entityType: "CloseoutItem", entityId: itemId, projectId: it.projectId, summary: `${it.project.number}: closeout "${it.name}" reopened` });
  });
}

export async function addCloseoutItem(actor: Actor, projectId: string, name: string, mandatory: boolean) {
  requirePerm(actor, "closeout.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const max = await t.closeoutItem.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    const key = `custom_${Date.now()}`;
    await t.closeoutItem.create({ data: { projectId, key, name, mandatory, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    await audit(t, actor, { action: "closeout.add", entityType: "Project", entityId: projectId, projectId, summary: `${p.number}: closeout item "${name}" added${mandatory ? " (mandatory)" : ""}` });
  });
}

/** CLOSED only when every mandatory item is complete (and its system check passes) or formally waived. */
export async function closeProject(actor: Actor, projectId: string, note?: string) {
  requirePerm(actor, "closeout.close");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(p.stage === "CLOSEOUT", "Start closeout before closing the job.");
    const status = await closeoutStatus(projectId, t);
    if (!status.ready) throw new UserError(`Cannot close: ${status.blocking.map((b) => b.item.name).join("; ")}.`);
    await changeStage(t, actor, p, "CLOSED", { closeReason: "COMPLETED", note: note ?? "All closeout requirements met" });
  });
}

export const zWaiver = z.object({ reason: zText(1000) });
