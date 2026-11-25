import type { OrgType, Role } from "@prisma/client";
import { prisma } from "./db";

export async function orgOptions(types: OrgType[]) {
  const orgs = await prisma.organization.findMany({ where: { type: { in: types }, active: true }, orderBy: { name: "asc" } });
  return orgs.map((o) => ({ value: o.id, label: o.name }));
}
export async function userOptions(roles?: Role[]) {
  const users = await prisma.user.findMany({ where: { active: true, ...(roles ? { role: { in: roles } } : {}) }, orderBy: { name: "asc" } });
  return users.map((u) => ({ value: u.id, label: u.name }));
}
export async function workerOptions() {
  const ws = await prisma.worker.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return ws.map((w) => ({ value: w.id, label: `${w.name} — ${w.trade}` }));
}
