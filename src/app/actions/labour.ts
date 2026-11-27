"use server";
import { parseDateTimeLocal } from "@/lib/dates";

import { run, str, filesFrom, type ActionState } from "@/lib/action";
import { zBool } from "@/lib/forms";
import { UserError } from "@/lib/errors";
import * as labour from "@/services/labour";
import { uploadDocument } from "@/services/documents";

export async function saveWorkerAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const w = await labour.saveWorker(actor, str(d.workerId) || null, labour.workerSchema.parse({ ...d, active: d.workerId ? zBool.parse(d.active ?? "") : true, }));
    return d.workerId ? "Employee saved." : { redirectTo: `/people/${w.id}` };
  });
}
export async function scheduleWorkersAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const res = await labour.scheduleWorkers(actor, str(d.projectId), labour.assignmentSchema.parse({ ...d, workerIds: d.workerIds ?? [], includeWeekends: zBool.parse(d.includeWeekends ?? ""), publish: zBool.parse(d.publish ?? "") }));
    const pub = res.published ? " Published." : " Draft: publish from Employee Schedule.";
    return res.warnings.length ? `${res.created} worker-day(s) scheduled.${pub} Note: ${res.warnings.slice(0, 5).join("; ")}${res.warnings.length > 5 ? "…" : ""}` : `${res.created} worker-day(s) scheduled.${pub}`;
  });
}
export async function updateAssignmentAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => { await labour.updateAssignment(actor, d as never); return "Shift saved."; });
}
export async function removeAssignmentAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await labour.removeAssignment(actor, str(d.id))));
}
export async function addTimeAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await labour.addTimeEntry(actor, str(d.projectId), labour.timeEntrySchema.parse(d))));
}
export async function editTimeAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await labour.updateTimeEntry(actor, str(d.id), labour.timeEntrySchema.omit({ workerId: true }).parse(d))));
}
export async function deleteTimeAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await labour.deleteTimeEntry(actor, str(d.id), str(d.reason))));
}
export async function approveTimeAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, _d, fd) => {
    const ids = fd.getAll("ids").map(String);
    if (!ids.length) throw new UserError("Select entries to approve.");
    const n = await labour.approveTimeEntries(actor, ids);
    return `${n} entr${n === 1 ? "y" : "ies"} approved.`;
  });
}
export async function dailyReportAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const r = await labour.saveDailyReport(actor, str(d.projectId), labour.dailyReportSchema.parse(d));
    for (const f of await filesFrom(fd, "files")) await uploadDocument(actor, { projectId: str(d.projectId), module: "SITE", category: "Site photo", entityType: "DailyReport", entityId: r.id }, f);
    return "Daily report saved.";
  });
}
export async function resolveIssueAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await labour.resolveFieldIssue(actor, str(d.id))));
}

// ── Field app ──
const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
const geo = (d: Record<string, unknown>) => ({
  lat: num(d.lat), lng: num(d.lng), accuracy: num(d.accuracy), error: d.geoError ? String(d.geoError) : undefined,
  officeFrom: d.officeFirst === "on" && d.officeFrom ? String(d.officeFrom) : undefined,
  toOffice: d.toOffice === "on",
});
export async function clockInAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await labour.clockIn(actor, str(d.projectId), geo(d));
    return "Clocked in.";
  });
}
export async function clockOutAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const r = await labour.clockOut(actor, geo(d), str(d.notes) || undefined, str(d.handLeadTo) || undefined);
    return `Clocked out: ${r.regular} regular${r.overtime ? ` + ${r.overtime} overtime` : ""} hours recorded.`;
  });
}
export async function doneAtOfficeAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const r = await labour.doneAtOffice(actor, geo(d));
    return `Done. ${Math.floor(r.minutes / 60)}:${String(r.minutes % 60).padStart(2, "0")} added.`;
  });
}
export async function workOrderNoteAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await labour.addWorkOrderNote(actor, str(d.signoffId), str(d.text));
    return "Note added.";
  });
}
export async function startServiceCallAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const p = await labour.startServiceCall(actor, labour.serviceCallSchema.parse(d), geo(d));
    return { message: `Service call ${p.number} started and you're clocked in.`, redirectTo: `/field/${p.id}` };
  });
}
export async function takeOverLeadAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await labour.takeOverLead(actor, str(d.projectId));
    return "You're lead now.";
  });
}
export async function officeClockOutAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const at = parseDateTimeLocal(str(d.at)) ?? undefined;
    const r = await labour.officeClockOut(actor, str(d.id), at);
    return `Clocked out: ${r.regular} regular${r.overtime ? ` + ${r.overtime} overtime` : ""} hours recorded.`;
  });
}
export async function fieldUpdateAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    await labour.postFieldUpdate(actor, str(d.projectId), labour.fieldUpdateSchema.parse(d), await filesFrom(fd, "photos"));
    return d.kind === "ISSUE" ? "Issue reported to the PM." : "Update sent to the PM.";
  });
}
export async function photosAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const photos = await filesFrom(fd, "photos");
    if (!photos.length) throw new UserError("Take or choose at least one photo.");
    await labour.postFieldUpdate(actor, str(d.projectId), { kind: "UPDATE", message: str(d.message) || "Progress photos" }, photos);
    return `${photos.length} photo(s) uploaded.`;
  });
}
export async function signoffAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const items = fd.getAll("materialItem").map(String);
    const qtys = fd.getAll("materialQty").map(String);
    const materialsUsed = items.map((item, i) => ({ item: item.trim(), quantity: (qtys[i] ?? "").trim() })).filter((m) => m.item);
    const coWorkerIds = fd.getAll("coWorkerIds").map(String).filter(Boolean);
    const [receipt] = await filesFrom(fd, "parkingReceipt");
    const input = labour.signoffSchema.parse({ ...d, markedComplete: zBool.parse(d.markedComplete ?? ""), jobStatus: d.jobStatus || undefined, coWorkerIds, materialsUsed });
    await labour.completeWorkOrder(actor, str(d.projectId), input, receipt ?? null);
    if (input.requestId) return { message: "Work order sent to the office.", redirectTo: "/my-work-orders" };
    return "Work order saved. See it in My Work Orders.";
  });
}
export async function joinServiceCallAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const p = await labour.joinServiceCall(actor, str(d.projectId), geo(d));
    return { message: `You joined ${p.number} and you're clocked in.`, redirectTo: `/field/${p.id}` };
  });
}
