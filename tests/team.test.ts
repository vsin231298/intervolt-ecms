/**
 * Draft → publish schedule, My week, time off, announcements and messages.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, today } from "@/lib/dates";
import { resetDb, makeUser } from "./helpers";
import * as projects from "@/services/projects";
import * as labour from "@/services/labour";
import * as team from "@/services/team";
import type { Actor } from "@/lib/actor";

let pm: Actor, jordan: Actor, andy: Actor, est: Actor;
let jobId: string, wJ: string, wA: string;

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  await resetDb();
  pm = await makeUser("Pat Manager", "PROJECT_MANAGER");
  est = await makeUser("Erin Estimator", "ESTIMATOR");
  jordan = await makeUser("Jordan Silva", "ELECTRICIAN");
  andy = await makeUser("Andy Morales", "ELECTRICIAN");
  wJ = (await labour.saveWorker(pm, null, labour.workerSchema.parse({ name: "Jordan Silva", trade: "Journeyperson", regularRate: 40, overtimeRate: 60, userId: jordan.id, active: true }))).id;
  wA = (await labour.saveWorker(pm, null, labour.workerSchema.parse({ name: "Andy Morales", trade: "Apprentice", regularRate: 25, overtimeRate: 37.5, userId: andy.id, active: true }))).id;
  const p = await projects.createDirectJob(pm, { jobType: "SMALL_JOB", name: "Riverside Condo", location: "100 River St", contractValue: 20000, clientPoNumber: "PO-1", projectManagerId: pm.id });
  jobId = p.id;
});

describe("schedule: draft then publish", () => {
  it("drafts are hidden; publishing sends one alert each; changes alert only the person affected", async () => {
    const t0 = today();
    await expect(labour.scheduleWorkers(pm, jobId, { workerIds: [wJ], fromDate: t0, toDate: t0, startTime: "08:00", endTime: "07:00", includeWeekends: true })).rejects.toThrow(/End time must be after/);
    const r = await labour.scheduleWorkers(pm, jobId, { workerIds: [wJ, wA], fromDate: t0, toDate: addDays(t0, 2), startTime: "07:30", endTime: "15:30", breakMin: 30, includeWeekends: true });
    expect(r.published).toBe(0);
    const a = await prisma.labourAssignment.findFirstOrThrow({ where: { workerId: wJ, date: t0 } });
    expect(Number(a.hours)).toBe(7.5);
    expect(a.publishedAt).toBeNull();
    expect((await labour.assignedJobs(jordan)).jobs.filter((j) => j.today)).toHaveLength(0);
    expect(await prisma.notification.count({ where: { userId: jordan.id } })).toBe(0);

    expect(await labour.publishSchedule(pm, t0, addDays(t0, 6))).toBe(6);
    const n = await prisma.notification.findMany({ where: { userId: jordan.id } });
    expect(n).toHaveLength(1);
    expect(n[0].title).toMatch(/^Your schedule for .* is out\.$/);
    expect((await labour.assignedJobs(jordan)).jobs.find((j) => j.today)?.startTime).toBe("07:30");
    const week = await labour.myWeek(wJ);
    expect(week[0].shifts[0].with).toEqual(["Andy"]);
    expect(week.filter((d) => d.shifts.length)).toHaveLength(3);

    // a future day is viewable but clock-in waits for the day
    const access = await labour.fieldViewAccess(jordan, jobId);
    expect(access.today).toBe(true);

    // change Jordan's day 2 only → only Jordan is told
    await labour.scheduleWorkers(pm, jobId, { workerIds: [wJ], fromDate: addDays(t0, 1), toDate: addDays(t0, 1), startTime: "09:00", endTime: "15:00", includeWeekends: true });
    expect(await labour.publishSchedule(pm, t0, addDays(t0, 6))).toBe(1);
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: jordan.id }, orderBy: { createdAt: "desc" } })).title).toMatch(/^Schedule changed: /);
    expect(await prisma.notification.count({ where: { userId: andy.id } })).toBe(1);
  });
});

describe("time off", () => {
  it("request → office sees clash → approve; shows as off in My week; can't double-book", async () => {
    const d2 = addDays(today(), 2);
    const o = await team.requestTimeOff(jordan, team.timeOffSchema.parse({ startDate: d2, reason: "Dentist" }));
    expect(o.status).toBe("PENDING");
    expect(await prisma.notification.count({ where: { userId: pm.id, type: "timeoff.request" } })).toBe(1);
    await expect(team.requestTimeOff(jordan, team.timeOffSchema.parse({ startDate: d2 }))).rejects.toThrow(/already asked/);
    expect((await team.clashes(wJ, o.startDate, o.endDate)).length).toBe(1);
    await expect(team.decideTimeOff(jordan, o.id, true)).rejects.toThrow();
    await team.decideTimeOff(pm, o.id, true);
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: jordan.id, type: "timeoff.decided" } })).title).toMatch(/approved/);
    expect((await labour.myWeek(wJ))[2].off?.id).toBe(o.id);
    // partial day booked by the office
    const p = await team.addTimeOff(pm, wA, team.timeOffSchema.parse({ startDate: addDays(today(), 3), partial: true, startTime: "09:00", endTime: "12:00" }));
    expect(p.status).toBe("APPROVED");
    expect(team.describeTimeOff(p)).toMatch(/09:00–12:00/);
    // cancel own pending
    const q = await team.requestTimeOff(andy, team.timeOffSchema.parse({ startDate: addDays(today(), 10), endDate: addDays(today(), 12) }));
    await expect(team.cancelTimeOff(jordan, q.id)).rejects.toThrow();
    await team.cancelTimeOff(andy, q.id);
  });
});

describe("announcements", () => {
  it("everyone / field staff / picked people; read receipts", async () => {
    const hello = team.announcementSchema.parse({ title: "Hello", body: "Test message", audience: "EVERYONE" });
    await expect(team.sendAnnouncement(jordan, hello)).rejects.toThrow(/permission/i);
    const a = await team.sendAnnouncement(pm, team.announcementSchema.parse({ title: "Office closed Dec 25", body: "Merry Christmas", audience: "FIELD" }));
    const r = await prisma.announcementRecipient.findMany({ where: { announcementId: a.id } });
    expect(r.map((x) => x.userId).sort()).toEqual([jordan.id, andy.id].sort());
    expect(await team.unreadAnnouncements(jordan.id)).toBe(1);
    await team.openAnnouncement(jordan, a.id);
    expect(await team.unreadAnnouncements(jordan.id)).toBe(0);
    await expect(team.openAnnouncement(est, a.id)).rejects.toThrow();
    const b = await team.sendAnnouncement(pm, team.announcementSchema.parse({ title: "Andy only", body: "Bring your harness", audience: "PEOPLE", userIds: [andy.id] }));
    expect((await team.myAnnouncements(jordan)).map((x) => x.id)).not.toContain(b.id);
  });
});

describe("messages", () => {
  it("private chat reuses the same conversation; one bell alert per unread chat; members only", async () => {
    const c = await team.startConversation(pm, [jordan.id]);
    expect((await team.startConversation(jordan, [pm.id])).id).toBe(c.id);
    await team.sendMessage(pm, c.id, "Can you pick up wire at the shop?");
    await team.sendMessage(pm, c.id, "2 boxes of 14/2");
    expect(await prisma.notification.count({ where: { userId: jordan.id, type: "message" } })).toBe(1);
    expect(await team.unreadConversations(jordan.id)).toBe(1);
    const open = await team.openConversation(jordan, c.id);
    expect(open.messages).toHaveLength(2);
    expect(await team.unreadConversations(jordan.id)).toBe(0);
    await team.sendMessage(jordan, c.id, "On it");
    await team.sendMessage(pm, c.id, "Thanks");
    expect(await team.unreadConversations(jordan.id)).toBe(1);
    await expect(team.openConversation(andy, c.id)).rejects.toThrow();
    await expect(team.sendMessage(andy, c.id, "hi")).rejects.toThrow();
    await expect(team.startConversation(pm, [jordan.id, andy.id])).rejects.toThrow(/Name the group/);
    const g = await team.startConversation(pm, [jordan.id, andy.id], "Riverside crew");
    expect(g.id).not.toBe(c.id);
  });
});
