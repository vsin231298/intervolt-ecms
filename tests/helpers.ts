import { execSync } from "child_process";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import type { Role } from "@prisma/client";

let migrated = false;
export async function resetDb() {
  if (!migrated) {
    execSync("npx prisma migrate deploy", { stdio: "ignore", env: process.env });
    migrated = true;
  }
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE bypasses row-level append-only triggers; acceptable for a disposable test DB only.
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} RESTART IDENTITY CASCADE`);
}

export async function makeUser(name: string, role: Role): Promise<Actor> {
  const u = await prisma.user.create({ data: { name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@test.local`, role, passwordHash: "x" } });
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

export const file = (name: string, type = "application/pdf", body = "%PDF-1.4 test file " + name) => ({ name, type, data: Buffer.from(body) });
