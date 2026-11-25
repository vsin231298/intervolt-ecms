import { z } from "zod";
import { prisma, tx, type Tx } from "@/lib/db";
import { requirePerm, requireAny, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { d, pct, round2, sum, type Dec } from "@/lib/money";
import { addDays, today } from "@/lib/dates";
import { nextInvoiceNumber } from "@/lib/numbering";
import { zDate, zNonNeg, zOptId, zOptText, zText } from "@/lib/forms";
import { notifyRoles, notifyUsers } from "@/lib/notify";
import { getSetting } from "@/lib/settings";
import { loadProject } from "./projects";

// ─────────────── Schedule of values ───────────────

export const sovSchema = z.object({ lines: z.array(z.object({ description: zText(300), scheduledValue: zNonNeg })).min(1) });

/** Split the base contract into billing lines. Allowed until the first draw; total must equal the original contract value. */
export async function setBaseSchedule(actor: Actor, projectId: string, input: z.infer<typeof sovSchema>) {
  requireAny(actor, ["billing.prepare", "billing.edit"]);
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const contract = await t.contract.findUnique({ where: { projectId } });
    assert(contract, "Record the contract first.");
    const draws = await t.progressDraw.count({ where: { projectId } });
    assert(draws === 0, "The schedule of values is locked once a progress draw exists.");
    const total = round2(sum(input.lines.map((l) => l.scheduledValue)));
    if (!total.equals(d(contract.originalValue))) throw new UserError(`Lines total ${total.toFixed(2)} but the original contract is ${d(contract.originalValue).toFixed(2)}.`);
    await t.billingLine.deleteMany({ where: { projectId, changeOrderId: null } });
    await t.billingLine.createMany({ data: input.lines.map((l, i) => ({ projectId, description: l.description, scheduledValue: l.scheduledValue, sortOrder: i })) });
    await audit(t, actor, { action: "billing.sov", entityType: "Project", entityId: projectId, projectId, summary: `${p.number}: schedule of values set (${input.lines.length} lines)`, after: input });
  });
}

// ─────────────── Progress draws ───────────────

export async function billingLinesWithProgress(projectId: string, t: Tx | typeof prisma = prisma) {
  const lines = await t.billingLine.findMany({ where: { projectId }, include: { drawLines: { include: { draw: true } } }, orderBy: { sortOrder: "asc" } });
  return lines.map((l) => {
    const billed = sum(l.drawLines.map((x) => x.thisPeriodAmount));
    return { line: l, billed, remaining: d(l.scheduledValue).minus(billed), percent: d(l.scheduledValue).isZero() ? d(0) : billed.dividedBy(d(l.scheduledValue)).times(100) };
  });
}

export const drawSchema = z.object({
  periodEnd: zDate,
  notes: zOptText(),
  /** billingLineId → percent complete to date (0–100) */
  percents: z.record(z.string(), z.union([z.string(), z.number()])),
});

export async function createDraw(actor: Actor, projectId: string, input: z.infer<typeof drawSchema>) {
  requirePerm(actor, "billing.prepare");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(["ACTIVATION", "EXECUTION", "CLOSEOUT"].includes(p.stage), "Progress draws apply to active jobs.");
    const open = await t.progressDraw.findFirst({ where: { projectId, status: { in: ["DRAFT", "SUBMITTED"] } } });
    assert(!open, `Draw #${open?.drawNumber} is still open. Approve and invoice it first.`);
    const lines = await billingLinesWithProgress(projectId, t);
    const drawLines: { billingLineId: string; previousAmount: Dec; thisPeriodAmount: Dec }[] = [];
    for (const l of lines) {
      const raw = input.percents[l.line.id];
      if (raw === undefined || String(raw).trim() === "") continue;
      const pctToDate = Number(raw);
      if (!isFinite(pctToDate) || pctToDate < 0 || pctToDate > 100) throw new UserError(`"${l.line.description}": percent must be 0 to 100.`);
      const toDate = round2(d(l.line.scheduledValue).times(pctToDate).dividedBy(100));
      const thisPeriod = toDate.minus(l.billed);
      if (thisPeriod.lessThan(0)) throw new UserError(`"${l.line.description}": ${pctToDate}% is less than already billed (${l.percent.toFixed(1)}%).`);
      if (!thisPeriod.isZero()) drawLines.push({ billingLineId: l.line.id, previousAmount: l.billed, thisPeriodAmount: thisPeriod });
    }
    assert(drawLines.length, "Nothing to bill this period.");
    const thisPeriod = sum(drawLines.map((x) => x.thisPeriodAmount));
    const holdback = pct(thisPeriod, p.holdbackPercent);
    const last = await t.progressDraw.aggregate({ where: { projectId }, _max: { drawNumber: true } });
    const draw = await t.progressDraw.create({ data: { projectId, drawNumber: (last._max.drawNumber ?? 0) + 1, periodEnd: input.periodEnd, thisPeriod, holdback, notes: input.notes, createdById: actor.id, lines: { create: drawLines } } });
    await audit(t, actor, { action: "draw.create", entityType: "ProgressDraw", entityId: draw.id, projectId, summary: `${p.number}: progress draw #${draw.drawNumber} prepared for ${thisPeriod.toFixed(2)} (holdback ${holdback.toFixed(2)})` });
    return draw;
  });
}

export async function deleteDraftDraw(actor: Actor, drawId: string) {
  requirePerm(actor, "billing.prepare");
  return tx(async (t) => {
    const dr = await t.progressDraw.findUnique({ where: { id: drawId } });
    if (!dr) throw new NotFoundError("Draw");
    assert(dr.status === "DRAFT", "Only draft draws can be deleted.");
    const later = await t.progressDraw.count({ where: { projectId: dr.projectId, drawNumber: { gt: dr.drawNumber } } });
    assert(later === 0, "Only the latest draw can be deleted.");
    await t.progressDraw.delete({ where: { id: drawId } });
    await audit(t, actor, { action: "draw.delete", entityType: "ProgressDraw", entityId: drawId, projectId: dr.projectId, summary: `Draft draw #${dr.drawNumber} deleted`, before: dr });
  });
}

export async function setDrawStatus(actor: Actor, drawId: string, status: "SUBMITTED" | "APPROVED") {
  requireAny(actor, ["billing.prepare", "billing.edit"]);
  return tx(async (t) => {
    const dr = await t.progressDraw.findUnique({ where: { id: drawId }, include: { project: true } });
    if (!dr) throw new NotFoundError("Draw");
    const ok = (status === "SUBMITTED" && dr.status === "DRAFT") || (status === "APPROVED" && dr.status === "SUBMITTED");
    assert(ok, `Draw is ${dr.status.toLowerCase()}.`);
    await t.progressDraw.update({ where: { id: drawId }, data: { status } });
    await audit(t, actor, { action: `draw.${status.toLowerCase()}`, entityType: "ProgressDraw", entityId: drawId, projectId: dr.projectId, summary: `${dr.project.number}: draw #${dr.drawNumber} ${status.toLowerCase()}` });
    if (status === "APPROVED") await notifyRoles(t, ["ACCOUNTING"], { type: "billing.due", title: `Draw #${dr.drawNumber} approved — invoice ${dr.project.number}`, link: `/jobs/${dr.projectId}/billing`, projectId: dr.projectId }, actor.id);
  });
}

// ─────────────── Invoices ───────────────

async function invoiceDefaults(t: Tx) {
  return { taxPercent: Number(await getSetting("tax.percent", t)), terms: Number(await getSetting("billing.paymentTermsDays", t)) };
}

export async function invoiceDraw(actor: Actor, drawId: string, input: { invoiceDate: Date; clientPoId?: string }) {
  requirePerm(actor, "billing.edit");
  return tx(async (t) => {
    const dr = await t.progressDraw.findUnique({ where: { id: drawId }, include: { project: true, invoice: true } });
    if (!dr) throw new NotFoundError("Draw");
    assert(dr.status === "APPROVED", "Approve the draw before invoicing it.");
    assert(!dr.invoice, "This draw is already invoiced.");
    const { taxPercent, terms } = await invoiceDefaults(t);
    const net = d(dr.thisPeriod).minus(d(dr.holdback));
    const tax = pct(net, taxPercent);
    const clientPoId = input.clientPoId ?? (await t.clientPO.findFirst({ where: { projectId: dr.projectId }, orderBy: { createdAt: "asc" } }))?.id;
    const inv = await t.invoice.create({
      data: {
        projectId: dr.projectId,
        number: await nextInvoiceNumber(t, input.invoiceDate.getUTCFullYear()),
        clientPoId,
        drawId,
        description: `Progress draw #${dr.drawNumber} to ${dr.periodEnd.toISOString().slice(0, 10)}`,
        invoiceDate: input.invoiceDate,
        dueDate: addDays(input.invoiceDate, terms),
        subtotal: dr.thisPeriod,
        holdback: dr.holdback,
        taxPercent,
        tax,
        total: net.plus(tax),
        createdById: actor.id,
      },
    });
    await t.progressDraw.update({ where: { id: drawId }, data: { status: "INVOICED" } });
    await audit(t, actor, { action: "invoice.create", entityType: "Invoice", entityId: inv.id, projectId: dr.projectId, summary: `${dr.project.number}: invoice ${inv.number} for ${d(inv.total).toFixed(2)} from draw #${dr.drawNumber}` });
    return inv;
  });
}

export const manualInvoiceSchema = z.object({
  description: zText(500),
  invoiceDate: zDate,
  amount: zNonNeg.refine((v) => v > 0, "Amount must be more than 0"),
  clientPoId: zOptId,
  changeOrderId: zOptId,
  applyHoldback: z.boolean().default(false),
  isFinal: z.boolean().default(false),
});

/** Invoice not tied to a draw: service calls, T&M, approved extra work (change order) billed separately. */
export async function createManualInvoice(actor: Actor, projectId: string, input: z.infer<typeof manualInvoiceSchema>) {
  requirePerm(actor, "billing.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    if (input.changeOrderId) {
      const co = await t.changeOrder.findUnique({ where: { id: input.changeOrderId }, include: { billingLine: { include: { drawLines: true } }, invoices: { where: { status: { not: "VOID" } } } } });
      assert(co && co.projectId === projectId && co.status === "APPROVED", "Only approved change orders can be invoiced.");
      const billedViaDraws = sum(co.billingLine?.drawLines.map((x) => x.thisPeriodAmount) ?? []);
      const billedDirect = sum(co.invoices.map((i) => i.subtotal));
      const remaining = d(co.approvedAmount).minus(billedViaDraws).minus(billedDirect);
      if (d(input.amount).greaterThan(remaining)) throw new UserError(`Only ${remaining.toFixed(2)} of ${co.number} remains to be invoiced.`);
    }
    if (input.clientPoId) {
      const po = await t.clientPO.findUnique({ where: { id: input.clientPoId } });
      assert(po && po.projectId === projectId, "Client PO not found on this job.");
    }
    const { taxPercent, terms } = await invoiceDefaults(t);
    const holdback = input.applyHoldback ? pct(input.amount, p.holdbackPercent) : d(0);
    const net = d(input.amount).minus(holdback);
    const tax = pct(net, taxPercent);
    const inv = await t.invoice.create({
      data: {
        projectId,
        number: await nextInvoiceNumber(t, input.invoiceDate.getUTCFullYear()),
        clientPoId: input.clientPoId,
        changeOrderId: input.changeOrderId,
        description: input.description,
        invoiceDate: input.invoiceDate,
        dueDate: addDays(input.invoiceDate, terms),
        subtotal: input.amount,
        holdback,
        taxPercent,
        tax,
        total: net.plus(tax),
        isFinal: input.isFinal,
        createdById: actor.id,
      },
    });
    await audit(t, actor, { action: "invoice.create", entityType: "Invoice", entityId: inv.id, projectId, summary: `${p.number}: invoice ${inv.number} for ${d(inv.total).toFixed(2)} — ${input.description}` });
    return inv;
  });
}

/** Release accumulated holdback as its own invoice (typically at closeout). */
export async function createHoldbackRelease(actor: Actor, projectId: string, invoiceDate: Date) {
  requirePerm(actor, "billing.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const invs = await t.invoice.findMany({ where: { projectId, status: { not: "VOID" } } });
    const retained = sum(invs.filter((i) => !i.isHoldbackRelease).map((i) => i.holdback));
    const released = sum(invs.filter((i) => i.isHoldbackRelease).map((i) => i.subtotal));
    const amount = retained.minus(released);
    assert(amount.greaterThan(0), "There is no holdback left to release.");
    const { taxPercent, terms } = await invoiceDefaults(t);
    const tax = pct(amount, taxPercent);
    const inv = await t.invoice.create({
      data: { projectId, number: await nextInvoiceNumber(t, invoiceDate.getUTCFullYear()), description: "Holdback release", invoiceDate, dueDate: addDays(invoiceDate, terms), subtotal: amount, holdback: 0, taxPercent, tax, total: amount.plus(tax), isHoldbackRelease: true, createdById: actor.id },
    });
    await audit(t, actor, { action: "invoice.holdback", entityType: "Invoice", entityId: inv.id, projectId, summary: `${p.number}: holdback release invoice ${inv.number} for ${amount.toFixed(2)}` });
    return inv;
  });
}

export async function setInvoiceStatus(actor: Actor, invoiceId: string, action: "SUBMIT" | "APPROVE" | "VOID" | "MARK_FINAL", opts: { approvedAmount?: number; reason?: string } = {}) {
  requirePerm(actor, "billing.edit");
  return tx(async (t) => {
    const inv = await t.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true, project: true } });
    if (!inv) throw new NotFoundError("Invoice");
    if (action === "SUBMIT") {
      assert(inv.status === "DRAFT", "Only draft invoices can be submitted.");
      await t.invoice.update({ where: { id: invoiceId }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    } else if (action === "APPROVE") {
      assert(inv.status === "SUBMITTED", "Only submitted invoices can be approved.");
      const amt = opts.approvedAmount ?? Number(inv.total);
      assert(amt >= 0 && d(amt).lessThanOrEqualTo(d(inv.total)), "Approved amount cannot exceed the invoice total.");
      await t.invoice.update({ where: { id: invoiceId }, data: { status: "APPROVED", approvedAmount: amt } });
    } else if (action === "VOID") {
      assert(inv.payments.length === 0, "Invoices with payments cannot be voided.");
      assert(opts.reason && opts.reason.trim().length >= 3, "Give a reason for voiding.");
      await t.invoice.update({ where: { id: invoiceId }, data: { status: "VOID" } });
      if (inv.drawId) await t.progressDraw.update({ where: { id: inv.drawId }, data: { status: "APPROVED" } });
      if (inv.drawId) await t.invoice.update({ where: { id: invoiceId }, data: { drawId: null } });
    } else if (action === "MARK_FINAL") {
      assert(inv.status !== "VOID", "Void invoices cannot be final.");
      await t.invoice.update({ where: { id: invoiceId }, data: { isFinal: true } });
    }
    await audit(t, actor, { action: `invoice.${action.toLowerCase()}`, entityType: "Invoice", entityId: invoiceId, projectId: inv.projectId, summary: `${inv.project.number}: invoice ${inv.number} ${action === "MARK_FINAL" ? "marked final" : action.toLowerCase() + (action === "SUBMIT" ? "ted" : action === "APPROVE" ? "d" : "ed")}${opts.approvedAmount !== undefined ? ` at ${opts.approvedAmount.toFixed(2)}` : ""}${opts.reason ? ` — ${opts.reason}` : ""}` });
  });
}

export const paymentSchema = z.object({ receivedAt: zDate, amount: zNonNeg.refine((v) => v > 0, "Amount must be more than 0"), method: zOptText(50), reference: zOptText(100) });

export async function recordPayment(actor: Actor, invoiceId: string, input: z.infer<typeof paymentSchema>) {
  requirePerm(actor, "billing.edit");
  return tx(async (t) => {
    const inv = await t.invoice.findUnique({ where: { id: invoiceId }, include: { project: true } });
    if (!inv) throw new NotFoundError("Invoice");
    assert(["SUBMITTED", "APPROVED", "PARTIALLY_PAID"].includes(inv.status), "Payments can only be recorded on submitted invoices.");
    const due = d(inv.approvedAmount ?? inv.total);
    const balance = due.minus(d(inv.paidAmount));
    if (d(input.amount).greaterThan(balance)) throw new UserError(`Payment exceeds the balance of ${balance.toFixed(2)}.`);
    await t.payment.create({ data: { invoiceId, ...input, createdById: actor.id } });
    const paid = d(inv.paidAmount).plus(d(input.amount));
    const status = paid.greaterThanOrEqualTo(due) ? "PAID" : "PARTIALLY_PAID";
    await t.invoice.update({ where: { id: invoiceId }, data: { paidAmount: paid, status } });
    await audit(t, actor, { action: "payment.record", entityType: "Invoice", entityId: invoiceId, projectId: inv.projectId, summary: `${inv.project.number}: payment ${input.amount.toFixed(2)} received on ${inv.number}${status === "PAID" ? " (paid in full)" : ""}` });
    await notifyUsers(t, [inv.project.projectManagerId], { type: "payment.received", title: `Payment received: ${inv.number}`, body: `${input.amount.toFixed(2)} on ${inv.project.number}`, link: `/jobs/${inv.projectId}/billing`, projectId: inv.projectId }, actor.id);
  });
}

export function invoiceBalance(inv: { total: unknown; approvedAmount: unknown; paidAmount: unknown; status: string }) {
  if (inv.status === "VOID" || inv.status === "DRAFT") return d(0);
  return d(inv.approvedAmount as Dec | null ?? inv.total as Dec).minus(d(inv.paidAmount as Dec));
}

// ─────────────── Read models ───────────────

/** Project-wise financial summary. Material cost = approved supplier invoices, or committed PO value where not yet invoiced. */
export async function projectFinancials(projectId: string) {
  const [contract, invoices, pos, supplierInvoices, time, manual, cos] = await Promise.all([
    prisma.contract.findUnique({ where: { projectId } }),
    prisma.invoice.findMany({ where: { projectId, status: { not: "VOID" } } }),
    prisma.purchaseOrder.findMany({ where: { projectId, status: { not: "CANCELLED" } }, include: { supplierInvoices: true } }),
    prisma.supplierInvoice.findMany({ where: { projectId }, include: { payments: true } }),
    prisma.timeEntry.aggregate({ where: { projectId }, _sum: { cost: true, regularHours: true, overtimeHours: true } }),
    prisma.materialItem.findMany({ where: { projectId, isManual: true, manualStatus: { not: "CANCELLED" } } }),
    prisma.changeOrder.findMany({ where: { projectId } }),
  ]);
  const est = contract?.awardedEstimateId ? await prisma.estimate.findUnique({ where: { id: contract.awardedEstimateId } }) : null;
  const billed = sum(invoices.filter((i) => i.status !== "DRAFT" && !i.isHoldbackRelease).map((i) => i.subtotal));
  const holdbackRetained = sum(invoices.filter((i) => i.status !== "DRAFT" && !i.isHoldbackRelease).map((i) => i.holdback)).minus(sum(invoices.filter((i) => i.isHoldbackRelease && i.status !== "DRAFT").map((i) => i.subtotal)));
  const received = sum(invoices.map((i) => i.paidAmount));
  const outstanding = sum(invoices.map((i) => invoiceBalance(i)));
  const committed = sum(pos.map((p) => p.total)).plus(sum(manual.map((m) => d(m.quantityRequired).times(d(m.manualUnitCost)))));
  // actual material: invoiced amount for POs with invoices, PO value otherwise
  const materialActual = sum(pos.map((p) => (p.supplierInvoices.length ? sum(p.supplierInvoices.map((s) => s.amount)) : d(p.total))))
    .plus(sum(supplierInvoices.filter((s) => !s.purchaseOrderId).map((s) => s.amount)))
    .plus(sum(manual.map((m) => d(m.quantityRequired).times(d(m.manualUnitCost)))));
  const supplierOwed = sum(supplierInvoices.map((s) => d(s.amount).plus(d(s.tax)).minus(sum(s.payments.map((p) => p.amount)))));
  const labourActual = d(time._sum.cost);
  const approvedCos = cos.filter((c) => c.status === "APPROVED");
  const estMaterial = d(est?.materialTotal).plus(d(est?.equipmentTotal)).plus(d(est?.subcontractTotal)).plus(sum(approvedCos.map((c) => d(c.materialCost).plus(d(c.otherCost)))));
  const estLabour = d(est?.labourTotal).plus(sum(approvedCos.map((c) => c.labourCost)));
  const revenue = d(contract?.currentValue);
  const cost = materialActual.plus(labourActual);
  return {
    originalValue: d(contract?.originalValue),
    currentValue: revenue,
    approvedChanges: sum(approvedCos.map((c) => c.approvedAmount)),
    pendingChanges: sum(cos.filter((c) => c.status === "SUBMITTED").map((c) => c.proposedAmount)),
    billed,
    billedPercent: revenue.isZero() ? d(0) : billed.dividedBy(revenue).times(100),
    holdbackRetained,
    received,
    outstanding,
    committed,
    materialActual,
    labourActual,
    labourHours: d(time._sum.regularHours).plus(d(time._sum.overtimeHours)),
    supplierOwed,
    estMaterial,
    estLabour,
    estCost: estMaterial.plus(estLabour),
    cost,
    margin: revenue.minus(cost),
    marginPercent: revenue.isZero() ? d(0) : revenue.minus(cost).dividedBy(revenue).times(100),
  };
}

/** Accounts receivable aging across all jobs. */
export async function receivablesAging(asOf = today()) {
  const invs = await prisma.invoice.findMany({
    where: { status: { in: ["SUBMITTED", "APPROVED", "PARTIALLY_PAID"] } },
    include: { project: { include: { client: true } } },
    orderBy: { dueDate: "asc" },
  });
  return invs.map((i) => {
    const days = Math.floor((asOf.getTime() - i.dueDate.getTime()) / 86_400_000);
    const bucket = days <= 0 ? "Current" : days <= 30 ? "1–30" : days <= 60 ? "31–60" : days <= 90 ? "61–90" : "90+";
    return { invoice: i, balance: invoiceBalance(i), daysOverdue: Math.max(0, days), bucket };
  });
}

export const zInvoiceDate = zDate;
