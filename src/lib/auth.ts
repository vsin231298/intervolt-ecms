import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import type { Actor } from "./actor";
import { can, isFieldOnly, type Permission } from "./rbac";
import { cache } from "react";

const COOKIE = "iv_session";
const SESSION_DAYS = 14;
const MAX_FAILS = 6;
const FAIL_WINDOW_MIN = 15;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function login(email: string, password: string): Promise<{ ok: true; fieldOnly: boolean } | { ok: false; error: string }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const normalized = email.trim().toLowerCase();
  const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60_000);
  const fails = await prisma.loginAttempt.count({ where: { email: normalized, success: false, createdAt: { gte: since } } });
  if (fails >= MAX_FAILS) {
    return { ok: false, error: `Too many failed attempts. Try again in ${FAIL_WINDOW_MIN} minutes.` };
  }
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  const valid = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  await prisma.loginAttempt.create({ data: { email: normalized, ip, success: !!valid } });
  if (!valid || !user) return { ok: false, error: "Incorrect email or password." };

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({
    data: { id: hashToken(token), userId: user.id, expiresAt, ip, userAgent: h.get("user-agent")?.slice(0, 250) ?? null },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { ok: true, fieldOnly: isFieldOnly(user.role) };
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: hashToken(token) } });
  jar.delete(COOKIE);
}

export const currentUser = cache(async (): Promise<Actor | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { id: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  const u = session.user;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
});

/** For pages: redirect to login when signed out, or show 403 when lacking permission. */
export async function requireUser(perm?: Permission): Promise<Actor> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (perm && !can(user.role, perm)) redirect("/forbidden");
  return user;
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}
