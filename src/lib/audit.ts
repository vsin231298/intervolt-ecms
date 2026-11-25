import type { Tx } from "./db";
import type { Actor } from "./actor";
import { Prisma } from "@prisma/client";

function clean(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));
}

/** Write an audit entry inside the caller's transaction. The table is append-only at the DB level. */
export async function audit(
  tx: Tx,
  actor: Actor | null,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    projectId?: string | null;
    summary: string;
    before?: unknown;
    after?: unknown;
  },
) {
  await tx.auditLog.create({
    data: {
      userId: actor?.id ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      projectId: entry.projectId ?? null,
      summary: entry.summary,
      before: clean(entry.before),
      after: clean(entry.after),
    },
  });
}
