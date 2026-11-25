import { z } from "zod";
import { JobType, Role } from "@prisma/client";
import { tx, type Tx } from "@/lib/db";
import { requirePerm, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { zDate, zDateTime, zId, zOptDate, zOptDateTime, zOptId, zOptMoney, zOptText, zText } from "@/lib/forms";
import { nextWorkOrderNumber } from "@/lib/numbering";
import { notifyUsers } from "@/lib/notify";
import { changeStage } from "@/lib/workflow";
import { getSetting, type CloseoutTemplateItem } from "@/lib/settings";

export async function loadProject(t: Tx, id: string) {
  const p = await t.project.findUnique({ where: { id } });
  if (!p) throw new NotFoundError("Job");
  return p;
}

// ─────────────── Leads (tender opportunities) ───────────────

export const leadSchema = z.object({
  name: zText(200),
  description: zOptText(),
  location: zOptText(300),
  clientId: zOptId,
  consultantId: zOptId,
  gcId: zOptId,
  clientProjectNo: zOptText(100),
  estimatedValue: zOptMoney,
  invitationDate: zOptDate,
  submissionDeadline: zOptDateTime,
  siteVisitDate: zOptDateTime,
  scope: zOptText(),
});
export type LeadInput = z.infer<typeof leadSchema>;

export async function createLead(actor: Actor, input: LeadInput) {
  requirePerm(actor, "leads.edit");
  return tx(async (t) => {
    const number = await nextWorkOrderNumber(t);
    const p = await t.project.create({
      data: { ...input, number, jobType: "PROJECT", stage: "OPPORTUNITY", holdbackPercent: await getSetting("billing.holdbackPercent", t) },
    });
    await t.stageHistory.create({ data: { projectId: p.id, toStage: "OPPORTUNITY", byId: actor.id, note: "Lead created" } });
    await createFolders(t, p.id, ["Tender Documents", "Estimates", "Supplier Quotes", "Submission"]);
    await audit(t, actor, { action: "lead.create", entityType: "Project", entityId: p.id, projectId: p.id, summary: `Lead ${number} created: ${p.name}`, after: input });
    return p;
  });
}

export async function updateProjectInfo(actor: Actor, id: string, input: Partial<LeadInput> & { siteContactName?: string; siteContactPhone?: string; startDate?: Date; finishDate?: Date }) {
  return tx(async (t) => {
    const p = await loadProject(t, id);
    requirePerm(actor, ["OPPORTUNITY", "UNDER_REVIEW", "ESTIMATING", "QUOTING", "READY_TO_SUBMIT", "SUBMITTED"].includes(p.stage) ? "leads.edit" : "project.manage");
    assert(p.stage !== "CLOSED", "Closed jobs cannot be edited. Reopen the job first.");
    const updated = await t.project.update({ where: { id }, data: input });
    await audit(t, actor, { action: "project.update", entityType: "Project", entityId: id, projectId: id, summary: `${p.number}: details updated`, before: pick(p, Object.keys(input)), after: input });
    return updated;
  });
}

function pick(o: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

export async function startReview(actor: Actor, id: string) {
  requirePerm(actor, "leads.edit");
  return tx(async (t) => {
    const p = await loadProject(t, id);
    await changeStage(t, actor, p, "UNDER_REVIEW", { note: "Tender review started" });
  });
}

export const reviewDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("DOABLE"), estimatorId: zId, reason: zOptText() }),
  z.object({ decision: z.literal("NOT_DOABLE"), reason: zText(2000).pipe(z.string().min(3, "Give the reason it is not doable")) }),
]);

/** Decision branch: Doable → assign estimator; Not doable → close with reason. */
export async function decideReview(actor: Actor, id: string, input: z.infer<typeof reviewDecisionSchema>) {
  requirePerm(actor, "leads.decide");
  return tx(async (t) => {
    const p = await loadProject(t, id);
    assert(p.stage === "UNDER_REVIEW" || p.stage === "OPPORTUNITY", "This lead is not awaiting a review decision.");
    if (p.stage === "OPPORTUNITY") {
      await changeStage(t, actor, p, "UNDER_REVIEW", { note: "Review started" });
      p.stage = "UNDER_REVIEW";
    }
    await t.tenderReview.create({ data: { projectId: id, decision: input.decision, reason: input.reason, reviewerId: actor.id } });
    if (input.decision === "NOT_DOABLE") {
      assert(input.reason && input.reason.trim().length >= 3, "Give the reason it is not doable.");
      await changeStage(t, actor, p, "CLOSED", { closeReason: "NOT_DOABLE", note: input.reason });
      return;
    }
    const est = await t.user.findUnique({ where: { id: input.estimatorId } });
    assert(est && est.active, "Choose an active estimator.");
    await t.project.update({ where: { id }, data: { estimatorId: est.id } });
    await changeStage(t, actor, p, "ESTIMATING", { note: `Doable. Assigned to ${est.name}${input.reason ? ` — ${input.reason}` : ""}` });
    await notifyUsers(t, [est.id], {
      type: "tender.assigned",
      title: `New tender assigned: ${p.number} ${p.name}`,
      body: p.submissionDeadline ? `Submission deadline ${p.submissionDeadline.toLocaleString("en-CA")}` : undefined,
      link: `/jobs/${id}/estimates`,
      projectId: id,
    }, actor.id);
  });
}

export async function assignEstimator(actor: Actor, id: string, estimatorId: string) {
  requirePerm(actor, "leads.decide");
  return tx(async (t) => {
    const p = await loadProject(t, id);
    const est = await t.user.findUnique({ where: { id: estimatorId } });
    assert(est && est.active, "Choose an active user.");
    await t.project.update({ where: { id }, data: { estimatorId } });
    await audit(t, actor, { action: "project.estimator", entityType: "Project", entityId: id, projectId: id, summary: `${p.number}: estimator set to ${est.name}`, before: { estimatorId: p.estimatorId }, after: { estimatorId } });
    await notifyUsers(t, [estimatorId], { type: "tender.assigned", title: `Tender assigned to you: ${p.number} ${p.name}`, link: `/jobs/${id}/estimates`, projectId: id }, actor.id);
  });
}

export const communicationSchema = z.object({
  kind: z.enum(["Email", "Phone", "Meeting", "Addendum", "Clarification", "Site visit", "Other"]),
  date: zDateTime,
  subject: zText(300),
  fromParty: zOptText(200),
  toParty: zOptText(200),
  summary: zOptText(),
});
export async function addCommunication(actor: Actor, projectId: string, input: z.infer<typeof communicationSchema>) {
  requirePerm(actor, "leads.edit");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const c = await t.communication.create({ data: { ...input, projectId, createdById: actor.id } });
    await audit(t, actor, { action: "communication.add", entityType: "Communication", entityId: c.id, projectId, summary: `${p.number}: ${input.kind} logged — ${input.subject}` });
    return c;
  });
}

/** Cancel a lead or job (any non-closed stage). */
export async function cancelJob(actor: Actor, id: string, reason: string) {
  return tx(async (t) => {
    const p = await loadProject(t, id);
    requirePerm(actor, ["EXECUTION", "ACTIVATION", "CLOSEOUT"].includes(p.stage) ? "project.manage" : "leads.decide");
    assert(reason.trim().length >= 3, "Give a reason for cancelling.");
    await changeStage(t, actor, p, "CLOSED", { closeReason: "CANCELLED", note: reason, force: p.stage !== "CLOSED" });
  });
}

/** Admin-only: reopen a closed job to a chosen stage. History is preserved. */
export async function reopenJob(actor: Actor, id: string, note: string) {
  requirePerm(actor, "admin.settings");
  return tx(async (t) => {
    const p = await loadProject(t, id);
    assert(p.stage === "CLOSED", "Only closed jobs can be reopened.");
    const last = await t.stageHistory.findFirst({ where: { projectId: id, toStage: "CLOSED" }, orderBy: { at: "desc" } });
    const to = last?.fromStage ?? "OPPORTUNITY";
    await changeStage(t, actor, p, to, { note: `Reopened: ${note}`, force: true });
  });
}

// ─────────────── Direct jobs: small jobs & service work orders ───────────────

export const directJobSchema = z.object({
  jobType: z.enum(["SMALL_JOB", "SERVICE"]),
  name: zText(200),
  clientId: zOptId,
  location: zOptText(300),
  scope: zOptText(),
  siteContactName: zOptText(200),
  siteContactPhone: zOptText(50),
  clientPoNumber: zOptText(100),
  contractValue: zOptMoney,
  projectManagerId: zOptId,
  startDate: zOptDate,
  finishDate: zOptDate,
});

/** Small jobs and service calls skip the tender stages and start as active jobs. */
export async function createDirectJob(actor: Actor, input: z.infer<typeof directJobSchema>) {
  requirePerm(actor, "jobs.create");
  return tx(async (t) => {
    const number = await nextWorkOrderNumber(t);
    const { clientPoNumber, contractValue, ...rest } = input;
    const p = await t.project.create({
      data: {
        ...rest,
        jobType: input.jobType as JobType,
        number,
        stage: "EXECUTION",
        awardedAt: new Date(),
        projectManagerId: input.projectManagerId ?? (actor.role === "PROJECT_MANAGER" ? actor.id : null),
        holdbackPercent: input.jobType === "SERVICE" ? 0 : await getSetting("billing.holdbackPercent", t),
      },
    });
    await t.stageHistory.create({ data: { projectId: p.id, toStage: "EXECUTION", byId: actor.id, note: `${input.jobType === "SERVICE" ? "Service work order" : "Small job"} created` } });
    if (contractValue !== undefined || clientPoNumber) {
      const value = contractValue ?? 0;
      await t.contract.create({ data: { projectId: p.id, originalValue: value, currentValue: value, clientPoNumber: clientPoNumber ?? "T&M" } });
      if (clientPoNumber) await t.clientPO.create({ data: { projectId: p.id, poNumber: clientPoNumber, amount: value } });
      if (value > 0) await t.billingLine.create({ data: { projectId: p.id, description: "Contract work", scheduledValue: value } });
    }
    await createFolders(t, p.id, ["Work Order", "Photos", "Procurement", "Billing", "Inspections"]);
    await createCloseoutItems(t, p.id, p.jobType);
    await audit(t, actor, { action: "job.create", entityType: "Project", entityId: p.id, projectId: p.id, summary: `${number} created: ${p.name}`, after: input });
    if (p.projectManagerId) {
      await notifyUsers(t, [p.projectManagerId], { type: "job.assigned", title: `${number} ${p.name} assigned to you`, link: `/jobs/${p.id}`, projectId: p.id }, actor.id);
    }
    return p;
  });
}

// ─────────────── Shared helpers used by activation ───────────────

export async function createFolders(t: Tx, projectId: string, names: string[]) {
  const existing = await t.documentFolder.count({ where: { projectId } });
  await t.documentFolder.createMany({
    data: names.map((name, i) => ({ projectId, name, sortOrder: existing + i })),
    skipDuplicates: true,
  });
}

export async function createCloseoutItems(t: Tx, projectId: string, jobType: JobType) {
  const key = `closeout.template.${jobType}` as const;
  const template = (await getSetting(key, t)) as CloseoutTemplateItem[];
  await t.closeoutItem.createMany({
    data: template.map((it, i) => ({ projectId, key: it.key, name: it.name, mandatory: it.mandatory, autoCheck: it.autoCheck ?? null, sortOrder: i })),
    skipDuplicates: true,
  });
}

// ─────────────── Team & tasks ───────────────

export async function setProjectManager(actor: Actor, id: string, userId: string) {
  requirePerm(actor, "project.manage");
  return tx(async (t) => {
    const p = await loadProject(t, id);
    const u = await t.user.findUnique({ where: { id: userId } });
    assert(u && u.active, "Choose an active user.");
    await t.project.update({ where: { id }, data: { projectManagerId: userId } });
    await audit(t, actor, { action: "project.pm", entityType: "Project", entityId: id, projectId: id, summary: `${p.number}: project manager set to ${u.name}`, before: { projectManagerId: p.projectManagerId }, after: { projectManagerId: userId } });
    await notifyUsers(t, [userId], { type: "job.assigned", title: `You are PM on ${p.number} ${p.name}`, link: `/jobs/${id}`, projectId: id }, actor.id);
  });
}

export async function addMember(actor: Actor, projectId: string, userId: string, roleLabel: string) {
  requirePerm(actor, "project.manage");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const u = await t.user.findUnique({ where: { id: userId } });
    assert(u, "User not found.");
    await t.projectMember.upsert({ where: { projectId_userId: { projectId, userId } }, create: { projectId, userId, roleLabel }, update: { roleLabel } });
    await audit(t, actor, { action: "project.member.add", entityType: "Project", entityId: projectId, projectId, summary: `${p.number}: ${u.name} added to team as ${roleLabel}` });
    await notifyUsers(t, [userId], { type: "job.assigned", title: `Added to ${p.number} ${p.name} as ${roleLabel}`, link: `/jobs/${projectId}`, projectId }, actor.id);
  });
}

export async function removeMember(actor: Actor, projectId: string, userId: string) {
  requirePerm(actor, "project.manage");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    await t.projectMember.deleteMany({ where: { projectId, userId } });
    await audit(t, actor, { action: "project.member.remove", entityType: "Project", entityId: projectId, projectId, summary: `${p.number}: team member removed`, before: { userId } });
  });
}

export const taskSchema = z.object({
  title: zText(300),
  description: zOptText(),
  assigneeId: zOptId,
  dueDate: zOptDate,
});
export async function createTask(actor: Actor, projectId: string, input: z.infer<typeof taskSchema>) {
  requirePerm(actor, "project.manage");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const task = await t.task.create({ data: { ...input, projectId, createdById: actor.id } });
    await audit(t, actor, { action: "task.create", entityType: "Task", entityId: task.id, projectId, summary: `${p.number}: task "${input.title}" created` });
    if (input.assigneeId) {
      await notifyUsers(t, [input.assigneeId], { type: "task.assigned", title: `Task: ${input.title}`, body: `${p.number} ${p.name}`, link: `/jobs/${projectId}/tasks`, projectId }, actor.id);
    }
    return task;
  });
}
export async function setTaskStatus(actor: Actor, taskId: string, status: "OPEN" | "IN_PROGRESS" | "DONE") {
  return tx(async (t) => {
    const task = await t.task.findUnique({ where: { id: taskId }, include: { project: true } });
    if (!task) throw new NotFoundError("Task");
    if (task.assigneeId !== actor.id) requirePerm(actor, "project.manage");
    await t.task.update({ where: { id: taskId }, data: { status, completedAt: status === "DONE" ? new Date() : null } });
    await audit(t, actor, { action: "task.status", entityType: "Task", entityId: taskId, projectId: task.projectId, summary: `${task.project.number}: task "${task.title}" → ${status}`, before: { status: task.status }, after: { status } });
  });
}
export async function deleteTask(actor: Actor, taskId: string) {
  requirePerm(actor, "project.manage");
  return tx(async (t) => {
    const task = await t.task.findUnique({ where: { id: taskId }, include: { project: true } });
    if (!task) throw new NotFoundError("Task");
    await t.task.delete({ where: { id: taskId } });
    await audit(t, actor, { action: "task.delete", entityType: "Task", entityId: taskId, projectId: task.projectId, summary: `${task.project.number}: task "${task.title}" deleted`, before: task });
  });
}

// ─────────────── Schedule ───────────────

export const scheduleItemSchema = z.object({
  name: zText(200),
  startDate: zOptDate,
  endDate: zOptDate,
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETE"]).default("NOT_STARTED"),
  isMilestone: z.preprocess((v) => v === "on" || v === true, z.boolean()).default(false),
});
export async function upsertScheduleItem(actor: Actor, projectId: string, itemId: string | null, input: z.infer<typeof scheduleItemSchema>) {
  requirePerm(actor, "project.manage");
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw new UserError("End date is before start date.");
  return tx(async (t) => {
    const p = await loadProject(t, projectId);
    const max = await t.scheduleItem.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    const item = itemId
      ? await t.scheduleItem.update({ where: { id: itemId, projectId }, data: input })
      : await t.scheduleItem.create({ data: { ...input, projectId, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    await audit(t, actor, { action: itemId ? "schedule.update" : "schedule.create", entityType: "ScheduleItem", entityId: item.id, projectId, summary: `${p.number}: schedule "${input.name}" ${itemId ? "updated" : "added"}`, after: input });
    return item;
  });
}

export async function usersByRole(t: Tx, roles: Role[]) {
  return t.user.findMany({ where: { role: { in: roles }, active: true }, orderBy: { name: "asc" } });
}

export const zStartFinish = z.object({ startDate: zDate, finishDate: zDate });
export const zOptDT = zOptDateTime;
