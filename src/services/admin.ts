import { z } from "zod";
import { OrgType, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma, tx } from "@/lib/db";
import { requirePerm, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { zDateTime, zOptId, zOptText, zText } from "@/lib/forms";
import { SETTING_DEFAULTS, type SettingKey } from "@/lib/settings";
import { notifyUsers } from "@/lib/notify";

// ─────────────── Users ───────────────

export const passwordRule = z.string().min(10, "Password must be at least 10 characters").max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), "Password needs letters and numbers");

export const userSchema = z.object({
  name: zText(200),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.nativeEnum(Role),
  phone: zOptText(50),
  active: z.boolean().default(true),
  password: z.preprocess((v) => (v === "" ? undefined : v), passwordRule.optional()),
});

export async function saveUser(actor: Actor, id: string | null, input: z.infer<typeof userSchema>) {
  requirePerm(actor, "admin.users");
  return tx(async (t) => {
    if (!id) assert(input.password, "Set an initial password.");
    const dup = await t.user.findFirst({ where: { email: input.email, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw new UserError("Another user already has that email.");
    if (id === actor.id && (input.role !== "ADMIN" || !input.active)) throw new UserError("You cannot remove your own administrator access.");
    const before = id ? await t.user.findUnique({ where: { id }, select: { name: true, email: true, role: true, active: true } }) : null;
    const { password, ...data } = input;
    const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
    const u = id
      ? await t.user.update({ where: { id }, data: { ...data, ...(passwordHash ? { passwordHash } : {}) } })
      : await t.user.create({ data: { ...data, passwordHash: passwordHash! } });
    if (id && (!input.active || passwordHash)) await t.session.deleteMany({ where: { userId: id } });
    await audit(t, actor, { action: id ? "user.update" : "user.create", entityType: "User", entityId: u.id, summary: `User ${u.email} ${id ? "updated" : "created"} (${u.role}${u.active ? "" : ", inactive"})${passwordHash && id ? ", password reset" : ""}`, before, after: data });
    return u;
  });
}

export async function changeOwnPassword(actor: Actor, current: string, next: string) {
  const parsed = passwordRule.safeParse(next);
  if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await bcrypt.compare(current, u.passwordHash))) throw new UserError("Current password is incorrect.");
  await tx(async (t) => {
    await t.user.update({ where: { id: actor.id }, data: { passwordHash: await bcrypt.hash(next, 12) } });
    await audit(t, actor, { action: "user.password", entityType: "User", entityId: actor.id, summary: `${actor.email} changed their password` });
  });
}

// ─────────────── Settings ───────────────

export async function saveSettings(actor: Actor, values: Partial<Record<SettingKey, unknown>>) {
  requirePerm(actor, "admin.settings");
  return tx(async (t) => {
    for (const [key, value] of Object.entries(values) as [SettingKey, unknown][]) {
      if (!(key in SETTING_DEFAULTS)) throw new UserError(`Unknown setting ${key}`);
      const def = SETTING_DEFAULTS[key];
      if (typeof def === "number" && (typeof value !== "number" || !isFinite(value) || value < 0)) throw new UserError(`${key} must be a non-negative number.`);
      if (typeof def === "boolean" && typeof value !== "boolean") throw new UserError(`${key} must be yes or no.`);
      if (Array.isArray(def) && !Array.isArray(value)) throw new UserError(`${key} must be a list.`);
      const before = await t.setting.findUnique({ where: { key } });
      if (JSON.stringify(before?.value ?? def) === JSON.stringify(value)) continue;
      await t.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
      await audit(t, actor, { action: "setting.update", entityType: "Setting", entityId: key, summary: `Setting ${key} changed`, before: before?.value ?? def, after: value });
    }
  });
}

// ─────────────── Directory ───────────────

export const orgSchema = z.object({
  name: zText(200),
  type: z.nativeEnum(OrgType),
  email: zOptText(200),
  phone: zOptText(50),
  address: zOptText(500),
  website: zOptText(200),
  notes: zOptText(),
  active: z.boolean().default(true),
});

export async function saveOrganization(actor: Actor, id: string | null, input: z.infer<typeof orgSchema>) {
  requirePerm(actor, "directory.edit");
  return tx(async (t) => {
    const dup = await t.organization.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, type: input.type, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw new UserError(`${input.name} is already in the directory.`);
    const before = id ? await t.organization.findUnique({ where: { id } }) : null;
    const o = id ? await t.organization.update({ where: { id }, data: input }) : await t.organization.create({ data: input });
    await audit(t, actor, { action: id ? "org.update" : "org.create", entityType: "Organization", entityId: o.id, summary: `${o.name} ${id ? "updated" : "added to directory"}`, before, after: input });
    return o;
  });
}

export const contactSchema = z.object({ name: zText(200), title: zOptText(100), email: zOptText(200), phone: zOptText(50) });
export async function addContact(actor: Actor, organizationId: string, input: z.infer<typeof contactSchema>) {
  requirePerm(actor, "directory.edit");
  return tx(async (t) => {
    const o = await t.organization.findUnique({ where: { id: organizationId } });
    if (!o) throw new NotFoundError("Organization");
    const c = await t.contact.create({ data: { ...input, organizationId } });
    await audit(t, actor, { action: "contact.add", entityType: "Organization", entityId: organizationId, summary: `Contact ${input.name} added to ${o.name}` });
    return c;
  });
}
export async function deleteContact(actor: Actor, id: string) {
  requirePerm(actor, "directory.edit");
  return tx(async (t) => {
    const c = await t.contact.findUnique({ where: { id } });
    if (!c) throw new NotFoundError("Contact");
    await t.contact.delete({ where: { id } });
    await audit(t, actor, { action: "contact.delete", entityType: "Organization", entityId: c.organizationId, summary: `Contact ${c.name} removed`, before: c });
  });
}

// ─────────────── Calendar ───────────────

export const eventSchema = z.object({
  title: zText(300),
  startsAt: zDateTime,
  endsAt: zDateTime,
  location: zOptText(300),
  notes: zOptText(),
  projectId: zOptId,
  attendeeIds: z.array(z.string()).default([]),
});

export async function saveEvent(actor: Actor, id: string | null, input: z.infer<typeof eventSchema>) {
  requirePerm(actor, "calendar.edit");
  if (input.endsAt <= input.startsAt) throw new UserError("The end time must be after the start time.");
  return tx(async (t) => {
    if (id) {
      const ev = await t.calendarEvent.findUnique({ where: { id } });
      if (!ev) throw new NotFoundError("Event");
      if (ev.createdById !== actor.id) requirePerm(actor, "admin.settings");
    }
    const { attendeeIds, ...data } = input;
    const ev = id
      ? await t.calendarEvent.update({ where: { id }, data: { ...data, attendees: { deleteMany: {}, create: attendeeIds.map((userId) => ({ userId })) } } })
      : await t.calendarEvent.create({ data: { ...data, createdById: actor.id, attendees: { create: [...new Set([actor.id, ...attendeeIds])].map((userId) => ({ userId })) } } });
    await audit(t, actor, { action: id ? "event.update" : "event.create", entityType: "CalendarEvent", entityId: ev.id, projectId: input.projectId, summary: `Meeting "${input.title}" ${id ? "updated" : "scheduled"} ${input.startsAt.toISOString().slice(0, 16).replace("T", " ")}` });
    await notifyUsers(t, attendeeIds, { type: "event.invite", title: `Meeting: ${input.title}`, body: input.startsAt.toLocaleString("en-CA", { timeZone: process.env.APP_TIMEZONE || "America/Toronto" }), link: `/calendar`, projectId: input.projectId }, actor.id);
    return ev;
  });
}

export async function deleteEvent(actor: Actor, id: string) {
  requirePerm(actor, "calendar.edit");
  return tx(async (t) => {
    const ev = await t.calendarEvent.findUnique({ where: { id } });
    if (!ev) throw new NotFoundError("Event");
    if (ev.createdById !== actor.id) requirePerm(actor, "admin.settings");
    await t.calendarEvent.delete({ where: { id } });
    await audit(t, actor, { action: "event.delete", entityType: "CalendarEvent", entityId: id, projectId: ev.projectId, summary: `Meeting "${ev.title}" cancelled`, before: ev });
  });
}

// ─────────────── Notifications ───────────────

export async function markNotificationsRead(actor: Actor, ids: string[] | "all") {
  await prisma.notification.updateMany({ where: { userId: actor.id, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) }, data: { readAt: new Date() } });
}
