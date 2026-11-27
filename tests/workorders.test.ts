/**
 * Office review: phone service calls get a temporary NEW-n number until the office files the
 * work order under an existing (unbilled) job or makes it a new work order. Billed tick.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, makeUser } from "./helpers";
import * as projects from "@/services/projects";
import * as labour from "@/services/labour";
import * as wo from "@/services/workorders";
import type { Actor } from "@/lib/actor";

let pm: Actor, jordan: Actor, andy: Actor;
const at = { lat: 43.75, lng: -79.7 };

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  await resetDb();
  pm = await makeUser("Pat Manager", "PROJECT_MANAGER");
  jordan = await makeUser("Jordan Silva", "ELECTRICIAN");
  andy = await makeUser("Andy Morales", "ELECTRICIAN");
  await labour.saveWorker(pm, null, labour.workerSchema.parse({ name: "Jordan Silva", trade: "Journeyperson", regularRate: 40, overtimeRate: 60, userId: jordan.id, active: true }));
  await labour.saveWorker(pm, null, labour.workerSchema.parse({ name: "Andy Morales", trade: "Apprentice", regularRate: 25, overtimeRate: 37.5, userId: andy.id, active: true }));
});

describe("office review of work orders", () => {
  it("new call → New work order gets a real number; a repeat visit is filed under it and the temp call is closed", async () => {
    const a = await labour.startServiceCall(jordan, { customer: "Midair Logistics", address: "115 Midair Court, Brampton" }, at);
    expect(a.number).toMatch(/^NEW-\d+$/);
    expect(a.pendingReview).toBe(true);
    await labour.completeWorkOrder(jordan, a.id, labour.signoffSchema.parse({ workSummary: "Breaker tripping, ordered part", jobStatus: "WAITING_PARTS" }));
    await labour.clockOut(jordan, at);
    let q = await wo.reviewQueue(pm);
    expect(q).toHaveLength(1);
    expect(q[0].project.pendingReview).toBe(true);
    await expect(wo.fileWorkOrder(jordan, q[0].id, "NEW")).rejects.toThrow();
    await wo.fileWorkOrder(pm, q[0].id, "NEW");
    const A = await prisma.project.findUniqueOrThrow({ where: { id: a.id } });
    expect(A.number).toMatch(/^WO-\d{4}-\d{4}$/);
    expect(A.pendingReview).toBe(false);
    expect(await wo.reviewQueue(pm)).toHaveLength(0);
    await expect(wo.fileWorkOrder(pm, q[0].id, "NEW")).rejects.toThrow(/Already filed/);

    // Andy goes back later and taps Service call again → new temp call; office files it under A
    const b = await labour.startServiceCall(andy, { customer: "Midair", address: "115 Midair Ct" }, at);
    const pic = (n: string) => ({ name: n, type: "image/jpeg", data: Buffer.alloc(600, 1) });
    await expect(labour.completeWorkOrder(andy, b.id, labour.signoffSchema.parse({ workSummary: "x x x" }), null, [{ name: "a.exe", type: "application/x-msdownload", data: Buffer.alloc(600) }])).rejects.toThrow(/pictures/);
    await labour.completeWorkOrder(andy, b.id, labour.signoffSchema.parse({ workSummary: "Installed part, tested", jobStatus: "COMPLETE", parkingAmount: 9 }), pic("ticket.jpg"), [pic("panel.jpg"), pic("breaker.jpg")]);
    expect(await prisma.document.count({ where: { projectId: b.id, category: "Site photo" } })).toBe(2);
    expect((await prisma.document.findFirstOrThrow({ where: { projectId: b.id, category: "Site photo" } })).title).not.toMatch(/NEW-/);
    await prisma.clockEntry.updateMany({ where: { projectId: b.id }, data: { clockInAt: new Date(Date.now() - 2 * 3_600_000) } });
    await labour.clockOut(andy, at);
    q = await wo.reviewQueue(pm);
    expect(q).toHaveLength(1);
    expect(q[0].candidates[0].id).toBe(A.id);
    expect(q[0].candidates[0].match).toBeGreaterThanOrEqual(2);
    const andyHoursBefore = await prisma.timeEntry.count({ where: { projectId: b.id } });
    expect(andyHoursBefore).toBeGreaterThan(0);
    await wo.fileWorkOrder(pm, q[0].id, A.id);
    const B = await prisma.project.findUniqueOrThrow({ where: { id: b.id } });
    expect(B.stage).toBe("CLOSED");
    expect(B.closeReason).toBe("MERGED");
    expect(B.mergedIntoId).toBe(A.id);
    expect(await prisma.timeEntry.count({ where: { projectId: b.id } })).toBe(0);
    expect(await prisma.clockEntry.count({ where: { projectId: b.id } })).toBe(0);
    expect(await prisma.workOrderSignoff.count({ where: { projectId: A.id } })).toBe(2);
    expect(await prisma.document.count({ where: { projectId: A.id, category: { in: ["Site photo", "Parking receipt"] } } })).toBe(3);
    expect(await prisma.document.count({ where: { projectId: b.id } })).toBe(0);
    expect(await prisma.timeEntry.count({ where: { projectId: A.id, worker: { userId: andy.id } } })).toBe(andyHoursBefore);
    // Andy's own list now shows it under the real job
    expect((await labour.myWorkOrders(andy))[0].project.id).toBe(A.id);

    // Billed: drops out of the list to file under
    expect((await wo.openJobs()).map((j) => j.id)).toContain(A.id);
    expect((await wo.billingList(pm))[0].id).toBe(A.id); // Complete on top
    await expect(wo.setBilled(jordan, A.id, true)).rejects.toThrow();
    await wo.setBilled(pm, A.id, true);
    expect((await wo.openJobs()).map((j) => j.id)).not.toContain(A.id);
    const c = await labour.startServiceCall(jordan, { customer: "Midair", address: "115 Midair Court" }, at);
    const sc = await labour.completeWorkOrder(jordan, c.id, labour.signoffSchema.parse({ workSummary: "Callback", jobStatus: "COMPLETE" }));
    await labour.clockOut(jordan, at);
    await expect(wo.fileWorkOrder(pm, sc.id, A.id)).rejects.toThrow(/already billed/);
    expect((await wo.reviewQueue(pm))[0].candidates.map((x) => x.id)).not.toContain(A.id);
    await wo.setBilled(pm, A.id, false);
    expect((await wo.openJobs()).map((j) => j.id)).toContain(A.id);
    await wo.fileWorkOrder(pm, sc.id, "NEW");
  });

  it("a work order on a scheduled job: keep it, or split that visit into a new work order", async () => {
    const job = await projects.createDirectJob(pm, { jobType: "SMALL_JOB", name: "Lakeview Plaza", location: "9 Lake Rd", contractValue: 5000, clientPoNumber: "PO-9", projectManagerId: pm.id });
    const s1 = await labour.completeWorkOrder(pm, job.id, labour.signoffSchema.parse({ workSummary: "Panel swap", jobStatus: "COMPLETE" }));
    await wo.fileWorkOrder(pm, s1.id, "KEEP");
    expect((await prisma.workOrderSignoff.findUniqueOrThrow({ where: { id: s1.id } })).reviewedAt).not.toBeNull();
    const s2 = await labour.completeWorkOrder(pm, job.id, labour.signoffSchema.parse({ workSummary: "Separate: new EV charger", jobStatus: "NEEDS_QUOTE" }));
    const r = await wo.fileWorkOrder(pm, s2.id, "NEW");
    expect(r.projectId).not.toBe(job.id);
    const n = await prisma.project.findUniqueOrThrow({ where: { id: r.projectId } });
    expect(n.number).toMatch(/^WO-/);
    expect(n.location).toBe("9 Lake Rd");
    expect((await prisma.workOrderSignoff.findUniqueOrThrow({ where: { id: s2.id } })).projectId).toBe(n.id);
    expect(await prisma.workOrderSignoff.count({ where: { projectId: job.id } })).toBe(1);
  });
});
