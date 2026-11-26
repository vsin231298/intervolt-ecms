import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, tx, type Tx } from "@/lib/db";
import { requirePerm, requireAny, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { can } from "@/lib/rbac";
import { ForbiddenError, NotFoundError, UserError, assert } from "@/lib/errors";
import { d, pct, round2, sum } from "@/lib/money";
import { addDays, dayOf, today, TZ, parseDateTimeLocal } from "@/lib/dates";
import { zDate, zId, zNonNeg, zOptId, zOptText, zText } from "@/lib/forms";
import { notifyUsers } from "@/lib/notify";
import { getSetting } from "@/lib/settings";
import { createCloseoutItems, createFolders, loadProject } from "./projects";
import { nextWorkOrderNumber } from "@/lib/numbering";
import { notifyRoles } from "@/lib/notify";
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

/** Phone location at clock in/out, plus the office questions asked on the same form. */
export type GeoPoint = { lat?: number; lng?: number; accuracy?: number; error?: string; officeFrom?: string; toOffice?: boolean };

/**
 * Geofence: when enabled, clock in/out only works within the job's radius of its site pin.
 * Returns the distance (m) when checked, or null when the geofence is off.
 */
export async function assertOnSite(t: Tx, p: { number: string; siteLat: number | null; siteLng: number | null; geofenceRadiusM: number | null }, geo: GeoPoint, verb: "clock in" | "clock out"): Promise<number | null> {
  if (!(await getSetting("field.geofenceEnabled", t))) return null;
  const radius = p.geofenceRadiusM ?? Number(await getSetting("field.geofenceRadiusMeters", t));
  if (p.siteLat == null || p.siteLng == null) {
    throw new UserError("Site not set. Call office.");
  }
  if (geo.lat == null || geo.lng == null || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) {
    throw new UserError(
      geo.error === "denied" ? "Location blocked. Allow it in phone settings." : "Turn on location.",
    );
  }
  const dist = distanceMeters({ lat: geo.lat, lng: geo.lng }, { lat: p.siteLat, lng: p.siteLng });
  if (dist > radius) {
    const acc = geo.accuracy && geo.accuracy > 25 ? ` Weak GPS (±${Math.round(geo.accuracy)} m). Step outside.` : "";
    throw new UserError(`You're ${fmtDistance(dist)} away. Get within ${radius} m.${acc}`);
  }
  return dist;
}

const hm = (x: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(x);
const dur = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
/** Company-time-zone midnight at the start of the day `at` falls on. */
const startOfDay = (at: Date) => parseDateTimeLocal(`${dayOf(at).toISOString().slice(0, 10)}T00:00`)!;

async function paidExtra(t: Tx, actor: Actor, worker: ClockWorker, projectId: string, at: Date, minutes: number, source: string, description: string) {
  const hours = Math.round((minutes / 60) * 100) / 100;
  const { cost } = await costFor(t, worker.id, hours, 0);
  return t.timeEntry.create({
    data: { workerId: worker.id, projectId, date: dayOf(at), regularHours: hours, overtimeHours: 0, regularRate: worker.regularRate, overtimeRate: worker.overtimeRate, cost, source, description, submittedById: actor.id },
  });
}

/**
 * Paid time before this clock-in, as regular hours on the job they arrived at (office can edit/delete in Timesheets):
 * - first clock-in of the day and they say they went to the office first → office start time to now ("typed by worker")
 * - otherwise, the gap since their last clock-out (or "Done at office") today → travel
 */
async function addTravel(t: Tx, actor: Actor, worker: ClockWorker, toProjectId: string, toNumber: string, at: Date, officeFrom?: string) {
  const day0 = startOfDay(at);
  const earlierToday = await t.clockEntry.count({ where: { workerId: worker.id, clockInAt: { gte: day0, lt: at } } });
  if (officeFrom && earlierToday === 0) {
    assert(/^\d{1,2}:\d{2}$/.test(officeFrom), "Enter office start time.");
    const from = parseDateTimeLocal(`${dayOf(at).toISOString().slice(0, 10)}T${officeFrom.padStart(5, "0")}`)!;
    assert(from < at, "Office start must be before now.");
    const minutes = Math.round((at.getTime() - from.getTime()) / 60_000);
    const e = await paidExtra(t, actor, worker, toProjectId, at, minutes, "OFFICE", `Office + drive ${dur(minutes)} (${hm(from)} to ${hm(at)}), typed by worker`);
    await audit(t, actor, { action: "time.office", entityType: "TimeEntry", entityId: e.id, projectId: toProjectId, summary: `${worker.name} office first from ${hm(from)}, ${minutes} min before ${toNumber}` });
    return e;
  }
  if (!(await getSetting("labour.payTravelBetweenJobs", t))) return null;
  const last = await t.clockEntry.findFirst({ where: { workerId: worker.id, clockOutAt: { not: null, gte: day0, lte: at } }, orderBy: { clockOutAt: "desc" }, include: { project: true } });
  if (!last || !last.clockOutAt || last.projectId === toProjectId) return null;
  const left = last.officeDoneAt ?? last.clockOutAt;
  const minutes = Math.round((at.getTime() - left.getTime()) / 60_000);
  if (minutes < 1) return null;
  const e = await paidExtra(t, actor, worker, toProjectId, at, minutes, "TRAVEL", `Travel ${dur(minutes)} from ${last.officeDoneAt ? "office" : last.project.number} (${hm(left)} to ${hm(at)})`);
  await audit(t, actor, { action: "time.travel", entityType: "TimeEntry", entityId: e.id, projectId: toProjectId, summary: `${worker.name} travel ${minutes} min ${last.project.number} → ${toNumber}` });
  return e;
}

/** No clock-in yet today: the clock-in form asks "Office first?". */
export async function firstClockInToday(workerId: string) {
  return (await prisma.clockEntry.count({ where: { workerId, clockInAt: { gte: startOfDay(new Date()) } } })) === 0;
}

/** After clocking out with "Going to office", the drop-off they haven't finished yet (today, nothing clocked since). */
export async function pendingOfficeDropOff(workerId: string) {
  const now = new Date();
  const last = await prisma.clockEntry.findFirst({ where: { workerId, clockInAt: { gte: startOfDay(now) } }, orderBy: { clockInAt: "desc" }, include: { project: true } });
  return last && last.clockOutAt && last.toOffice && !last.officeDoneAt ? last : null;
}

/** "Done at office": drive back + drop-off time, from site clock-out until now, on that job. */
export async function doneAtOffice(actor: Actor, geo: GeoPoint = {}) {
  requirePerm(actor, "field.use");
  return tx(async (t) => {
    const worker = await workerForUser(actor.id, t);
    assert(worker, "Your account is not linked to a worker profile.");
    const now = new Date();
    const last = await t.clockEntry.findFirst({ where: { workerId: worker.id, clockInAt: { gte: startOfDay(now) } }, orderBy: { clockInAt: "desc" }, include: { project: true } });
    assert(last && last.clockOutAt && last.toOffice && !last.officeDoneAt, "Nothing to finish.");
    const minutes = Math.max(0, Math.round((now.getTime() - last.clockOutAt.getTime()) / 60_000));
    await t.clockEntry.update({ where: { id: last.id }, data: { officeDoneAt: now, officeLat: geo.lat, officeLng: geo.lng } });
    const e = minutes > 0 ? await paidExtra(t, actor, worker, last.projectId, now, minutes, "OFFICE", `Drive to office + drop-off ${dur(minutes)} (${hm(last.clockOutAt)} to ${hm(now)})`) : null;
    await audit(t, actor, { action: "time.office", entityType: "ClockEntry", entityId: last.id, projectId: last.projectId, summary: `${worker.name} done at office, ${minutes} min after leaving ${last.project.number}` });
    return { minutes, timeEntryId: e?.id ?? null };
  });
}

export async function clockIn(actor: Actor, projectId: string, geo: GeoPoint = {}) {
  requirePerm(actor, "field.use");
  await assertFieldAccess(actor, projectId);
  return tx(async (t) => {
    const worker = await workerForUser(actor.id, t);
    assert(worker && worker.active, "Your account is not linked to a worker profile. Ask the office to link it.");
    const open = await t.clockEntry.findFirst({ where: { workerId: worker.id, clockOutAt: null }, include: { project: true } });
    if (open) throw new UserError(`Clock out of ${open.project.number} first.`);
    const p = await loadProject(t, projectId);
    const dist = await assertOnSite(t, p, geo, "clock in");
    const c = await t.clockEntry.create({ data: { workerId: worker.id, projectId, clockInAt: new Date(), inLat: geo.lat, inLng: geo.lng } });
    await addTravel(t, actor, worker, projectId, p.number, c.clockInAt, geo.officeFrom);
    // Service work order with nobody leading right now: first one in leads.
    if (p.jobType === "SERVICE" && !(await leadIsOnCall(t, p.id, p.serviceLeadUserId, actor.id))) await t.project.update({ where: { id: p.id }, data: { serviceLeadUserId: actor.id } });
    await audit(t, actor, { action: "clock.in", entityType: "ClockEntry", entityId: c.id, projectId, summary: `${worker.name} clocked in on ${p.number}${dist != null ? ` (${fmtDistance(dist)} from site)` : ""}` });
    return c;
  });
}

export const serviceCallSchema = z.object({
  customer: zText(200).pipe(z.string().min(2, "Enter the client's name")),
  address: zOptText(300),
  phone: zOptText(50),
  problem: zOptText(2000),
  helperWorkerId: zOptId,
});

/**
 * Unplanned service call started from the field app: creates a service work order, pins the site
 * where the worker is standing, adds them to the job and clocks them in. Office is notified to complete it.
 */
export async function startServiceCall(actor: Actor, input: z.infer<typeof serviceCallSchema>, geo: GeoPoint) {
  requirePerm(actor, "field.use");
  assert(await getSetting("field.allowServiceCalls"), "Service calls are off. Call office.");
  if (geo.lat == null || geo.lng == null || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) {
    throw new UserError(geo.error === "denied" ? "Location blocked. Allow it in phone settings." : "Turn on location.");
  }
  return tx(async (t) => {
    const worker = await workerForUser(actor.id, t);
    assert(worker && worker.active, "Your account is not linked to a worker profile. Ask the office to link it.");
    const open = await t.clockEntry.findFirst({ where: { workerId: worker.id, clockOutAt: null }, include: { project: true } });
    if (open) throw new UserError(`Clock out of ${open.project.number} first.`);
    const base = Number(await getSetting("field.geofenceRadiusMeters", t));
    // Weak GPS at the start would make the pin unreliable; widen this job's range to cover it (max 500 m).
    const radius = geo.accuracy && geo.accuracy > base / 2 ? Math.min(500, Math.ceil(base + geo.accuracy)) : null;
    const number = await nextWorkOrderNumber(t);
    const p = await t.project.create({
      data: {
        number, jobType: "SERVICE", stage: "EXECUTION", awardedAt: new Date(), holdbackPercent: 0,
        name: `Service call: ${input.customer}`.slice(0, 200), location: input.address ?? null, siteContactName: input.customer, siteContactPhone: input.phone,
        scope: input.problem, description: `Started on site by ${worker.name}.`,
        siteLat: geo.lat, siteLng: geo.lng, geofenceRadiusM: radius, serviceLeadUserId: actor.id,
      },
    });
    await t.stageHistory.create({ data: { projectId: p.id, toStage: "EXECUTION", byId: actor.id, note: "Service call started from the field app" } });
    await t.projectMember.create({ data: { projectId: p.id, userId: actor.id, roleLabel: "Service technician" } });
    // "Who's with you?": expected helper is added to the call (no hours until they join on site) and notified.
    if (input.helperWorkerId) {
      const h = await t.worker.findUnique({ where: { id: input.helperWorkerId } });
      assert(h && h.active && h.id !== worker.id, "Pick a co-worker from the list.");
      if (h.userId) {
        await t.projectMember.upsert({ where: { projectId_userId: { projectId: p.id, userId: h.userId } }, create: { projectId: p.id, userId: h.userId, roleLabel: "Co-worker" }, update: {} });
        await notifyUsers(t, [h.userId], { type: "servicecall.join", title: `${worker.name} started ${input.customer} and added you. Join when there.`, body: input.address ?? undefined, link: "/field", projectId: p.id }, actor.id);
      }
      await audit(t, actor, { action: "servicecall.helper", entityType: "Project", entityId: p.id, projectId: p.id, summary: `${number}: ${worker.name} added ${h.name} as co-worker${h.userId ? "" : " (no field login, not notified)"}` });
    }
    await createFolders(t, p.id, ["Work Order", "Photos", "Procurement", "Billing", "Inspections"]);
    await createCloseoutItems(t, p.id, "SERVICE");
    const c = await t.clockEntry.create({ data: { workerId: worker.id, projectId: p.id, clockInAt: new Date(), inLat: geo.lat, inLng: geo.lng } });
    await addTravel(t, actor, worker, p.id, number, c.clockInAt, geo.officeFrom);
    await audit(t, actor, { action: "job.create", entityType: "Project", entityId: p.id, projectId: p.id, summary: `${number} service call started on site by ${worker.name}: ${input.customer}${input.address ? `, ${input.address}` : ""}`, after: { ...input, siteLat: geo.lat, siteLng: geo.lng, accuracy: geo.accuracy } });
    await audit(t, actor, { action: "clock.in", entityType: "ClockEntry", entityId: c.id, projectId: p.id, summary: `${worker.name} clocked in on ${number} (service call start)` });
    await notifyRoles(t, ["ADMIN", "PROJECT_MANAGER"], { type: "job.assigned", title: `${worker.name} started service call ${number}: ${input.customer}`, body: `${input.address ?? "Address not given"}${input.problem ? ` · ${input.problem.slice(0, 140)}` : ""}. Add the client, PM and pricing.`, link: `/jobs/${p.id}`, projectId: p.id }, actor.id);
    return p;
  });
}

/** Clock out → creates the time entry. Regular/overtime split by daily threshold across all of the day's entries. */
export async function clockOut(actor: Actor, geo: GeoPoint = {}, notes?: string, handLeadToUserId?: string) {
  requirePerm(actor, "field.use");
  return tx(async (t) => {
    const worker = await workerForUser(actor.id, t);
    assert(worker, "Your account is not linked to a worker profile.");
    const open = await t.clockEntry.findFirst({ where: { workerId: worker.id, clockOutAt: null }, include: { project: true } });
    assert(open, "You are not clocked in.");
    const dist = await assertOnSite(t, open.project, geo, "clock out");
    if (handLeadToUserId) {
      assert(open.project.serviceLeadUserId === actor.id, "Only the lead can hand over the lead.");
      const other = await t.clockEntry.findFirst({ where: { projectId: open.projectId, clockOutAt: null, worker: { userId: handLeadToUserId } }, include: { worker: true } });
      assert(other, "They're not on this call any more. Fill work order instead.");
      await t.project.update({ where: { id: open.projectId }, data: { serviceLeadUserId: handLeadToUserId } });
      await notifyUsers(t, [handLeadToUserId], { type: "servicecall.lead", title: `${worker.name} left. You're lead on ${open.project.siteContactName ?? open.project.number}. Fill work order before you clock out.`, link: `/field/${open.projectId}`, projectId: open.projectId }, actor.id);
      await audit(t, actor, { action: "servicecall.lead", entityType: "Project", entityId: open.projectId, projectId: open.projectId, summary: `${open.project.number}: ${worker.name} handed lead to ${other.worker.name}` });
    } else if (await needsWorkOrder(t, actor.id, open)) {
      throw new UserError("Fill work order first.");
    }
    return closeClock(t, actor, worker, open, geo, notes, dist != null ? ` (${fmtDistance(dist)} from site)` : "");
  });
}

/** Service calls: the work order form must be filled in during this shift before clocking out (setting). */
export async function needsWorkOrder(t: Tx | typeof prisma, userId: string, open: { projectId: string; clockInAt: Date; project: { jobType: string } }) {
  if (open.project.jobType !== "SERVICE") return false;
  if (!(await getSetting("field.requireWorkOrderBeforeClockOut", t))) return false;
  const p = await t.project.findUnique({ where: { id: open.projectId }, select: { serviceLeadUserId: true } });
  if (p?.serviceLeadUserId && p.serviceLeadUserId !== userId) return false; // co-workers never owe it
  const done = await t.workOrderSignoff.count({ where: { projectId: open.projectId, createdAt: { gte: open.clockInAt } } });
  return done === 0;
}

/** Is the call's lead currently clocked in on it (ignoring `except`)? */
async function leadIsOnCall(t: Tx | typeof prisma, projectId: string, leadUserId: string | null, except?: string) {
  if (!leadUserId || leadUserId === except) return false;
  return (await t.clockEntry.count({ where: { projectId, clockOutAt: null, worker: { userId: leadUserId } } })) > 0;
}

/** Lead of a service call takes over: must be clocked in on it. */
export async function takeOverLead(actor: Actor, projectId: string) {
  requirePerm(actor, "field.use");
  return tx(async (t) => {
    const worker = await workerForUser(actor.id, t);
    assert(worker, "Your account is not linked to a worker profile.");
    const mine = await t.clockEntry.findFirst({ where: { workerId: worker.id, clockOutAt: null, projectId }, include: { project: true } });
    assert(mine && mine.project.jobType === "SERVICE", "Join the call first.");
    if (mine.project.serviceLeadUserId === actor.id) return;
    const prev = mine.project.serviceLeadUserId;
    await t.project.update({ where: { id: projectId }, data: { serviceLeadUserId: actor.id } });
    if (prev) await notifyUsers(t, [prev], { type: "servicecall.lead", title: `${worker.name} took over as lead on ${mine.project.siteContactName ?? mine.project.number}. No work order needed from you.`, link: `/field/${projectId}`, projectId }, actor.id);
    await audit(t, actor, { action: "servicecall.lead", entityType: "Project", entityId: projectId, projectId, summary: `${mine.project.number}: ${worker.name} took over as lead` });
  });
}

/** Service calls someone is clocked in on right now, that a helper can join. */
export async function joinableServiceCalls(actor: Actor) {
  const named = new Set((await prisma.projectMember.findMany({ where: { userId: actor.id, roleLabel: { in: ["Co-worker", "Helper"] }, project: { jobType: "SERVICE", stage: "EXECUTION" } }, select: { projectId: true } })).map((m) => m.projectId));
  const open = await prisma.clockEntry.findMany({
    where: { clockOutAt: null, worker: { userId: { not: actor.id } }, project: { jobType: "SERVICE", stage: "EXECUTION" } },
    include: { worker: { select: { name: true } }, project: { select: { id: true, number: true, name: true, location: true, siteContactName: true, siteLat: true, siteLng: true } } },
    orderBy: { clockInAt: "desc" },
  });
  const map = new Map<string, { project: (typeof open)[number]["project"]; crew: string[]; since: Date; namedMe: boolean }>();
  for (const c of open) {
    const e = map.get(c.projectId);
    if (e) e.crew.push(c.worker.name);
    else map.set(c.projectId, { project: c.project, crew: [c.worker.name], since: c.clockInAt, namedMe: named.has(c.projectId) });
  }
  return [...map.values()].sort((a, b) => Number(b.namedMe) - Number(a.namedMe));
}

/** Helper joins a service call someone else is on: added to the job as Helper and clocked in (site range applies). */
export async function joinServiceCall(actor: Actor, projectId: string, geo: GeoPoint) {
  requirePerm(actor, "field.use");
  return tx(async (t) => {
    const worker = await workerForUser(actor.id, t);
    assert(worker && worker.active, "Your account is not linked to a worker profile. Ask the office to link it.");
    const mine = await t.clockEntry.findFirst({ where: { workerId: worker.id, clockOutAt: null }, include: { project: true } });
    if (mine) throw new UserError(`Clock out of ${mine.project.number} first.`);
    const p = await loadProject(t, projectId);
    assert(p.jobType === "SERVICE" && p.stage === "EXECUTION", "That call has ended.");
    const lead = await t.clockEntry.findFirst({ where: { projectId, clockOutAt: null }, include: { worker: true } });
    assert(lead, "That call has ended.");
    const dist = await assertOnSite(t, p, geo, "clock in");
    await t.projectMember.upsert({ where: { projectId_userId: { projectId, userId: actor.id } }, create: { projectId, userId: actor.id, roleLabel: "Co-worker" }, update: {} });
    // Nobody leading right now (e.g. lead left without handing over): the one joining leads.
    const leads = await leadIsOnCall(t, projectId, p.serviceLeadUserId, actor.id);
    if (!leads) await t.project.update({ where: { id: projectId }, data: { serviceLeadUserId: actor.id } });
    const c = await t.clockEntry.create({ data: { workerId: worker.id, projectId, clockInAt: new Date(), inLat: geo.lat, inLng: geo.lng } });
    await addTravel(t, actor, worker, projectId, p.number, c.clockInAt, geo.officeFrom);
    await audit(t, actor, { action: "clock.in", entityType: "ClockEntry", entityId: c.id, projectId, summary: `${worker.name} joined ${p.number} with ${lead.worker.name}${leads ? "" : " (now lead)"}${dist != null ? ` (${fmtDistance(dist)} from site)` : ""}` });
    return p;
  });
}

export type CrewFlag = { kind: "NO_HOURS" | "STAYED_LATE"; projectId: string; number: string; name: string; text: string };

/**
 * Service-call crew checks for the office (Timesheets), for calls active in the date range:
 * - a helper was named / joined but never clocked in, after everyone else has clocked out
 * - a helper stayed clocked in more than N minutes after the last technician clocked out
 */
export async function crewFlags(from: Date, to: Date): Promise<CrewFlag[]> {
  const lateMin = Number(await getSetting("field.helperLateFlagMinutes"));
  const end = addDays(to, 1);
  const projects = await prisma.project.findMany({
    where: { jobType: "SERVICE", clockEntries: { some: { clockInAt: { gte: from, lt: end } } } },
    select: {
      id: true, number: true, name: true, serviceLeadUserId: true,
      members: { select: { roleLabel: true, userId: true, user: { select: { name: true, worker: { select: { id: true } } } } } },
      clockEntries: { select: { workerId: true, clockInAt: true, clockOutAt: true, worker: { select: { name: true, userId: true } } } },
    },
  });
  const flags: CrewFlag[] = [];
  for (const p of projects) {
    const anyOpen = p.clockEntries.some((c) => !c.clockOutAt);
    const lead = p.clockEntries.filter((c) => c.worker.userId === p.serviceLeadUserId);
    const leadName = lead[0]?.worker.name ?? "the lead";
    // co-worker added at start (or joined) but never clocked in, once the call is over
    if (!anyOpen) {
      for (const m of p.members) {
        const wid = m.user.worker?.id;
        if (!["Co-worker", "Helper"].includes(m.roleLabel) || !wid) continue;
        if (!p.clockEntries.some((c) => c.workerId === wid)) {
          flags.push({ kind: "NO_HOURS", projectId: p.id, number: p.number, name: p.name, text: `${m.user.name} was added as co-worker with ${leadName} on ${p.number} ${p.name} but never clocked in. Add their hours if they worked.` });
        }
      }
    }
    // a co-worker stayed clocked in long after the lead left
    if (!lead.length || lead.some((c) => !c.clockOutAt)) continue;
    const leadOut = new Date(Math.max(...lead.map((c) => c.clockOutAt!.getTime())));
    for (const c of p.clockEntries) {
      if (c.worker.userId === p.serviceLeadUserId) continue;
      const out = c.clockOutAt ?? new Date();
      const mins = Math.round((out.getTime() - leadOut.getTime()) / 60000);
      if (mins > lateMin) {
        const dur = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
        flags.push({ kind: "STAYED_LATE", projectId: p.id, number: p.number, name: p.name, text: `${c.worker.name} ${c.clockOutAt ? "stayed" : "has been clocked in"} ${dur} after ${leadName} (lead) left ${p.number} ${p.name}.` });
      }
    }
  }
  return flags;
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
    await t.clockEntry.update({ where: { id: open.id }, data: { clockOutAt: now, outLat: geo.lat, outLng: geo.lng, notes, toOffice: !!geo.toOffice } });
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

export const JOB_STATUSES = { COMPLETE: "Complete", RETURN_VISIT: "Needs return visit", WAITING_PARTS: "Waiting for parts", NEEDS_QUOTE: "Needs a quote" } as const;

const money = (v: unknown) => (v === "" || v == null ? undefined : Number(String(v).replace(/[$,\s]/g, "")));
export const signoffSchema = z.object({
  workSummary: zText(4000).pipe(z.string().min(3, "Describe the work completed")),
  markedComplete: z.boolean().default(false),
  jobStatus: z.enum(["COMPLETE", "RETURN_VISIT", "WAITING_PARTS", "NEEDS_QUOTE"]).optional(),
  coWorkerIds: z.array(zId).max(20).optional(),
  materialsUsed: z.array(z.object({ item: zText(300), quantity: zText(50) })).max(100).optional(),
  parkingAmount: z.preprocess(money, z.number({ invalid_type_error: "Parking amount must be a number" }).min(0).max(10000).optional()),
  customerName: zOptText(200),
  signatureDataUrl: zOptText(2_000_000),
});

/** Complete work order (optional) + customer signature (optional). */
export async function completeWorkOrder(actor: Actor, projectId: string, input: z.infer<typeof signoffSchema>, parkingReceipt?: UploadFile | null) {
  if (input.jobStatus) input = { ...input, markedComplete: input.jobStatus === "COMPLETE" };
  if (parkingReceipt) assert(/^image\//.test(parkingReceipt.type) || /\.(jpe?g|png|heic|webp|pdf)$/i.test(parkingReceipt.name), "The parking receipt must be a photo or PDF.");
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
    const s = await t.workOrderSignoff.create({ data: { projectId, completedById: actor.id, workSummary: input.workSummary, markedComplete: input.markedComplete, jobStatus: input.jobStatus ?? (input.markedComplete ? "COMPLETE" : null), coWorkerIds: input.coWorkerIds ?? [], materialsUsed: input.materialsUsed?.length ? input.materialsUsed : undefined, parkingAmount: input.parkingAmount, customerName: input.customerName, signedAt: sigFile ? new Date() : null } });
    if (parkingReceipt) {
      const up = await uploadDocument(actor, { projectId, module: "FIELD", category: "Parking receipt", title: `${p.number} parking receipt${input.parkingAmount != null ? ` $${input.parkingAmount.toFixed(2)}` : ""}`, entityType: "WorkOrderSignoff", entityId: s.id, approvalStatus: "APPROVED" }, parkingReceipt, t);
      await t.workOrderSignoff.update({ where: { id: s.id }, data: { parkingReceiptDocId: up.documentId } });
    }
    if (sigFile) {
      const up = await uploadDocument(actor, { projectId, module: "FIELD", category: "Customer signature", title: `${p.number} customer sign-off — ${input.customerName}`, entityType: "WorkOrderSignoff", entityId: s.id, approvalStatus: "APPROVED" }, sigFile, t);
      await t.workOrderSignoff.update({ where: { id: s.id }, data: { signatureDocId: up.documentId } });
    }
    await audit(t, actor, { action: "workorder.signoff", entityType: "WorkOrderSignoff", entityId: s.id, projectId, summary: `${p.number}: work order ${input.jobStatus ? JOB_STATUSES[input.jobStatus].toLowerCase() : input.markedComplete ? "completed" : "visit recorded"}${input.parkingAmount ? `, parking $${input.parkingAmount.toFixed(2)}` : ""}${sigFile ? `, signed by ${input.customerName}` : ""}` });
    const sn = { type: "workorder.signoff", title: `${p.number}: work ${input.markedComplete ? "completed" : "visit report"}`, body: input.workSummary.slice(0, 200), link: `/jobs/${projectId}/site`, projectId };
    if (!p.projectManagerId) await notifyRoles(t, ["ADMIN", "PROJECT_MANAGER"], sn, actor.id);
    else await notifyUsers(t, [p.projectManagerId], { type: "workorder.signoff", title: `${p.number}: work ${input.markedComplete ? "completed" : "visit report"}`, body: input.workSummary.slice(0, 200), link: `/jobs/${projectId}/site`, projectId }, actor.id);
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
