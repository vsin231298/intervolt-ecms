import type { Tx } from "./db";
import { getSetting } from "./settings";

/** Atomically increment a named counter and return the new value. */
export async function nextCounter(tx: Tx, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return rows[0].value;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** Work Order Number, shared by all job types, assigned at creation and kept for life. */
export async function nextWorkOrderNumber(tx: Tx, year = new Date().getFullYear()) {
  const prefix = await getSetting("numbering.workOrderPrefix", tx);
  const n = await nextCounter(tx, `wo:${year}`);
  return `${prefix}-${year}-${pad(n, 4)}`;
}

/** Per-project sequence, e.g. WO-2026-0001-RFI-003 */
export async function nextProjectNumber(tx: Tx, projectId: string, projectNumber: string, kind: "PO" | "RFI" | "ESI" | "CO" | "RFQ" | "MR" | "SD") {
  const n = await nextCounter(tx, `${kind}:${projectId}`);
  return `${projectNumber}-${kind}-${pad(n, kind === "PO" || kind === "RFQ" || kind === "MR" ? 2 : 3)}`;
}

export async function nextInvoiceNumber(tx: Tx, year = new Date().getFullYear()) {
  const n = await nextCounter(tx, `inv:${year}`);
  return `INV-${year}-${pad(n, 4)}`;
}
