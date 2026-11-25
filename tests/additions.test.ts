/**
 * Edge cases added during UI build: credit change orders and shop drawing re-review after a revised upload.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import { d } from "@/lib/money";
import { today } from "@/lib/dates";
import { resetDb, makeUser, file } from "./helpers";
import * as projects from "@/services/projects";
import * as changes from "@/services/changes";
import * as sd from "@/services/shopDrawings";
import type { Actor } from "@/lib/actor";

process.env.STORAGE_LOCAL_DIR = "./storage-test";

let pm: Actor;
let projectId: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  await resetDb();
  pm = await makeUser("Pat Manager", "PROJECT_MANAGER");
  const p = await projects.createDirectJob(pm, { jobType: "SMALL_JOB", name: "Office reno", contractValue: 20000, clientPoNumber: "PO-1", projectManagerId: pm.id });
  projectId = p.id;
});

describe("change order credits", () => {
  it("a credit (negative quantity) reduces the contract through the ledger; original stays", async () => {
    const co = await changes.createChangeOrder(pm, projectId, { title: "Delete 10 pot lights", description: "Owner removed", reason: "Scope reduction" });
    await changes.updateCoPricing(pm, co.id, { labourRate: 100, markupPercent: 0, otherCost: 0, scheduleImpactDays: 0, title: co.title, description: co.description, reason: co.reason });
    await changes.addCoLine(pm, co.id, changes.coLineSchema.parse({ category: "MATERIAL", description: "Pot light", quantity: "-10", unitPrice: "50", labourHoursPerUnit: "0.5" }));
    expect(() => changes.coLineSchema.parse({ category: "MATERIAL", description: "x", quantity: "0" })).toThrow(/cannot be 0/);
    const priced = await prisma.changeOrder.findUniqueOrThrow({ where: { id: co.id } });
    expect(d(priced.proposedAmount).toNumber()).toBe(-1000); // -500 material, -5h x 100
    await changes.submitChangeOrder(pm, co.id);
    await changes.decideChangeOrder(pm, co.id, { decision: "APPROVED", decidedAt: today() });
    const c = await prisma.contract.findUniqueOrThrow({ where: { projectId } });
    expect(d(c.originalValue).toNumber()).toBe(20000);
    expect(d(c.currentValue).toNumber()).toBe(19000);
  });
});

describe("shop drawing review", () => {
  it("uploading a revised file after a return needs a fresh Intervolt review", async () => {
    const s = await sd.createShopDrawing(pm, projectId, { title: "Panel schedule" }, file("panel.pdf"));
    await sd.internalReview(pm, s.id, "RETURN", "Wrong breaker sizes");
    await sd.uploadDrawingFile(pm, s.id, file("panel-v2.pdf"));
    await expect(sd.submitToConsultant(pm, s.id, { submittedAt: new Date() })).rejects.toThrow(/review/);
    await sd.internalReview(pm, s.id, "PASS");
    await sd.submitToConsultant(pm, s.id, { submittedAt: new Date() });
    const rev = await prisma.shopDrawingRevision.findFirstOrThrow({ where: { shopDrawingId: s.id } });
    expect(rev.status).toBe("SUBMITTED");
  });
});
