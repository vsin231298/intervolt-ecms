"use server";

import { z } from "zod";
import { run, str, filesFrom, type ActionState } from "@/lib/action";
import { zBool } from "@/lib/forms";
import * as c from "@/services/closeout";
import { uploadDocument } from "@/services/documents";

export async function startCloseoutAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await c.startCloseout(actor, str(d.projectId));
    return { redirectTo: `/jobs/${str(d.projectId)}/closeout` };
  });
}

export async function scheduleInspectionAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await c.scheduleInspection(actor, str(d.projectId), c.inspectionSchema.parse({ ...d, isEsa: zBool.parse(d.isEsa ?? ""), isFinal: zBool.parse(d.isFinal ?? "") }));
    return "Inspection scheduled.";
  });
}

export async function inspectionResultAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const descs = fd.getAll("defDescription").map(String);
    const locs = fd.getAll("defLocation").map(String);
    const who = fd.getAll("defAssignee").map(String);
    const due = fd.getAll("defDue").map(String);
    const deficiencies = descs.map((description, i) => ({ description, location: locs[i], assignedToId: who[i], dueDate: due[i] })).filter((x) => x.description.trim());
    const input = c.inspectionResultSchema.parse({ result: d.result, resultDate: d.resultDate, notes: d.notes, deficiencies });
    await c.recordInspectionResult(actor, str(d.inspectionId), input);
    for (const f of await filesFrom(fd, "files")) {
      await uploadDocument(actor, { projectId: str(d.projectId), module: "INSPECTION", category: "Inspection report", entityType: "Inspection", entityId: str(d.inspectionId) }, f);
    }
    return input.result === "FAILED" ? "Recorded as failed. Deficiencies created; schedule a re-inspection when corrected." : "Inspection result recorded.";
  });
}

export async function addDeficiencyAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await c.addDeficiency(actor, str(d.projectId), c.deficiencySchema.parse(d))));
}

export async function deficiencyStatusAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await c.updateDeficiency(actor, str(d.id), z.enum(["OPEN", "IN_PROGRESS", "COMPLETED"]).parse(d.status), str(d.correctiveAction) || undefined)));
}

export async function addCommissioningAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await c.addCommissioningItem(actor, str(d.projectId), c.commissioningSchema.parse(d))));
}

export async function commissioningResultAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    await c.recordCommissioning(actor, str(d.id), c.commissioningResultSchema.parse(d));
    for (const f of await filesFrom(fd, "files")) {
      await uploadDocument(actor, { projectId: str(d.projectId), module: "COMMISSIONING", category: "Commissioning report", entityType: "CommissioningItem", entityId: str(d.id) }, f);
    }
  });
}

export async function closeoutItemAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d, fd) => {
    const op = str(d.op);
    const id = str(d.itemId);
    if (op === "complete") await c.completeCloseoutItem(actor, id, str(d.notes) || undefined);
    else if (op === "waive") await c.waiveCloseoutItem(actor, id, str(d.reason));
    else if (op === "reopen") await c.reopenCloseoutItem(actor, id);
    for (const f of await filesFrom(fd, "files")) {
      await uploadDocument(actor, { projectId: str(d.projectId), module: "CLOSEOUT", category: str(d.itemName) || "Closeout document", entityType: "CloseoutItem", entityId: id }, f);
    }
  });
}

export async function addCloseoutItemAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => void (await c.addCloseoutItem(actor, str(d.projectId), str(d.name), zBool.parse(d.mandatory ?? ""))));
}

export async function closeProjectAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    await c.closeProject(actor, str(d.projectId), str(d.note) || undefined);
    return "Job closed.";
  });
}
