/**
 * TRAINING / DEMO DATA ONLY. Loads a realistic set of jobs into an EMPTY non-production database
 * so staff can practise. Refuses to run in production or when jobs already exist.
 *   DEMO_DATA=1 npm run demo
 */
import { prisma } from "../src/lib/db";
import bcrypt from "bcryptjs";
import type { Actor } from "../src/lib/actor";
import type { Role } from "@prisma/client";
import { addDays, today } from "../src/lib/dates";
import * as projects from "../src/services/projects";
import * as est from "../src/services/estimating";
import * as quotes from "../src/services/quotes";
import * as sub from "../src/services/submission";
import * as proc from "../src/services/procurement";
import * as sd from "../src/services/shopDrawings";
import * as labour from "../src/services/labour";
import * as changes from "../src/services/changes";
import * as billing from "../src/services/billing";
import * as closeout from "../src/services/closeout";
import * as admin from "../src/services/admin";

const PASSWORD = process.env.DEMO_PASSWORD || "Intervolt2026!";

async function user(name: string, email: string, role: Role): Promise<Actor> {
  const existing = await prisma.user.findUnique({ where: { email } });
  const u = existing ?? (await prisma.user.create({ data: { name, email, role, passwordHash: await bcrypt.hash(PASSWORD, 10) } }));
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}
const pdf = (n: string) => ({ name: n, type: "application/pdf", data: Buffer.from(`%PDF-1.4\n% demo document ${n}\n`) });

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.DEMO_DATA !== "1") throw new Error("Refusing: set DEMO_DATA=1 on a non-production database.");
  if ((await prisma.project.count()) > 0) throw new Error("Refusing: jobs already exist in this database.");

  const adminU = await user("Vik Admin", "admin@intervolt.demo", "ADMIN");
  const pm = await user("Priya Patel", "pm@intervolt.demo", "PROJECT_MANAGER");
  const est1 = await user("Mark Chen", "estimator@intervolt.demo", "ESTIMATOR");
  const procU = await user("Dana Brooks", "procurement@intervolt.demo", "PROCUREMENT");
  const acct = await user("Lisa Wong", "accounting@intervolt.demo", "ACCOUNTING");
  const sup = await user("Tom Reid", "supervisor@intervolt.demo", "SITE_SUPERVISOR");
  const elec = await user("Jordan Silva", "electrician@intervolt.demo", "ELECTRICIAN");
  await user("Owner View", "readonly@intervolt.demo", "READ_ONLY");

  const org = (name: string, type: "CLIENT" | "CONSULTANT" | "GENERAL_CONTRACTOR" | "SUPPLIER", extra: object = {}) => admin.saveOrganization(adminU, null, { name, type, active: true, ...extra });
  const c1 = await org("Northbridge Developments", "CLIENT", { email: "pm@northbridge.example", phone: "416-555-0101" });
  const c2 = await org("Peel District School Board", "CLIENT");
  const c3 = await org("Lakeview Property Mgmt", "CLIENT");
  const cons = await org("Hammond Engineering", "CONSULTANT");
  const gc = await org("Bayview Construction", "GENERAL_CONTRACTOR");
  const s1 = await org("Graybar Supply", "SUPPLIER", { email: "quotes@graybar.example" });
  const s2 = await org("Nedco Supply", "SUPPLIER", { email: "quotes@nedco.example" });
  const s3 = await org("Eaton Distribution", "SUPPLIER");

  const w1 = await labour.saveWorker(pm, null, { name: "Jordan Silva", trade: "Journeyperson 309A", regularRate: 52, overtimeRate: 78, userId: elec.id, active: true });
  const w2 = await labour.saveWorker(pm, null, { name: "Andy Morales", trade: "Apprentice (3rd yr)", regularRate: 31, overtimeRate: 46.5, active: true });
  const w3 = await labour.saveWorker(pm, null, { name: "Kim Osei", trade: "Lead hand", regularRate: 58, overtimeRate: 87, active: true });

  // 1. Active project through most of the lifecycle
  const p = await projects.createLead(est1, { name: "Riverside Condo Tower — Electrical", clientId: c1.id, consultantId: cons.id, gcId: gc.id, location: "100 River St, Toronto", estimatedValue: 450000, invitationDate: addDays(today(), -60), submissionDeadline: addDays(new Date(), -40) });
  await projects.decideReview(pm, p.id, { decision: "DOABLE", estimatorId: est1.id });
  const e0 = await est.createEstimate(est1, p.id);
  await est.addEstimateLines(est1, e0.id, est.parseBomPaste([
    "Panelboard 225A 42cct\tSchneider\tNQ42L225\t6\tea\t2450\t10",
    "Transformer 75kVA\tHammond\tHPS-75\t1\tea\t8900\t16",
    "#12 THHN copper\tSouthwire\tTHHN12\t18000\tft\t0.44\t0.008",
    "EMT 3/4\"\tAtkore\tEMT34\t4200\tft\t1.65\t0.04",
    "LED troffer 2x4 4000K\tLithonia\t2GTL4\t320\tea\t142\t0.75",
    "Receptacle 15A TR\tLeviton\tTR5262\t640\tea\t4.2\t0.35",
    "Fire alarm devices\tEdwards\tSIGA\t110\tea\t165\t1.1",
  ].join("\n")));
  await est.addEstimateLines(est1, e0.id, [{ category: "LABOUR", description: "Supervision & coordination", quantity: 320, unit: "hr", unitPrice: 0, labourHoursPerUnit: 0 }, { category: "EQUIPMENT", description: "Scissor lift rental", quantity: 3, unit: "month", unitPrice: 1800, labourHoursPerUnit: 0 }]);
  const lines = await prisma.estimateLine.findMany({ where: { estimateId: e0.id, category: "MATERIAL" } });
  const rfq = await quotes.createRfq(est1, e0.id, { title: "Distribution, wire & lighting", supplierIds: [s1.id, s2.id, s3.id], lineIds: lines.map((l) => l.id), dueDate: addDays(today(), -45) });
  const items = await prisma.quoteRequestItem.findMany({ where: { quoteRequestId: rfq.id } });
  for (const [s, f, n] of [[s1, 0.97, "GB-2231"], [s2, 1.0, "ND-88120"]] as const) {
    await quotes.recordSupplierQuote(procU, rfq.id, { supplierId: s.id, quoteNumber: n, quoteDate: addDays(today(), -46), validUntil: addDays(today(), 30), leadTimeDays: 21, freight: 0, prices: Object.fromEntries(items.map((i, idx) => [i.id, String((Number(lines.find((l) => l.id === i.estimateLineId)!.unitPrice) * (f + (idx % 2 ? 0.03 : -0.02))).toFixed(2))])) });
  }
  await prisma.quoteRequestSupplier.updateMany({ where: { quoteRequestId: rfq.id }, data: { sentAt: addDays(new Date(), -50) } });
  await quotes.selectAll(est1, rfq.id, { kind: "lowest" });
  const e1 = await est.createEstimate(est1, p.id, { basedOnId: e0.id, title: "Rev 1 — supplier pricing" });
  await quotes.applySelectionsToEstimate(est1, rfq.id, e1.id);
  await est.finalizeEstimate(pm, e1.id);
  const sell = Number((await prisma.estimate.findUniqueOrThrow({ where: { id: e1.id } })).sellPrice);
  await sub.prepareSubmission(est1, p.id, { estimateId: e1.id, finalPrice: Math.round(sell / 100) * 100 });
  const s = await prisma.tenderSubmission.findFirstOrThrow({ where: { projectId: p.id } });
  await sub.approvePrice(pm, s.id);
  await sub.recordSubmitted(est1, s.id, { submittedAt: addDays(new Date(), -41), submittedAmount: Number(s.finalPrice), submissionMethod: "Email" });
  await sub.recordOutcome(pm, s.id, { outcome: "AWARDED", outcomeDate: addDays(today(), -30), clientPoNumber: "NB-PO-7781", poDate: addDays(today(), -30), contractValue: Number(s.finalPrice), projectManagerId: pm.id, startDate: addDays(today(), -25), finishDate: addDays(today(), 95) });
  await projects.addMember(pm, p.id, sup.id, "Site Supervisor");
  await projects.addMember(pm, p.id, elec.id, "Electrician");
  await sub.startExecution(pm, p.id);
  const q2 = await prisma.supplierQuote.findFirstOrThrow({ where: { quoteRequestId: rfq.id, supplierId: s1.id } });
  const qN = await prisma.supplierQuote.findFirstOrThrow({ where: { quoteRequestId: rfq.id, supplierId: s2.id } });
  for (const q of [q2, qN]) {
    const has = await prisma.supplierQuoteLine.count({ where: { supplierQuoteId: q.id, selectedFor: { isNot: null } } });
    if (!has) continue;
    const po = await proc.createPoFromQuote(procU, q.id, { shopDrawingsRequired: true, expectedDelivery: addDays(today(), q.id === q2.id ? -3 : 12) });
    await proc.issuePurchaseOrder(procU, po.id);
    const drawing = await sd.createShopDrawing(procU, p.id, { title: q.id === q2.id ? "Panelboards & transformer" : "Lighting fixtures cut sheets", specSection: q.id === q2.id ? "26 24 16" : "26 51 00", purchaseOrderId: po.id, requiredBy: addDays(today(), 5) }, pdf("shop-drawing.pdf"));
    await sd.internalReview(pm, drawing.id, "PASS");
    await sd.submitToConsultant(procU, drawing.id, { submittedAt: addDays(new Date(), -10), requiredBy: addDays(today(), -2) });
    if (q.id === q2.id) {
      await sd.recordConsultantResponse(pm, drawing.id, { status: "APPROVED_AS_NOTED", consultantComments: "Confirm bus rating on LP-3", returnedAt: addDays(today(), -4) });
      const pol = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
      await proc.receiveDelivery(sup, po.id, { receivedAt: addDays(today(), -2), reference: "PS-44120", quantities: Object.fromEntries(pol.map((l, i) => [l.id, i === 0 ? String(Number(l.quantity) / 2) : String(l.quantity)])) });
      const inv = await proc.recordSupplierInvoice(acct, p.id, { supplierId: s1.id, purchaseOrderId: po.id, invoiceNumber: "GB-INV-90211", invoiceDate: addDays(today(), -1), dueDate: addDays(today(), 29), tax: 0, lines: pol.slice(1).map((l) => ({ poLineId: l.id, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitCost) })) });
      await proc.approveSupplierInvoice(acct, inv.id);
    }
  }
  await labour.scheduleWorkers(pm, p.id, { workerIds: [w1.id, w2.id, w3.id], fromDate: addDays(today(), -14), toDate: addDays(today(), 14), hours: 8, includeWeekends: false });
  for (let i = 14; i >= 1; i--) {
    const day = addDays(today(), -i);
    if ([0, 6].includes(day.getUTCDay())) continue;
    for (const w of [w2, w3]) await labour.addTimeEntry(sup, p.id, { workerId: w.id, date: day, regularHours: 8, overtimeHours: i % 5 === 0 ? 2 : 0, costCode: "Rough-in" });
  }
  await labour.saveDailyReport(sup, p.id, { date: addDays(today(), -1), weather: "Cloudy, 4°C", manpower: 3, workPerformed: "Level 3 rough-in, pulled feeders to LP-3", delays: "Sprinkler conflict at grid C4", safetyNotes: "Toolbox talk: ladder safety" });
  const rfi = await changes.createRfi(sup, p.id, { subject: "Sprinkler main conflict at grid C4", question: "Conduit route conflicts with sprinkler main. Can we reroute below deck?", requiredBy: addDays(today(), -1), sendNow: true });
  const { changeOrderId } = await changes.recordRfiResponse(pm, rfi.id, { response: "Reroute below deck, add junction boxes as required", respondedAt: new Date(), changeRequired: "yes" });
  await changes.addCoLine(pm, changeOrderId!, { category: "MATERIAL", description: "EMT 3/4\" and fittings", quantity: 220, unit: "ft", unitPrice: 2.4, labourHoursPerUnit: 0.05 });
  await changes.addCoLine(pm, changeOrderId!, { category: "LABOUR", description: "Rework", quantity: 16, unit: "hr", unitPrice: 0, labourHoursPerUnit: 0 });
  await changes.submitChangeOrder(pm, changeOrderId!);
  await changes.decideChangeOrder(pm, changeOrderId!, { decision: "APPROVED", decidedAt: today(), clientPoNumber: "NB-PO-7781-01" });
  await changes.recordEsi(pm, p.id, { issuedBy: "Hammond Engineering", receivedAt: today(), description: "Add 4 receptacles in amenity room", changeRequired: "yes" });
  await changes.createRfi(pm, p.id, { subject: "Generator transfer switch location", question: "Confirm ATS room location per revised architectural", requiredBy: addDays(today(), 6), sendNow: false });
  const lines2 = await billing.billingLinesWithProgress(p.id);
  const draw = await billing.createDraw(pm, p.id, { periodEnd: addDays(today(), -5), percents: { [lines2[0].line.id]: "18" } });
  await billing.setDrawStatus(pm, draw.id, "SUBMITTED");
  await billing.setDrawStatus(acct, draw.id, "APPROVED");
  const inv = await billing.invoiceDraw(acct, draw.id, { invoiceDate: addDays(today(), -40) });
  await billing.setInvoiceStatus(acct, inv.id, "SUBMIT");
  await closeout.scheduleInspection(sup, p.id, { type: "ESA Rough-in", isEsa: true, isFinal: false, scheduledAt: addDays(new Date(), 3), esaNotificationNo: "ESA-7Q12345" });
  await projects.createTask(pm, p.id, { title: "Submit fire alarm shop drawings", assigneeId: procU.id, dueDate: addDays(today(), 4) });
  await projects.createTask(pm, p.id, { title: "Coordinate ATS location with GC", assigneeId: pm.id, dueDate: addDays(today(), -1) });

  // 2. Leads at various stages
  const l1 = await projects.createLead(est1, { name: "Brampton Secondary — Gym Lighting Retrofit", clientId: c2.id, consultantId: cons.id, location: "Brampton, ON", estimatedValue: 180000, invitationDate: today(), submissionDeadline: addDays(new Date(), 9) });
  const l2 = await projects.createLead(est1, { name: "Warehouse 7 — Service Upgrade 1200A", clientId: c3.id, location: "Mississauga, ON", estimatedValue: 320000, invitationDate: addDays(today(), -10), submissionDeadline: addDays(new Date(), 3) });
  await projects.decideReview(pm, l2.id, { decision: "DOABLE", estimatorId: est1.id });
  await est.createEstimate(est1, l2.id);
  const l3 = await projects.createLead(est1, { name: "Hospital MRI Suite Shielding", clientId: c1.id, estimatedValue: 900000, invitationDate: addDays(today(), -20) });
  await projects.decideReview(pm, l3.id, { decision: "NOT_DOABLE", reason: "Specialist shielding scope outside our licence" });
  void l1;

  // 3. Service work order and a small job
  const svc = await projects.createDirectJob(pm, { jobType: "SERVICE", name: "Tripping breaker — Unit 402", clientId: c3.id, location: "55 Lake Shore Blvd, Unit 402", siteContactName: "Jane Doe", siteContactPhone: "416-555-0144", clientPoNumber: "LV-SVC-118", projectManagerId: pm.id, startDate: today() });
  await labour.scheduleWorkers(pm, svc.id, { workerIds: [w1.id], fromDate: today(), toDate: today(), hours: 3, includeWeekends: true });
  await projects.createDirectJob(pm, { jobType: "SMALL_JOB", name: "EV charger install — 2 x Level 2", clientId: c3.id, location: "55 Lake Shore Blvd, P1", clientPoNumber: "LV-PO-2290", contractValue: 14800, projectManagerId: pm.id, startDate: addDays(today(), 7), finishDate: addDays(today(), 14) });

  await admin.saveEvent(pm, null, { title: "Riverside coordination meeting", startsAt: addDays(new Date(), 1), endsAt: new Date(addDays(new Date(), 1).getTime() + 3600_000), location: "Site trailer", projectId: p.id, attendeeIds: [sup.id, procU.id] });

  console.log(`Demo data loaded. Sign in as admin@intervolt.demo (or pm@, estimator@, procurement@, accounting@, supervisor@, electrician@, readonly@) with password ${PASSWORD}`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
