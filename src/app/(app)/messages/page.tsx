import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { Empty } from "@/components/ui";
import { myConversations } from "@/services/team";

export default async function MessagesPage() {
  const user = await requireUser();
  const list = await myConversations(user);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Messages</h1>
          <p className="text-sm text-slate-500">Chat with the office and your co-workers.</p>
        </div>
        <Link href="/messages/new" className="btn btn-primary">New message</Link>
      </div>
      {list.length === 0 ? <Empty>No messages yet.</Empty> : (
        <ul className="card divide-y divide-slate-100">{list.map((c) => (
          <li key={c.id}>
            <Link href={`/messages/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-600">{c.group ? "👥" : c.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2"><span className={c.unread ? "font-bold" : "font-semibold"}>{c.name}</span>{c.last ? <span className="shrink-0 text-xs text-slate-400">{fmtDateTime(c.last.at)}</span> : null}</div>
                <div className={`truncate text-sm ${c.unread ? "text-slate-900" : "text-slate-500"}`}>{c.last ? `${c.last.mine ? "You: " : ""}${c.last.text}` : "No messages yet"}</div>
              </div>
              {c.unread ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-orange-500" aria-label="Unread" /> : null}
            </Link>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
