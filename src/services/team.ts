import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma, tx } from "@/lib/db";
import { requirePerm, type Actor } from "@/lib/actor";
import { audit } from "@/lib/audit";
import { can } from "@/lib/rbac";
import { NotFoundError, UserError, assert } from "@/lib/errors";
import { addDays, today } from "@/lib/dates";
import { zDate, zOptText, zText } from "@/lib/forms";
import { notifyRoles, notifyUsers } from "@/lib/notify";

const day = (d: Date) => d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const span = (a: Date, b: Date) => (a.getTime() === b.getTime() ? day(a) : `${day(a)} – ${day(b)}`);
const dayCount = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
const hhmm = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{1,2}:\d{2}$/, "Enter a time like 09:00").optional());

// ─────────────── Time off ───────────────

export const timeOffSchema = z.object({
  startDate: zDate,
  endDate: zDate.optional(),
  partial: z.boolean().default(false),
  startTime: hhmm,
  endTime: hhmm,
  reason: zOptText(500),
});

function normalize(input: z.infer<typeof timeOffSchema>) {
  const end = input.partial ? input.startDate : (input.endDate ?? input.startDate);
  if (end < input.startDate) throw new UserError("End date is before start date.");
  if (dayCount(input.startDate, end) > 60) throw new UserError("At most 60 days at a time.");
  if (input.partial) {
    assert(input.startTime && input.endTime, "Enter the hours for a partial day.");
    assert(input.startTime! < input.endTime!.padStart(5, "0") || input.startTime!.padStart(5, "0") < input.endTime!.padStart(5, "0"), "End time must be after start time.");
  }
  return { startDate: input.startDate, endDate: end, startTime: input.partial ? input.startTime! : null, endTime: input.partial ? input.endTime! : null, reason: input.reason ?? null };
}

export function describeTimeOff(o: { startDate: Date; endDate: Date; startTime: string | null; endTime: string | null }) {
  if (o.startTime) return `${day(o.startDate)}, ${o.startTime}–${o.endTime}`;
  const n = dayCount(o.startDate, o.endDate);
  return `${span(o.startDate, o.endDate)} (${n} day${n === 1 ? "" : "s"})`;
}

/** Field staff ask for days off. The office is notified. */
export async function requestTimeOff(actor: Actor, input: z.infer<typeof timeOffSchema>) {
  requirePerm(actor, "field.use");
  const data = normalize(input);
  assert(data.startDate >= today(), "Pick today or a later day.");
  return tx(async (t) => {
    const w = await t.worker.findUnique({ where: { userId: actor.id } });
    assert(w && w.active, "Login not linked to an employee. Call office.");
    const overlap = await t.timeOff.findFirst({ where: { workerId: w.id, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: data.endDate }, endDate: { gte: data.startDate } } });
    assert(!overlap, "You already asked for some of these days.");
    const o = await t.timeOff.create({ data: { ...data, workerId: w.id, requestedById: actor.id } });
    await audit(t, actor, { action: "timeoff.request", entityType: "TimeOff", entityId: o.id, summary: `${w.name} asked for time off ${describeTimeOff(o)}` });
    await notifyRoles(t, ["ADMIN", "PROJECT_MANAGER"], { type: "timeoff.request", title: `Time-off request: ${w.name}`, body: `${describeTimeOff(o)}${data.reason ? ` · ${data.reason}` : ""}`, link: "/schedule?view=timeoff" }, actor.id);
    return o;
  });
}

export async function cancelTimeOff(actor: Actor, id: string) {
  requirePerm(actor, "field.use");
  return tx(async (t) => {
    const o = await t.timeOff.findUnique({ where: { id }, include: { worker: true } });
    if (!o || o.worker.userId !== actor.id) throw new NotFoundError("Request");
    assert(o.status === "PENDING", "Only a waiting request can be cancelled. Call office.");
    await t.timeOff.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(t, actor, { action: "timeoff.cancel", entityType: "TimeOff", entityId: id, summary: `${o.worker.name} cancelled time-off request ${describeTimeOff(o)}` });
  });
}

/** Office: approve or decline. The person gets an alert either way. */
export async function decideTimeOff(actor: Actor, id: string, approve: boolean, note?: string) {
  requirePerm(actor, "labour.schedule");
  return tx(async (t) => {
    const o = await t.timeOff.findUnique({ where: { id }, include: { worker: true } });
    if (!o) throw new NotFoundError("Request");
    assert(o.status === "PENDING", "Already answered.");
    const status = approve ? "APPROVED" : "DECLINED";
    await t.timeOff.update({ where: { id }, data: { status, decidedById: actor.id, decidedAt: new Date(), decisionNote: note?.trim() || null } });
    await audit(t, actor, { action: approve ? "timeoff.approve" : "timeoff.decline", entityType: "TimeOff", entityId: id, summary: `${o.worker.name} time off ${describeTimeOff(o)} ${approve ? "approved" : "declined"}` });
    if (o.worker.userId) await notifyUsers(t, [o.worker.userId], { type: "timeoff.decided", title: `Time off ${approve ? "approved" : "declined"}: ${describeTimeOff(o)}`, body: note?.trim() || undefined, link: "/time-off" }, actor.id);
  });
}

/** Office books time off for someone directly (approved). */
export async function addTimeOff(actor: Actor, workerId: string, input: z.infer<typeof timeOffSchema>) {
  requirePerm(actor, "labour.schedule");
  const data = normalize(input);
  return tx(async (t) => {
    const w = await t.worker.findUnique({ where: { id: workerId } });
    assert(w, "Pick an employee.");
    const o = await t.timeOff.create({ data: { ...data, workerId, requestedById: actor.id, status: "APPROVED", decidedById: actor.id, decidedAt: new Date() } });
    await audit(t, actor, { action: "timeoff.add", entityType: "TimeOff", entityId: o.id, summary: `Time off added for ${w.name}: ${describeTimeOff(o)}` });
    if (w.userId) await notifyUsers(t, [w.userId], { type: "timeoff.decided", title: `Time off booked: ${describeTimeOff(o)}`, body: data.reason ?? undefined, link: "/time-off" }, actor.id);
    return o;
  });
}

/** Shifts that clash with a time-off request (shown to the office next to the request). */
export async function clashes(workerId: string, start: Date, end: Date) {
  return prisma.labourAssignment.findMany({ where: { workerId, date: { gte: start, lte: end } }, include: { project: { select: { number: true, name: true } } }, orderBy: { date: "asc" } });
}

// ─────────────── Announcements ───────────────

export const AUDIENCES = { EVERYONE: "Everyone", FIELD: "Field staff", OFFICE: "Office staff", PEOPLE: "Pick people" } as const;
export const announcementSchema = z.object({
  title: zText(200).pipe(z.string().min(2, "Add a title")),
  body: zText(5000).pipe(z.string().min(2, "Write the message")),
  audience: z.enum(["EVERYONE", "FIELD", "OFFICE", "PEOPLE"]),
  userIds: z.array(z.string()).max(500).default([]),
});

const FIELD_ROLES: Role[] = ["ELECTRICIAN", "SITE_SUPERVISOR"];

export async function sendAnnouncement(actor: Actor, input: z.infer<typeof announcementSchema>) {
  requirePerm(actor, "labour.schedule");
  return tx(async (t) => {
    const users = await t.user.findMany({
      where: {
        active: true,
        ...(input.audience === "FIELD" ? { role: { in: FIELD_ROLES } } : input.audience === "OFFICE" ? { role: { notIn: FIELD_ROLES } } : input.audience === "PEOPLE" ? { id: { in: input.userIds } } : {}),
      },
      select: { id: true },
    });
    const ids = users.map((u) => u.id).filter((id) => id !== actor.id);
    assert(ids.length, "Pick at least one person.");
    const audience = input.audience === "PEOPLE" ? `${ids.length} ${ids.length === 1 ? "person" : "people"}` : AUDIENCES[input.audience];
    const a = await t.announcement.create({ data: { title: input.title, body: input.body, authorId: actor.id, audience, recipients: { create: ids.map((userId) => ({ userId })) } } });
    await notifyUsers(t, ids, { type: "announcement", title: `📢 ${input.title}`, body: input.body.slice(0, 200), link: `/announcements/${a.id}` }, actor.id);
    await audit(t, actor, { action: "announcement.send", entityType: "Announcement", entityId: a.id, summary: `Announcement "${input.title}" sent to ${audience}` });
    return a;
  });
}

/** Announcements sent to me (and, for senders, ones I sent). */
export async function myAnnouncements(actor: Actor) {
  const sender = can(actor.role, "labour.schedule");
  return prisma.announcement.findMany({
    where: sender ? { OR: [{ recipients: { some: { userId: actor.id } } }, { authorId: actor.id }] } : { recipients: { some: { userId: actor.id } } },
    include: { recipients: { select: { userId: true, readAt: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function openAnnouncement(actor: Actor, id: string) {
  const a = await prisma.announcement.findUnique({ where: { id }, include: { recipients: true } });
  const mine = a?.recipients.find((r) => r.userId === actor.id);
  if (!a || (!mine && a.authorId !== actor.id && !can(actor.role, "labour.schedule"))) throw new NotFoundError("Announcement");
  if (mine && !mine.readAt) await prisma.announcementRecipient.update({ where: { announcementId_userId: { announcementId: id, userId: actor.id } }, data: { readAt: new Date() } });
  return a;
}

export async function unreadAnnouncements(userId: string) {
  return prisma.announcementRecipient.count({ where: { userId, readAt: null } });
}

// ─────────────── Messages ───────────────

/** Open the private chat with someone (creating it the first time), or a new group chat. */
export async function startConversation(actor: Actor, userIds: string[], title?: string) {
  const others = [...new Set(userIds.filter((id) => id && id !== actor.id))];
  assert(others.length, "Pick who to message.");
  assert(others.length <= 50, "At most 50 people.");
  const found = await prisma.user.count({ where: { id: { in: others }, active: true } });
  assert(found === others.length, "Pick people from the list.");
  if (others.length === 1) {
    const existing = await prisma.conversation.findFirst({
      where: { title: null, members: { every: { userId: { in: [actor.id, others[0]] } } }, AND: [{ members: { some: { userId: actor.id } } }, { members: { some: { userId: others[0] } } }] },
    });
    if (existing) return existing;
  } else assert(title?.trim(), "Name the group.");
  return prisma.conversation.create({
    data: { title: others.length > 1 ? title!.trim().slice(0, 100) : null, createdById: actor.id, members: { create: [actor.id, ...others].map((userId) => ({ userId, lastReadAt: userId === actor.id ? new Date() : null })) } },
  });
}

async function memberOf(actor: Actor, conversationId: string) {
  const m = await prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: actor.id } } });
  if (!m) throw new NotFoundError("Conversation");
  return m;
}

export async function sendMessage(actor: Actor, conversationId: string, text: string) {
  await memberOf(actor, conversationId);
  const body = text.trim();
  assert(body.length, "Write a message.");
  assert(body.length <= 5000, "Message is too long.");
  return tx(async (t) => {
    const now = new Date();
    const m = await t.message.create({ data: { conversationId, authorId: actor.id, body } });
    await t.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
    await t.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: actor.id } }, data: { lastReadAt: now } });
    // One unread alert per chat: don't pile up a bell alert for every message.
    const members = await t.conversationMember.findMany({ where: { conversationId, userId: { not: actor.id } } });
    const conv = await t.conversation.findUnique({ where: { id: conversationId } });
    for (const mem of members) {
      const key = `msg:${conversationId}:${mem.userId}`;
      const n = { type: "message", title: conv?.title ? `${conv.title}: new message` : `Message from ${actor.name}`, body: `${actor.name}: ${body.slice(0, 160)}`, link: `/messages/${conversationId}` };
      await t.notification.upsert({ where: { userId_dedupeKey: { userId: mem.userId, dedupeKey: key } }, create: { ...n, userId: mem.userId, dedupeKey: key }, update: { ...n, readAt: null, createdAt: now } });
    }
    return m;
  });
}

export async function myConversations(actor: Actor) {
  const convs = await prisma.conversation.findMany({
    where: { members: { some: { userId: actor.id } } },
    include: { members: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  });
  const names = await userNames(convs.flatMap((c) => c.members.map((m) => m.userId)));
  return convs.map((c) => {
    const me = c.members.find((m) => m.userId === actor.id)!;
    const last = c.messages[0];
    return {
      id: c.id,
      name: c.title ?? c.members.filter((m) => m.userId !== actor.id).map((m) => names.get(m.userId) ?? "Removed user").join(", "),
      group: !!c.title,
      last: last ? { text: last.body, at: last.createdAt, mine: last.authorId === actor.id } : null,
      unread: !!last && last.authorId !== actor.id && (!me.lastReadAt || me.lastReadAt < last.createdAt),
    };
  });
}

export async function openConversation(actor: Actor, id: string) {
  await memberOf(actor, id);
  const c = await prisma.conversation.findUnique({ where: { id }, include: { members: true, messages: { orderBy: { createdAt: "asc" }, take: 500 } } });
  if (!c) throw new NotFoundError("Conversation");
  const now = new Date();
  await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: actor.id } }, data: { lastReadAt: now } });
  await prisma.notification.updateMany({ where: { userId: actor.id, dedupeKey: `msg:${id}:${actor.id}`, readAt: null }, data: { readAt: now } });
  const names = await userNames(c.members.map((m) => m.userId));
  return { ...c, names, title: c.title ?? c.members.filter((m) => m.userId !== actor.id).map((m) => names.get(m.userId) ?? "Removed user").join(", ") };
}

export async function unreadConversations(userId: string) {
  const mine = await prisma.conversationMember.findMany({ where: { userId }, include: { conversation: { select: { lastMessageAt: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { authorId: true } } } } } });
  return mine.filter((m) => m.conversation.messages[0] && m.conversation.messages[0].authorId !== userId && (!m.lastReadAt || m.lastReadAt < m.conversation.lastMessageAt)).length;
}

/** People you can message, with their trade and this week's jobs (like a team directory). */
export async function messageDirectory(actor: Actor) {
  const t0 = today();
  const users = await prisma.user.findMany({ where: { active: true, id: { not: actor.id } }, select: { id: true, name: true, role: true, worker: { select: { trade: true, assignments: { where: { date: { gte: t0, lte: addDays(t0, 6) }, publishedAt: { not: null } }, select: { project: { select: { location: true, name: true } } } } } } }, orderBy: { name: "asc" } });
  return users.map((u) => ({ id: u.id, name: u.name, role: u.role, trade: u.worker?.trade ?? null, sites: [...new Set(u.worker?.assignments.map((a) => a.project.location ?? a.project.name) ?? [])].join(", ") }));
}

async function userNames(ids: string[]) {
  const us = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(us.map((u) => [u.id, u.name]));
}
