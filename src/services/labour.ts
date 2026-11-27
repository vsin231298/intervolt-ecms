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
import { nextCounter, nextWorkOrderNumber } from "@/lib/numbering";
import { notifyRoles } from "@/lib/notify";
import { distanceMeters, fmtDistance, parseLatLng } from "@/lib/geo";
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

const hhmm = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{1,2}:\d{2}$/, "Enter a time like 07:30").optional());
export const assignmentSchema = z.object({
  workerIds: z.array(z.string()).min(1, "Choose at least one worker"),
  fromDate: zDate,
  toDate: zDate,
  hours: zNonNeg.default(8),
  startTime: hhmm,
  endTime: hhmm,
  breakMin: z.coerce.number().int().min(0).max(480).default(0),
  includeWeekends: z.boolean().default(false),
  notes: zOptText(300),
  /// publish straight away (field staff see it and get an alert); otherwise it's a draft
  publish: z.boolean().default(false),
});

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
/** Paid hours for a shift with start/end times: end - start - break. */
export function shiftHours(start: string, end: string, breakMin = 0) {
  const mins = toMin(end) - toMin(start) - breakMin;
  if (toMin(end) <= toMin(start)) throw new UserError("End time must be after start time.");
  if (mins <= 0) throw new UserError("Break is longer than the shift.");
  return Math.round((mins / 60) * 100) / 100;
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const shortDay = (d: Date) => `${DOW[d.getUTCDay()]} ${d.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" })}`;

/** Assign workers to a job for a date range. Returns any double-booking warnings. */
export async function scheduleWorkers(actor: Actor, projectId: string, raw: z.input<typeof assignmentSchema>) {
  const input = assignmentSchema.parse(raw);
  requirePerm(actor, "labour.schedule");
  if (input.toDate < input.fromDate) throw new UserError("End date is before start date.");
  const days = Math.round((input.toDate.getTime() - input.fromDate.getTime()) / 86_400_000) + 1;
  if (days > 120) throw new UserError("Schedule at most 120 days at a time.");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    assert(["ACTIVATION", "EXECUTION", "CLOSEOUT"].includes(p.stage), "Workers can only be scheduled on active jobs.");
    const warnings: string[] = [];
    let created = 0;
    if ((input.startTime && !input.endTime) || (!input.startTime && input.endTime)) throw new UserError("Enter both start and end time, or neither.");
    const hours = input.startTime && input.endTime ? shiftHours(input.startTime, input.endTime, input.breakMin) : input.hours;
    const times = { startTime: input.startTime ?? null, endTime: input.endTime ?? null, breakMin: input.startTime ? input.breakMin : 0 };
    for (const workerId of input.workerIds) {
      const w = await t.worker.findUnique({ where: { id: workerId } });
      assert(w && w.active, "Choose active workers.");
      for (let i = 0; i < days; i++) {
        const date = addDays(input.fromDate, i);
        const dow = date.getUTCDay();
        if (!input.includeWeekends && (dow === 0 || dow === 6)) continue;
        const elsewhere = await t.labourAssignment.findFirst({ where: { workerId, date, projectId: { not: projectId } }, include: { project: true } });
        if (elsewhere) warnings.push(`${w.name} is also on ${elsewhere.project.number} on ${date.toISOString().slice(0, 10)}`);
        const off = await t.timeOff.findFirst({ where: { workerId, status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } } });
        if (off) warnings.push(`${w.name} has time off on ${date.toISOString().slice(0, 10)}`);
        await t.labourAssignment.upsert({
          where: { workerId_projectId_date: { workerId, projectId, date } },
          create: { workerId, projectId, date, hours, notes: input.notes, ...times, publishedAt: null },
          update: { hours, notes: input.notes, ...times, publishedAt: null },
        });
        created++;
      }
    }
    await audit(t, actor, { action: "schedule.assign", entityType: "Project", entityId: projectId, projectId, summary: `${p.number}: ${created} worker-day(s) scheduled ${input.fromDate.toISOString().slice(0, 10)} – ${input.toDate.toISOString().slice(0, 10)}` });
    const published = input.publish ? await publishInTx(t, actor, input.fromDate, input.toDate, input.workerIds) : 0;
    return { created, warnings, published };
  });
}

/**
 * Publish draft shifts in a date range (optionally only some workers). Each worker gets one alert:
 * "Your schedule for … is out" the first time, "Schedule changed: Tue, Thu" after that.
 */
export async function publishSchedule(actor: Actor, from: Date, to: Date, workerIds?: string[]) {
  requirePerm(actor, "labour.schedule");
  if (to < from) throw new UserError("End date is before start date.");
  return tx((t) => publishInTx(t, actor, from, to, workerIds));
}

async function publishInTx(t: Tx, actor: Actor, from: Date, to: Date, workerIds?: string[]) {
  const where = { date: { gte: from, lte: to }, publishedAt: null, ...(workerIds?.length ? { workerId: { in: workerIds } } : {}) };
  const drafts = await t.labourAssignment.findMany({ where, include: { worker: true }, orderBy: { date: "asc" } });
  if (!drafts.length) return 0;
  const now = new Date();
  await t.labourAssignment.updateMany({ where: { id: { in: drafts.map((a) => a.id) } }, data: { publishedAt: now } });
  const byWorker = new Map<string, typeof drafts>();
  for (const a of drafts) byWorker.set(a.workerId, [...(byWorker.get(a.workerId) ?? []), a]);
  const range = `${shortDay(from)} – ${shortDay(to)}`;
  for (const [workerId, list] of byWorker) {
    const w = list[0].worker;
    if (!w.userId) continue;
    const before = await t.labourAssignment.count({ where: { workerId, date: { gte: from, lte: to }, publishedAt: { lt: now } } });
    const days = [...new Set(list.map((a) => DOW[a.date.getUTCDay()]))].join(", ");
    await notifyUsers(t, [w.userId], before
      ? { type: "schedule.changed", title: `Schedule changed: ${days}`, body: range, link: "/field" }
      : { type: "schedule.assigned", title: `Your schedule for ${range} is out.`, body: "Tap to see your week.", link: "/field" }, actor.id);
  }
  await audit(t, actor, { action: "schedule.publish", entityType: "LabourAssignment", entityId: drafts.map((a) => a.id).join(",").slice(0, 200), summary: `Schedule published ${range}: ${drafts.length} shift(s), ${byWorker.size} employee(s)` });
  return drafts.length;
}

/** The next 7 days for a worker: published shifts and approved time off (field "My week"). */
export async function myWeek(workerId: string, from = today()) {
  const to = addDays(from, 6);
  const [shifts, off] = await Promise.all([
    prisma.labourAssignment.findMany({ where: { workerId, date: { gte: from, lte: to }, publishedAt: { not: null } }, include: { project: { select: { id: true, number: true, name: true, location: true } } }, orderBy: { date: "asc" } }),
    prisma.timeOff.findMany({ where: { workerId, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } } }),
  ]);
  const crew = shifts.length ? await prisma.labourAssignment.findMany({ where: { projectId: { in: shifts.map((s) => s.projectId) }, date: { gte: from, lte: to }, publishedAt: { not: null }, workerId: { not: workerId } }, include: { worker: { select: { name: true } } } }) : [];
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    const k = date.getTime();
    return {
      date,
      shifts: shifts.filter((s) => s.date.getTime() === k).map((s) => ({ ...s, with: crew.filter((c) => c.projectId === s.projectId && c.date.getTime() === k).map((c) => c.worker.name.split(" ")[0]) })),
      off: off.find((o) => o.startDate.getTime() <= k && o.endDate.getTime() >= k) ?? null,
    };
  });
}

export const editShiftSchema = z.object({
  id: zId,
  date: zDate.optional(),
  projectId: zOptId,
  startTime: hhmm,
  endTime: hhmm,
  breakMin: z.coerce.number().int().min(0).max(480).default(0),
  hours: zNonNeg.optional(),
  notes: zOptText(300),
});

const fmtShift = (a: { startTime: string | null; endTime: string | null; hours: unknown }) => (a.startTime ? `${a.startTime}-${a.endTime}` : `${d(a.hours as never)}h`);

/**
 * Edit a shift at any time. A published shift stays published and the worker gets a
 * "Schedule changed" alert; a draft stays a draft (no alert).
 */
export async function updateAssignment(actor: Actor, raw: z.input<typeof editShiftSchema>) {
  const input = editShiftSchema.parse(raw);
  requirePerm(actor, "labour.schedule");
  return tx(async (t) => {
    const a = await t.labourAssignment.findUnique({ where: { id: input.id }, include: { worker: true, project: true } });
    if (!a) throw new NotFoundError("Schedule entry");
    if ((input.startTime && !input.endTime) || (!input.startTime && input.endTime)) throw new UserError("Enter both start and end time, or neither.");
    const hours = input.startTime && input.endTime ? shiftHours(input.startTime, input.endTime, input.breakMin) : (input.hours ?? Number(a.hours));
    assert(hours > 0 && hours <= 24, "Hours must be between 0 and 24.");
    const date = input.date ?? a.date;
    const projectId = input.projectId ?? a.projectId;
    const project = projectId === a.projectId ? a.project : await loadProject(t, projectId);
    if (projectId !== a.projectId) assert(["ACTIVATION", "EXECUTION", "CLOSEOUT"].includes(project.stage), "Workers can only be scheduled on active jobs.");
    if (projectId !== a.projectId || date.getTime() !== a.date.getTime()) {
      const clash = await t.labourAssignment.findFirst({ where: { workerId: a.workerId, date, projectId, id: { not: a.id } } });
      if (clash) throw new UserError(`${a.worker.name} already has a shift on that job that day.`);
    }
    const data = {
      date, projectId, hours, notes: input.notes ?? null,
      startTime: input.startTime ?? null, endTime: input.endTime ?? null, breakMin: input.startTime ? input.breakMin : 0,
    };
    await t.labourAssignment.update({ where: { id: a.id }, data });
    const changes: string[] = [];
    if (date.getTime() !== a.date.getTime()) changes.push(`moved to ${shortDay(date)}`);
    if (projectId !== a.projectId) changes.push(`now at ${project.name}`);
    if (fmtShift(data) !== fmtShift(a)) changes.push(fmtShift(data));
    if ((data.notes ?? "") !== (a.notes ?? "")) changes.push(data.notes ? `note: ${data.notes}` : "note removed");
    if (a.publishedAt && a.worker.userId && changes.length) {
      const days = [...new Set([shortDay(a.date), shortDay(date)])].join(", ");
      await notifyUsers(t, [a.worker.userId], { type: "schedule.changed", title: `Schedule changed: ${days}`, body: changes.join(" · "), link: "/field" }, actor.id);
    }
    await audit(t, actor, { action: "schedule.update", entityType: "LabourAssignment", entityId: a.id, projectId, summary: `${a.worker.name} ${shortDay(a.date)}: ${changes.join(", ") || "no change"}`, before: a, after: data });
  });
}

export async function removeAssignment(actor: Actor, id: string) {
  requirePerm(actor, "labour.schedule");
  return tx(async (t) => {
    const a = await t.labourAssignment.findUnique({ where: { id }, include: { worker: true } });
    if (!a) throw new NotFoundError("Schedule entry");
    await t.labourAssignment.delete({ where: { id } });
    if (a.publishedAt && a.worker.userId) {
      const p = await t.project.findUnique({ where: { id: a.projectId }, select: { number: true, name: true } });
      await notifyUsers(t, [a.worker.userId], { type: "schedule.changed", title: `Schedule changed: ${shortDay(a.date)}`, body: `Removed from ${p?.name ?? "a job"}`, link: "/field" }, actor.id);
    }
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
      ? prisma.labourAssignment.findMany({ where: { workerId: worker.id, date, publishedAt: { not: null } }, include: { project: { include: { client: true } } } })
      : Promise.resolve([]),
    prisma.projectMember.findMany({ where: { userId: actor.id, project: { stage: { in: ["ACTIVATION", "EXECUTION", "CLOSEOUT"] } } }, include: { project: { include: { client: true } } } }),
  ]);
  const map = new Map<string, { project: (typeof memberOf)[number]["project"]; today: boolean; hours?: number; notes?: string | null; startTime?: string | null; endTime?: string | null }>();
  for (const a of assigned) map.set(a.projectId, { project: a.project, today: true, hours: Number(a.hours), notes: a.notes, startTime: a.startTime, endTime: a.endTime });
  for (const m of memberOf) if (!map.has(m.projectId)) map.set(m.projectId, { project: m.project, today: false });
  return { worker, jobs: [...map.values()].filter((j) => j.project.stage !== "CLOSED") };
}

/** Viewing a job in the field app: today's jobs, or a published shift in the next 14 days. Returns the next shift date when it isn't today. */
export async function fieldViewAccess(actor: Actor, projectId: string): Promise<{ today: boolean; next: Date | null }> {
  if (can(actor.role, "jobs.view")) return { today: true, next: null };
  const { jobs, worker } = await assignedJobs(actor);
  if (jobs.some((j) => j.project.id === projectId)) return { today: true, next: null };
  if (await prisma.workOrderRequest.count({ where: { userId: actor.id, projectId, doneAt: null, cancelledAt: null } })) return { today: false, next: null };
  const t0 = today();
  const next = worker ? await prisma.labourAssignment.findFirst({ where: { workerId: worker.id, projectId, publishedAt: { not: null }, date: { gt: t0, lte: addDays(t0, 14) } }, orderBy: { date: "asc" } }) : null;
  if (!next) throw new ForbiddenError("You are not assigned to this job.");
  return { today: false, next: next.date };
}

export async function assertFieldAccess(actor: Actor, projectId: string) {
  if (can(actor.role, "jobs.view")) return;
  if (await prisma.workOrderRequest.count({ where: { userId: actor.id, projectId, doneAt: null, cancelledAt: null } })) return;
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
  const e = await paidExtra(t, actor, worker, toProjectId, at, minutes, "TRAVEL", `Travel ${dur(minutes)} from ${last.officeDoneAt ? "office" : last.project.pendingReview ? last.project.name : last.project.number} (${hm(left)} to ${hm(at)})`);
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
    if (await getSetting("field.geofenceEnabled", t)) {
      const office = parseLatLng(String(await getSetting("field.officePin", t) ?? ""));
      if (!office) throw new UserError("Office not set. Call office.");
      if (geo.lat == null || geo.lng == null || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) throw new UserError(geo.error === "denied" ? "Location blocked. Allow it in phone settings." : "Turn on location.");
      const radius = Number(await getSetting("field.geofenceRadiusMeters", t));
      const dist = distanceMeters({ lat: geo.lat, lng: geo.lng }, office);
      if (dist > radius) throw new UserError(`You're ${fmtDistance(dist)} from office. Get within ${radius} m.${geo.accuracy && geo.accuracy > 25 ? ` Weak GPS (±${Math.round(geo.accuracy)} m). Step outside.` : ""}`);
    }
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
    if (open) throw new UserError(`Clock out of ${open.project.name} first.`);
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
    if (open) throw new UserError(`Clock out of ${open.project.name} first.`);
    const base = Number(await getSetting("field.geofenceRadiusMeters", t));
    // Weak GPS at the start would make the pin unreliable; widen this job's range to cover it (max 500 m).
    const radius = geo.accuracy && geo.accuracy > base / 2 ? Math.min(500, Math.ceil(base + geo.accuracy)) : null;
    // Temporary number: the office files the work order under an existing job or gives it a real WO number.
    const number = `NEW-${await nextCounter(t, "newcall")}`;
    const p = await t.project.create({
      data: {
        number, pendingReview: true, jobType: "SERVICE", stage: "EXECUTION", awardedAt: new Date(), holdbackPercent: 0,
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
      await notifyUsers(t, [handLeadToUserId], { type: "servicecall.lead", title: `${worker.name} left. You're lead on ${open.project.siteContactName ?? open.project.name}. Fill work order before you clock out.`, link: `/field/${open.projectId}`, projectId: open.projectId }, actor.id);
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
    if (prev) await notifyUsers(t, [prev], { type: "servicecall.lead", title: `${worker.name} took over as lead on ${mine.project.siteContactName ?? mine.project.name}. No work order needed from you.`, link: `/field/${projectId}`, projectId }, actor.id);
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
    if (mine) throw new UserError(`Clock out of ${mine.project.name} first.`);
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

/** Work orders this person submitted (field app "My work orders"), newest first. */
export async function myWorkOrders(actor: Actor) {
  requirePerm(actor, "field.use");
  return prisma.workOrderSignoff.findMany({ where: { completedById: actor.id }, orderBy: { createdAt: "desc" }, take: 200, include: { project: { select: { id: true, number: true, name: true, location: true } }, _count: { select: { notes: true } } } });
}

/** One of this person's own submitted work orders; anyone else's is "not found". */
export async function myWorkOrder(actor: Actor, id: string) {
  requirePerm(actor, "field.use");
  const s = await prisma.workOrderSignoff.findUnique({ where: { id }, include: { project: { select: { id: true, number: true, name: true, location: true } }, notes: { orderBy: { createdAt: "asc" } } } });
  if (!s || s.completedById !== actor.id) throw new NotFoundError("Work order");
  return s;
}

/** Office: every submitted work order, newest first, with who submitted it. */
export async function allWorkOrders(actor: Actor, f: { userId?: string; status?: string; from?: Date; to?: Date; q?: string } = {}) {
  requirePerm(actor, "jobs.view");
  const where: Prisma.WorkOrderSignoffWhereInput = {
    ...(f.userId ? { completedById: f.userId } : {}),
    ...(f.status ? { jobStatus: f.status } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: addDays(f.to, 1) } : {}) } } : {}),
    ...(f.q ? { OR: [
      { workSummary: { contains: f.q, mode: "insensitive" } },
      { customerName: { contains: f.q, mode: "insensitive" } },
      { project: { number: { contains: f.q, mode: "insensitive" } } },
      { project: { name: { contains: f.q, mode: "insensitive" } } },
      { project: { location: { contains: f.q, mode: "insensitive" } } },
    ] } : {}),
  };
  const list = await prisma.workOrderSignoff.findMany({ where, orderBy: { createdAt: "desc" }, take: 300, include: { project: { select: { id: true, number: true, name: true, location: true } }, _count: { select: { notes: true } } } });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(list.map((s) => s.completedById))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return list.map((s) => ({ ...s, submittedBy: name.get(s.completedById) ?? "Unknown" }));
}

/** Office: one submitted work order. */
export async function workOrderForOffice(actor: Actor, id: string) {
  requirePerm(actor, "jobs.view");
  const s = await prisma.workOrderSignoff.findUnique({ where: { id }, include: { project: { select: { id: true, number: true, name: true, location: true } }, notes: { orderBy: { createdAt: "asc" } } } });
  if (!s) throw new NotFoundError("Work order");
  const u = await prisma.user.findUnique({ where: { id: s.completedById }, select: { name: true } });
  return { ...s, submittedBy: u?.name ?? "Unknown" };
}

// ─────────────── Work order requests (office asks for a missed one) ───────────────

export const workOrderRequestSchema = z.object({
  userIds: z.array(zId).min(1, "Pick at least one person").max(50),
  projectId: zId,
  date: zDate,
  note: zOptText(500),
});

/** Office asks one or more guys for the work order for a job on a day. Each gets an alert. */
export async function requestWorkOrders(actor: Actor, raw: z.input<typeof workOrderRequestSchema>) {
  const input = workOrderRequestSchema.parse(raw);
  requirePerm(actor, "labour.schedule");
  assert(input.date <= today(), "Pick today or an earlier day.");
  return tx(async (t) => {
    const p = await loadProject(t, input.projectId);
    let created = 0;
    const skipped: string[] = [];
    for (const userId of [...new Set(input.userIds)]) {
      const w = await t.worker.findUnique({ where: { userId }, include: { user: { select: { name: true } } } });
      assert(w && w.active, "Pick active employees with a field login.");
      const dup = await t.workOrderRequest.findFirst({ where: { userId, projectId: p.id, date: input.date, doneAt: null, cancelledAt: null } });
      if (dup) { skipped.push(w.name); continue; }
      const r = await t.workOrderRequest.create({ data: { userId, projectId: p.id, date: input.date, note: input.note ?? null, requestedById: actor.id } });
      await notifyUsers(t, [userId], { type: "workorder.request", title: `Work order needed: ${p.name}`, body: `Office asked for your work order for ${shortDay(input.date)}.${input.note ? ` ${input.note}` : ""}`, link: `/field/request/${r.id}`, projectId: p.id }, actor.id);
      await audit(t, actor, { action: "workorder.request", entityType: "WorkOrderRequest", entityId: r.id, projectId: p.id, summary: `Asked ${w.name} for the ${p.number} work order for ${shortDay(input.date)}` });
      created++;
    }
    return { created, skipped };
  });
}

export async function cancelWorkOrderRequest(actor: Actor, id: string) {
  requirePerm(actor, "labour.schedule");
  return tx(async (t) => {
    const r = await t.workOrderRequest.findUnique({ where: { id }, include: { project: true } });
    if (!r) throw new NotFoundError("Request");
    assert(!r.doneAt, "Already done.");
    if (r.cancelledAt) return;
    await t.workOrderRequest.update({ where: { id }, data: { cancelledAt: new Date() } });
    await notifyUsers(t, [r.userId], { type: "workorder.request", title: `No longer needed: ${r.project.name} work order (${shortDay(r.date)})`, link: "/field", projectId: r.projectId }, actor.id);
    await audit(t, actor, { action: "workorder.request.cancel", entityType: "WorkOrderRequest", entityId: id, projectId: r.projectId, summary: `Cancelled work order request for ${shortDay(r.date)}` });
  });
}

/** Field: work orders the office is waiting on from me. */
export async function myWorkOrderRequests(userId: string) {
  return prisma.workOrderRequest.findMany({ where: { userId, doneAt: null, cancelledAt: null }, orderBy: { date: "asc" }, include: { project: { select: { id: true, number: true, name: true, location: true } } } });
}

/** Field: one request, only my own and still open. */
export async function myWorkOrderRequest(actor: Actor, id: string) {
  requirePerm(actor, "field.use");
  const r = await prisma.workOrderRequest.findUnique({ where: { id }, include: { project: { select: { id: true, number: true, name: true, location: true } } } });
  if (!r || r.userId !== actor.id) throw new NotFoundError("Request");
  return r;
}

/** Office: open requests, plus ones answered or cancelled in the last 14 days. */
export async function officeWorkOrderRequests(actor: Actor) {
  requirePerm(actor, "jobs.view");
  const since = addDays(today(), -14);
  const list = await prisma.workOrderRequest.findMany({
    where: { OR: [{ doneAt: null, cancelledAt: null }, { doneAt: { gte: since } }] },
    orderBy: [{ doneAt: { sort: "desc", nulls: "first" } }, { date: "desc" }], take: 200,
    include: { project: { select: { id: true, number: true, name: true } } },
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(list.flatMap((r) => [r.userId, r.requestedById]))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return list.map((r) => ({ ...r, who: name.get(r.userId) ?? "Unknown", by: name.get(r.requestedById) ?? "Office" }));
}

/** Add a note to a submitted work order. The original stays as submitted; the office is notified. */
export async function addWorkOrderNote(actor: Actor, signoffId: string, text: string) {
  requirePerm(actor, "field.use");
  const body = text.trim();
  assert(body.length >= 2, "Write a note.");
  assert(body.length <= 2000, "Note is too long.");
  return tx(async (t) => {
    const s = await t.workOrderSignoff.findUnique({ where: { id: signoffId }, include: { project: true } });
    if (!s || s.completedById !== actor.id) throw new NotFoundError("Work order");
    const n = await t.workOrderNote.create({ data: { signoffId, authorId: actor.id, text: body } });
    await audit(t, actor, { action: "workorder.note", entityType: "WorkOrderSignoff", entityId: signoffId, projectId: s.projectId, summary: `${s.project.number}: ${actor.name} added a note to their work order` });
    const msg = { type: "workorder.signoff", title: `${s.project.number}: note added to work order`, body: `${actor.name}: ${body.slice(0, 200)}`, link: `/work-orders/${s.id}`, projectId: s.projectId };
    if (s.project.projectManagerId) await notifyUsers(t, [s.project.projectManagerId], msg, actor.id);
    else await notifyRoles(t, ["ADMIN", "PROJECT_MANAGER"], msg, actor.id);
    return n;
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
  /// filling in a work order the office asked for
  requestId: zOptId,
});

/** Complete work order (optional) + customer signature (optional). */
export async function completeWorkOrder(actor: Actor, projectId: string, input: z.infer<typeof signoffSchema>, parkingReceipt?: UploadFile | null, photos: UploadFile[] = []) {
  assert(photos.length <= 15, "Up to 15 photos.");
  for (const ph of photos) assert(/^image\//.test(ph.type) || /\.(jpe?g|png|heic|webp)$/i.test(ph.name), "Site photos must be pictures.");
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
    const req = input.requestId ? await t.workOrderRequest.findUnique({ where: { id: input.requestId } }) : null;
    if (input.requestId) assert(req && req.userId === actor.id && req.projectId === projectId && !req.doneAt && !req.cancelledAt, "That request is already done or was cancelled.");
    const s = await t.workOrderSignoff.create({ data: { projectId, completedById: actor.id, forDate: req?.date ?? null, workSummary: input.workSummary, markedComplete: input.markedComplete, jobStatus: input.jobStatus ?? (input.markedComplete ? "COMPLETE" : null), coWorkerIds: input.coWorkerIds ?? [], materialsUsed: input.materialsUsed?.length ? input.materialsUsed : undefined, parkingAmount: input.parkingAmount, customerName: input.customerName, signedAt: sigFile ? new Date() : null } });
    if (parkingReceipt) {
      const up = await uploadDocument(actor, { projectId, module: "FIELD", category: "Parking receipt", title: `${p.pendingReview ? p.name : p.number} parking receipt${input.parkingAmount != null ? ` $${input.parkingAmount.toFixed(2)}` : ""}`, entityType: "WorkOrderSignoff", entityId: s.id, approvalStatus: "APPROVED" }, parkingReceipt, t);
      await t.workOrderSignoff.update({ where: { id: s.id }, data: { parkingReceiptDocId: up.documentId } });
    }
    const ref = p.pendingReview ? p.name : p.number;
    for (const [i, ph] of photos.entries()) {
      await uploadDocument(actor, { projectId, module: "FIELD", category: "Site photo", title: `${ref} site photo ${i + 1}`, entityType: "WorkOrderSignoff", entityId: s.id, approvalStatus: "APPROVED" }, ph, t);
    }
    if (sigFile) {
      const up = await uploadDocument(actor, { projectId, module: "FIELD", category: "Customer signature", title: `${p.pendingReview ? p.name : p.number} customer sign-off — ${input.customerName}`, entityType: "WorkOrderSignoff", entityId: s.id, approvalStatus: "APPROVED" }, sigFile, t);
      await t.workOrderSignoff.update({ where: { id: s.id }, data: { signatureDocId: up.documentId } });
    }
    await audit(t, actor, { action: "workorder.signoff", entityType: "WorkOrderSignoff", entityId: s.id, projectId, summary: `${p.number}: work order ${input.jobStatus ? JOB_STATUSES[input.jobStatus].toLowerCase() : input.markedComplete ? "completed" : "visit recorded"}${input.parkingAmount ? `, parking $${input.parkingAmount.toFixed(2)}` : ""}${sigFile ? `, signed by ${input.customerName}` : ""}` });
    const sn = { type: "workorder.signoff", title: `${p.number}: work ${input.markedComplete ? "completed" : "visit report"}`, body: `${actor.name}: ${input.workSummary.slice(0, 200)}`, link: `/work-orders/${s.id}`, projectId };
    if (req) {
      await t.workOrderRequest.update({ where: { id: req.id }, data: { doneAt: new Date(), signoffId: s.id } });
      sn.title = `${p.number}: requested work order in (${shortDay(req.date)})`;
      const to = [...new Set([req.requestedById, ...(p.projectManagerId ? [p.projectManagerId] : [])])];
      await notifyUsers(t, to, sn, actor.id);
    } else {
      // a work order filed the normal way also answers any open request for this job up to today
      await t.workOrderRequest.updateMany({ where: { userId: actor.id, projectId, doneAt: null, cancelledAt: null, date: { lte: today() } }, data: { doneAt: new Date(), signoffId: s.id } });
      if (!p.projectManagerId) await notifyRoles(t, ["ADMIN", "PROJECT_MANAGER"], sn, actor.id);
      else await notifyUsers(t, [p.projectManagerId], sn, actor.id);
    }
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
