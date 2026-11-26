import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, tx, type Tx } from "@/lib/db";
import { requirePerm, requireAny, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { can } from "@/lib/rbac";
import { ForbiddenError, NotFoundError, UserError, assert } from "@/lib/errors";
import { d, pct, round2, sum } from "@/lib/money";
import { addDays, dayOf, today } from "@/lib/dates";
import { zDate, zId, zNonNeg, zOptId, zOptText, zText } from "@/lib/forms";
import { notifyUsers } from "@/lib/notify";
import { getSetting } from "@/lib/settings";
import { loadProject } from "./projects";
import { distanceMeters, fmtDistance } from "@/lib/geo";
import { uploadDocument, type UploadFile } from "./documents";

// ─────────────── Workers ───────────────

export const workerSchema = z.object({
  name: zText(200),
  trade: zText(100),
  licenceNo: zOptText(100),
  phone: zOptText(50),
  regularRate: zNonNeg,
  overtimeRate: zNonNeg,
  userId: zOptId,
  active: z.boolean().default(true),
});

export async function saveWorker(actor: Actor, id: string | null, input: z.infer<typeof workerSchema>) {
  requirePerm(actor, "workers.edit");
  return tx(async (t) => {
    if (input.userId) {
      const other = await t.worker.findFirst({ where: { userId: input.userId, ...(id ? { id: { not: id } } : {}) } });
      assert(!other, "That user account is already linked to another worker.");
    }
    const before = id ? await t.worker.findUnique({ where: { id } }) : null;
    const w = id ? await t.worker.update({ where: { id }, data: { ...input, userId: input.userId ?? null } }) : await t.worker.create({ data: input });
    await audit(t, actor, { action: id ? "worker.update" : "worker.create", entityType: "Worker", entityId: w.id, summary: `Worker ${w.name} ${id ? "updated" : "added"}`, before, after: input });
    return w;
  });
}

// ─────────────── Scheduling ───────────────

export const assignmentSchema = z.object({
  workerIds: z.array(z.string()).min(1, "Choose at least one worker"),
  fromDate: zDate,
  toDate: zDate,
  hours: zNonNeg.default(8),
  includeWeekends: z.boolean().default(false),
  notes: zOptText(300),
});

/** Assign workers to a job for a date range. Returns any double-booking warnings. */
export async function scheduleWorkers(actor: Actor, projectId: string, input: z.infer<typeof assignmentSchema>) {
  requirePerm(actor, "labour.schedule");
  if (input.toDate < input.fromDate) throw new UserError("End date is before start date.");
  const days = Math.round((input.toDate.getTime() - input.fromDate.getTime()) / 86_400_000) + 1;
  if (days > 120) throw new UserError("Schedule at most 120 days at a time.");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(["ACTIVATION", "EXECUTION", "CLOSEOUT"].includes(p.stage), "Workers can only be scheduled on active jobs.");
    const warnings: string[] = [];
    let created = 0;
    for (const workerId of input.workerIds) {
      const w = await t.worker.findUnique({ where: { id: workerId } });
      assert(w && w.active, "Choose active workers.");
      for (let i = 0; i < days; i++) {
        const date = addDays(input.fromDate, i);
        const dow = date.getUTCDay();
        if (!input.includeWeekends && (dow === 0 || dow === 6)) continue;
        const elsewhere = await t.labourAssignment.findFirst({ where: { workerId, date, projectId: { not: projectId } }, include: { project: true } });
        if (elsewhere) warnings.push(`${w.name} is also on ${elsewhere.project.number} on ${date.toISOString().slice(0, 10)}`);
        await t.labourAssignment.upsert({
          where: { workerId_projectId_date: { workerId, projectId, date } },
          create: { workerId, projectId, date, hours: input.hours, notes: input.notes },
          update: { hours: input.hours, notes: input.notes },
        });
        created++;
      }
      if (w.userId) await notifyUsers(t, [w.userId], { type: "schedule.assigned", title: `Scheduled on ${p.number} ${p.name}`, body: `${input.fromDate.toISOString().slice(0, 10)} to ${input.toDate.toISOString().slice(0, 10)}`, link: `/field`, projectId }, actor.id);
    }
    await audit(t, actor, { action: "schedule.assign", entityType: "Project", entityId: projectId, projectId, summary: `${p.number}: ${created} worker-day(s) scheduled ${input.fromDate.toISOString().slice(0, 10)} – ${input.toDate.toISOString().slice(0, 10)}` });
    return { created, warnings };
  });
}

export async function updateAssignment(actor: Actor, id: string, hours: number, notes?: string) {
  requirePerm(actor, "labour.schedule");
  return tx(async (t) => {
    const a = await t.labourAssignment.findUnique({ where: { id }, include: { worker: true } });
    if (!a) throw new NotFoundError("Schedule entry");
    assert(hours > 0 && hours <= 24, "Hours must be between 0 and 24.");
    await t.labourAssignment.update({ where: { id }, data: { hours, notes } });
    await audit(t, actor, { action: "schedule.update", entityType: "LabourAssignment", entityId: id, projectId: a.projectId, summary: `${a.worker.name} ${a.date.toISOString().slice(0, 10)}: hours ${d(a.hours)} → ${hours}`, before: a, after: { hours, notes } });
  });
}

export async function removeAssignment(actor: Actor, id: string) {
  requirePerm(actor, "labour.schedule");
  return tx(async (t) => {
    const a = await t.labourAssignment.findUnique({ where: { id }, include: { worker: true } });
    if (!a) throw new NotFoundError("Schedule entry");
    await t.labourAssignment.delete({ where: { id } });
    await audit(t, actor, { action: "schedule.remove", entityType: "LabourAssignment", entityId: id, projectId: a.projectId, summary: `${a.worker.name} removed from schedule on ${a.date.toISOString().slice(0, 10)}`, before: a });
  });
}

// ─────────────── Time entries ───────────────

export const timeEntrySchema = z.object({
  workerId: zId,
  date: zDate,
  regularHours: zNonNeg,
  overtimeHours: zNonNeg.default(0),
  costCode: zOptText(50),
  changeOrderId: zOptId,
  description: zOptText(1000),
});

async function costFor(t: Tx, workerId: string, regular: number, overtime: number) {
  const w = await t.worker.findUnique({ where: { id: workerId } });
  if (!w) throw new NotFoundError("Worker");
  const burden = Number(await getSetting("labour.burdenPercent", t));
  const base = d(regular).times(d(w.regularRate)).plus(d(overtime).times(d(w.overtimeRate)));
  return { worker: w, cost: round2(base.plus(pct(base, burden))) };
}

export async function addTimeEntry(actor: Actor, projectId: string, input: z.infer<typeof timeEntrySchema>) {
  requireAny(actor, ["time.submit", "time.manage"]);
  if (input.regularHours + input.overtimeHours <= 0) throw new UserError("Enter hours worked.");
  if (input.regularHours + input.overtimeHours > 24) throw new UserError("More than 24 hours in a day.");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(p.stage !== "CLOSED" || can(actor.role, "time.manage"), "This job is closed.");
    const { worker, cost } = await costFor(t, input.workerId, input.regularHours, input.overtimeHours);
    const e = await t.timeEntry.create({
      data: { ...input, projectId, regularRate: worker.regularRate, overtimeRate: worker.overtimeRate, cost, submittedById: actor.id, source: can(actor.role, "time.manage") ? "MANUAL" : "TIMESHEET" },
    });
    await audit(t, actor, { action: "time.add", entityType: "TimeEntry", entityId: e.id, projectId, summary: `${p.number}: ${worker.name} ${input.date.toISOString().slice(0, 10)} — ${input.regularHours} reg + ${input.overtimeHours} OT` });
    return e;
  });
}

export async function updateTimeEntry(actor: Actor, id: string, input: Omit<z.infer<typeof timeEntrySchema>, "workerId">) {
  requirePerm(actor, "time.manage");
  return tx(async (t) => {
    const e = await t.timeEntry.findUnique({ where: { id }, include: { worker: true, project: true } });
    if (!e) throw new NotFoundError("Time entry");
    if (input.regularHours + input.overtimeHours > 24) throw new UserError("More than 24 hours in a day.");
    const { cost } = await costFor(t, e.workerId, input.regularHours, input.overtimeHours);
    const updated = await t.timeEntry.update({ where: { id }, data: { ...input, cost, editedById: actor.id, approvedAt: null, approvedById: null } });
    await audit(t, actor, { action: "time.edit", entityType: "TimeEntry", entityId: id, projectId: e.projectId, summary: `${e.project.number}: ${e.worker.name} ${e.date.toISOString().slice(0, 10)} time edited`, before: e, after: input });
    return updated;
  });
}

export async function deleteTimeEntry(actor: Actor, id: string, reason: string) {
  requirePerm(actor, "time.manage");
  assert(reason.trim().length >= 3, "Give a reason for deleting this entry.");
  return tx(async (t) => {
    const e = await t.timeEntry.findUnique({ where: { id }, include: { worker: true, project: true } });
    if (!e) throw new NotFoundError("Time entry");
    await t.timeEntry.delete({ where: { id } });
    await audit(t, actor, { action: "time.delete", entityType: "TimeEntry", entityId: id, projectId: e.projectId, summary: `${e.project.number}: ${e.worker.name} ${e.date.toISOString().slice(0, 10)} time entry deleted — ${reason}`, before: e });
  });
}

export async function approveTimeEntries(actor: Actor, ids: string[]) {
  requirePerm(actor, "time.manage");
  return tx(async (t) => {
    const res = await t.timeEntry.updateMany({ where: { id: { in: ids }, approvedAt: null }, data: { approvedAt: new Date(), approvedById: actor.id } });
    await audit(t, actor, { action: "time.approve", entityType: "TimeEntry", entityId: ids.join(",").slice(0, 200), summary: `${res.count} time entr${res.count === 1 ? "y" : "ies"} approved` });
    return res.count;
  });
}

// ─────────────── Field app (trades) ───────────────

export async function workerForUser(userId: string, t: Tx | typeof prisma = prisma) {
  return t.worker.findUnique({ where: { userId } });
}

/** Jobs a field user may see: scheduled today (or within ±1 day) or a team member on an active job. */
export async function assignedJobs(actor: Actor, date = today()) {
  const worker = await workerForUser(actor.id);
  const [assigned, memberOf] = await Promise.all([
    worker
      ? prisma.labourAssignment.findMany({ where: { workerId: worker.id, date }, include: { project: { include: { client: true } } } })
      : Promise.resolve([]),
    prisma.projectMember.findMany({ where: { userId: actor.id, project: { stage: { in: ["ACTIVATION", "EXECUTION", "CLOSEOUT"] } } }, include: { project: { include: { client: true } } } }),
  ]);
  const map = new Map<string, { project: (typeof memberOf)[number]["project"]; today: boolean; hours?: number; notes?: string | null }>();
  for (const a of assigned) map.set(a.projectId, { project: a.project, today: true, hours: Number(a.hours), notes: a.notes });
  for (const m of memberOf) if (!map.has(m.projectId)) map.set(m.projectId, { project: m.project, today: false });
  return { worker, jobs: [...map.values()].filter((j) => j.project.stage !== "CLOSED") };
}

export async function assertFieldAccess(actor: Actor, projectId: string) {
  if (can(actor.role, "jobs.view")) return;
  const { jobs } = await assignedJobs(actor);
  if (!jobs.some((j) => j.project.id === projectId)) throw new ForbiddenError("You are not assigned to this job.");
}

export type GeoPoint = { lat?: number; lng?: number; accuracy?: number; error?: string };

/**
 * Geofence: when enabled, clock in/out only works within the job's radius of its site pin.
 * Returns the distance (m) when checked, or null when the geofence is off.
 */
export async function assertOnSite(t: Tx, p: { number: string; siteLat: number | null; siteLng: number | null; geofenceRadiusM: number | null }, geo: GeoPoint, verb: "clock in" | "clock out"): Promise<number | null> {
  if (!(await getSetting("field.geofenceEnabled", t))) return null;
  const radius = p.geofenceRadiusM ?? Number(await getSetting("field.geofenceRadiusMeters", t));
  if (p.siteLat == null || p.siteLng == null) {
    throw new UserError(`The site location for ${p.number} hasn't been set yet, so you can't ${verb}. Ask the office to set it on the job's Info tab.`);
  }
  if (geo.lat == null || geo.lng == null || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) {
    throw new UserError(
      geo.error === "denied"
        ? `Location is blocked for this site. Allow location for your browser in your phone's settings, then try again. You need to be within ${radius} m of the site to ${verb}.`
        : `We couldn't get your location. Turn on Location on your phone and try again. You need to be within ${radius} m of the site to ${verb}.`,
    );
  }
  const dist = distanceMeters({ lat: geo.lat, lng: geo.lng }, { lat: p.siteLat, lng: p.siteLng });
  if (dist > radius) {
    const acc = geo.accuracy && geo.accuracy > 25 ? ` Your phone's GPS is only accurate to about ${Math.round(geo.accuracy)} m right now; stepping outside can help.` : "";
    throw new UserError(`You're ${fmtDistance(dist)} from the ${p.number} site. Move within ${radius} m of the site to ${verb}.${acc}`);
  }
  return dist;
}

export async function clockIn(actor: Actor, projectId: string, geo: GeoPoint = {}) {
  requirePerm(actor, "field.use");
  await assertFieldAccess(actor, projectId);
  return tx(async (t) => {
    const worker = await workerForUser(actor.id, t);
    assert(worker && worker.active, "Your account is not linked to a worker profile. Ask the office to link it.");
    const open = await t.clockEntry.findFirst({ where: { workerId: worker.id, clockOutAt: null }, include: { project: true } });
    if (open) throw new UserError(`You are still clocked in on ${open.project.number}. Clock out first.`);
    const p = await loadProject(t, projectId);
    const dist = await assertOnSite(t, p, geo, "clock in");
    const c = await t.clockEntry.create({ data: { workerId: worker.id, projectId, clockInAt: new Date(), inLat: geo.lat, inLng: geo.lng } });
    await audit(t, actor, { action: "clock.in", entityType: "ClockEntry", entityId: c.id, projectId, summary: `${worker.name} clocked in on ${p.number}${dist != null ? ` (${fmtDistance(dist)} from site)` : ""}` });
    return c;
  });
}

/** Clock out → creates the time entry. Regular/overtime split by daily threshold across all of the day's entries. */
export async function clockOut(actor: Actor, geo: GeoPoint = {}, notes?: string) {
  requirePerm(actor, "field.use");
  return tx(async (t) => {
    const worker = await workerForUser(actor.id, t);
    assert(worker, "Your account is not linked to a worker profile.");
    const open = await t.clockEntry.findFirst({ where: { workerId: worker.id, clockOutAt: null }, include: { project: true } });
    assert(open, "You are not clocked in.");
    const dist = await assertOnSite(t, open.project, geo, "clock out");
    return closeClock(t, actor, worker, open, geo, notes, dist != null ? ` (${fmtDistance(dist)} from site)` : "");
  });
}

/** Office clock-out for someone who left site without clocking out (no geofence; recorded in the audit trail). */
export async function officeClockOut(actor: Actor, clockEntryId: string, at?: Date) {
  requirePerm(actor, "time.manage");
  return tx(async (t) => {
    const open = await t.clockEntry.findUnique({ where: { id: clockEntryId }, include: { project: true, worker: true } });
    assert(open && !open.clockOutAt, "That person is no longer clocked in.");
    const when = at ?? new Date();
    assert(when > open.clockInAt && when <= new Date(), "Clock-out time must be after the clock-in time and not in the future.");
    return closeClock(t, actor, open.worker, open, {}, "Clocked out by office", ` by ${actor.name}`, when);
  });
}

type OpenClock = { id: string; projectId: string; clockInAt: Date; project: { number: string } };
type ClockWorker = { id: string; name: string; regularRate: Prisma.Decimal; overtimeRate: Prisma.Decimal };

async function closeClock(t: Tx, actor: Actor, worker: ClockWorker, open: OpenClock, geo: GeoPoint, notes: string | undefined, suffix: string, at?: Date) {
  {
    const now = at ?? new Date();
    const hours = Math.round(((now.getTime() - open.clockInAt.getTime()) / 3_600_000) * 4) / 4; // nearest 15 min
    await t.clockEntry.update({ where: { id: open.id }, data: { clockOutAt: now, outLat: geo.lat, outLng: geo.lng, notes } });
    const day = dayOf(now);
    const existing = await t.timeEntry.findMany({ where: { workerId: worker.id, date: day } });
    const already = Number(sum(existing.map((e) => d(e.regularHours).plus(d(e.overtimeHours)))));
    const threshold = Number(await getSetting("labour.overtimeAfterHours", t));
    const capped = Math.min(hours, 24 - already);
    const regular = Math.max(0, Math.min(capped, threshold - already));
    const overtime = Math.max(0, capped - regular);
    let entryId: string | null = null;
    if (capped > 0) {
      const { cost } = await costFor(t, worker.id, regular, overtime);
      const e = await t.timeEntry.create({
        data: { workerId: worker.id, projectId: open.projectId, date: day, regularHours: regular, overtimeHours: overtime, regularRate: worker.regularRate, overtimeRate: worker.overtimeRate, cost, source: "CLOCK", clockEntryId: open.id, description: notes, submittedById: actor.id },
      });
      entryId = e.id;
    }
    await audit(t, actor, { action: "clock.out", entityType: "ClockEntry", entityId: open.id, projectId: open.projectId, summary: `${worker.name} clocked out of ${open.project.number}${suffix}: ${regular} reg + ${overtime} OT` });
    return { hours: capped, regular, overtime, timeEntryId: entryId };
  }
}

export const fieldUpdateSchema = z.object({ kind: z.enum(["UPDATE", "ISSUE"]), message: zText(4000).pipe(z.string().min(2, "Write a message")) });

/** Progress update or issue from site, with optional photos. Notifies the PM. */
export async function postFieldUpdate(actor: Actor, projectId: string, input: z.infer<typeof fieldUpdateSchema>, photos: UploadFile[] = []) {
  requireAny(actor, ["field.use", "dailyreport.submit"]);
  await assertFieldAccess(actor, projectId);
  for (const ph of photos) assert(/^image\//.test(ph.type) || /\.(jpe?g|png|heic|webp)$/i.test(ph.name), "Photos must be images.");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const u = await t.fieldUpdate.create({ data: { projectId, authorId: actor.id, kind: input.kind, message: input.message } });
    for (const ph of photos) {
      await uploadDocument(actor, { projectId, module: "FIELD", category: "Progress photo", title: `${p.number} ${input.kind === "ISSUE" ? "issue" : "progress"} photo`, entityType: "FieldUpdate", entityId: u.id }, ph, t);
    }
    await audit(t, actor, { action: input.kind === "ISSUE" ? "field.issue" : "field.update", entityType: "FieldUpdate", entityId: u.id, projectId, summary: `${p.number}: ${input.kind === "ISSUE" ? "issue reported" : "site update"} by ${actor.name}${photos.length ? ` (${photos.length} photo(s))` : ""}` });
    await notifyUsers(t, [p.projectManagerId], { type: input.kind === "ISSUE" ? "field.issue" : "field.update", title: `${input.kind === "ISSUE" ? "Site issue" : "Site update"}: ${p.number}`, body: `${actor.name}: ${input.message.slice(0, 200)}`, link: `/jobs/${projectId}/site`, projectId }, actor.id);
    return u;
  });
}

export async function resolveFieldIssue(actor: Actor, id: string) {
  requirePerm(actor, "project.manage");
  return tx(async (t) => {
    const u = await t.fieldUpdate.findUnique({ where: { id } });
    if (!u) throw new NotFoundError("Issue");
    await t.fieldUpdate.update({ where: { id }, data: { resolvedAt: new Date(), resolvedById: actor.id } });
    await audit(t, actor, { action: "field.resolve", entityType: "FieldUpdate", entityId: id, projectId: u.projectId, summary: `Site issue resolved` });
  });
}

export const signoffSchema = z.object({
  workSummary: zText(4000).pipe(z.string().min(3, "Describe the work completed")),
  markedComplete: z.boolean().default(false),
  customerName: zOptText(200),
  signatureDataUrl: zOptText(2_000_000),
});

/** Complete work order (optional) + customer signature (optional). */
export async function completeWorkOrder(actor: Actor, projectId: string, input: z.infer<typeof signoffSchema>) {
  requireAny(actor, ["field.use", "project.manage"]);
  await assertFieldAccess(actor, projectId);
  let sigFile: UploadFile | null = null;
  if (input.signatureDataUrl) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(input.signatureDataUrl);
    assert(m, "Signature could not be read.");
    const buf = Buffer.from(m[1], "base64");
    assert(buf.length > 200 && buf.length < 1_500_000, "Signature is empty or too large.");
    sigFile = { name: `signature-${Date.now()}.png`, type: "image/png", data: buf };
    assert(input.customerName, "Enter the customer's name with the signature.");
  }
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const s = await t.workOrderSignoff.create({ data: { projectId, completedById: actor.id, workSummary: input.workSummary, markedComplete: input.markedComplete, customerName: input.customerName, signedAt: sigFile ? new Date() : null } });
    if (sigFile) {
      const up = await uploadDocument(actor, { projectId, module: "FIELD", category: "Customer signature", title: `${p.number} customer sign-off — ${input.customerName}`, entityType: "WorkOrderSignoff", entityId: s.id, approvalStatus: "APPROVED" }, sigFile, t);
      await t.workOrderSignoff.update({ where: { id: s.id }, data: { signatureDocId: up.documentId } });
    }
    await audit(t, actor, { action: "workorder.signoff", entityType: "WorkOrderSignoff", entityId: s.id, projectId, summary: `${p.number}: work order ${input.markedComplete ? "completed" : "visit recorded"}${sigFile ? `, signed by ${input.customerName}` : ""}` });
    await notifyUsers(t, [p.projectManagerId], { type: "workorder.signoff", title: `${p.number}: work ${input.markedComplete ? "completed" : "visit report"}`, body: input.workSummary.slice(0, 200), link: `/jobs/${projectId}/site`, projectId }, actor.id);
    return s;
  });
}

// ─────────────── Daily reports ───────────────

export const dailyReportSchema = z.object({
  date: zDate,
  weather: zOptText(200),
  manpower: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(1000)),
  workPerformed: zText(10000).pipe(z.string().min(3, "Describe the work performed")),
  delays: zOptText(),
  safetyNotes: zOptText(),
  visitors: zOptText(1000),
});

export async function saveDailyReport(actor: Actor, projectId: string, input: z.infer<typeof dailyReportSchema>) {
  requirePerm(actor, "dailyreport.submit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const existing = await t.dailyReport.findUnique({ where: { projectId_date: { projectId, date: input.date } } });
    const r = await t.dailyReport.upsert({
      where: { projectId_date: { projectId, date: input.date } },
      create: { ...input, projectId, createdById: actor.id },
      update: input,
    });
    await audit(t, actor, { action: existing ? "dailyreport.update" : "dailyreport.create", entityType: "DailyReport", entityId: r.id, projectId, summary: `${p.number}: daily report ${input.date.toISOString().slice(0, 10)} ${existing ? "updated" : "submitted"}`, before: existing, after: input });
    if (input.delays && p.projectManagerId) await notifyUsers(t, [p.projectManagerId], { type: "dailyreport.delay", title: `Delay reported on ${p.number}`, body: input.delays.slice(0, 200), link: `/jobs/${projectId}/site`, projectId }, actor.id);
    return r;
  });
}

// ─────────────── Read models ───────────────

/** Estimated vs actual labour hours for a job (estimate + approved change orders vs time entries). */
export async function labourSummary(projectId: string) {
  const [contract, entries, cos] = await Promise.all([
    prisma.contract.findUnique({ where: { projectId } }),
    prisma.timeEntry.findMany({ where: { projectId } }),
    prisma.changeOrder.findMany({ where: { projectId, status: "APPROVED" } }),
  ]);
  let estHours = d(0);
  let estCost = d(0);
  const estimateId = contract?.awardedEstimateId;
  if (estimateId) {
    const est = await prisma.estimate.findUnique({ where: { id: estimateId } });
    if (est) { estHours = d(est.labourHours); estCost = d(est.labourTotal); }
  }
  estHours = estHours.plus(sum(cos.map((c) => c.labourHours)));
  estCost = estCost.plus(sum(cos.map((c) => c.labourCost)));
  const regular = sum(entries.map((e) => e.regularHours));
  const overtime = sum(entries.map((e) => e.overtimeHours));
  const cost = sum(entries.map((e) => e.cost));
  return { estHours, estCost, regular, overtime, actualHours: regular.plus(overtime), actualCost: cost, variance: estHours.minus(regular.plus(overtime)) };
}
