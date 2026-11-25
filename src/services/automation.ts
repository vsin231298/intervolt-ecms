import { prisma } from "@/lib/db";
import { addDays, today } from "@/lib/dates";
import { d } from "@/lib/money";
import { notifyRoles, notifyUsers } from "@/lib/notify";
import { getSetting } from "@/lib/settings";
import { evaluateAutoChecks } from "./closeout";

/**
 * Scheduled reminders. Safe to run as often as you like: every notification carries a dedupe key,
 * so the same reminder is never sent twice to the same person.
 * Run by `npm run jobs` (cron every 15 min) or POST /api/jobs/run with the JOBS_SECRET.
 */
export async function runScheduledJobs(now = new Date()) {
  const day = today();
  const stamp = day.toISOString().slice(0, 10);
  const week = `${day.getUTCFullYear()}-w${Math.ceil(((day.getTime() - Date.UTC(day.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7)}`;
  const counts: Record<string, number> = {};
  const bump = (k: string, n: number) => (counts[k] = (counts[k] ?? 0) + n);

  await prisma.$transaction(async (t) => {
    // 1. Tender deadlines
    const leadDays = (await getSetting("reminders.tenderDeadlineDays", t)) as number[];
    const maxLead = Math.max(...leadDays, 0);
    const tenders = await t.project.findMany({ where: { stage: { in: ["OPPORTUNITY", "UNDER_REVIEW", "ESTIMATING", "QUOTING", "READY_TO_SUBMIT"] }, submissionDeadline: { gte: now, lte: addDays(now, maxLead + 1) } } });
    for (const p of tenders) {
      const daysLeft = Math.ceil((p.submissionDeadline!.getTime() - now.getTime()) / 86_400_000);
      const hit = leadDays.filter((l) => daysLeft <= l).sort((a, b) => a - b)[0];
      if (hit === undefined) continue;
      bump("tenderDeadline", await notifyUsers(t, [p.estimatorId, p.projectManagerId], { type: "tender.deadline", title: `Tender due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}: ${p.number} ${p.name}`, link: `/jobs/${p.id}`, projectId: p.id, dedupeKey: `tender-deadline:${p.id}:${hit}` }));
      if (!p.estimatorId) bump("tenderDeadline", await notifyRoles(t, ["ADMIN", "PROJECT_MANAGER"], { type: "tender.deadline", title: `Unassigned tender due in ${daysLeft} day(s): ${p.number}`, link: `/jobs/${p.id}`, projectId: p.id, dedupeKey: `tender-deadline:${p.id}:${hit}` }));
    }

    // 2. Outstanding supplier quotes
    const followDays = Number(await getSetting("reminders.quoteFollowUpDays", t));
    const pendingQuotes = await t.quoteRequestSupplier.findMany({ where: { status: "PENDING", sentAt: { not: null } }, include: { quoteRequest: { include: { project: true } }, supplier: true } });
    for (const rs of pendingQuotes) {
      const due = rs.followUpDate ?? (rs.sentAt ? addDays(rs.sentAt, followDays) : null);
      if (!due || due > day) continue;
      const p = rs.quoteRequest.project;
      bump("quoteFollowUp", await notifyUsers(t, [p.estimatorId, rs.quoteRequest.createdById], { type: "quote.followup", title: `Follow up ${rs.supplier.name} for ${rs.quoteRequest.number}`, body: `Quote outstanding on ${p.number} ${p.name}`, link: `/jobs/${p.id}/quotes/${rs.quoteRequestId}`, projectId: p.id, dedupeKey: `quote-followup:${rs.id}:${stamp}` }));
    }

    // 3. Delayed materials
    const late = await t.purchaseOrderLine.findMany({ where: { expectedDate: { lt: day }, purchaseOrder: { status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] } } }, include: { purchaseOrder: { include: { project: true, supplier: true } } } });
    const latePos = new Map<string, (typeof late)[number]["purchaseOrder"]>();
    for (const l of late) if (d(l.quantityReceived).lessThan(d(l.quantity))) latePos.set(l.purchaseOrderId, l.purchaseOrder);
    for (const po of latePos.values()) {
      const n = { type: "material.delayed", title: `Material delayed: ${po.number} (${po.supplier.name})`, body: `${po.project.number} ${po.project.name} — expected ${po.expectedDelivery?.toISOString().slice(0, 10) ?? "earlier"}`, link: `/jobs/${po.projectId}/procurement/${po.id}`, projectId: po.projectId, dedupeKey: `po-late:${po.id}:${stamp}` };
      bump("materialDelayed", await notifyUsers(t, [po.project.projectManagerId, po.createdById], n));
    }

    // 4. Shop drawings overdue from consultant
    const sdOver = await t.shopDrawingRevision.findMany({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, requiredBy: { lt: day } }, include: { shopDrawing: { include: { project: true } } } });
    for (const r of sdOver) {
      const p = r.shopDrawing.project;
      bump("shopDrawingOverdue", await notifyUsers(t, [p.projectManagerId], { type: "shopdrawing.overdue", title: `Shop drawing response overdue: ${r.shopDrawing.number}`, body: `${p.number} — consultant response was required ${r.requiredBy!.toISOString().slice(0, 10)}`, link: `/jobs/${p.id}/shop-drawings`, projectId: p.id, dedupeKey: `sd-overdue:${r.id}:${week}` }));
    }

    // 5. Overdue RFIs
    const rfis = await t.rfi.findMany({ where: { status: "OPEN", requiredBy: { lt: day } }, include: { project: true } });
    for (const r of rfis) {
      bump("rfiOverdue", await notifyUsers(t, [r.responsibleId ?? r.project.projectManagerId], { type: "rfi.overdue", title: `RFI overdue: ${r.number}`, body: r.subject, link: `/jobs/${r.projectId}/changes`, projectId: r.projectId, dedupeKey: `rfi-overdue:${r.id}:${stamp}` }));
    }

    // 6. Progress billing due (N days before the monthly due day, for active jobs with no draw this month)
    const dueDay = Number(await getSetting("billing.drawDueDay", t));
    if (day.getUTCDate() >= Math.max(1, dueDay - 5)) {
      const monthStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
      const active = await t.project.findMany({ where: { stage: { in: ["EXECUTION", "CLOSEOUT"] }, jobType: "PROJECT", contract: { isNot: null } }, include: { draws: { where: { createdAt: { gte: monthStart } } } } });
      for (const p of active) {
        if (p.draws.length) continue;
        const key = `billing-due:${p.id}:${stamp.slice(0, 7)}`;
        bump("billingDue", await notifyRoles(t, ["ACCOUNTING"], { type: "billing.due", title: `Progress billing due: ${p.number} ${p.name}`, body: `Draw due on the ${dueDay}th`, link: `/jobs/${p.id}/billing`, projectId: p.id, dedupeKey: key }));
        bump("billingDue", await notifyUsers(t, [p.projectManagerId], { type: "billing.due", title: `Prepare progress draw: ${p.number}`, link: `/jobs/${p.id}/billing`, projectId: p.id, dedupeKey: key }));
      }
    }

    // 7. Overdue client invoices
    const overdue = await t.invoice.findMany({ where: { status: { in: ["SUBMITTED", "APPROVED", "PARTIALLY_PAID"] }, dueDate: { lt: day } }, include: { project: true } });
    for (const inv of overdue) {
      const n = { type: "invoice.overdue", title: `Invoice overdue: ${inv.number}`, body: `${inv.project.number} ${inv.project.name}`, link: `/jobs/${inv.projectId}/billing`, projectId: inv.projectId, dedupeKey: `inv-overdue:${inv.id}:${week}` };
      bump("invoiceOverdue", await notifyRoles(t, ["ACCOUNTING"], n));
      bump("invoiceOverdue", await notifyUsers(t, [inv.project.projectManagerId], n));
    }

    // 8. Incomplete closeout (weekly)
    const closing = await t.project.findMany({ where: { stage: "CLOSEOUT" }, include: { closeoutItems: true } });
    for (const p of closing) {
      const open = p.closeoutItems.filter((i) => i.mandatory && i.status === "OPEN").length;
      if (!open) continue;
      bump("closeout", await notifyUsers(t, [p.projectManagerId], { type: "closeout.incomplete", title: `${open} closeout item(s) open on ${p.number}`, link: `/jobs/${p.id}/closeout`, projectId: p.id, dedupeKey: `closeout:${p.id}:${week}` }));
    }

    // 9. Overdue tasks
    const tasks = await t.task.findMany({ where: { status: { not: "DONE" }, dueDate: { lt: day }, assigneeId: { not: null } }, include: { project: true } });
    for (const tk of tasks) {
      bump("taskOverdue", await notifyUsers(t, [tk.assigneeId], { type: "task.overdue", title: `Task overdue: ${tk.title}`, body: `${tk.project.number} ${tk.project.name}`, link: `/jobs/${tk.projectId}/tasks`, projectId: tk.projectId, dedupeKey: `task-overdue:${tk.id}:${stamp}` }));
    }

    // 10. Expiring company / employee certificates
    const certDays = Number(await getSetting("reminders.certificateExpiryDays", t));
    const expiring = await t.document.findMany({ where: { expiresAt: { lte: addDays(day, certDays) } }, include: { worker: true } });
    for (const doc of expiring) {
      const expired = doc.expiresAt! < day;
      bump("certExpiry", await notifyRoles(t, ["ADMIN", "ACCOUNTING"], { type: "document.expiring", title: `${expired ? "Expired" : "Expiring"}: ${doc.title}${doc.worker ? ` (${doc.worker.name})` : ""}`, body: `Expires ${doc.expiresAt!.toISOString().slice(0, 10)}`, link: doc.workerId ? `/people/${doc.workerId}` : `/documents?scope=company`, dedupeKey: `doc-expiry:${doc.id}:${expired ? "expired" : "soon"}` }));
    }
  }, { timeout: 120_000 });

  return counts;
}

/** Live counts of attention items for the operations dashboard "signals" panel. */
export async function signals() {
  const day = today();
  const [lateLines, overdueInv, rfiOver, sdPending, pendingTime, openIssues, expiring, closeoutProjects] = await Promise.all([
    prisma.purchaseOrderLine.findMany({ where: { expectedDate: { lt: day }, purchaseOrder: { status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] } } }, select: { purchaseOrderId: true, quantity: true, quantityReceived: true } }),
    prisma.invoice.count({ where: { status: { in: ["SUBMITTED", "APPROVED", "PARTIALLY_PAID"] }, dueDate: { lt: day } } }),
    prisma.rfi.count({ where: { status: "OPEN", requiredBy: { lt: day } } }),
    prisma.shopDrawingRevision.count({ where: { status: { in: ["INTERNAL_REVIEW"] } } }),
    prisma.timeEntry.count({ where: { approvedAt: null } }),
    prisma.fieldUpdate.count({ where: { kind: "ISSUE", resolvedAt: null } }),
    prisma.document.count({ where: { expiresAt: { lte: addDays(day, 30) } } }),
    prisma.project.findMany({ where: { stage: "CLOSEOUT" }, select: { id: true } }),
  ]);
  const latePos = new Set(lateLines.filter((l) => d(l.quantityReceived).lessThan(d(l.quantity))).map((l) => l.purchaseOrderId)).size;
  let closeoutBlocked = 0;
  for (const p of closeoutProjects) {
    const c = await evaluateAutoChecks(p.id);
    if (Object.values(c).some((x) => !x.ok)) closeoutBlocked++;
  }
  return [
    { key: "latePos", label: "Delayed material deliveries", count: latePos, href: "/procurement?filter=late", tone: "red" },
    { key: "overdueInv", label: "Overdue client invoices", count: overdueInv, href: "/finance?filter=overdue", tone: "red" },
    { key: "rfiOver", label: "Overdue RFIs", count: rfiOver, href: "/claims?type=rfi", tone: "amber" },
    { key: "sdPending", label: "Shop drawings awaiting Intervolt review", count: sdPending, href: "/claims?type=sd", tone: "amber" },
    { key: "pendingTime", label: "Time entries awaiting approval", count: pendingTime, href: "/timesheets?filter=pending", tone: "blue" },
    { key: "openIssues", label: "Open site issues", count: openIssues, href: "/jobs?filter=issues", tone: "amber" },
    { key: "expiring", label: "Certificates expiring within 30 days", count: expiring, href: "/documents?scope=company&filter=expiring", tone: "amber" },
    { key: "closeoutBlocked", label: "Jobs in closeout with open items", count: closeoutBlocked, href: "/jobs?stage=CLOSEOUT", tone: "blue" },
  ] as const;
}
