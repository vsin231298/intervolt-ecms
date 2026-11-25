import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runScheduledJobs } from "@/services/automation";

export const dynamic = "force-dynamic";

/** Reminder/notification sweep. Call from cron: POST with header "Authorization: Bearer $JOBS_SECRET". */
export async function POST(req: Request) {
  const secret = process.env.JOBS_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = secret.length >= 16 && got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const counts = await runScheduledJobs();
  return NextResponse.json({ ok: true, counts });
}
