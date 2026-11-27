/**
 * Billing sheet: the PM's billing copy of a service call / small job (the guys' work orders stay as written).
 * DRAFT → READY (to bill) → BILLED by the office admin after invoicing in QuickBooks.
 * The PM can reopen READY (not BILLED). CANCELLED = no bill.
 */
import { z } from "zod";
import { prisma, tx } from "@/lib/db";
import { requireAny, requirePerm, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { addDays } from "@/lib/dates";
import { d, pct, round2, sum } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { notifyRoles } from "@/lib/notify";

const SMALL = ["SERVICE", "SMALL_JOB"] as const;
const RETURNING = ["RETURN_VISIT", "WAITING_PARTS", "NEEDS_QUOTE"];
export const KINDS = ["LABOUR", "MATERIAL", "OTHER"] as const;
export type Kind = (typeof KINDS)[number];
export type Line = { kind: Kind; date: string | null; who: string | null; description: string; quantity: number; unitPrice: number | null };

const num = (v: unknown) => (v === "" || v == null ? null : Number(String(v).replace(/[$,\s]/g, "")));
export const lineSchema = z.object({
  kind: z.enum(KINDS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  who: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().min(1, "Every line needs a description").max(500),
  quantity: z.preprocess(num, z.number({ invalid_type_error: "Quantity must be a number" }).min(0).max(100000)),
  unitPrice: z.preprocess(num, z.number({ invalid_type_error: "Price must be a number" }).min(0).max(1_000_000).nullable()),
});
export const sheetSchema = z.object({
  description: z.string().trim().max(5000).default(""),
  lines: z.array(lineSchema).max(200),
});

const iso = (dt: Date) => dt.toISOString().slice(0, 10);

/** Starting point built from the guys' work orders and clocked hours (prices left for the PM). */
async function prefill(projectId: string): Promise<{ description: string; lines: Line[] }> {
  const signoffs = await prisma.workOrderSignoff.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  const entries = await prisma.timeEntry.findMany({ where: { projectId }, include: { worker: { select: { name: true } } }, orderBy: [{ date: "asc" }] });
  const labour = new Map<string, Line>();
  for (const e of entries) {
    const k = `${iso(e.date)}|${e.worker.name}`;
    const h = Number(e.regularHours) + Number(e.overtimeHours);
    const l = labour.get(k) ?? { kind: "LABOUR" as const, date: iso(e.date), who: e.worker.name, description: "Labour", quantity: 0, unitPrice: null };
    l.quantity = Math.round((l.quantity + h) * 100) / 100;
    labour.set(k, l);
  }
  const materials: Line[] = signoffs.flatMap((s) => (Array.isArray(s.materialsUsed) ? (s.materialsUsed as { item: string; quantity: string }[]) : []).map((m) => {
    const q = Number(String(m.quantity ?? "").replace(/[^\d.]/g, ""));
    const ok = Number.isFinite(q) && q > 0;
    return { kind: "MATERIAL" as const, date: null, who: null, description: ok || !m.quantity ? m.item : `${m.item} (${m.quantity})`, quantity: ok ? q : 1, unitPrice: null };
  }));
  const other: Line[] = signoffs.filter((s) => s.parkingAmount != null && Number(s.parkingAmount) > 0).map((s) => ({
    kind: "OTHER" as const, date: null, who: null, description: `Parking${s.parkingReceiptDocId ? " (receipt attached)" : ""}`, quantity: 1, unitPrice: Number(s.parkingAmount),
  }));
  return { description: signoffs.map((s) => s.workSummary.trim()).filter(Boolean).join("\n"), lines: [...labour.values(), ...materials, ...other] };
}

export function totals(lines: { quantity: unknown; unitPrice: unknown; kind: string }[], taxPercent: number) {
  const by = (k: string) => round2(sum(lines.filter((l) => l.kind === k).map((l) => d(l.quantity as number).times(d((l.unitPrice ?? 0) as number)))));
  const labour = by("LABOUR"), materials = by("MATERIAL"), other = by("OTHER");
  const subtotal = labour.plus(materials).plus(other);
  const tax = pct(subtotal, taxPercent);
  return { labour, materials, other, subtotal, tax, total: subtotal.plus(tax) };
}

/** The sheet for a job: saved one, or a prefilled starting point (not saved until the PM saves). */
export async function getSheet(actor: Actor, projectId: string) {
  requirePerm(actor, "jobs.view");
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { client: { select: { name: true } }, projectManager: { select: { name: true } } } });
  if (!project) throw new NotFoundError("Job");
  const saved = await prisma.billingSheet.findUnique({ where: { projectId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  const signoffs = await prisma.workOrderSignoff.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set([...signoffs.map((s) => s.completedById), saved?.readyById, saved?.billedById, saved?.cancelledById].filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const name = new Map(people.map((u) => [u.id, u.name]));
  const taxPercent = Number(await getSetting("tax.percent"));
  const base = saved
    ? { description: saved.description, lines: saved.lines.map((l) => ({ kind: l.kind as Kind, date: l.date ? iso(l.date) : null, who: l.who, description: l.description, quantity: Number(l.quantity), unitPrice: l.unitPrice == null ? null : Number(l.unitPrice) })) }
    : await prefill(projectId);
  return {
    project, sheet: saved, status: (saved?.status ?? "NEW") as "NEW" | "DRAFT" | "READY" | "BILLED" | "CANCELLED", ...base, taxPercent,
    totals: totals(base.lines, taxPercent),
    visits: signoffs.map((s) => ({ ...s, by: name.get(s.completedById) ?? "Unknown" })),
    who: (id: string | null | undefined) => (id ? name.get(id) ?? null : null),
    unfiled: project.pendingReview || signoffs.some((s) => !s.reviewedAt),
  };
}

/** PM / admin: save the sheet, and optionally mark it Ready to bill. */
export async function saveSheet(actor: Actor, projectId: string, raw: unknown, ready: boolean) {
  requirePerm(actor, "project.manage");
  const input = sheetSchema.parse(raw);
  return tx(async (t) => {
    const p = await t.project.findUnique({ where: { id: projectId } });
    if (!p) throw new NotFoundError("Job");
    const cur = await t.billingSheet.findUnique({ where: { projectId } });
    if (cur && cur.status !== "DRAFT") throw new UserError(cur.status === "BILLED" ? "Already billed. It can't be changed." : cur.status === "READY" ? "It's Ready to bill. Reopen it to change it." : "Job is cancelled. Reopen it first.");
    if (ready) {
      assert(!p.pendingReview && !(await t.workOrderSignoff.count({ where: { projectId, reviewedAt: null } })), "File this job's work orders first (Work Orders → Needs review).");
      assert(input.description.trim().length >= 3, "Write the description for the invoice.");
      assert(input.lines.length > 0, "Add at least one line.");
      const missing = input.lines.findIndex((l) => l.unitPrice == null);
      assert(missing < 0, `Add a price to "${input.lines[missing]?.description}".`);
    }
    const data = { description: input.description, status: ready ? "READY" : "DRAFT", updatedById: actor.id, ...(ready ? { readyAt: new Date(), readyById: actor.id } : {}) };
    const sheet = cur ? await t.billingSheet.update({ where: { id: cur.id }, data }) : await t.billingSheet.create({ data: { projectId, ...data } });
    await t.billingSheetLine.deleteMany({ where: { sheetId: sheet.id } });
    if (input.lines.length) {
      await t.billingSheetLine.createMany({ data: input.lines.map((l, i) => ({ sheetId: sheet.id, kind: l.kind, sortOrder: i, date: l.date ? new Date(`${l.date}T00:00:00.000Z`) : null, who: l.who || null, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })) });
    }
    const tt = totals(input.lines, Number(await getSetting("tax.percent", t)));
    await audit(t, actor, { action: ready ? "billing.ready" : "billing.save", entityType: "BillingSheet", entityId: sheet.id, projectId, summary: `${p.number}: billing sheet ${ready ? "Ready to bill" : "saved"} · ${tt.total.toFixed(2)} incl. tax` });
    if (ready) await notifyRoles(t, ["OFFICE_ADMIN", "ADMIN"], { type: "billing.ready", title: `Ready to bill: ${p.number} ${p.name}`, body: `$${tt.total.toFixed(2)} incl. tax · by ${actor.name}`, link: `/billing/${projectId}`, projectId }, actor.id);
    return sheet;
  });
}

/** PM / admin: take a Ready-to-bill (or cancelled) job back to draft. Not once billed. */
export async function reopenSheet(actor: Actor, projectId: string) {
  requirePerm(actor, "project.manage");
  return tx(async (t) => {
    const s = await t.billingSheet.findUnique({ where: { projectId }, include: { project: true } });
    if (!s) throw new NotFoundError("Billing sheet");
    assert(s.status !== "BILLED", "Already billed. It can't be reopened.");
    assert(s.status !== "DRAFT", "It's already open.");
    await t.billingSheet.update({ where: { id: s.id }, data: { status: "DRAFT", readyAt: null, readyById: null, cancelledAt: null, cancelledById: null, cancelReason: null } });
    await audit(t, actor, { action: "billing.reopen", entityType: "BillingSheet", entityId: s.id, projectId, summary: `${s.project.number}: billing sheet reopened (was ${s.status === "READY" ? "Ready to bill" : "cancelled"})` });
  });
}

/** PM / admin: no bill for this job. */
export async function cancelJobBilling(actor: Actor, projectId: string, reason?: string) {
  requirePerm(actor, "project.manage");
  return tx(async (t) => {
    const p = await t.project.findUnique({ where: { id: projectId } });
    if (!p) throw new NotFoundError("Job");
    const cur = await t.billingSheet.findUnique({ where: { projectId } });
    assert(cur?.status !== "BILLED", "Already billed.");
    const data = { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.id, cancelReason: reason?.trim() || null, readyAt: null, readyById: null };
    const s = cur ? await t.billingSheet.update({ where: { id: cur.id }, data }) : await t.billingSheet.create({ data: { projectId, ...data } });
    await audit(t, actor, { action: "billing.cancel", entityType: "BillingSheet", entityId: s.id, projectId, summary: `${p.number}: cancelled, no bill${reason ? ` (${reason})` : ""}` });
  });
}

/** Office admin / admin: invoiced in QuickBooks → Billed. Takes the job off the "Existing job" list. */
export async function markBilled(actor: Actor, projectId: string, qbInvoiceNo?: string) {
  requirePerm(actor, "billing.edit");
  return tx(async (t) => {
    const s = await t.billingSheet.findUnique({ where: { projectId }, include: { project: true } });
    assert(s && s.status === "READY", "Only Ready to bill jobs can be marked billed.");
    const now = new Date();
    await t.billingSheet.update({ where: { id: s.id }, data: { status: "BILLED", billedAt: now, billedById: actor.id, qbInvoiceNo: qbInvoiceNo?.trim() || null } });
    await t.project.update({ where: { id: projectId }, data: { billedAt: now, billedById: actor.id } });
    await audit(t, actor, { action: "job.billed", entityType: "BillingSheet", entityId: s.id, projectId, summary: `${s.project.number} billed${qbInvoiceNo ? `, QuickBooks invoice ${qbInvoiceNo}` : ""}` });
  });
}

export type Tab = "ready" | "finalize" | "returning" | "cancelled" | "billed";

/** Billing page: service calls and small jobs sorted into the five tabs. */
export async function billingBoard(actor: Actor) {
  requireAny(actor, ["project.manage", "billing.edit"]);
  const since = addDays(new Date(), -90);
  const jobs = await prisma.project.findMany({
    where: { jobType: { in: [...SMALL] }, pendingReview: false, mergedIntoId: null, signoffs: { some: {} }, OR: [{ billedAt: null }, { billedAt: { gte: since } }] },
    include: {
      client: { select: { name: true } },
      billingSheet: { include: { lines: true } },
      signoffs: { orderBy: { createdAt: "desc" }, select: { createdAt: true, jobStatus: true, reviewedAt: true, completedById: true } },
    },
    orderBy: { number: "desc" }, take: 1000,
  });
  const ids = [...new Set(jobs.flatMap((j) => [j.billingSheet?.readyById, j.billingSheet?.billedById, j.billingSheet?.cancelledById, j.signoffs[0]?.completedById]).filter((x): x is string => !!x))];
  const name = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const taxPercent = Number(await getSetting("tax.percent"));
  const rows = jobs.map((j) => {
    const s = j.billingSheet;
    const last = j.signoffs[0];
    const tab: Tab = s?.status === "BILLED" || j.billedAt ? "billed" : s?.status === "CANCELLED" ? "cancelled" : s?.status === "READY" ? "ready" : last && RETURNING.includes(last.jobStatus ?? "") ? "returning" : "finalize";
    return {
      id: j.id, number: j.number, name: j.name, location: j.location, customer: j.client?.name ?? j.siteContactName ?? j.name,
      tab, sheetStatus: s?.status ?? null, visits: j.signoffs.length, unfiled: j.signoffs.some((x) => !x.reviewedAt),
      lastAt: last?.createdAt ?? null, lastStatus: last?.jobStatus ?? null, lastBy: last ? name.get(last.completedById) ?? null : null,
      total: s ? totals(s.lines, taxPercent).total : null,
      readyAt: s?.readyAt ?? null, readyBy: s?.readyById ? name.get(s.readyById) ?? null : null,
      billedAt: s?.billedAt ?? j.billedAt, billedBy: s?.billedById ? name.get(s.billedById) ?? null : null, qbInvoiceNo: s?.qbInvoiceNo ?? null,
      cancelledAt: s?.cancelledAt ?? null, cancelReason: s?.cancelReason ?? null, cancelledBy: s?.cancelledById ? name.get(s.cancelledById) ?? null : null,
    };
  });
  const count = (t: Tab) => rows.filter((r) => r.tab === t).length;
  return { rows, counts: { ready: count("ready"), finalize: count("finalize"), returning: count("returning"), cancelled: count("cancelled"), billed: count("billed") } };
}

export async function readyCount() {
  return prisma.billingSheet.count({ where: { status: "READY" } });
}
