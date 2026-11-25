import { prisma } from "@/lib/db";
import { addDays, today } from "@/lib/dates";
import { d, sum } from "@/lib/money";
import { LEAD_STAGES } from "@/lib/workflow";
import { invoiceBalance, projectFinancials } from "./billing";

export async function operationsKpis() {
  const day = today();
  const [active, byType, newLeads, awaitingSubmission, awarded90, lost90, execution, sdPending, quotesOutstanding, deliveriesPending, deadlines, rfis, cos, invoicesAwaiting, invoicesOverdue, approachingCloseout] = await Promise.all([
    prisma.project.count({ where: { stage: { in: ["ACTIVATION", "EXECUTION", "CLOSEOUT"] } } }),
    prisma.project.groupBy({ by: ["jobType"], where: { stage: { in: ["ACTIVATION", "EXECUTION", "CLOSEOUT"] } }, _count: true }),
    prisma.project.count({ where: { stage: { in: ["OPPORTUNITY", "UNDER_REVIEW"] } } }),
    prisma.project.count({ where: { stage: { in: ["ESTIMATING", "QUOTING", "READY_TO_SUBMIT"] } } }),
    prisma.tenderSubmission.count({ where: { outcome: "AWARDED", outcomeDate: { gte: addDays(day, -90) } } }),
    prisma.tenderSubmission.count({ where: { outcome: "NOT_AWARDED", outcomeDate: { gte: addDays(day, -90) } } }),
    prisma.project.count({ where: { stage: "EXECUTION" } }),
    prisma.shopDrawingRevision.count({ where: { status: { in: ["INTERNAL_REVIEW", "SUBMITTED", "UNDER_REVIEW"] } } }),
    prisma.quoteRequestSupplier.count({ where: { status: "PENDING" } }),
    prisma.purchaseOrder.count({ where: { status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] } } }),
    prisma.project.count({ where: { stage: { in: LEAD_STAGES.filter((s) => s !== "SUBMITTED") }, submissionDeadline: { gte: new Date(), lte: addDays(new Date(), 14) } } }),
    prisma.rfi.count({ where: { status: "OPEN" } }),
    prisma.changeOrder.count({ where: { status: { in: ["DRAFT", "SUBMITTED"] } } }),
    prisma.invoice.count({ where: { status: { in: ["SUBMITTED", "APPROVED", "PARTIALLY_PAID"] } } }),
    prisma.invoice.count({ where: { status: { in: ["SUBMITTED", "APPROVED", "PARTIALLY_PAID"] }, dueDate: { lt: day } } }),
    prisma.project.count({ where: { OR: [{ stage: "CLOSEOUT" }, { stage: "EXECUTION", finishDate: { lte: addDays(day, 30) } }] } }),
  ]);
  return { active, byType: Object.fromEntries(byType.map((b) => [b.jobType, b._count])) as Record<string, number>, newLeads, awaitingSubmission, awarded90, lost90, execution, sdPending, quotesOutstanding, deliveriesPending, deadlines, rfis, cos, invoicesAwaiting, invoicesOverdue, approachingCloseout };
}

/** Upcoming items for "My schedule": meetings, inspections, tender deadlines, tasks, deliveries. */
export async function agenda(userId: string, from: Date, to: Date, all = false) {
  const [events, inspections, deadlines, tasks, deliveries] = await Promise.all([
    prisma.calendarEvent.findMany({ where: { startsAt: { gte: from, lt: to }, ...(all ? {} : { attendees: { some: { userId } } }) }, include: { project: true, attendees: { include: { user: true } } }, orderBy: { startsAt: "asc" } }),
    prisma.inspection.findMany({ where: { scheduledAt: { gte: from, lt: to }, result: "SCHEDULED", ...(all ? {} : { project: { OR: [{ projectManagerId: userId }, { members: { some: { userId } } }] } }) }, include: { project: true } }),
    prisma.project.findMany({ where: { submissionDeadline: { gte: from, lt: to }, stage: { in: LEAD_STAGES }, ...(all ? {} : { OR: [{ estimatorId: userId }, { projectManagerId: userId }] }) } }),
    prisma.task.findMany({ where: { dueDate: { gte: from, lt: to }, status: { not: "DONE" }, ...(all ? {} : { assigneeId: userId }) }, include: { project: true } }),
    prisma.purchaseOrder.findMany({ where: { expectedDelivery: { gte: from, lt: to }, status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] }, ...(all ? {} : { project: { OR: [{ projectManagerId: userId }, { members: { some: { userId } } }] } }) }, include: { project: true, supplier: true } }),
  ]);
  type Item = { at: Date; end?: Date; kind: "Meeting" | "Inspection" | "Tender due" | "Task due" | "Delivery"; title: string; href: string; sub?: string; id: string };
  const items: Item[] = [
    ...events.map((e) => ({ id: e.id, at: e.startsAt, end: e.endsAt, kind: "Meeting" as const, title: e.title, href: `/calendar?date=${e.startsAt.toISOString().slice(0, 10)}`, sub: [e.location, e.project?.number].filter(Boolean).join(" · ") })),
    ...inspections.map((i) => ({ id: i.id, at: i.scheduledAt, kind: "Inspection" as const, title: `${i.type}`, href: `/jobs/${i.projectId}/inspections`, sub: `${i.project.number} ${i.project.name}` })),
    ...deadlines.map((p) => ({ id: p.id, at: p.submissionDeadline!, kind: "Tender due" as const, title: p.name, href: `/jobs/${p.id}`, sub: p.number })),
    ...tasks.map((t) => ({ id: t.id, at: t.dueDate!, kind: "Task due" as const, title: t.title, href: `/jobs/${t.projectId}/tasks`, sub: t.project.number })),
    ...deliveries.map((p) => ({ id: p.id, at: p.expectedDelivery!, kind: "Delivery" as const, title: `${p.number} — ${p.supplier.name}`, href: `/jobs/${p.projectId}/procurement/${p.id}`, sub: p.project.number })),
  ];
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export type ClaimBucket = "draft" | "submitted" | "approvedNotInvoiced" | "approvedWithPo" | "approvedInvoiced" | "rejected";

/** Projects dashboard: claims pipeline for RFIs, ESIs / change orders and shop drawings. */
export async function claimsPipeline() {
  const [rfis, cos, sds] = await Promise.all([
    prisma.rfi.findMany({ where: { project: { stage: { not: "CLOSED" } } }, include: { project: true } }),
    prisma.changeOrder.findMany({ include: { project: true, esi: true, rfi: true, invoices: { where: { status: { notIn: ["VOID", "DRAFT"] } } }, billingLine: { include: { drawLines: { include: { draw: { include: { invoice: true } } } } } } } }),
    prisma.shopDrawing.findMany({ where: { project: { stage: { not: "CLOSED" } } }, include: { project: true, revisions: { orderBy: { revision: "desc" }, take: 1 } } }),
  ]);
  const coRows = cos.map((c) => {
    const invoicedViaDraw = sum(c.billingLine?.drawLines.filter((x) => x.draw.invoice && x.draw.invoice.status !== "VOID").map((x) => x.thisPeriodAmount) ?? []);
    const invoicedDirect = sum(c.invoices.map((i) => i.subtotal));
    const invoiced = invoicedViaDraw.plus(invoicedDirect);
    let bucket: ClaimBucket;
    if (c.status === "DRAFT") bucket = "draft";
    else if (c.status === "SUBMITTED") bucket = "submitted";
    else if (c.status === "REJECTED") bucket = "rejected";
    else if (invoiced.greaterThan(0)) bucket = "approvedInvoiced";
    else if (c.clientPoNumber) bucket = "approvedWithPo";
    else bucket = "approvedNotInvoiced";
    return { co: c, bucket, invoiced, value: d(c.approvedAmount ?? c.proposedAmount) };
  });
  const rfiRows = rfis.map((r) => ({ rfi: r, bucket: (!r.sentAt ? "draft" : r.status === "OPEN" ? "submitted" : "approvedNotInvoiced") as ClaimBucket }));
  const sdRows = sds.map((s) => {
    const st = s.revisions[0]?.status ?? "IN_PREPARATION";
    const bucket: ClaimBucket = ["IN_PREPARATION", "INTERNAL_REVIEW"].includes(st) ? "draft" : ["SUBMITTED", "UNDER_REVIEW"].includes(st) ? "submitted" : st === "REVISE_AND_RESUBMIT" ? "rejected" : "approvedNotInvoiced";
    return { sd: s, status: st, bucket };
  });
  return { coRows, rfiRows, sdRows };
}

/** Finance dashboard data. */
export async function financeOverview() {
  const day = today();
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - 11, 1));
  const [invoices, payments, subs, activeProjects] = await Promise.all([
    prisma.invoice.findMany({ where: { status: { not: "VOID" } }, include: { project: true } }),
    prisma.payment.findMany({ where: { receivedAt: { gte: start } } }),
    prisma.tenderSubmission.findMany({ where: { outcome: { not: "PENDING" }, outcomeDate: { gte: start } } }),
    prisma.project.findMany({ where: { stage: { in: ["ACTIVATION", "EXECUTION", "CLOSEOUT"] }, contract: { isNot: null } }, select: { id: true, number: true, name: true } }),
  ]);
  const months: { key: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    months.push({ key: m.toISOString().slice(0, 7), label: m.toLocaleDateString("en-CA", { month: "short", year: "2-digit", timeZone: "UTC" }) });
  }
  const revenue = months.map((m) => ({
    month: m.label,
    invoiced: sum(invoices.filter((i) => i.status !== "DRAFT" && i.invoiceDate.toISOString().startsWith(m.key)).map((i) => i.subtotal)).toNumber(),
    collected: sum(payments.filter((p) => p.receivedAt.toISOString().startsWith(m.key)).map((p) => p.amount)).toNumber(),
  }));
  const tenders = months.map((m) => ({
    month: m.label,
    awarded: subs.filter((s) => s.outcome === "AWARDED" && s.outcomeDate?.toISOString().startsWith(m.key)).length,
    lost: subs.filter((s) => s.outcome === "NOT_AWARDED" && s.outcomeDate?.toISOString().startsWith(m.key)).length,
  }));
  const won = subs.filter((s) => s.outcome === "AWARDED").length;
  const successRate = subs.length ? (won / subs.length) * 100 : null;
  const open = invoices.filter((i) => ["SUBMITTED", "APPROVED", "PARTIALLY_PAID"].includes(i.status));
  const buckets = ["Current", "1–30", "31–60", "61–90", "90+"];
  const aging = buckets.map((b) => ({ bucket: b, amount: 0 }));
  for (const i of open) {
    const days = Math.floor((day.getTime() - i.dueDate.getTime()) / 86_400_000);
    const idx = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    aging[idx].amount += invoiceBalance(i).toNumber();
  }
  const outstanding = sum(open.map((i) => invoiceBalance(i)));
  const overdue = sum(open.filter((i) => i.dueDate < day).map((i) => invoiceBalance(i)));
  const projectRows = [];
  for (const p of activeProjects.slice(0, 25)) {
    const f = await projectFinancials(p.id);
    projectRows.push({ project: p, f });
  }
  return { revenue, tenders, successRate, won, decided: subs.length, aging, outstanding, overdue, open, projectRows };
}
