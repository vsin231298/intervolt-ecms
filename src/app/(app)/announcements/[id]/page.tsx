import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { Card } from "@/components/ui";
import { openAnnouncement } from "@/services/team";

export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const a = await openAnnouncement(user, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const ids = [a.authorId, ...a.recipients.map((r) => r.userId)];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const showReads = a.authorId === user.id || user.role === "ADMIN";
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/announcements" className="flex items-center gap-1 text-sm text-slate-600"><ChevronLeft className="h-4 w-4" /> Announcements</Link>
      <Card>
        <div className="text-xs text-slate-500">{names.get(a.authorId) ?? "Office"} · {fmtDateTime(a.createdAt)}</div>
        <h1 className="mt-1 text-xl font-semibold">{a.title}</h1>
        <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{a.body}</p>
      </Card>
      {showReads ? (
        <Card title={`Sent to ${a.audience} · ${a.recipients.filter((r) => r.readAt).length} of ${a.recipients.length} read`}>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">{a.recipients.map((r) => (
            <li key={r.userId} className="flex justify-between gap-2"><span>{names.get(r.userId) ?? "Removed user"}</span><span className={r.readAt ? "text-emerald-700" : "text-slate-400"}>{r.readAt ? `Read ${fmtDateTime(r.readAt)}` : "Not read"}</span></li>
          ))}</ul>
        </Card>
      ) : null}
    </div>
  );
}
