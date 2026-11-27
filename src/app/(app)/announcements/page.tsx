import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { can, ROLE_LABELS } from "@/lib/rbac";
import { Card, Drawer, Empty, Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { myAnnouncements } from "@/services/team";
import { sendAnnouncementAction } from "@/app/actions/team";

export default async function AnnouncementsPage() {
  const user = await requireUser();
  const canSend = can(user.role, "labour.schedule");
  const [list, people] = await Promise.all([
    myAnnouncements(user),
    canSend ? prisma.user.findMany({ where: { active: true, id: { not: user.id } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const authors = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(list.map((a) => a.authorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Announcements</h1>
          <p className="text-sm text-slate-500">News from the office.</p>
        </div>
        {canSend ? (
          <Drawer label="Send announcement" className="btn btn-primary" wide>
            <ActionForm action={sendAnnouncementAction} className="space-y-3">
              <Field label="Send to *">
                <div className="space-y-1 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="audience" value="EVERYONE" defaultChecked /> Everyone</label>
                  <label className="flex items-center gap-2"><input type="radio" name="audience" value="FIELD" /> Field staff only</label>
                  <label className="flex items-center gap-2"><input type="radio" name="audience" value="OFFICE" /> Office staff only</label>
                  <label className="flex items-center gap-2"><input type="radio" name="audience" value="PEOPLE" /> Pick people:</label>
                  <div className="ml-6 grid max-h-48 grid-cols-2 gap-1 overflow-auto rounded border border-slate-200 p-2">
                    {people.map((p) => <label key={p.id} className="flex items-center gap-1.5"><input type="checkbox" name="userIds[]" value={p.id} /> {p.name} <span className="text-xs text-slate-400">{ROLE_LABELS[p.role]}</span></label>)}
                  </div>
                </div>
              </Field>
              <Field label="Title *"><input name="title" required className="input" placeholder="e.g. Office closed Dec 25 – 26" /></Field>
              <Field label="Message *"><textarea name="body" required rows={6} className="input" /></Field>
              <Submit>Send</Submit>
            </ActionForm>
          </Drawer>
        ) : null}
      </div>
      {list.length === 0 ? <Empty>No announcements yet.</Empty> : (
        <ul className="space-y-2">{list.map((a) => {
          const mine = a.recipients.find((r) => r.userId === user.id);
          const unread = mine && !mine.readAt;
          const read = a.recipients.filter((r) => r.readAt).length;
          return (
            <li key={a.id}>
              <Link href={`/announcements/${a.id}`} className={`card flex items-center gap-3 p-4 hover:bg-slate-50 ${unread ? "border-l-4 border-l-orange-500" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className={unread ? "font-bold" : "font-semibold"}>{a.title}</div>
                  <div className="truncate text-sm text-slate-600">{a.body}</div>
                  <div className="text-xs text-slate-500">{authors.get(a.authorId) ?? "Office"} · {fmtDateTime(a.createdAt)}{a.authorId === user.id ? ` · to ${a.audience} · ${read} of ${a.recipients.length} read` : ""}</div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </Link>
            </li>
          );
        })}</ul>
      )}
      {canSend && list.length ? <Card title="Tip"><p className="text-sm text-slate-600">Open one you sent to see who has read it.</p></Card> : null}
    </div>
  );
}
