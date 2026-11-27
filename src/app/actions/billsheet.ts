"use server";

import { run, str, type ActionState } from "@/lib/action";
import { UserError } from "@/lib/errors";
import * as bs from "@/services/billsheet";

export async function saveSheetAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    let payload: unknown;
    try { payload = JSON.parse(str(d.payload)); } catch { throw new UserError("Could not read the sheet. Refresh and try again."); }
    const ready = str(d.intent) === "ready";
    await bs.saveSheet(actor, str(d.projectId), payload, ready);
    return ready ? { message: "Ready to bill. Office admin can see it now.", redirectTo: `/billing/${str(d.projectId)}` } : "Draft saved.";
  });
}
export async function reopenSheetAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => { await bs.reopenSheet(actor, str(d.projectId)); return "Reopened. You can edit it again."; });
}
export async function cancelJobBillingAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => { await bs.cancelJobBilling(actor, str(d.projectId), str(d.reason)); return { message: "Cancelled. No bill.", redirectTo: `/billing/${str(d.projectId)}` }; });
}
export async function markBilledAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => { await bs.markBilled(actor, str(d.projectId), str(d.qbInvoiceNo)); return "Marked billed."; });
}
