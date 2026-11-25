/**
 * First-run setup: creates the first administrator account. Contains no sample data.
 *   ADMIN_EMAIL=you@intervolt.ca ADMIN_NAME="Your Name" ADMIN_PASSWORD='...' npm run db:setup
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.count();
  if (users > 0) {
    console.log(`Setup skipped: ${users} user(s) already exist. Manage users in Admin → Users & Roles.`);
    return;
  }
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || "Administrator";
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first administrator.");
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new Error("ADMIN_PASSWORD must be 10+ characters with letters and numbers.");
  await prisma.user.create({ data: { email, name, role: "ADMIN", passwordHash: await bcrypt.hash(password, 12) } });
  await prisma.auditLog.create({ data: { action: "setup", entityType: "User", entityId: email, summary: `Initial administrator ${email} created` } });
  console.log(`Administrator ${email} created. Sign in and add your team under Admin → Users & Roles.`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e.message ?? e);
  await prisma.$disconnect();
  process.exit(1);
});
