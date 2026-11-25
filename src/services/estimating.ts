import { z } from "zod";
import { LineCategory, type Estimate, type EstimateLine } from "@prisma/client";
import { prisma, tx, type Tx } from "@/lib/db";
import { requirePerm, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { d, pct, round2, sum } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { zNonNeg, zOptText, zPercent, zText } from "@/lib/forms";
import { changeStage } from "@/lib/workflow";
import { loadProject } from "./projects";

export const estimateLineSchema = z.object({
  category: z.nativeEnum(LineCategory),
  section: zOptText(100),
  description: zText(500),
  manufacturer: zOptText(120),
  model: zOptText(120),
  quantity: zNonNeg,
  unit: zText(20).default("ea"),
  unitPrice: zNonNeg.default(0),
  labourHoursPerUnit: zNonNeg.default(0),
});
export type EstimateLineInput = z.infer<typeof estimateLineSchema>;

export const estimateRatesSchema = z.object({
  title: zText(200),
  labourRate: zNonNeg,
  overheadPercent: zPercent,
  profitPercent: zPercent,
  notes: zOptText(),
});

function lineTotals(l: Pick<EstimateLine, "category" | "quantity" | "unitPrice" | "labourHoursPerUnit">) {
  const q = d(l.quantity);
  if (l.category === "LABOUR") return { materialTotal: d(0), labourHours: round2(q) };
  return { materialTotal: round2(q.times(d(l.unitPrice))), labourHours: round2(q.times(d(l.labourHoursPerUnit))) };
}

/** Recompute all totals from lines. Never trust totals sent from the browser. */
export async function recalcEstimate(t: Tx, estimateId: string) {
  const est = await t.estimate.findUniqueOrThrow({ where: { id: estimateId }, include: { lines: true } });
  const by = (c: LineCategory) => sum(est.lines.filter((l) => l.category === c).map((l) => l.materialTotal));
  const materialTotal = by("MATERIAL");
  const equipmentTotal = by("EQUIPMENT");
  const subcontractTotal = by("SUBCONTRACT");
  const labourHours = sum(est.lines.map((l) => l.labourHours));
  const labourTotal = round2(labourHours.times(d(est.labourRate)));
  const directCost = materialTotal.plus(labourTotal).plus(equipmentTotal).plus(subcontractTotal);
  const overheadAmount = pct(directCost, est.overheadPercent);
  const profitAmount = pct(directCost.plus(overheadAmount), est.profitPercent);
  const sellPrice = directCost.plus(overheadAmount).plus(profitAmount);
  return t.estimate.update({
    where: { id: estimateId },
    data: { materialTotal, equipmentTotal, subcontractTotal, labourHours, labourTotal, directCost, overheadAmount, profitAmount, sellPrice },
  });
}

async function loadDraft(t: Tx, estimateId: string) {
  const est = await t.estimate.findUnique({ where: { id: estimateId }, include: { project: true } });
  if (!est) throw new NotFoundError("Estimate");
  assert(est.status === "DRAFT", `Revision ${est.revision} is ${est.status.toLowerCase()} and locked. Create a new revision to make changes.`);
  return est;
}

/** Create a new estimate revision, optionally copying lines from an earlier revision. */
export async function createEstimate(actor: Actor, projectId: string, opts: { basedOnId?: string; title?: string } = {}) {
  requirePerm(actor, "estimate.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(p.stage !== "CLOSED", "This job is closed.");
    const last = await t.estimate.findFirst({ where: { projectId }, orderBy: { revision: "desc" } });
    const base = opts.basedOnId ? await t.estimate.findUnique({ where: { id: opts.basedOnId }, include: { lines: true } }) : null;
    if (opts.basedOnId) assert(base && base.projectId === projectId, "Base revision not found.");
    const revision = (last?.revision ?? -1) + 1;
    const est = await t.estimate.create({
      data: {
        projectId,
        revision,
        title: opts.title || (base ? `${base.title}` : "Base estimate"),
        labourRate: base?.labourRate ?? (await getSetting("estimate.labourRate", t)),
        overheadPercent: base?.overheadPercent ?? (await getSetting("estimate.overheadPercent", t)),
        profitPercent: base?.profitPercent ?? (await getSetting("estimate.profitPercent", t)),
        notes: base?.notes,
        basedOnId: base?.id,
        createdById: actor.id,
      },
    });
    if (base?.lines.length) {
      await t.estimateLine.createMany({
        data: base.lines.map((l) => ({
          estimateId: est.id,
          sortOrder: l.sortOrder,
          category: l.category,
          section: l.section,
          description: l.description,
          manufacturer: l.manufacturer,
          model: l.model,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          labourHoursPerUnit: l.labourHoursPerUnit,
          supplierQuoteLineId: l.supplierQuoteLineId,
          materialTotal: l.materialTotal,
          labourHours: l.labourHours,
        })),
      });
    }
    await recalcEstimate(t, est.id);
    if (p.stage === "UNDER_REVIEW") await changeStage(t, actor, p, "ESTIMATING", { note: "Estimating started" });
    await audit(t, actor, { action: "estimate.create", entityType: "Estimate", entityId: est.id, projectId, summary: `${p.number}: estimate revision ${revision} created${base ? ` from revision ${base.revision}` : ""}` });
    return est;
  });
}

export async function updateEstimateRates(actor: Actor, estimateId: string, input: z.infer<typeof estimateRatesSchema>) {
  requirePerm(actor, "estimate.edit");
  return tx(async (t) => {
    const est = await loadDraft(t, estimateId);
    await t.estimate.update({ where: { id: estimateId }, data: input });
    await recalcEstimate(t, estimateId);
    await audit(t, actor, { action: "estimate.rates", entityType: "Estimate", entityId: estimateId, projectId: est.projectId, summary: `${est.project.number}: estimate rev ${est.revision} rates updated`, before: { labourRate: est.labourRate, overheadPercent: est.overheadPercent, profitPercent: est.profitPercent }, after: input });
  });
}

export async function addEstimateLines(actor: Actor, estimateId: string, lines: EstimateLineInput[]) {
  requirePerm(actor, "estimate.edit");
  return tx(async (t) => {
    const est = await loadDraft(t, estimateId);
    const max = await t.estimateLine.aggregate({ where: { estimateId }, _max: { sortOrder: true } });
    let order = max._max.sortOrder ?? 0;
    for (const l of lines) {
      const totals = lineTotals({ ...l, quantity: d(l.quantity), unitPrice: d(l.unitPrice), labourHoursPerUnit: d(l.labourHoursPerUnit) });
      await t.estimateLine.create({ data: { ...l, estimateId, sortOrder: ++order, ...totals } });
    }
    await recalcEstimate(t, estimateId);
    await audit(t, actor, { action: "estimate.lines.add", entityType: "Estimate", entityId: estimateId, projectId: est.projectId, summary: `${est.project.number}: ${lines.length} line(s) added to estimate rev ${est.revision}` });
  });
}

export async function updateEstimateLine(actor: Actor, lineId: string, input: EstimateLineInput) {
  requirePerm(actor, "estimate.edit");
  return tx(async (t) => {
    const line = await t.estimateLine.findUnique({ where: { id: lineId } });
    if (!line) throw new NotFoundError("Line");
    const est = await loadDraft(t, line.estimateId);
    const totals = lineTotals({ ...input, quantity: d(input.quantity), unitPrice: d(input.unitPrice), labourHoursPerUnit: d(input.labourHoursPerUnit) });
    const priceChanged = !d(line.unitPrice).equals(d(input.unitPrice));
    await t.estimateLine.update({ where: { id: lineId }, data: { ...input, ...totals, ...(priceChanged ? { supplierQuoteLineId: null } : {}) } });
    await recalcEstimate(t, line.estimateId);
    await audit(t, actor, { action: "estimate.line.update", entityType: "Estimate", entityId: est.id, projectId: est.projectId, summary: `${est.project.number}: estimate rev ${est.revision} line "${input.description}" updated`, before: line, after: input });
  });
}

export async function deleteEstimateLine(actor: Actor, lineId: string) {
  requirePerm(actor, "estimate.edit");
  return tx(async (t) => {
    const line = await t.estimateLine.findUnique({ where: { id: lineId } });
    if (!line) throw new NotFoundError("Line");
    const est = await loadDraft(t, line.estimateId);
    await t.estimateLine.delete({ where: { id: lineId } });
    await recalcEstimate(t, line.estimateId);
    await audit(t, actor, { action: "estimate.line.delete", entityType: "Estimate", entityId: est.id, projectId: est.projectId, summary: `${est.project.number}: estimate rev ${est.revision} line "${line.description}" removed`, before: line });
  });
}

/** Lock a revision as Final. Earlier Final revisions become Superseded. */
export async function finalizeEstimate(actor: Actor, estimateId: string) {
  requirePerm(actor, "estimate.finalize");
  return tx(async (t) => {
    const est = await loadDraft(t, estimateId);
    const count = await t.estimateLine.count({ where: { estimateId } });
    assert(count > 0, "An estimate needs at least one line before it can be finalized.");
    await t.estimate.updateMany({ where: { projectId: est.projectId, status: "FINAL" }, data: { status: "SUPERSEDED" } });
    await t.estimate.update({ where: { id: estimateId }, data: { status: "FINAL", finalizedAt: new Date(), finalizedById: actor.id } });
    await audit(t, actor, { action: "estimate.finalize", entityType: "Estimate", entityId: estimateId, projectId: est.projectId, summary: `${est.project.number}: estimate rev ${est.revision} finalized` });
  });
}

export type EstimateWithLines = Estimate & { lines: EstimateLine[] };

/** Line-by-line comparison of two revisions, matched on category + description + manufacturer + model. */
export function compareEstimates(a: EstimateWithLines, b: EstimateWithLines) {
  const key = (l: EstimateLine) => [l.category, l.description.trim().toLowerCase(), (l.manufacturer ?? "").toLowerCase(), (l.model ?? "").toLowerCase()].join("|");
  const mapA = new Map(a.lines.map((l) => [key(l), l]));
  const mapB = new Map(b.lines.map((l) => [key(l), l]));
  const keys = [...new Set([...mapA.keys(), ...mapB.keys()])];
  const rows = keys.map((k) => {
    const la = mapA.get(k);
    const lb = mapB.get(k);
    const totalA = la ? d(la.materialTotal).plus(d(la.labourHours).times(d(a.labourRate))) : d(0);
    const totalB = lb ? d(lb.materialTotal).plus(d(lb.labourHours).times(d(b.labourRate))) : d(0);
    return {
      key: k,
      description: (lb ?? la)!.description,
      category: (lb ?? la)!.category,
      a: la ?? null,
      b: lb ?? null,
      change: !la ? "added" : !lb ? "removed" : !d(la.quantity).equals(d(lb.quantity)) || !d(la.unitPrice).equals(d(lb.unitPrice)) || !d(la.labourHoursPerUnit).equals(d(lb.labourHoursPerUnit)) ? "changed" : "same",
      delta: round2(totalB.minus(totalA)),
    };
  });
  const order = { added: 0, removed: 1, changed: 2, same: 3 } as const;
  rows.sort((x, y) => order[x.change as keyof typeof order] - order[y.change as keyof typeof order]);
  return rows;
}

export async function getEstimate(id: string) {
  return prisma.estimate.findUnique({ where: { id }, include: { lines: { orderBy: { sortOrder: "asc" } }, project: true } });
}

/** Parse pasted BOM rows (tab or comma separated, e.g. from Excel). Columns:
 * description, manufacturer, model, quantity, unit, unit price, labour hrs/unit */
export function parseBomPaste(text: string, category: LineCategory = "MATERIAL"): EstimateLineInput[] {
  const out: EstimateLineInput[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols = raw.includes("\t") ? raw.split("\t") : raw.split(",");
    const [description, manufacturer, model, quantity, unit, unitPrice, hpu] = cols.map((c) => c.trim());
    if (!description || /^description$/i.test(description)) continue;
    const parsed = estimateLineSchema.safeParse({ category, description, manufacturer, model, quantity: quantity || "0", unit: unit || "ea", unitPrice: unitPrice || "0", labourHoursPerUnit: hpu || "0" });
    if (parsed.success) out.push(parsed.data);
    else throw new UserError(`Could not read row "${raw.slice(0, 60)}": ${parsed.error.issues[0]?.message}`);
  }
  return out;
}
