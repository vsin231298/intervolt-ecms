import type { CloseReason, JobType, ProjectStage } from "@prisma/client";
import type { Tx } from "./db";
import type { Actor } from "./actor";
import { audit } from "./audit";
import { UserError } from "./errors";

export const STAGE_LABELS: Record<ProjectStage, string> = {
  OPPORTUNITY: "New lead",
  UNDER_REVIEW: "Under review",
  ESTIMATING: "Estimating",
  QUOTING: "Supplier quoting",
  READY_TO_SUBMIT: "Ready to submit",
  SUBMITTED: "Submitted",
  ACTIVATION: "Activation",
  EXECUTION: "In progress",
  CLOSEOUT: "Closeout",
  CLOSED: "Closed",
};

export const CLOSE_REASON_LABELS: Record<CloseReason, string> = {
  NOT_DOABLE: "Not bidding",
  LOST_BID: "Lost bid",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  PROJECT: "Project",
  SMALL_JOB: "Small job",
  SERVICE: "Service work order",
};

export const LEAD_STAGES: ProjectStage[] = ["OPPORTUNITY", "UNDER_REVIEW", "ESTIMATING", "QUOTING", "READY_TO_SUBMIT", "SUBMITTED"];
export const ACTIVE_STAGES: ProjectStage[] = ["ACTIVATION", "EXECUTION", "CLOSEOUT"];

/** Allowed stage moves. Branch decisions are enforced by the services that call changeStage. */
const TRANSITIONS: Record<ProjectStage, ProjectStage[]> = {
  OPPORTUNITY: ["UNDER_REVIEW", "CLOSED"],
  UNDER_REVIEW: ["ESTIMATING", "CLOSED"],
  ESTIMATING: ["QUOTING", "READY_TO_SUBMIT", "CLOSED"],
  QUOTING: ["ESTIMATING", "READY_TO_SUBMIT", "CLOSED"],
  READY_TO_SUBMIT: ["ESTIMATING", "QUOTING", "SUBMITTED", "CLOSED"],
  SUBMITTED: ["ACTIVATION", "CLOSED", "READY_TO_SUBMIT"],
  ACTIVATION: ["EXECUTION", "CLOSED"],
  EXECUTION: ["CLOSEOUT", "CLOSED"],
  CLOSEOUT: ["EXECUTION", "CLOSED"],
  CLOSED: [],
};

export function canTransition(from: ProjectStage, to: ProjectStage) {
  return TRANSITIONS[from].includes(to);
}

export async function changeStage(
  tx: Tx,
  actor: Actor,
  project: { id: string; stage: ProjectStage; number: string },
  to: ProjectStage,
  opts: { note?: string; closeReason?: CloseReason; force?: boolean } = {},
) {
  if (!opts.force && !canTransition(project.stage, to)) {
    throw new UserError(`A job cannot move from "${STAGE_LABELS[project.stage]}" to "${STAGE_LABELS[to]}".`);
  }
  if (to === "CLOSED" && !opts.closeReason) throw new UserError("A close reason is required.");
  await tx.project.update({
    where: { id: project.id },
    data: {
      stage: to,
      ...(to === "CLOSED"
        ? { closeReason: opts.closeReason, closeNote: opts.note ?? null, closedAt: new Date() }
        : project.stage === "CLOSED"
          ? { closeReason: null, closeNote: null, closedAt: null }
          : {}),
    },
  });
  await tx.stageHistory.create({
    data: { projectId: project.id, fromStage: project.stage, toStage: to, note: opts.note, byId: actor.id },
  });
  await audit(tx, actor, {
    action: "stage.change",
    entityType: "Project",
    entityId: project.id,
    projectId: project.id,
    summary: `${project.number}: ${STAGE_LABELS[project.stage]} → ${STAGE_LABELS[to]}${opts.closeReason ? ` (${CLOSE_REASON_LABELS[opts.closeReason]})` : ""}${opts.note ? ` — ${opts.note}` : ""}`,
    before: { stage: project.stage },
    after: { stage: to, closeReason: opts.closeReason },
  });
}
