/**
 * Phase 9: end-to-end business scenarios against a real PostgreSQL database.
 * Run with: DATABASE_URL=postgresql://.../intervolt_test npm test
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import { d } from "@/lib/money";
import { addDays, today } from "@/lib/dates";
import { resetDb, makeUser, file } from "./helpers";
import * as projects from "@/services/projects";
import * as est from "@/services/estimating";
import * as quotes from "@/services/quotes";
import * as sub from "@/services/submission";
import * as proc from "@/services/procurement";
import * as sd from "@/services/shopDrawings";
import * as labour from "@/services/labour";
import * as changes from "@/services/changes";
import * as billing from "@/services/billing";
import * as closeout from "@/services/closeout";
import * as admin from "@/services/admin";
import { runScheduledJobs } from "@/services/automation";
import type { Actor } from "@/lib/actor";

process.env.STORAGE_LOCAL_DIR = "./storage-test";

let adminU: Actor, pm: Actor, estimator: Actor, procU: Actor, acct: Actor, sup: Actor, elec: Actor, ro: Actor;
let client: { id: string }, consultant: { id: string }, s1: { id: string }, s2: { id: string };

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  await resetDb();
  adminU = await makeUser("Admin User", "ADMIN");
  pm = await makeUser("Pat Manager", "PROJECT_MANAGER");
  estimator = await makeUser("Erin Estimator", "ESTIMATOR");
  procU = await makeUser("Paul Procurement", "PROCUREMENT");
  acct = await makeUser("Alex Accounting", "ACCOUNTING");
  sup = await makeUser("Sam Supervisor", "SITE_SUPERVISOR");
  elec = await makeUser("Eddie Electrician", "ELECTRICIAN");
  ro = await makeUser("Rita Readonly", "READ_ONLY");
  client = await admin.saveOrganization(adminU, null, { name: "Northbridge Developments", type: "CLIENT", active: true });
  consultant = await admin.saveOrganization(adminU, null, { name: "Hammond Engineering", type: "CONSULTANT", active: true });
  s1 = await admin.saveOrganization(adminU, null, { name: "Graybar Supply", type: "SUPPLIER", active: true });
  s2 = await admin.saveOrganization(adminU, null, { name: "Nedco Supply", type: "SUPPLIER", active: true });
});

describe("Scenario 1: tender declined at review (Not doable)", () => {
  it("closes the lead with a reason and keeps history", async () => {
    const lead = await projects.createLead(estimator, { name: "Hospital wing retrofit", clientId: client.id, estimatedValue: 2_000_000 });
    expect(lead.number).toMatch(/^WO-\d{4}-0001$/);
    await expect(projects.decideReview(estimator, lead.id, { decision: "NOT_DOABLE", reason: "No capacity" })).rejects.toThrow(/permission/);
    await expect(projects.decideReview(pm, lead.id, { decision: "NOT_DOABLE", reason: "" } as never)).rejects.toThrow();
    await projects.decideReview(pm, lead.id, { decision: "NOT_DOABLE", reason: "Outside our bonding capacity" });
    const p = await prisma.project.findUniqueOrThrow({ where: { id: lead.id }, include: { stageHistory: true } });
    expect(p.stage).toBe("CLOSED");
    expect(p.closeReason).toBe("NOT_DOABLE");
    expect(p.stageHistory.map((h) => h.toStage)).toEqual(["OPPORTUNITY", "UNDER_REVIEW", "CLOSED"]);
  });
});

describe("Scenario 2: tender lost", () => {
  it("records Lost bid after submission", async () => {
    const lead = await projects.createLead(estimator, { name: "Warehouse lighting", clientId: client.id });
    await projects.decideReview(pm, lead.id, { decision: "DOABLE", estimatorId: estimator.id });
    const e = await est.createEstimate(estimator, lead.id);
    await est.addEstimateLines(estimator, e.id, [{ category: "MATERIAL", description: "LED high bay", quantity: 40, unit: "ea", unitPrice: 310, labourHoursPerUnit: 1.5 }]);
    await expect(sub.prepareSubmission(estimator, lead.id, { estimateId: e.id, finalPrice: 30000 })).rejects.toThrow(/Finalize/);
    await est.finalizeEstimate(pm, e.id);
    await sub.prepareSubmission(estimator, lead.id, { estimateId: e.id, finalPrice: 30000 });
    const s = await prisma.tenderSubmission.findFirstOrThrow({ where: { projectId: lead.id } });
    await expect(sub.recordSubmitted(estimator, s.id, { submittedAt: new Date(), submittedAmount: 30000 })).rejects.toThrow(/approved/);
    await sub.approvePrice(pm, s.id);
    await sub.recordSubmitted(estimator, s.id, { submittedAt: new Date(), submittedAmount: 30000 });
    await sub.recordOutcome(pm, s.id, { outcome: "NOT_AWARDED", outcomeDate: today(), outcomeReason: "Low bidder was 8% under", winningAmount: 27600 });
    const p = await prisma.project.findUniqueOrThrow({ where: { id: lead.id } });
    expect(p.stage).toBe("CLOSED");
    expect(p.closeReason).toBe("LOST_BID");
  });
});

describe("Scenario 3: full project lifecycle, tender to closeout", () => {
  let projectId = "";
  let estimateId = "";
  let poId = "";
  let worker: { id: string };

  it("tender → estimate → supplier quotes → submission → award", async () => {
    const lead = await projects.createLead(estimator, { name: "Riverside Condo Tower — Electrical", clientId: client.id, consultantId: consultant.id, location: "100 River St", estimatedValue: 150000, submissionDeadline: addDays(new Date(), 2) });
    projectId = lead.id;
    await projects.addCommunication(estimator, projectId, { kind: "Addendum", date: new Date(), subject: "Addendum 1 — panel schedule revised" });
    await projects.decideReview(pm, projectId, { decision: "DOABLE", estimatorId: estimator.id });
    const notif = await prisma.notification.findFirst({ where: { userId: estimator.id, type: "tender.assigned" } });
    expect(notif).toBeTruthy();

    const e0 = await est.createEstimate(estimator, projectId);
    await est.addEstimateLines(estimator, e0.id, est.parseBomPaste("Description\tMfr\tModel\tQty\tUnit\tPrice\tHrs\nPanelboard 225A\tSchneider\tNQ\t4\tea\t2500\t8\n#12 THHN wire\tSouthwire\tTHHN12\t5000\tft\t0.45\t0.01\nLED troffer 2x4\tLithonia\t2GTL4\t120\tea\t145\t0.75"));
    await est.addEstimateLines(estimator, e0.id, [{ category: "LABOUR", description: "Supervision", quantity: 80, unit: "hr", unitPrice: 0, labourHoursPerUnit: 0 }]);
    const e0r = await prisma.estimate.findUniqueOrThrow({ where: { id: e0.id } });
    // material: 4*2500 + 5000*0.45 + 120*145 = 10000 + 2250 + 17400 = 29650
    expect(d(e0r.materialTotal).toNumber()).toBe(29650);
    // hours: 32 + 50 + 90 + 80 = 252
    expect(d(e0r.labourHours).toNumber()).toBe(252);
    expect(d(e0r.labourTotal).toNumber()).toBe(252 * 95);
    const direct = 29650 + 252 * 95;
    expect(d(e0r.sellPrice).toNumber()).toBeCloseTo(direct * 1.1 * 1.1, 1);

    const lines = await prisma.estimateLine.findMany({ where: { estimateId: e0.id, category: "MATERIAL" } });
    const rfq = await quotes.createRfq(estimator, e0.id, { title: "Distribution & lighting", supplierIds: [s1.id, s2.id], lineIds: lines.map((l) => l.id) });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).stage).toBe("QUOTING");
    const items = await prisma.quoteRequestItem.findMany({ where: { quoteRequestId: rfq.id } });
    const byDesc = (s: string) => items.find((i) => i.description.startsWith(s))!.id;
    await quotes.recordSupplierQuote(procU, rfq.id, { supplierId: s1.id, quoteNumber: "GB-881", quoteDate: today(), validUntil: addDays(today(), 30), leadTimeDays: 21, freight: 0, prices: { [byDesc("Panel")]: "2350", [byDesc("#12")]: "0.42", [byDesc("LED")]: "151" } });
    await quotes.recordSupplierQuote(procU, rfq.id, { supplierId: s2.id, quoteNumber: "ND-1002", quoteDate: today(), validUntil: addDays(today(), 30), leadTimeDays: 14, freight: 150, prices: { [byDesc("Panel")]: "2410", [byDesc("#12")]: "0.40", [byDesc("LED")]: "139" } });
    const cmp = await quotes.getRfqComparison(rfq.id);
    expect(cmp!.rows.find((r) => r.item.description.startsWith("Panel"))!.lowestLineId).toBeTruthy();
    expect(await quotes.selectAll(estimator, rfq.id, { kind: "lowest" })).toBe(3);

    // New revision, apply supplier prices, compare revisions
    const e1 = await est.createEstimate(estimator, projectId, { basedOnId: e0.id, title: "Rev 1 with supplier pricing" });
    expect(await quotes.applySelectionsToEstimate(estimator, rfq.id, e1.id)).toBe(3);
    const e1r = await est.getEstimate(e1.id);
    expect(d(e1r!.lines.find((l) => l.description.startsWith("Panel"))!.unitPrice).toNumber()).toBe(2350);
    const diff = est.compareEstimates((await est.getEstimate(e0.id))!, e1r!);
    expect(diff.filter((r) => r.change === "changed")).toHaveLength(3);
    await est.finalizeEstimate(pm, e1.id);
    await expect(est.addEstimateLines(estimator, e1.id, [{ category: "MATERIAL", description: "x", quantity: 1, unit: "ea", unitPrice: 1, labourHoursPerUnit: 0 }])).rejects.toThrow(/locked/);
    estimateId = e1.id;

    await sub.prepareSubmission(estimator, projectId, { estimateId, finalPrice: 98500 });
    const s = await prisma.tenderSubmission.findFirstOrThrow({ where: { projectId } });
    await sub.approvePrice(pm, s.id);
    await sub.recordSubmitted(estimator, s.id, { submittedAt: new Date(), submittedAmount: 98500, submissionMethod: "Bids & Tenders portal" });
    await expect(sub.recordOutcome(estimator, s.id, { outcome: "NOT_AWARDED", outcomeDate: today(), outcomeReason: "x" + "yz" })).rejects.toThrow(/permission/);
    await sub.recordOutcome(pm, s.id, { outcome: "AWARDED", outcomeDate: today(), clientPoNumber: "NB-PO-7781", contractValue: 98500, projectManagerId: pm.id, startDate: today(), finishDate: addDays(today(), 120) });

    const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { contract: true, materialItems: true, scheduleItems: true, closeoutItems: true, folders: true } });
    expect(p.stage).toBe("ACTIVATION");
    expect(p.number).toBe(lead.number); // Work Order Number kept for life
    expect(d(p.contract!.originalValue).toNumber()).toBe(98500);
    expect(p.materialItems).toHaveLength(3);
    expect(p.scheduleItems.length).toBeGreaterThan(5);
    expect(p.closeoutItems.length).toBeGreaterThan(8);
    expect(p.folders.map((f) => f.name)).toContain("Shop Drawings");
  });

  it("activation checklist gates execution", async () => {
    await expect(sub.startExecution(pm, projectId)).rejects.toThrow(/team members/);
    await projects.addMember(pm, projectId, sup.id, "Site Supervisor");
    await projects.addMember(pm, projectId, elec.id, "Electrician");
    await sub.startExecution(pm, projectId);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).stage).toBe("EXECUTION");
  });

  it("procurement: PO from quote, shop drawings gate delivery, revise & resubmit", async () => {
    const q = await prisma.supplierQuote.findFirstOrThrow({ where: { supplierId: s2.id } });
    const po = await proc.createPoFromQuote(procU, q.id, { shopDrawingsRequired: true });
    poId = po.id;
    expect(d(po.total).toNumber()).toBe(5000 * 0.4 + 120 * 139);
    await proc.issuePurchaseOrder(procU, po.id);
    const lines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    const qtys = Object.fromEntries(lines.map((l) => [l.id, String(l.quantity)]));
    await expect(proc.receiveDelivery(sup, po.id, { receivedAt: today(), quantities: qtys })).rejects.toThrow(/Delivery blocked/);

    const drawing = await sd.createShopDrawing(procU, projectId, { title: "LED troffer cut sheets", specSection: "26 51 00", purchaseOrderId: po.id }, file("troffer.pdf"));
    await expect(sd.submitToConsultant(procU, drawing.id, { submittedAt: new Date() })).rejects.toThrow(/Intervolt review/);
    await sd.internalReview(pm, drawing.id, "PASS");
    await sd.submitToConsultant(procU, drawing.id, { submittedAt: new Date(), requiredBy: addDays(today(), 10) });
    await sd.recordConsultantResponse(pm, drawing.id, { status: "REVISE_AND_RESUBMIT", consultantComments: "Provide 4000K CCT option" });
    let revs = await prisma.shopDrawingRevision.findMany({ where: { shopDrawingId: drawing.id }, orderBy: { revision: "asc" } });
    expect(revs.map((r) => r.status)).toEqual(["REVISE_AND_RESUBMIT", "IN_PREPARATION"]);
    await sd.uploadDrawingFile(procU, drawing.id, file("troffer-rev1.pdf"));
    await sd.internalReview(pm, drawing.id, "PASS");
    await sd.submitToConsultant(procU, drawing.id, { submittedAt: new Date() });
    await sd.recordConsultantResponse(pm, drawing.id, { status: "APPROVED_AS_NOTED", consultantComments: "Confirm mounting with ceiling grid" });
    revs = await prisma.shopDrawingRevision.findMany({ where: { shopDrawingId: drawing.id }, orderBy: { revision: "asc" } });
    expect(revs[1].status).toBe("APPROVED_AS_NOTED");
    const versions = await prisma.documentVersion.findMany({ where: { documentId: revs[0].documentId! }, orderBy: { revision: "asc" } });
    expect(versions).toHaveLength(2); // original never overwritten
    expect(versions[1].approvalStatus).toBe("APPROVED");
    expect(await prisma.notification.count({ where: { userId: procU.id, type: "shopdrawing.approved" } })).toBe(1);

    // partial then full delivery
    const wire = lines.find((l) => l.description.startsWith("#12"))!;
    const led = lines.find((l) => l.description.startsWith("LED"))!;
    await proc.receiveDelivery(sup, po.id, { receivedAt: today(), reference: "PS-1001", quantities: { [wire.id]: "5000", [led.id]: "60" } });
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PARTIALLY_RECEIVED");
    await expect(proc.receiveDelivery(sup, po.id, { receivedAt: today(), quantities: { [led.id]: "61" } })).rejects.toThrow(/outstanding/);
    const reg = await proc.materialRegister(projectId);
    expect(reg.find((r) => r.item.description.startsWith("LED"))!.outstanding.toNumber()).toBe(60);
    await proc.receiveDelivery(sup, po.id, { receivedAt: today(), reference: "PS-1002", quantities: { [led.id]: "60" } });
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");
  });

  it("supplier invoice 3-way match, approval, payment", async () => {
    const lines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: poId } });
    const led = lines.find((l) => l.description.startsWith("LED"))!;
    const wire = lines.find((l) => l.description.startsWith("#12"))!;
    // over-priced invoice → variance
    const bad = await proc.recordSupplierInvoice(acct, projectId, { supplierId: s2.id, purchaseOrderId: poId, invoiceNumber: "INV-ND-1", invoiceDate: today(), tax: 0, lines: [{ poLineId: led.id, description: led.description, quantity: 120, unitPrice: 160 }] });
    expect((await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: bad.id } })).matchStatus).toBe("VARIANCE");
    await expect(proc.approveSupplierInvoice(pm, bad.id)).rejects.toThrow(/variance/);
    await proc.disputeSupplierInvoice(acct, bad.id, "Price above PO");
    const good = await proc.recordSupplierInvoice(acct, projectId, { supplierId: s2.id, purchaseOrderId: poId, invoiceNumber: "INV-ND-2", invoiceDate: today(), tax: 0, lines: [{ poLineId: wire.id, description: wire.description, quantity: 5000, unitPrice: 0.4 }] });
    expect((await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: good.id } })).matchStatus).toBe("MATCHED");
    await proc.approveSupplierInvoice(acct, good.id);
    await expect(proc.paySupplierInvoice(acct, good.id, { paidAt: today(), amount: 2500 })).rejects.toThrow(/exceeds/);
    await proc.paySupplierInvoice(acct, good.id, { paidAt: today(), amount: 2000 });
    expect((await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: good.id } })).status).toBe("PAID");
  });

  it("labour: schedule, field clock in/out, time entries, estimated vs actual", async () => {
    worker = await labour.saveWorker(pm, null, { name: "Eddie Electrician", trade: "Journeyperson 309A", regularRate: 52, overtimeRate: 78, userId: elec.id, active: true });
    const w2 = await labour.saveWorker(pm, null, { name: "Andy Apprentice", trade: "Apprentice", regularRate: 30, overtimeRate: 45, active: true });
    const res = await labour.scheduleWorkers(sup, projectId, { workerIds: [worker.id, w2.id], fromDate: today(), toDate: today(), hours: 8, includeWeekends: true });
    expect(res.created).toBe(2);
    const { jobs } = await labour.assignedJobs(elec);
    expect(jobs.map((j) => j.project.id)).toContain(projectId);
    // geofence: no site pin yet → blocked
    await expect(labour.clockIn(elec, projectId, { lat: 43.65, lng: -79.38 })).rejects.toThrow(/site location .* hasn't been set/);
    await expect(projects.setSiteLocation(elec, projectId, { lat: 43.65, lng: -79.38 }, null)).rejects.toThrow(/permission/);
    await expect(projects.setSiteLocation(pm, projectId, { lat: 43.65, lng: -79.38 }, 3)).rejects.toThrow(/between 10 and 5000/);
    await projects.setSiteLocation(pm, projectId, { lat: 43.65, lng: -79.38 }, null);
    await expect(labour.clockIn(elec, projectId)).rejects.toThrow(/couldn't get your location.*50 m/);
    await expect(labour.clockIn(elec, projectId, { error: "denied" })).rejects.toThrow(/Location is blocked/);
    await expect(labour.clockIn(elec, projectId, { lat: 43.66, lng: -79.38 })).rejects.toThrow(/You're 1\.1 km from .* Move within 50 m/);
    await expect(labour.clockIn(elec, projectId, { lat: 43.6505, lng: -79.38 })).rejects.toThrow(/56 m/);
    await labour.clockIn(elec, projectId, { lat: 43.6503, lng: -79.38 }); // ~33 m away: allowed
    await expect(labour.clockIn(elec, projectId, { lat: 43.65, lng: -79.38 })).rejects.toThrow(/still clocked in/);
    // backdate clock-in by 9.5h to simulate a full day
    await prisma.clockEntry.updateMany({ where: { clockOutAt: null }, data: { clockInAt: new Date(Date.now() - 9.5 * 3_600_000) } });
    await expect(labour.clockOut(elec, { lat: 43.7, lng: -79.4 }, "left early")).rejects.toThrow(/Move within 50 m of the site to clock out/);
    const out = await labour.clockOut(elec, { lat: 43.65, lng: -79.3801 }, "Rough-in level 3");
    expect(out.regular).toBe(8);
    expect(out.overtime).toBe(1.5);
    await labour.addTimeEntry(sup, projectId, { workerId: w2.id, date: today(), regularHours: 8, overtimeHours: 0 });
    const e = await prisma.timeEntry.findFirstOrThrow({ where: { workerId: w2.id } });
    expect(d(e.cost).toNumber()).toBe(240);
    await expect(labour.deleteTimeEntry(sup, e.id, "wrong")).rejects.toThrow(/permission/);
    await labour.updateTimeEntry(pm, e.id, { date: today(), regularHours: 7, overtimeHours: 0 });
    const summary = await labour.labourSummary(projectId);
    expect(summary.actualHours.toNumber()).toBe(9.5 + 7);
    expect(summary.estHours.toNumber()).toBe(252);
    // field: update with photo, materials used, issue
    await labour.postFieldUpdate(elec, projectId, { kind: "ISSUE", message: "Conflict with sprinkler main at grid C4" }, [file("site.jpg", "image/jpeg")]);
    expect(await prisma.notification.count({ where: { userId: pm.id, type: "field.issue" } })).toBe(1);
    const mi = await prisma.materialItem.findFirstOrThrow({ where: { projectId, description: { startsWith: "LED" } } });
    await proc.logMaterialUsage(elec, projectId, { materialItemId: mi.id, quantity: 30, usedOn: today() });
    expect((await proc.materialRegister(projectId)).find((r) => r.item.id === mi.id)!.used.toNumber()).toBe(30);
  });

  it("change management: RFI → change required → CO → approval keeps original contract value", async () => {
    const rfi = await changes.createRfi(sup, projectId, { subject: "Sprinkler conflict C4", question: "Can conduit reroute above?", requiredBy: addDays(today(), 3), sendNow: true });
    const { changeOrderId } = await changes.recordRfiResponse(pm, rfi.id, { response: "Reroute below deck; add 2 junction boxes", respondedAt: new Date(), changeRequired: "yes" });
    expect(changeOrderId).toBeTruthy();
    await changes.addCoLine(pm, changeOrderId!, { category: "MATERIAL", description: "EMT 3/4 conduit", quantity: 200, unit: "ft", unitPrice: 2.5, labourHoursPerUnit: 0.05 });
    await changes.addCoLine(pm, changeOrderId!, { category: "LABOUR", description: "Rework", quantity: 16, unit: "hr", unitPrice: 0, labourHoursPerUnit: 0 });
    const co = await prisma.changeOrder.findUniqueOrThrow({ where: { id: changeOrderId! } });
    // Diagram: RFI change needed → ESI → Intervolt estimates the ESI
    expect(co.esiId).toBeTruthy();
    expect((await prisma.esi.findUniqueOrThrow({ where: { id: co.esiId! } })).changeRequired).toBe(true);
    // material 500, hours 10+16=26 × 95 = 2470, direct 2970, +15% = 3415.50
    expect(d(co.proposedAmount).toNumber()).toBe(3415.5);
    await changes.submitChangeOrder(pm, co.id);
    await changes.decideChangeOrder(pm, co.id, { decision: "APPROVED", decidedAt: today(), approvedAmount: 3400, clientPoNumber: "NB-PO-7781-CO1" });
    const contract = await prisma.contract.findUniqueOrThrow({ where: { projectId }, include: { changes: true } });
    expect(d(contract.originalValue).toNumber()).toBe(98500);
    expect(d(contract.currentValue).toNumber()).toBe(101900);
    expect(contract.changes).toHaveLength(1);
    // DB-level guards: original value cannot be overwritten; current value cannot bypass the ledger; ledger is append-only
    await expect(prisma.contract.update({ where: { id: contract.id }, data: { originalValue: 1 } })).rejects.toThrow();
    await expect(prisma.contract.update({ where: { id: contract.id }, data: { currentValue: 200000 } })).rejects.toThrow();
    await expect(prisma.contractValueChange.deleteMany({ where: { contractId: contract.id } })).rejects.toThrow();
    // rejected branch
    const co2 = await changes.createChangeOrder(pm, projectId, { title: "Add EV chargers", description: "4 x level 2", reason: "Owner request" });
    await changes.updateCoPricing(pm, co2.id, { labourRate: 95, markupPercent: 15, otherCost: 8000, scheduleImpactDays: 5, title: "Add EV chargers", description: "4 x level 2", reason: "Owner request" });
    await changes.submitChangeOrder(pm, co2.id);
    await changes.decideChangeOrder(pm, co2.id, { decision: "REJECTED", decidedAt: today(), decisionNote: "Owner deferred to phase 2" });
    expect(d((await prisma.contract.findUniqueOrThrow({ where: { projectId } })).currentValue).toNumber()).toBe(101900);
  });

  it("billing: draws with holdback, invoices, payments, AR", async () => {
    const lines = await billing.billingLinesWithProgress(projectId);
    expect(lines).toHaveLength(2); // base + CO
    const base = lines[0].line;
    const coLine = lines[1].line;
    const draw = await billing.createDraw(pm, projectId, { periodEnd: today(), percents: { [base.id]: "40" } });
    expect(d(draw.thisPeriod).toNumber()).toBe(39400);
    expect(d(draw.holdback).toNumber()).toBe(3940);
    await expect(billing.invoiceDraw(acct, draw.id, { invoiceDate: today() })).rejects.toThrow(/Approve/);
    await billing.setDrawStatus(pm, draw.id, "SUBMITTED");
    await billing.setDrawStatus(acct, draw.id, "APPROVED");
    const inv = await billing.invoiceDraw(acct, draw.id, { invoiceDate: today() });
    // (39400 - 3940) * 1.13 = 40069.80
    expect(d(inv.total).toNumber()).toBeCloseTo(40069.8, 2);
    await billing.setInvoiceStatus(acct, inv.id, "SUBMIT");
    await billing.recordPayment(acct, inv.id, { receivedAt: today(), amount: 20000 });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PARTIALLY_PAID");
    await expect(billing.recordPayment(acct, inv.id, { receivedAt: today(), amount: 50000 })).rejects.toThrow(/exceeds/);
    await billing.recordPayment(acct, inv.id, { receivedAt: today(), amount: 20069.8 });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    // cannot bill less than already billed
    await expect(billing.createDraw(pm, projectId, { periodEnd: today(), percents: { [base.id]: "30" } })).rejects.toThrow(/less than already billed/);
    // final draw 100%
    const draw2 = await billing.createDraw(pm, projectId, { periodEnd: today(), percents: { [base.id]: "100", [coLine.id]: "100" } });
    expect(d(draw2.thisPeriod).toNumber()).toBe(59100 + 3400);
    await billing.setDrawStatus(pm, draw2.id, "SUBMITTED");
    await billing.setDrawStatus(acct, draw2.id, "APPROVED");
    const inv2 = await billing.invoiceDraw(acct, draw2.id, { invoiceDate: today() });
    await billing.setInvoiceStatus(acct, inv2.id, "SUBMIT");
    await billing.setInvoiceStatus(acct, inv2.id, "APPROVE");
    await billing.recordPayment(acct, inv2.id, { receivedAt: today(), amount: Number(inv2.total) });
    const fin = await billing.projectFinancials(projectId);
    expect(fin.billed.toNumber()).toBe(101900);
    expect(fin.holdbackRetained.toNumber()).toBeCloseTo(10190, 2);
    expect(fin.outstanding.toNumber()).toBe(0);
  });

  it("inspections: failed → deficiencies → re-inspection passed; commissioning", async () => {
    await closeout.scheduleInspection(sup, projectId, { type: "ESA Final", isEsa: true, isFinal: true, scheduledAt: new Date(), esaNotificationNo: "ESA-123456" });
    const insp = await prisma.inspection.findFirstOrThrow({ where: { projectId } });
    await expect(closeout.recordInspectionResult(sup, insp.id, { result: "FAILED", resultDate: today(), deficiencies: [] })).rejects.toThrow(/deficiency/);
    await closeout.recordInspectionResult(sup, insp.id, { result: "FAILED", resultDate: today(), deficiencies: [{ description: "Missing bonding jumper at panel LP-3" }, { description: "Unlabelled circuits on LP-2" }] });
    expect(await prisma.notification.count({ where: { userId: pm.id, type: "inspection.failed" } })).toBe(1);
    const defs = await prisma.deficiency.findMany({ where: { projectId } });
    await expect(closeout.updateDeficiency(sup, defs[0].id, "COMPLETED")).rejects.toThrow(/corrective/);
    for (const df of defs) await closeout.updateDeficiency(sup, df.id, "COMPLETED", "Corrected and photographed");
    await closeout.scheduleInspection(sup, projectId, { type: "ESA Final (re-inspection)", isEsa: true, isFinal: true, scheduledAt: new Date(), reinspectionOfId: insp.id });
    const re = await prisma.inspection.findFirstOrThrow({ where: { reinspectionOfId: insp.id } });
    await closeout.recordInspectionResult(sup, re.id, { result: "PASSED", resultDate: today(), deficiencies: [] });
    const c = await closeout.addCommissioningItem(pm, projectId, { system: "Fire alarm", test: "Verification" });
    await closeout.recordCommissioning(pm, c.id, { result: "PASSED", performedAt: today(), performedBy: "Simplex" });
  });

  it("closeout: blocked until mandatory items complete or waived; then CLOSED", async () => {
    await closeout.startCloseout(pm, projectId);
    await expect(closeout.closeProject(pm, projectId)).rejects.toThrow(/Cannot close/);
    const items = await prisma.closeoutItem.findMany({ where: { projectId } });
    const byKey = (k: string) => items.find((i) => i.key === k)!;
    // final invoice not marked yet → auto check blocks completion
    await expect(closeout.completeCloseoutItem(pm, byKey("final_invoice").id)).rejects.toThrow(/Cannot mark complete/);
    const lastInv = await prisma.invoice.findFirstOrThrow({ where: { projectId }, orderBy: { createdAt: "desc" } });
    await billing.setInvoiceStatus(acct, lastInv.id, "MARK_FINAL");
    // holdback release billed & paid
    const hb = await billing.createHoldbackRelease(acct, projectId, today());
    await billing.setInvoiceStatus(acct, hb.id, "SUBMIT");
    await billing.recordPayment(acct, hb.id, { receivedAt: today(), amount: Number(hb.total) });
    // the disputed supplier invoice must be resolved: estimator can't waive
    await expect(closeout.waiveCloseoutItem(estimator, byKey("supplier_invoices").id, "Disputed invoice credited")).rejects.toThrow(/permission/);
    await closeout.waiveCloseoutItem(pm, byKey("supplier_invoices").id, "Disputed invoice INV-ND-1 to be credited by supplier");
    for (const it of items) {
      if (it.key === "supplier_invoices") continue;
      await closeout.completeCloseoutItem(pm, it.id);
    }
    await closeout.closeProject(pm, projectId);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(p.stage).toBe("CLOSED");
    expect(p.closeReason).toBe("COMPLETED");
    const history = await prisma.stageHistory.findMany({ where: { projectId }, orderBy: { at: "asc" } });
    expect(history.map((h) => h.toStage)).toEqual(["OPPORTUNITY", "UNDER_REVIEW", "ESTIMATING", "QUOTING", "READY_TO_SUBMIT", "SUBMITTED", "ACTIVATION", "EXECUTION", "CLOSEOUT", "CLOSED"]);
  });

  it("audit log is append-only and complete", async () => {
    const n = await prisma.auditLog.count({ where: { projectId } });
    expect(n).toBeGreaterThan(40);
    await expect(prisma.auditLog.deleteMany({ where: { projectId } })).rejects.toThrow();
    await expect(prisma.auditLog.updateMany({ where: { projectId }, data: { summary: "tampered" } })).rejects.toThrow();
  });
});

describe("Scenario 4: service work order from the field", () => {
  it("direct job → field visit with signature → invoice → paid → closed", async () => {
    await expect(projects.createDirectJob(estimator, { jobType: "SERVICE", name: "x" })).rejects.toThrow(/permission/);
    const job = await projects.createDirectJob(pm, { jobType: "SERVICE", name: "Tripping breaker — Unit 402", clientId: client.id, location: "100 River St #402", siteContactName: "J. Doe", siteContactPhone: "555-0100", clientPoNumber: "SVC-55", contractValue: 0 });
    expect(job.stage).toBe("EXECUTION");
    expect(job.number).toMatch(/^WO-\d{4}-\d{4}$/);
    // electrician not assigned → cannot see / clock in
    await expect(labour.clockIn(elec, job.id)).rejects.toThrow(/not assigned/);
    const w = await prisma.worker.findFirstOrThrow({ where: { userId: elec.id } });
    await labour.scheduleWorkers(pm, job.id, { workerIds: [w.id], fromDate: today(), toDate: today(), hours: 2, includeWeekends: true });
    // per-job range override: 200 m
    await projects.setSiteLocation(pm, job.id, { lat: 43.7, lng: -79.4 }, 200);
    await labour.clockIn(elec, job.id, { lat: 43.7015, lng: -79.4 }); // ~167 m
    await labour.completeWorkOrder(elec, job.id, { workSummary: "Replaced 15A breaker, tested circuit", markedComplete: true, customerName: "J. Doe", signatureDataUrl: "data:image/png;base64," + Buffer.alloc(600, 7).toString("base64") });
    // left without clocking out → office closes it (no geofence), audited
    const openClock = await prisma.clockEntry.findFirstOrThrow({ where: { clockOutAt: null, projectId: job.id } });
    await expect(labour.officeClockOut(elec, openClock.id)).rejects.toThrow(/permission/);
    await labour.officeClockOut(pm, openClock.id);
    expect(await prisma.auditLog.count({ where: { action: "clock.out", entityId: openClock.id, summary: { contains: "by " } } })).toBe(1);
    // geofence can be switched off in settings
    await admin.saveSettings(adminU, { "field.geofenceEnabled": false });
    await labour.clockIn(elec, job.id);
    await expect(labour.clockOut(elec)).rejects.toThrow(/work order form/);
    await labour.completeWorkOrder(elec, job.id, { workSummary: "Return visit: labelled panel", markedComplete: false });
    await labour.clockOut(elec);
    await admin.saveSettings(adminU, { "field.geofenceEnabled": true });
    // unplanned service call started from the phone
    await expect(labour.startServiceCall(elec, { customer: "Corner Cafe", address: "25 King St W" }, {})).rejects.toThrow(/needs your location/);
    const call = await labour.startServiceCall(elec, { customer: "Corner Cafe", address: "25 King St W", problem: "No power to kitchen" }, { lat: 43.6487, lng: -79.3817, accuracy: 12 });
    expect(call.jobType).toBe("SERVICE");
    expect(call.siteLat).toBe(43.6487);
    expect(call.geofenceRadiusM).toBeNull();
    expect((await labour.assignedJobs(elec)).jobs.map((j) => j.project.id)).toContain(call.id);
    expect(await prisma.notification.count({ where: { userId: pm.id, projectId: call.id } })).toBe(1);
    await expect(labour.startServiceCall(elec, { customer: "Other", address: "1 Main St" }, { lat: 43.6, lng: -79.3 })).rejects.toThrow(/still clocked in/);
    await expect(labour.clockOut(elec, { lat: 43.66, lng: -79.3817 })).rejects.toThrow(/Move within/);
    await expect(labour.clockOut(elec, { lat: 43.6489, lng: -79.3817 })).rejects.toThrow(/Fill in the work order form/);
    await labour.completeWorkOrder(elec, call.id, { workSummary: "Reset GFCI, replaced 20A breaker", markedComplete: true });
    expect(await prisma.notification.count({ where: { userId: pm.id, type: "workorder.signoff", projectId: call.id } })).toBe(1);
    await labour.clockOut(elec, { lat: 43.6489, lng: -79.3817 });
    // weak GPS widens that call's range
    const call2 = await labour.startServiceCall(elec, { customer: "Gas Bar", address: "9 Queen St" }, { lat: 43.65, lng: -79.39, accuracy: 120 });
    expect(call2.geofenceRadiusM).toBe(170);
    await admin.saveSettings(adminU, { "field.requireWorkOrderBeforeClockOut": false });
    await labour.clockOut(elec, { lat: 43.65, lng: -79.39 });
    await admin.saveSettings(adminU, { "field.requireWorkOrderBeforeClockOut": true });
    await admin.saveSettings(adminU, { "field.allowServiceCalls": false });
    await expect(labour.startServiceCall(elec, { customer: "X Co", address: "1 Main St" }, { lat: 43.6, lng: -79.3 })).rejects.toThrow(/switched off/);
    await admin.saveSettings(adminU, { "field.allowServiceCalls": true });
    const signoff = await prisma.workOrderSignoff.findFirstOrThrow({ where: { projectId: job.id } });
    expect(signoff.signatureDocId).toBeTruthy();
    const inv = await billing.createManualInvoice(acct, job.id, { description: "Service call — 2 hrs + breaker", invoiceDate: today(), amount: 285, applyHoldback: false, isFinal: true });
    await billing.setInvoiceStatus(acct, inv.id, "SUBMIT");
    await billing.recordPayment(acct, inv.id, { receivedAt: today(), amount: Number(inv.total) });
    await closeout.startCloseout(pm, job.id);
    for (const it of await prisma.closeoutItem.findMany({ where: { projectId: job.id } })) await closeout.completeCloseoutItem(pm, it.id);
    await closeout.closeProject(pm, job.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: job.id } })).stage).toBe("CLOSED");
  });
});

describe("Scenario 5: permissions and automation", () => {
  it("read-only and electrician users cannot change data", async () => {
    await expect(projects.createLead(ro, { name: "x" })).rejects.toThrow(/permission/);
    await expect(projects.createLead(elec, { name: "x" })).rejects.toThrow(/permission/);
    await expect(admin.saveUser(pm, null, { name: "x", email: "x@y.z", role: "ADMIN", active: true, password: "abc12345678" })).rejects.toThrow(/permission/);
  });
  it("scheduled reminders fire once (dedupe)", async () => {
    const lead = await projects.createLead(estimator, { name: "School gym", submissionDeadline: addDays(new Date(), 1) });
    await projects.decideReview(pm, lead.id, { decision: "DOABLE", estimatorId: estimator.id });
    const first = await runScheduledJobs();
    expect(first.tenderDeadline).toBeGreaterThan(0);
    const second = await runScheduledJobs();
    expect(second.tenderDeadline ?? 0).toBe(0);
  });
});
