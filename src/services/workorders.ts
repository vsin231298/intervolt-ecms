/**
 * Office review of incoming work orders: file each one under an existing (unbilled) job,
 * or give it a new Work Order Number. Plus the "Billed" tick that takes a job off that list.
 */
import { prisma, tx, type Tx } from "@/lib/db";
import { requirePerm, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { addDays, TZ } from "@/lib/dates";
import { nextWorkOrderNumber } from "@/lib/numbering";

const OPEN = ["ACTIVATION", "EXECUTION", "CLOSEOUT"] as const;
const SMALL = ["SERVICE", "SMALL_JOB"] as const;

/** Local (Toronto) calendar day of a timestamp, as a UTC-midnight date like TimeEntry.date. */
function localDay(at: Date) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return new Date(`${s}T00:00:00.000Z`);
}

/** "115 Midair Court, Brampton" → "115 midair" (house number + first word of street) for matching. */
function addrKey(a: string | null | undefined) {
  const m = (a ?? "").toLowerCase().match(/(\d+[a-z]?)\s+([a-z]+)/);
  return m ? `${m[1]} ${m[2]}` : null;
}
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export async function reviewCount() {
  return prisma.workOrderSignoff.count({ where: { reviewedAt: null } });
}

/** Work orders waiting for the office, oldest first, with who sent them, the hours that day, and where they could go. */
export async function reviewQueue(actor: Actor) {
  requirePerm(actor, "jobs.view");
  const list = await prisma.workOrderSignoff.findMany({
    where: { reviewedAt: null }, orderBy: { createdAt: "asc" }, take: 100,
    include: { project: { select: { id: true, number: true, name: true, location: true, siteContactName: true, clientId: true, pendingReview: true, client: { select: { name: true } } } } },
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(list.map((s) => s.completedById))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  const candidates = await openJobs();
  return Promise.all(list.map(async (s) => {
    const w = await prisma.worker.findUnique({ where: { userId: s.completedById }, select: { id: true } });
    const day = s.forDate ?? localDay(s.createdAt);
    const hrs = w ? await prisma.timeEntry.aggregate({ where: { projectId: s.projectId, workerId: w.id, date: day }, _sum: { regularHours: true, overtimeHours: true } }) : null;
    const hours = hrs ? Number(hrs._sum.regularHours ?? 0) + Number(hrs._sum.overtimeHours ?? 0) : 0;
    const key = addrKey(s.project.location), cust = norm(s.project.siteContactName ?? s.project.client?.name);
    const scored = candidates
      .filter((c) => c.id !== s.projectId)
      .map((c) => ({ ...c, match: (key && addrKey(c.location) === key ? 2 : 0) + ((s.project.clientId && c.clientId === s.project.clientId) || (cust && norm(c.customer) === cust) ? 1 : 0) }))
      .sort((a, b) => b.match - a.match || (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0));
    return { ...s, submittedBy: name.get(s.completedById) ?? "Unknown", hours, day, candidates: scored };
  }));
}

/** Open service calls and small jobs that are not billed and not waiting on review: where a work order can be filed. */
export async function openJobs() {
  const jobs = await prisma.project.findMany({
    where: { jobType: { in: [...SMALL] }, stage: { in: [...OPEN] }, billedAt: null, pendingReview: false },
    select: { id: true, number: true, name: true, location: true, clientId: true, siteContactName: true, client: { select: { name: true } }, signoffs: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, completedById: true, jobStatus: true } } },
    orderBy: { number: "desc" }, take: 300,
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(jobs.flatMap((j) => j.signoffs.map((s) => s.completedById)))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return jobs.map((j) => ({
    id: j.id, number: j.number, name: j.name, location: j.location, clientId: j.clientId, customer: j.client?.name ?? j.siteContactName,
    lastAt: j.signoffs[0]?.createdAt ?? null, lastBy: j.signoffs[0] ? name.get(j.signoffs[0].completedById) ?? null : null, lastStatus: j.signoffs[0]?.jobStatus ?? null,
  }));
}

/** Move documents to another job, into the folder with the same name there (created if missing). */
async function moveDocs(t: Tx, where: { id: { in: string[] } }, toProjectId: string) {
  const docs = await t.document.findMany({ where, include: { folder: { select: { name: true } } } });
  for (const d of docs) {
    let folderId: string | null = null;
    if (d.folder) {
      const f = await t.documentFolder.upsert({ where: { projectId_name: { projectId: toProjectId, name: d.folder.name } }, create: { projectId: toProjectId, name: d.folder.name }, update: {} });
      folderId = f.id;
    }
    await t.document.update({ where: { id: d.id }, data: { projectId: toProjectId, folderId } });
  }
  return docs.length;
}

/**
 * File a work order. target:
 *  - "KEEP": it's on the right job (or a phone service call that's genuinely new → gets its real WO number)
 *  - "NEW": make it a new work order (phone call: gets its real number; existing job: split this visit into a new job)
 *  - a project id: move it there (a phone service call is merged in whole and closed)
 */
export async function fileWorkOrder(actor: Actor, signoffId: string, target: string) {
  requirePerm(actor, "jobs.create");
  assert(target, "Pick Existing job or New work order.");
  return tx(async (t) => {
    const s = await t.workOrderSignoff.findUnique({ where: { id: signoffId }, include: { project: true } });
    if (!s) throw new NotFoundError("Work order");
    if (s.reviewedAt) throw new UserError("Already filed.");
    const src = s.project;
    const done = async (projectId: string, summary: string) => {
      await t.workOrderSignoff.update({ where: { id: s.id }, data: { reviewedAt: new Date(), reviewedById: actor.id } });
      await audit(t, actor, { action: "workorder.file", entityType: "WorkOrderSignoff", entityId: s.id, projectId, summary });
      return { projectId };
    };

    // Keep where it is. A phone call kept as-is is a new work order.
    if (target === "KEEP" || (target === "NEW" && src.pendingReview)) {
      if (!src.pendingReview) return done(src.id, `${src.number}: work order checked`);
      const number = await nextWorkOrderNumber(t);
      await t.project.update({ where: { id: src.id }, data: { number, pendingReview: false } });
      await t.stageHistory.create({ data: { projectId: src.id, toStage: src.stage, byId: actor.id, note: `${src.number} filed as new work order ${number}` } });
      return done(src.id, `${src.number} filed as new work order ${number}`);
    }

    // Split this visit off an existing job into a brand-new work order.
    let to: { id: string; number: string; jobType: string; stage: string; billedAt: Date | null; pendingReview: boolean };
    if (target === "NEW") {
      const number = await nextWorkOrderNumber(t);
      to = await t.project.create({
        data: {
          number, jobType: "SERVICE", stage: "EXECUTION", awardedAt: new Date(), holdbackPercent: 0, name: src.name, location: src.location, clientId: src.clientId,
          siteContactName: src.siteContactName, siteContactPhone: src.siteContactPhone, siteLat: src.siteLat, siteLng: src.siteLng, geofenceRadiusM: src.geofenceRadiusM, projectManagerId: src.projectManagerId,
          description: `Split from ${src.number} by ${actor.name}.`,
        },
      });
      await t.stageHistory.create({ data: { projectId: to.id, toStage: "EXECUTION", byId: actor.id, note: `New work order for a visit filed from ${src.number}` } });
    } else {
      const found = await t.project.findUnique({ where: { id: target } });
      assert(found, "Pick a job.");
      to = found;
      if (to.id === src.id) return done(src.id, `${src.number}: work order checked`);
      assert(!to.billedAt, `${to.number} is already billed. Pick another job or New work order.`);
      assert(!to.pendingReview, "Pick a job that has a WO number.");
    }

    if (src.pendingReview) {
      // Phone service call: everything on it belongs to the chosen job. Move it all, then close the temporary call.
      const pid = { projectId: src.id };
      await t.clockEntry.updateMany({ where: pid, data: { projectId: to.id } });
      await t.timeEntry.updateMany({ where: pid, data: { projectId: to.id } });
      await t.workOrderSignoff.updateMany({ where: pid, data: { projectId: to.id } });
      await t.workOrderRequest.updateMany({ where: pid, data: { projectId: to.id } });
      await t.fieldUpdate.updateMany({ where: pid, data: { projectId: to.id } });
      await t.materialUsage.updateMany({ where: pid, data: { projectId: to.id, materialItemId: null } });
      const docIds = (await t.document.findMany({ where: pid, select: { id: true } })).map((d) => d.id);
      await moveDocs(t, { id: { in: docIds } }, to.id);
      for (const m of await t.projectMember.findMany({ where: pid })) {
        await t.projectMember.upsert({ where: { projectId_userId: { projectId: to.id, userId: m.userId } }, create: { projectId: to.id, userId: m.userId, roleLabel: m.roleLabel }, update: {} });
      }
      if (src.serviceLeadUserId && to.jobType === "SERVICE") await t.project.update({ where: { id: to.id }, data: { serviceLeadUserId: src.serviceLeadUserId } });
      await t.project.update({ where: { id: src.id }, data: { stage: "CLOSED", closeReason: "MERGED", closedAt: new Date(), pendingReview: false, mergedIntoId: to.id } });
      await t.stageHistory.create({ data: { projectId: src.id, fromStage: src.stage, toStage: "CLOSED", byId: actor.id, note: `Merged into ${to.number}` } });
      return done(to.id, `${src.number} filed under ${to.number} (hours, photos and work order moved)`);
    }

    // Existing job: move just this visit — the work order, its documents, and that day's hours for the people on it.
    const day = s.forDate ?? localDay(s.createdAt);
    const workerIds = [
      ...(await t.worker.findMany({ where: { userId: s.completedById }, select: { id: true } })).map((w) => w.id),
      ...s.coWorkerIds,
    ];
    await t.workOrderSignoff.update({ where: { id: s.id }, data: { projectId: to.id } });
    await moveDocs(t, { id: { in: (await t.document.findMany({ where: { entityType: "WorkOrderSignoff", entityId: s.id }, select: { id: true } })).map((d) => d.id) } }, to.id);
    await t.timeEntry.updateMany({ where: { projectId: src.id, workerId: { in: workerIds }, date: day }, data: { projectId: to.id } });
    const from = new Date(day.getTime() - 14 * 3_600_000), until = addDays(day, 2);
    const clocks = await t.clockEntry.findMany({ where: { projectId: src.id, workerId: { in: workerIds }, clockInAt: { gte: from, lt: until } } });
    const moveIds = clocks.filter((c) => localDay(c.clockInAt).getTime() === day.getTime()).map((c) => c.id);
    await t.clockEntry.updateMany({ where: { id: { in: moveIds } }, data: { projectId: to.id } });
    return done(to.id, `Visit moved from ${src.number} to ${to.number}`);
  });
}
