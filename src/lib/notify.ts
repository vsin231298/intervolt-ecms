import type { Role } from "@prisma/client";
import type { Tx } from "./db";

export type NotificationInput = {
  type: string;
  title: string;
  body?: string;
  link?: string;
  projectId?: string | null;
  /** When set, the same user never gets the same notification twice. */
  dedupeKey?: string;
};

export async function notifyUsers(tx: Tx, userIds: (string | null | undefined)[], n: NotificationInput, exceptUserId?: string) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x && x !== exceptUserId))];
  if (!ids.length) return 0;
  const res = await tx.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      projectId: n.projectId ?? null,
      dedupeKey: n.dedupeKey ?? null,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

export async function notifyRoles(tx: Tx, roles: Role[], n: NotificationInput, exceptUserId?: string) {
  const users = await tx.user.findMany({ where: { role: { in: roles }, active: true }, select: { id: true } });
  return notifyUsers(tx, users.map((u) => u.id), n, exceptUserId);
}

/** PM + estimator + project members of a job. */
export async function projectTeam(tx: Tx, projectId: string) {
  const p = await tx.project.findUnique({
    where: { id: projectId },
    select: { projectManagerId: true, estimatorId: true, members: { select: { userId: true } } },
  });
  if (!p) return { pm: null as string | null, estimator: null as string | null, members: [] as string[] };
  return { pm: p.projectManagerId, estimator: p.estimatorId, members: p.members.map((m) => m.userId) };
}
