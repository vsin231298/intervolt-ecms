import type { Role } from "@prisma/client";
import { can, type Permission } from "./rbac";
import { ForbiddenError } from "./errors";

/** The user performing an operation. Services receive this instead of reading cookies. */
export type Actor = { id: string; name: string; email: string; role: Role };

export function requirePerm(actor: Actor, perm: Permission) {
  if (!can(actor.role, perm)) throw new ForbiddenError();
}
export function requireAny(actor: Actor, perms: Permission[]) {
  if (!perms.some((p) => can(actor.role, p))) throw new ForbiddenError();
}
