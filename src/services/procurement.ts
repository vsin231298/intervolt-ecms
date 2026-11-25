import { z } from "zod";
import type { PurchaseOrder, PurchaseOrderLine, ShopDrawing, ShopDrawingRevision } from "@prisma/client";
import { prisma, tx, type Tx } from "@/lib/db";
import { requirePerm, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { can } from "@/lib/rbac";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { d, round2, sum } from "@/lib/money";
import { nextProjectNumber } from "@/lib/numbering";
import { zDate, zId, zNonNeg, zOptDate, zOptId, zOptText, zText } from "@/lib/forms";
import { notifyRoles, notifyUsers } from "@/lib/notify";
import { getSetting } from "@/lib/settings";
import { loadProject } from "./projects";

const APPROVED_SD = ["APPROVED", "APPROVED_AS_NOTED"] as const;

// ─────────────── Material requests ───────────────

export const materialRequestSchema = z.object({
  neededBy: zOptDate,
  notes: zOptText(),
  lines: z.array(z.object({ description: zText(300), quantity: zNonNeg, unit: zText(20).default("ea"), materialItemId: zOptId })).min(1, "Add at least one item"),
});

export async function createMaterialRequest(actor: Actor, projectId: string, input: z.infer<typeof materialRequestSchema>) {
  if (!can(actor.role, "procurement.edit") && !can(actor.role, "materials.edit") && !can(actor.role, "field.use")) requirePerm(actor, "procurement.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(p.stage !== "CLOSED", "This job is closed.");
    const number = await nextProjectNumber(t, p.id, p.number, "MR");
    const mr = await t.materialRequest.create({ data: { projectId, number, requestedById: actor.id, neededBy: input.neededBy, notes: input.notes, lines: { create: input.lines } } });
    await audit(t, actor, { action: "materialRequest.create", entityType: "MaterialRequest", entityId: mr.id, projectId, summary: `${number}: material request (${input.lines.length} item(s))` });
    await notifyRoles(t, ["PROCUREMENT"], { type: "material.request", title: `Material request ${number}`, body: `${p.number} ${p.name}`, link: `/jobs/${projectId}/procurement`, projectId }, actor.id);
    if (p.projectManagerId) await notifyUsers(t, [p.projectManagerId], { type: "material.request", title: `Material request ${number}`, link: `/jobs/${projectId}/procurement`, projectId }, actor.id);
    return mr;
  });
}

export async function cancelMaterialRequest(actor: Actor, id: string) {
  requirePerm(actor, "procurement.edit");
  return tx(async (t) => {
    const mr = await t.materialRequest.findUnique({ where: { id } });
    if (!mr) throw new NotFoundError("Material request");
    assert(mr.status === "REQUESTED", "Only open requests can be cancelled.");
    await t.materialRequest.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(t, actor, { action: "materialRequest.cancel", entityType: "MaterialRequest", entityId: id, projectId: mr.projectId, summary: `${mr.number}: cancelled` });
  });
}

// ─────────────── Purchase orders ───────────────

export const poLineSchema = z.object({
  description: zText(300),
  quantity: zNonNeg.refine((v) => v > 0, "Quantity must be more than 0"),
  unit: zText(20).default("ea"),
  unitCost: zNonNeg,
  materialItemId: zOptId,
  expectedDate: zOptDate,
});
export const poSchema = z.object({
  supplierId: zId,
  expectedDelivery: zOptDate,
  deliveryAddress: zOptText(300),
  notes: zOptText(),
  shopDrawingsRequired: z.boolean().default(false),
  supplierQuoteId: zOptId,
  materialRequestId: zOptId,
  lines: z.array(poLineSchema).min(1, "Add at least one line"),
});

export async function createPurchaseOrder(actor: Actor, projectId: string, input: z.infer<typeof poSchema>) {
  requirePerm(actor, "procurement.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(["ACTIVATION", "EXECUTION", "CLOSEOUT"].includes(p.stage), "Purchase orders can only be raised on active jobs.");
    const supplier = await t.organization.findUnique({ where: { id: input.supplierId } });
    assert(supplier && ["SUPPLIER", "SUBCONTRACTOR"].includes(supplier.type), "Choose a supplier or subcontractor.");
    const number = await nextProjectNumber(t, p.id, p.number, "PO");
    // Link lines to the material register: use given id, else match by description, else create a register item.
    const lines = [];
    for (const l of input.lines) {
      let materialItemId = l.materialItemId ?? null;
      if (materialItemId) {
        const mi = await t.materialItem.findUnique({ where: { id: materialItemId } });
        assert(mi && mi.projectId === projectId, "Material item does not belong to this job.");
      } else {
        const match = await t.materialItem.findFirst({ where: { projectId, description: { equals: l.description, mode: "insensitive" }, isManual: false } });
        materialItemId = match?.id ?? (await t.materialItem.create({ data: { projectId, description: l.description, unit: l.unit, quantityRequired: l.quantity, budgetUnitCost: l.unitCost, createdById: actor.id } })).id;
      }
      lines.push({ ...l, materialItemId, expectedDate: l.expectedDate ?? input.expectedDelivery });
    }
    const total = round2(sum(lines.map((l) => d(l.quantity).times(d(l.unitCost)))));
    const po = await t.purchaseOrder.create({
      data: {
        projectId,
        number,
        supplierId: input.supplierId,
        supplierQuoteId: input.supplierQuoteId,
        materialRequestId: input.materialRequestId,
        expectedDelivery: input.expectedDelivery,
        deliveryAddress: input.deliveryAddress ?? p.location,
        notes: input.notes,
        shopDrawingsRequired: input.shopDrawingsRequired,
        total,
        createdById: actor.id,
        lines: { create: lines },
      },
    });
    if (input.materialRequestId) await t.materialRequest.update({ where: { id: input.materialRequestId }, data: { status: "ORDERED" } });
    await audit(t, actor, { action: "po.create", entityType: "PurchaseOrder", entityId: po.id, projectId, summary: `${number}: PO to ${supplier.name} for ${total.toFixed(2)}${input.shopDrawingsRequired ? " (shop drawings required before delivery)" : ""}` });
    return po;
  });
}

/** Build a PO for one supplier from the RFQ items where that supplier's price is selected. */
export async function createPoFromQuote(actor: Actor, supplierQuoteId: string, opts: { expectedDelivery?: Date; shopDrawingsRequired: boolean }) {
  const q = await prisma.supplierQuote.findUnique({
    where: { id: supplierQuoteId },
    include: { lines: { include: { rfqItem: { include: { estimateLine: true } }, selectedFor: true } }, quoteRequest: true },
  });
  if (!q) throw new NotFoundError("Supplier quote");
  const selected = q.lines.filter((l) => l.selectedFor);
  assert(selected.length, "No items are selected from this quote. Select prices on the comparison first.");
  const materialItems = await prisma.materialItem.findMany({ where: { projectId: q.quoteRequest.projectId } });
  const leadDays = Math.max(0, ...selected.map((l) => l.leadTimeDays ?? q.leadTimeDays ?? 0));
  return createPurchaseOrder(actor, q.quoteRequest.projectId, {
    supplierId: q.supplierId,
    supplierQuoteId: q.id,
    expectedDelivery: opts.expectedDelivery ?? (leadDays ? new Date(Date.now() + leadDays * 86_400_000) : undefined),
    shopDrawingsRequired: opts.shopDrawingsRequired,
    notes: `Per supplier quote ${q.quoteNumber}`,
    lines: selected.map((l) => ({
      description: l.rfqItem.description,
      quantity: Number(l.rfqItem.quantity),
      unit: l.rfqItem.unit,
      unitCost: Number(l.unitPrice),
      materialItemId: materialItems.find((m) => m.estimateLineId && m.estimateLineId === l.rfqItem.estimateLineId)?.id,
    })),
  } as z.infer<typeof poSchema>);
}

export async function issuePurchaseOrder(actor: Actor, poId: string) {
  requirePerm(actor, "procurement.edit");
  return tx(async (t) => {
    const po = await t.purchaseOrder.findUnique({ where: { id: poId }, include: { supplier: true, project: true } });
    if (!po) throw new NotFoundError("Purchase order");
    assert(po.status === "DRAFT", "Only draft POs can be issued.");
    await t.purchaseOrder.update({ where: { id: poId }, data: { status: "ISSUED", issuedAt: new Date() } });
    await audit(t, actor, { action: "po.issue", entityType: "PurchaseOrder", entityId: poId, projectId: po.projectId, summary: `${po.number}: issued to ${po.supplier.name}` });
  });
}

export async function cancelPurchaseOrder(actor: Actor, poId: string, reason: string) {
  requirePerm(actor, "procurement.edit");
  return tx(async (t) => {
    const po = await t.purchaseOrder.findUnique({ where: { id: poId }, include: { receipts: true } });
    if (!po) throw new NotFoundError("Purchase order");
    assert(po.receipts.length === 0, "A PO with deliveries cannot be cancelled.");
    assert(reason.trim().length >= 3, "Give a reason.");
    await t.purchaseOrder.update({ where: { id: poId }, data: { status: "CANCELLED", notes: `${po.notes ?? ""}\nCancelled: ${reason}`.trim() } });
    await audit(t, actor, { action: "po.cancel", entityType: "PurchaseOrder", entityId: poId, projectId: po.projectId, summary: `${po.number}: cancelled — ${reason}` });
  });
}

export async function updatePoExpected(actor: Actor, poId: string, expectedDelivery: Date | null) {
  requirePerm(actor, "procurement.edit");
  return tx(async (t) => {
    const po = await t.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new NotFoundError("Purchase order");
    await t.purchaseOrder.update({ where: { id: poId }, data: { expectedDelivery } });
    await t.purchaseOrderLine.updateMany({ where: { purchaseOrderId: poId, quantityReceived: 0 }, data: { expectedDate: expectedDelivery } });
    await audit(t, actor, { action: "po.expected", entityType: "PurchaseOrder", entityId: poId, projectId: po.projectId, summary: `${po.number}: expected delivery changed to ${expectedDelivery?.toISOString().slice(0, 10) ?? "none"}`, before: { expectedDelivery: po.expectedDelivery }, after: { expectedDelivery } });
  });
}

/** Shop drawing gate: is this PO cleared for delivery? */
export function drawingGate(po: Pick<PurchaseOrder, "shopDrawingsRequired" | "deliveryOverrideReason">, drawings: (ShopDrawing & { revisions: ShopDrawingRevision[] })[]) {
  if (!po.shopDrawingsRequired) return { cleared: true, reason: "No shop drawings required" };
  if (po.deliveryOverrideReason) return { cleared: true, reason: `Override: ${po.deliveryOverrideReason}` };
  if (!drawings.length) return { cleared: false, reason: "Shop drawings required but none submitted" };
  const pending = drawings.filter((sd) => {
    const latest = [...sd.revisions].sort((a, b) => b.revision - a.revision)[0];
    return !latest || !(APPROVED_SD as readonly string[]).includes(latest.status);
  });
  if (pending.length) return { cleared: false, reason: `Waiting on shop drawing approval: ${pending.map((p) => p.number).join(", ")}` };
  return { cleared: true, reason: "Shop drawings approved" };
}

export async function overrideDeliveryGate(actor: Actor, poId: string, reason: string) {
  requirePerm(actor, "procurement.overrideDelivery");
  assert(reason.trim().length >= 5, "Give a reason for the override.");
  return tx(async (t) => {
    const po = await t.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new NotFoundError("Purchase order");
    await t.purchaseOrder.update({ where: { id: poId }, data: { deliveryOverrideReason: reason, deliveryOverrideById: actor.id } });
    await audit(t, actor, { action: "po.deliveryOverride", entityType: "PurchaseOrder", entityId: poId, projectId: po.projectId, summary: `${po.number}: delivery allowed before shop drawing approval — ${reason}` });
  });
}

export const receiptSchema = z.object({
  receivedAt: zDate,
  reference: zOptText(100),
  notes: zOptText(),
  quantities: z.record(z.string(), z.union([z.string(), z.number()])),
});

/** Delivery confirmed + material tagged to job. Enforces the shop drawing gate. */
export async function receiveDelivery(actor: Actor, poId: string, input: z.infer<typeof receiptSchema>) {
  requirePerm(actor, "procurement.receive");
  return tx(async (t) => {
    const po = await t.purchaseOrder.findUnique({ where: { id: poId }, include: { lines: true, shopDrawings: { include: { revisions: true } }, project: true } });
    if (!po) throw new NotFoundError("Purchase order");
    assert(po.status === "ISSUED" || po.status === "PARTIALLY_RECEIVED", po.status === "DRAFT" ? "Issue the PO before receiving." : "This PO cannot receive deliveries.");
    const gate = drawingGate(po, po.shopDrawings);
    if (!gate.cleared && (await getSetting("procurement.blockDeliveryUntilDrawingsApproved", t))) {
      throw new UserError(`Delivery blocked: ${gate.reason}. An Admin or PM can override with a reason.`);
    }
    const lines: { poLineId: string; quantity: number }[] = [];
    for (const l of po.lines) {
      const raw = input.quantities[l.id];
      if (raw === undefined || String(raw).trim() === "") continue;
      const q = Number(raw);
      if (!isFinite(q) || q < 0) throw new UserError(`Invalid quantity for "${l.description}".`);
      if (q === 0) continue;
      const remaining = d(l.quantity).minus(d(l.quantityReceived));
      if (d(q).greaterThan(remaining)) throw new UserError(`"${l.description}": receiving ${q} but only ${remaining.toString()} outstanding.`);
      lines.push({ poLineId: l.id, quantity: q });
    }
    assert(lines.length, "Enter the quantity received for at least one line.");
    const receipt = await t.receipt.create({ data: { purchaseOrderId: poId, receivedAt: input.receivedAt, reference: input.reference, notes: input.notes, receivedById: actor.id, lines: { create: lines } } });
    for (const l of lines) await t.purchaseOrderLine.update({ where: { id: l.poLineId }, data: { quantityReceived: { increment: l.quantity } } });
    const after = await t.purchaseOrderLine.findMany({ where: { purchaseOrderId: poId } });
    const complete = after.every((l) => d(l.quantityReceived).greaterThanOrEqualTo(d(l.quantity)));
    await t.purchaseOrder.update({ where: { id: poId }, data: { status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED" } });
    await audit(t, actor, { action: "po.receive", entityType: "PurchaseOrder", entityId: poId, projectId: po.projectId, summary: `${po.number}: delivery received${input.reference ? ` (${input.reference})` : ""}${complete ? ", PO complete" : ", partial"}` });
    if (po.project.projectManagerId) await notifyUsers(t, [po.project.projectManagerId], { type: "material.received", title: `Delivery received: ${po.number}`, body: complete ? "All items received" : "Partial delivery", link: `/jobs/${po.projectId}/procurement/${poId}`, projectId: po.projectId }, actor.id);
    return receipt;
  });
}

// ─────────────── Supplier invoices: 3-way match ───────────────

export const supplierInvoiceSchema = z.object({
  supplierId: zId,
  purchaseOrderId: zOptId,
  invoiceNumber: zText(100),
  invoiceDate: zDate,
  dueDate: zOptDate,
  tax: zNonNeg.default(0),
  amount: zNonNeg.optional(),
  lines: z.array(z.object({ poLineId: zOptId, description: zText(300), quantity: zNonNeg, unitPrice: zNonNeg })).default([]),
});

export async function recordSupplierInvoice(actor: Actor, projectId: string, input: z.infer<typeof supplierInvoiceSchema>) {
  requirePerm(actor, "supplierInvoice.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    if (input.purchaseOrderId) {
      const po = await t.purchaseOrder.findUnique({ where: { id: input.purchaseOrderId } });
      assert(po && po.projectId === projectId && po.supplierId === input.supplierId, "The PO must belong to this job and supplier.");
    }
    const linesTotal = round2(sum(input.lines.map((l) => d(l.quantity).times(d(l.unitPrice)))));
    const amount = input.lines.length ? linesTotal : d(input.amount ?? 0);
    assert(amount.greaterThan(0), "Enter invoice lines or an amount.");
    const inv = await t.supplierInvoice.create({
      data: {
        projectId,
        supplierId: input.supplierId,
        purchaseOrderId: input.purchaseOrderId,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        amount,
        tax: input.tax,
        lines: { create: input.lines },
      },
    }).catch((e) => {
      if (String(e).includes("Unique")) throw new UserError("This supplier invoice number is already recorded.");
      throw e;
    });
    await runThreeWayMatch(t, inv.id);
    await audit(t, actor, { action: "supplierInvoice.create", entityType: "SupplierInvoice", entityId: inv.id, projectId, summary: `${p.number}: supplier invoice ${input.invoiceNumber} recorded (${amount.toFixed(2)})` });
    return inv;
  });
}

/** PO vs delivery vs invoice. Quantity invoiced must not exceed received; price within tolerance of PO. */
export async function runThreeWayMatch(t: Tx, invoiceId: string) {
  const inv = await t.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { include: { poLine: true } }, purchaseOrder: { include: { lines: true } } } });
  const tolerance = Number(await getSetting("procurement.matchTolerancePercent", t));
  const issues: string[] = [];
  if (!inv.purchaseOrder) {
    issues.push("No purchase order linked");
  } else if (!inv.lines.length) {
    const received = round2(sum(inv.purchaseOrder.lines.map((l) => d(l.quantityReceived).times(d(l.unitCost)))));
    const diff = d(inv.amount).minus(received);
    if (diff.abs().greaterThan(received.times(tolerance).dividedBy(100))) issues.push(`Invoice ${d(inv.amount).toFixed(2)} vs received value ${received.toFixed(2)}`);
  } else {
    // other invoices already billed on the same PO lines
    const others = await t.supplierInvoiceLine.findMany({ where: { poLineId: { in: inv.lines.map((l) => l.poLineId).filter((x): x is string => !!x) }, supplierInvoiceId: { not: inv.id } } });
    for (const l of inv.lines) {
      if (!l.poLine) { issues.push(`"${l.description}" is not on the PO`); continue; }
      const prevBilled = sum(others.filter((o) => o.poLineId === l.poLineId).map((o) => o.quantity));
      const billable = d(l.poLine.quantityReceived).minus(prevBilled);
      if (d(l.quantity).greaterThan(billable)) issues.push(`"${l.description}": invoiced ${d(l.quantity)} but only ${billable} received and not yet billed`);
      const poPrice = d(l.poLine.unitCost);
      const allowed = poPrice.times(1 + tolerance / 100);
      if (d(l.unitPrice).greaterThan(allowed)) issues.push(`"${l.description}": price ${d(l.unitPrice).toFixed(2)} vs PO ${poPrice.toFixed(2)}`);
    }
  }
  await t.supplierInvoice.update({ where: { id: invoiceId }, data: { matchStatus: issues.length ? "VARIANCE" : "MATCHED", matchNote: issues.join("; ") || "PO, delivery and invoice agree" } });
  return issues;
}

export async function recheckMatch(actor: Actor, invoiceId: string) {
  requirePerm(actor, "supplierInvoice.edit");
  return tx((t) => runThreeWayMatch(t, invoiceId));
}

export async function approveSupplierInvoice(actor: Actor, invoiceId: string, overrideReason?: string) {
  requirePerm(actor, "supplierInvoice.approve");
  return tx(async (t) => {
    const issues = await runThreeWayMatch(t, invoiceId);
    const inv = await t.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { project: true } });
    assert(inv.status === "RECEIVED" || inv.status === "DISPUTED", "This invoice is already approved.");
    if (issues.length && !(overrideReason && overrideReason.trim().length >= 5)) {
      throw new UserError(`3-way match variance: ${issues.join("; ")}. Approve with an override reason, or dispute the invoice.`);
    }
    await t.supplierInvoice.update({ where: { id: invoiceId }, data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date(), overrideReason: issues.length ? overrideReason : null } });
    await audit(t, actor, { action: "supplierInvoice.approve", entityType: "SupplierInvoice", entityId: invoiceId, projectId: inv.projectId, summary: `${inv.project.number}: supplier invoice ${inv.invoiceNumber} approved${issues.length ? ` with override — ${overrideReason}` : ""}` });
  });
}

export async function disputeSupplierInvoice(actor: Actor, invoiceId: string, note: string) {
  requirePerm(actor, "supplierInvoice.edit");
  return tx(async (t) => {
    const inv = await t.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { project: true } });
    await t.supplierInvoice.update({ where: { id: invoiceId }, data: { status: "DISPUTED", matchNote: `${inv.matchNote ?? ""} | Disputed: ${note}` } });
    await audit(t, actor, { action: "supplierInvoice.dispute", entityType: "SupplierInvoice", entityId: invoiceId, projectId: inv.projectId, summary: `${inv.project.number}: supplier invoice ${inv.invoiceNumber} disputed — ${note}` });
  });
}

export const supplierPaymentSchema = z.object({ paidAt: zDate, amount: zNonNeg.refine((v) => v > 0, "Amount must be more than 0"), reference: zOptText(100) });

export async function paySupplierInvoice(actor: Actor, invoiceId: string, input: z.infer<typeof supplierPaymentSchema>) {
  requirePerm(actor, "billing.edit");
  return tx(async (t) => {
    const inv = await t.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: true, project: true } });
    assert(inv.status === "APPROVED" || inv.status === "PAID", "Approve the invoice before paying it.");
    const total = d(inv.amount).plus(d(inv.tax));
    const paid = sum(inv.payments.map((p) => p.amount));
    const remaining = total.minus(paid);
    if (d(input.amount).greaterThan(remaining)) throw new UserError(`Payment exceeds the balance of ${remaining.toFixed(2)}.`);
    await t.supplierPayment.create({ data: { supplierInvoiceId: invoiceId, ...input } });
    const fully = paid.plus(d(input.amount)).greaterThanOrEqualTo(total);
    if (fully) await t.supplierInvoice.update({ where: { id: invoiceId }, data: { status: "PAID" } });
    await audit(t, actor, { action: "supplierInvoice.pay", entityType: "SupplierInvoice", entityId: invoiceId, projectId: inv.projectId, summary: `${inv.project.number}: paid ${input.amount.toFixed(2)} on supplier invoice ${inv.invoiceNumber}${fully ? " (paid in full)" : ""}` });
  });
}

// ─────────────── Manual materials & usage ───────────────

export const manualMaterialSchema = z.object({
  description: zText(300),
  manufacturer: zOptText(120),
  model: zOptText(120),
  quantity: zNonNeg,
  unit: zText(20).default("ea"),
  unitCost: zNonNeg.default(0),
  supplierId: zOptId,
  orderedByName: zOptText(120),
  orderedAt: zOptDate,
  status: z.enum(["ORDERED", "RECEIVED", "CANCELLED", "INVOICED"]).default("ORDERED"),
});

export async function addManualMaterial(actor: Actor, projectId: string, input: z.infer<typeof manualMaterialSchema>) {
  requirePerm(actor, "materials.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const m = await t.materialItem.create({
      data: {
        projectId,
        description: input.description,
        manufacturer: input.manufacturer,
        model: input.model,
        unit: input.unit,
        quantityRequired: input.quantity,
        budgetUnitCost: input.unitCost,
        manualUnitCost: input.unitCost,
        isManual: true,
        supplierId: input.supplierId,
        orderedByName: input.orderedByName ?? actor.name,
        orderedAt: input.orderedAt,
        manualStatus: input.status,
        createdById: actor.id,
      },
    });
    await audit(t, actor, { action: "material.manual.add", entityType: "MaterialItem", entityId: m.id, projectId, summary: `${p.number}: material "${input.description}" added (${input.status.toLowerCase()})` });
    return m;
  });
}

export async function setManualMaterialStatus(actor: Actor, itemId: string, status: "ORDERED" | "RECEIVED" | "CANCELLED" | "INVOICED") {
  requirePerm(actor, "materials.edit");
  return tx(async (t) => {
    const m = await t.materialItem.findUnique({ where: { id: itemId } });
    if (!m) throw new NotFoundError("Material");
    assert(m.isManual, "Status of PO materials follows their purchase order and deliveries.");
    await t.materialItem.update({ where: { id: itemId }, data: { manualStatus: status } });
    await audit(t, actor, { action: "material.manual.status", entityType: "MaterialItem", entityId: itemId, projectId: m.projectId, summary: `Material "${m.description}" → ${status.toLowerCase()}`, before: { status: m.manualStatus }, after: { status } });
  });
}

export const usageSchema = z.object({
  materialItemId: zOptId,
  description: zOptText(300),
  quantity: zNonNeg.refine((v) => v > 0, "Quantity must be more than 0"),
  unit: zOptText(20),
  usedOn: zDate,
  note: zOptText(),
});

export async function logMaterialUsage(actor: Actor, projectId: string, input: z.infer<typeof usageSchema>, workerId?: string | null) {
  if (!can(actor.role, "field.use")) requirePerm(actor, "materials.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    let description = input.description;
    let unit = input.unit ?? "ea";
    if (input.materialItemId) {
      const m = await t.materialItem.findUnique({ where: { id: input.materialItemId } });
      assert(m && m.projectId === projectId, "Material not found on this job.");
      description = m.description;
      unit = m.unit;
    }
    assert(description, "Describe the material used.");
    const u = await t.materialUsage.create({ data: { projectId, materialItemId: input.materialItemId, description: description!, quantity: input.quantity, unit, usedOn: input.usedOn, note: input.note, workerId: workerId ?? null, createdById: actor.id } });
    await audit(t, actor, { action: "material.usage", entityType: "MaterialUsage", entityId: u.id, projectId, summary: `${p.number}: ${input.quantity} ${unit} "${description}" used` });
    return u;
  });
}

// ─────────────── Read models ───────────────

export function lineOutstanding(l: Pick<PurchaseOrderLine, "quantity" | "quantityReceived">) {
  return d(l.quantity).minus(d(l.quantityReceived));
}

/** Material register with ordered / received / outstanding / used, computed from POs, receipts and usage. */
export async function materialRegister(projectId: string) {
  const items = await prisma.materialItem.findMany({
    where: { projectId },
    include: { poLines: { include: { purchaseOrder: { include: { supplier: true } } } }, usage: true },
    orderBy: [{ isManual: "asc" }, { description: "asc" }],
  });
  const suppliers = await prisma.organization.findMany({ where: { id: { in: items.map((i) => i.supplierId).filter((x): x is string => !!x) } } });
  const today = new Date();
  return items.map((i) => {
    const activeLines = i.poLines.filter((l) => l.purchaseOrder.status !== "CANCELLED");
    const ordered = i.isManual ? (i.manualStatus === "CANCELLED" ? d(0) : d(i.quantityRequired)) : sum(activeLines.map((l) => l.quantity));
    const received = i.isManual ? (["RECEIVED", "INVOICED"].includes(i.manualStatus ?? "") ? d(i.quantityRequired) : d(0)) : sum(activeLines.map((l) => l.quantityReceived));
    const used = sum(i.usage.map((u) => u.quantity));
    const late = activeLines.some((l) => l.expectedDate && l.expectedDate < today && d(l.quantityReceived).lessThan(d(l.quantity)));
    const status = i.isManual
      ? i.manualStatus ?? "ORDERED"
      : ordered.isZero() ? "REQUIRED" : received.greaterThanOrEqualTo(ordered) ? "RECEIVED" : "ORDERED";
    const committedCost = i.isManual ? (i.manualStatus === "CANCELLED" ? d(0) : round2(d(i.quantityRequired).times(d(i.manualUnitCost)))) : round2(sum(activeLines.map((l) => d(l.quantity).times(d(l.unitCost)))));
    return {
      item: i,
      suppliers: i.isManual ? suppliers.filter((s) => s.id === i.supplierId).map((s) => s.name) : [...new Set(activeLines.map((l) => l.purchaseOrder.supplier.name))],
      required: d(i.quantityRequired),
      ordered,
      received,
      outstanding: ordered.minus(received),
      toOrder: d(i.quantityRequired).minus(ordered).greaterThan(0) ? d(i.quantityRequired).minus(ordered) : d(0),
      used,
      late,
      status,
      budgetCost: round2(d(i.quantityRequired).times(d(i.budgetUnitCost))),
      committedCost,
    };
  });
}

/** Display status for a PO, combining delivery and shop drawing state. */
export function poDisplayStatus(po: PurchaseOrder & { shopDrawings: (ShopDrawing & { revisions: ShopDrawingRevision[] })[] }, invoiced: boolean) {
  if (po.status === "CANCELLED") return "Cancelled";
  if (po.status === "DRAFT") return "Draft";
  if (po.status === "RECEIVED") return invoiced ? "Delivered & invoiced" : "Delivered";
  const gate = drawingGate(po, po.shopDrawings);
  if (!gate.cleared) return "Drawings pending";
  if (po.status === "PARTIALLY_RECEIVED") return "Partially delivered";
  return po.shopDrawingsRequired ? "Drawings approved" : "Ordered";
}
