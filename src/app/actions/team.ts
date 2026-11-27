"use server";

import { run, str, type ActionState } from "@/lib/action";
import { zBool } from "@/lib/forms";
import { parseDate } from "@/lib/dates";
import { UserError } from "@/lib/errors";
import * as labour from "@/services/labour";
import * as team from "@/services/team";

const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

/** Office: one shift (or the same shift over several days) for one or more people. */
export async function createShiftAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const projectId = str(d.projectId);
    if (!projectId) throw new UserError("Pick a job.");
    const res = await labour.scheduleWorkers(actor, projectId, {
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
    } as never);
    const what = res.published ? "Shift saved and published." : "Shift saved as draft. Publish when ready.";
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
