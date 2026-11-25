import { z } from "zod";
import { prisma, tx } from "@/lib/db";
import { requirePerm, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { d, round2, sum } from "@/lib/money";
import { nextProjectNumber } from "@/lib/numbering";
import { zDate, zNonNeg, zOptDate, zOptInt, zOptText, zText } from "@/lib/forms";
import { changeStage } from "@/lib/workflow";
import { loadProject } from "./projects";
import { recalcEstimate } from "./estimating";

export const rfqSchema = z.object({
  title: zText(200),
  dueDate: zOptDate,
  notes: zOptText(),
  supplierIds: z.array(z.string()).min(1, "Select at least one supplier"),
  lineIds: z.array(z.string()).min(1, "Select at least one BOM line"),
});

/** Build a quotation request (RFQ) from BOM lines and send it to selected suppliers. */
export async function createRfq(actor: Actor, estimateId: string, input: z.infer<typeof rfqSchema>) {
  requirePerm(actor, "quote.edit");
  return tx(async (t) => {
    const est = await t.estimate.findUnique({ where: { id: estimateId }, include: { project: true, lines: true } });
    if (!est) throw new NotFoundError("Estimate");
    const p = est.project;
    const lines = est.lines.filter((l) => input.lineIds.includes(l.id));
    assert(lines.length === input.lineIds.length, "Some selected lines do not belong to this estimate.");
    const suppliers = await t.organization.findMany({ where: { id: { in: input.supplierIds }, type: { in: ["SUPPLIER", "SUBCONTRACTOR"] } } });
    assert(suppliers.length === input.supplierIds.length, "Choose suppliers from the supplier directory.");
    const number = await nextProjectNumber(t, p.id, p.number, "RFQ");
    const rfq = await t.quoteRequest.create({
      data: {
        projectId: p.id,
        estimateId,
        number,
        title: input.title,
        dueDate: input.dueDate,
        notes: input.notes,
        createdById: actor.id,
        items: { create: lines.map((l) => ({ estimateLineId: l.id, description: l.description, manufacturer: l.manufacturer, model: l.model, quantity: l.quantity, unit: l.unit })) },
        suppliers: { create: suppliers.map((s) => ({ supplierId: s.id, followUpDate: input.dueDate })) },
      },
    });
    if (p.stage === "ESTIMATING") await changeStage(t, actor, p, "QUOTING", { note: `RFQ ${number} created` });
    await audit(t, actor, { action: "rfq.create", entityType: "QuoteRequest", entityId: rfq.id, projectId: p.id, summary: `${number}: RFQ for ${lines.length} item(s) to ${suppliers.map((s) => s.name).join(", ")}` });
    return rfq;
  });
}

export async function addRfqSupplier(actor: Actor, rfqId: string, supplierId: string) {
  requirePerm(actor, "quote.edit");
  return tx(async (t) => {
    const rfq = await t.quoteRequest.findUnique({ where: { id: rfqId } });
    if (!rfq) throw new NotFoundError("RFQ");
    const s = await t.organization.findUnique({ where: { id: supplierId } });
    assert(s, "Supplier not found.");
    await t.quoteRequestSupplier.create({ data: { quoteRequestId: rfqId, supplierId, followUpDate: rfq.dueDate } }).catch(() => {
      throw new UserError("That supplier is already on this RFQ.");
    });
    await audit(t, actor, { action: "rfq.supplier.add", entityType: "QuoteRequest", entityId: rfqId, projectId: rfq.projectId, summary: `${rfq.number}: ${s.name} added` });
  });
}

export async function setRfqSupplierStatus(actor: Actor, rfqSupplierId: string, action: "SENT" | "FOLLOWED_UP" | "DECLINED", followUpDate?: Date) {
  requirePerm(actor, "quote.edit");
  return tx(async (t) => {
    const rs = await t.quoteRequestSupplier.findUnique({ where: { id: rfqSupplierId }, include: { quoteRequest: true, supplier: true } });
    if (!rs) throw new NotFoundError("RFQ supplier");
    const data =
      action === "SENT" ? { sentAt: new Date(), ...(followUpDate ? { followUpDate } : {}) }
      : action === "FOLLOWED_UP" ? { lastFollowUpAt: new Date(), followUpDate: followUpDate ?? null }
      : { status: "DECLINED" as const };
    await t.quoteRequestSupplier.update({ where: { id: rfqSupplierId }, data });
    await audit(t, actor, { action: `rfq.supplier.${action.toLowerCase()}`, entityType: "QuoteRequest", entityId: rs.quoteRequestId, projectId: rs.quoteRequest.projectId, summary: `${rs.quoteRequest.number}: ${rs.supplier.name} ${action === "SENT" ? "sent" : action === "FOLLOWED_UP" ? "followed up" : "declined"}` });
  });
}

export const supplierQuoteSchema = z.object({
  supplierId: z.string().min(1),
  quoteNumber: zText(100),
  quoteDate: zDate,
  validUntil: zOptDate,
  leadTimeDays: zOptInt,
  freight: zNonNeg.default(0),
  notes: zOptText(),
  prices: z.record(z.string(), z.union([z.string(), z.number()])),
  leadTimes: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

/** Record a supplier's quotation against the RFQ items. Blank price = item not quoted. */
export async function recordSupplierQuote(actor: Actor, rfqId: string, input: z.infer<typeof supplierQuoteSchema>) {
  requirePerm(actor, "quote.edit");
  return tx(async (t) => {
    const rfq = await t.quoteRequest.findUnique({ where: { id: rfqId }, include: { items: true, suppliers: true } });
    if (!rfq) throw new NotFoundError("RFQ");
    const rs = rfq.suppliers.find((s) => s.supplierId === input.supplierId);
    assert(rs, "This supplier is not on the RFQ. Add them first.");
    if (input.validUntil && input.validUntil < input.quoteDate) throw new UserError("Valid-until date is before the quote date.");
    const lines: { rfqItemId: string; unitPrice: number; leadTimeDays: number | null }[] = [];
    for (const item of rfq.items) {
      const raw = input.prices[item.id];
      if (raw === undefined || String(raw).trim() === "") continue;
      const price = Number(String(raw).replace(/[$,]/g, ""));
      if (!isFinite(price) || price < 0) throw new UserError(`Invalid price for "${item.description}".`);
      const lt = input.leadTimes?.[item.id];
      lines.push({ rfqItemId: item.id, unitPrice: price, leadTimeDays: lt !== undefined && String(lt).trim() !== "" ? Math.round(Number(lt)) : input.leadTimeDays ?? null });
    }
    assert(lines.length > 0, "Enter at least one unit price.");
    const total = sum(lines.map((l) => d(l.unitPrice).times(d(rfq.items.find((i) => i.id === l.rfqItemId)!.quantity)))).plus(d(input.freight));
    const q = await t.supplierQuote.create({
      data: {
        quoteRequestId: rfqId,
        supplierId: input.supplierId,
        quoteNumber: input.quoteNumber,
        quoteDate: input.quoteDate,
        validUntil: input.validUntil,
        leadTimeDays: input.leadTimeDays,
        freight: input.freight,
        notes: input.notes,
        total: round2(total),
        lines: { create: lines },
      },
    });
    await t.quoteRequestSupplier.update({ where: { id: rs.id }, data: { status: "RECEIVED" } });
    await audit(t, actor, { action: "quote.record", entityType: "SupplierQuote", entityId: q.id, projectId: rfq.projectId, summary: `${rfq.number}: quote ${input.quoteNumber} recorded (${lines.length} item(s))` });
    return q;
  });
}

/** Comparison matrix: per item, every supplier's price, and the lowest. */
export async function getRfqComparison(rfqId: string) {
  const rfq = await prisma.quoteRequest.findUnique({
    where: { id: rfqId },
    include: {
      project: true,
      items: { include: { quoteLines: true, estimateLine: true }, orderBy: { description: "asc" } },
      suppliers: { include: { supplier: true } },
      quotes: { include: { supplier: true, lines: true }, orderBy: { quoteDate: "desc" } },
    },
  });
  if (!rfq) return null;
  const today = new Date();
  // latest quote per supplier counts
  const latestBySupplier = new Map<string, (typeof rfq.quotes)[number]>();
  for (const q of rfq.quotes) if (!latestBySupplier.has(q.supplierId)) latestBySupplier.set(q.supplierId, q);
  const quotes = [...latestBySupplier.values()];
  const rows = rfq.items.map((item) => {
    const prices = quotes.map((q) => {
      const ql = q.lines.find((l) => l.rfqItemId === item.id);
      return ql ? { quoteId: q.id, lineId: ql.id, unitPrice: d(ql.unitPrice), extended: round2(d(ql.unitPrice).times(d(item.quantity))), leadTimeDays: ql.leadTimeDays, expired: !!q.validUntil && q.validUntil < today } : null;
    });
    const valid = prices.filter((x): x is NonNullable<typeof x> => !!x && !x.expired);
    const lowest = valid.length ? valid.reduce((a, b) => (b.unitPrice.lessThan(a.unitPrice) ? b : a)) : null;
    return { item, prices, lowestLineId: lowest?.lineId ?? null };
  });
  const totals = quotes.map((q, qi) => {
    const covered = rows.filter((r) => r.prices[qi]).length;
    return { quote: q, total: d(q.total), covered, complete: covered === rows.length, expired: !!q.validUntil && q.validUntil < today };
  });
  const completeTotals = totals.filter((x) => x.complete && !x.expired);
  const bestOverall = completeTotals.length ? completeTotals.reduce((a, b) => (b.total.lessThan(a.total) ? b : a)).quote.id : null;
  return { rfq, quotes, rows, totals, bestOverall };
}

/** Select a supplier quote line for an RFQ item (null clears). */
export async function selectQuoteLine(actor: Actor, rfqItemId: string, quoteLineId: string | null) {
  requirePerm(actor, "quote.edit");
  return tx(async (t) => {
    const item = await t.quoteRequestItem.findUnique({ where: { id: rfqItemId }, include: { quoteRequest: true } });
    if (!item) throw new NotFoundError("RFQ item");
    if (quoteLineId) {
      const ql = await t.supplierQuoteLine.findUnique({ where: { id: quoteLineId } });
      assert(ql && ql.rfqItemId === rfqItemId, "That price is not for this item.");
    }
    await t.quoteRequestItem.update({ where: { id: rfqItemId }, data: { selectedQuoteLineId: quoteLineId } });
    await audit(t, actor, { action: "quote.select", entityType: "QuoteRequest", entityId: item.quoteRequestId, projectId: item.quoteRequest.projectId, summary: `${item.quoteRequest.number}: ${quoteLineId ? "supplier selected" : "selection cleared"} for "${item.description}"` });
  });
}

/** Select the lowest valid price for every item, or every item from one supplier quote. */
export async function selectAll(actor: Actor, rfqId: string, mode: { kind: "lowest" } | { kind: "quote"; quoteId: string }) {
  requirePerm(actor, "quote.edit");
  const cmp = await getRfqComparison(rfqId);
  if (!cmp) throw new NotFoundError("RFQ");
  return tx(async (t) => {
    let n = 0;
    for (const row of cmp.rows) {
      let lineId: string | null = null;
      if (mode.kind === "lowest") lineId = row.lowestLineId;
      else lineId = row.prices.find((p) => p?.quoteId === mode.quoteId)?.lineId ?? null;
      if (lineId) {
        await t.quoteRequestItem.update({ where: { id: row.item.id }, data: { selectedQuoteLineId: null } });
        await t.quoteRequestItem.update({ where: { id: row.item.id }, data: { selectedQuoteLineId: lineId } });
        n++;
      }
    }
    await audit(t, actor, { action: "quote.selectAll", entityType: "QuoteRequest", entityId: rfqId, projectId: cmp.rfq.projectId, summary: `${cmp.rfq.number}: ${n} item(s) selected (${mode.kind === "lowest" ? "lowest price" : "single supplier"})` });
    return n;
  });
}

/** Push selected supplier prices into the linked BOM lines of a DRAFT estimate. */
export async function applySelectionsToEstimate(actor: Actor, rfqId: string, estimateId: string) {
  requirePerm(actor, "estimate.edit");
  return tx(async (t) => {
    const est = await t.estimate.findUnique({ where: { id: estimateId }, include: { lines: true, project: true } });
    if (!est) throw new NotFoundError("Estimate");
    assert(est.status === "DRAFT", "Prices can only be applied to a draft estimate revision.");
    const items = await t.quoteRequestItem.findMany({ where: { quoteRequestId: rfqId, selectedQuoteLineId: { not: null } }, include: { selectedQuoteLine: true, estimateLine: true } });
    let updated = 0;
    for (const it of items) {
      // Match the line in this revision: same line id, or same description/manufacturer/model if copied to a new revision.
      const target =
        est.lines.find((l) => l.id === it.estimateLineId) ??
        est.lines.find((l) => it.estimateLine && l.description === it.estimateLine.description && (l.manufacturer ?? "") === (it.estimateLine.manufacturer ?? "") && (l.model ?? "") === (it.estimateLine.model ?? ""));
      if (!target || !it.selectedQuoteLine) continue;
      const price = d(it.selectedQuoteLine.unitPrice);
      await t.estimateLine.update({
        where: { id: target.id },
        data: { unitPrice: price, supplierQuoteLineId: it.selectedQuoteLine.id, materialTotal: target.category === "LABOUR" ? 0 : round2(d(target.quantity).times(price)) },
      });
      updated++;
    }
    await recalcEstimate(t, estimateId);
    await audit(t, actor, { action: "quote.apply", entityType: "Estimate", entityId: estimateId, projectId: est.projectId, summary: `${est.project.number}: supplier prices applied to ${updated} line(s) of estimate rev ${est.revision}` });
    return updated;
  });
}
