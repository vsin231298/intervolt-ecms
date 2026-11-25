"use server";

import { run, str, type ActionState } from "@/lib/action";
import { zBool } from "@/lib/forms";
import { UserError } from "@/lib/errors";
import * as projects from "@/services/projects";
import * as sub from "@/services/submission";
import { uploadDocument } from "@/services/documents";
import { filesFrom } from "@/lib/action";

export async function createLeadAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const p = await projects.createLead(actor, projects.leadSchema.parse(d));
    for (const f of await filesFrom(fd, "files")) {
      await uploadDocument(actor, { projectId: p.id, module: "TENDER", category: str(d.docCategory) || "Tender document" }, f);
    }
    return { redirectTo: `/jobs/${p.id}` };
  });
}

export async function createDirectJobAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const p = await projects.createDirectJob(actor, projects.directJobSchema.parse(d));
    return { redirectTo: `/jobs/${p.id}` };
  });
}

export async function updateInfoAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    const schema = projects.leadSchema.partial().extend({
      siteContactName: projects.directJobSchema.shape.siteContactName,
      siteContactPhone: projects.directJobSchema.shape.siteContactPhone,
      startDate: projects.directJobSchema.shape.startDate,
      finishDate: projects.directJobSchema.shape.finishDate,
    });
    await projects.updateProjectInfo(actor, str(d.projectId), schema.parse(d));
    return "Job details saved.";
  });
}

export async function startReviewAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await projects.startReview(actor, str(d.projectId))));
}

export async function reviewDecisionAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await projects.decideReview(actor, str(d.projectId), projects.reviewDecisionSchema.parse(d));
    return d.decision === "DOABLE" ? "Marked doable and assigned to the estimator." : "Lead closed as not doable.";
  });
}

export async function assignEstimatorAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await projects.assignEstimator(actor, str(d.projectId), str(d.estimatorId))));
}

export async function communicationAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const c = await projects.addCommunication(actor, str(d.projectId), projects.communicationSchema.parse(d));
    for (const f of await filesFrom(fd, "files")) {
      await uploadDocument(actor, { projectId: str(d.projectId), module: "TENDER", category: d.kind === "Addendum" ? "Addendum" : "Correspondence", entityType: "Communication", entityId: c.id }, f);
    }
    return "Communication logged.";
  });
}

export async function cancelJobAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await projects.cancelJob(actor, str(d.projectId), str(d.reason))));
}
export async function reopenJobAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await projects.reopenJob(actor, str(d.projectId), str(d.note) || "Reopened by administrator")));
}

export async function setPmAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await projects.setProjectManager(actor, str(d.projectId), str(d.userId))));
}
export async function addMemberAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    if (!str(d.userId)) throw new UserError("Choose a person.");
    await projects.addMember(actor, str(d.projectId), str(d.userId), str(d.roleLabel) || "Team member");
  });
}
export async function removeMemberAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await projects.removeMember(actor, str(d.projectId), str(d.userId))));
}

export async function createTaskAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await projects.createTask(actor, str(d.projectId), projects.taskSchema.parse(d))));
}
export async function taskStatusAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await projects.setTaskStatus(actor, str(d.taskId), str(d.status) as "OPEN" | "IN_PROGRESS" | "DONE")));
}
export async function deleteTaskAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await projects.deleteTask(actor, str(d.taskId))));
}

export async function scheduleItemAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await projects.upsertScheduleItem(actor, str(d.projectId), str(d.itemId) || null, projects.scheduleItemSchema.parse({ ...d, isMilestone: zBool.parse(d.isMilestone ?? "") }))));
}

export async function startExecutionAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await sub.startExecution(actor, str(d.projectId));
    return "Job is now in progress.";
  });
}
