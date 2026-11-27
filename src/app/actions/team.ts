"use server";

import { run, str, type ActionState } from "@/lib/action";
import { zBool } from "@/lib/forms";
import { parseDate } from "@/lib/dates";
import { UserError } from "@/lib/errors";
import * as labour from "@/services/labour";
import * as team from "@/services/team";
import * as workorders from "@/services/workorders";
import { prisma } from "@/lib/db";

const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

/** Office: one shift (or the same shift over several days) for one or more people. */
export async function createShiftAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const isNew = str(d.jobMode) === "new";
    const projectId = str(d.projectId);
    if (!isNew && !projectId) throw new UserError("Pick a job.");
    const shift = {
      workerIds: arr(d.workerIds),
      fromDate: str(d.date),
      toDate: str(d.toDate) || str(d.date),
      startTime: str(d.startTime),
      endTime: str(d.endTime),
      breakMin: str(d.breakMin) || "0",
      hours: 8,
      includeWeekends: true,
      notes: str(d.notes) || undefined,
      publish: zBool.parse(d.publish ?? ""),
    } as never;
    let noPin = false;
    let res: { warnings: string[]; published: number };
    if (isNew) {
      const r = await labour.scheduleNewJob(actor, { customer: str(d.customer), phone: str(d.phone), address: str(d.address), lat: str(d.lat), lng: str(d.lng) }, shift);
      res = r; noPin = r.project.siteLat == null;
    } else res = await labour.scheduleWorkers(actor, projectId, shift);
    let what = res.published ? "Shift saved and published." : "Shift saved as draft. Publish when ready.";
    if (noPin) what += " Address wasn't picked from the list, so there's no site pin. Set it on the job before they clock in.";
    return res.warnings.length ? `${what} Note: ${res.warnings.slice(0, 4).join("; ")}` : what;
  });
}

export async function publishWeekAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const from = parseDate(str(d.from));
    const to = parseDate(str(d.to));
    if (!from || !to) throw new UserError("Pick the week.");
    const n = await labour.publishSchedule(actor, from, to);
    return n ? `Published ${n} shift${n === 1 ? "" : "s"}. The guys have been told.` : "Nothing new to publish.";
  });
}

const timeOffInput = (d: Record<string, unknown>) => team.timeOffSchema.parse({ ...d, endDate: d.endDate || undefined, partial: zBool.parse(d.partial ?? "") });

export async function requestTimeOffAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await team.requestTimeOff(actor, timeOffInput(d));
    return { message: "Request sent. You'll get an alert when the office answers.", redirectTo: "/time-off" };
  });
}
export async function cancelTimeOffAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await team.cancelTimeOff(actor, str(d.id));
    return "Request cancelled.";
  });
}
export async function decideTimeOffAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const approve = str(d.decision) === "approve";
    await team.decideTimeOff(actor, str(d.id), approve, str(d.note) || undefined);
    return approve ? "Approved." : "Declined.";
  });
}
export async function addTimeOffAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    for (const w of arr(d.workerIds)) await team.addTimeOff(actor, w, timeOffInput(d));
    return "Time off added to the schedule.";
  });
}

export async function sendAnnouncementAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const a = await team.sendAnnouncement(actor, team.announcementSchema.parse({ ...d, userIds: arr(d.userIds) }));
    return { message: "Announcement sent.", redirectTo: `/announcements/${a.id}` };
  });
}

export async function startConversationAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const c = await team.startConversation(actor, arr(d.userIds), str(d.title) || undefined);
    return { redirectTo: `/messages/${c.id}` };
  });
}
export async function sendMessageAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await team.sendMessage(actor, str(d.conversationId), str(d.body));
    return "Sent.";
  });
}

/** Office: ask guys for a work order they missed. */
export async function requestWorkOrderAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const r = await labour.requestWorkOrders(actor, { userIds: arr(d["userIds[]"] ?? d.userIds), projectId: str(d.projectId), date: str(d.date), note: str(d.note) || undefined });
    const skip = r.skipped.length ? ` Already asked: ${r.skipped.join(", ")}.` : "";
    return r.created ? `Requested from ${r.created} ${r.created === 1 ? "person" : "people"}.${skip}` : `Nothing sent.${skip}`;
  });
}
export async function cancelWorkOrderRequestAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => { await labour.cancelWorkOrderRequest(actor, str(d.id)); return "Request cancelled."; });
}

/** Office: file a work order under a job, or make it a new work order. */
export async function fileWorkOrderAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const target = str(d.target) === "OTHER" ? str(d.otherId) : str(d.target);
    if (!target) throw new UserError("Pick a job.");
    const r = await workorders.fileWorkOrder(actor, str(d.signoffId), target);
    const p = await prisma.project.findUnique({ where: { id: r.projectId }, select: { number: true } });
    return `Filed under ${p?.number}.`;
  });
}
