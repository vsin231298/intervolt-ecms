import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { Card, Empty, PageHeader, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { markReadAction } from "@/app/actions/admin";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const unreadOnly = sp.show !== "all";
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" subtitle={`${unread} unread`} actions={
        <div className="flex gap-2">
          <a className="btn btn-ghost" href={unreadOnly ? "/notifications?show=all" : "/notifications"}>{unreadOnly ? "Show all" : "Unread only"}</a>
          {unread ? <ActionForm action={markReadAction}><input type="hidden" name="all" value="1" /><Submit className="btn btn-secondary">Mark all read</Submit></ActionForm> : null}
        </div>
      } />
      <Card bodyClass="">
        {items.length === 0 ? <div className="p-6"><Empty>{unreadOnly ? "You're all caught up." : "No notifications yet."}</Empty></div> : (
          <ul className="divide-y divide-slate-100">
            {items.map((n) => (
              <li key={n.id} className={clsx("flex items-start gap-3 px-4 py-3", !n.readAt && "bg-brand-50/40")}>
                <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-500")} aria-hidden />
                <div className="min-w-0 flex-1">
                  {n.link ? <Link href={n.link} className="font-medium hover:text-brand-700">{n.title}</Link> : <span className="font-medium">{n.title}</span>}
                  {n.body ? <p className="text-sm text-slate-600">{n.body}</p> : null}
                  <div className="text-xs text-slate-400">{fmtDateTime(n.createdAt)}</div>
                </div>
                {!n.readAt ? <ActionForm action={markReadAction}><input type="hidden" name="id" value={n.id} /><Submit className="btn btn-ghost btn-sm" pendingText="…">Mark read</Submit></ActionForm> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
