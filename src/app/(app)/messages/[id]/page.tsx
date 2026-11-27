import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { openConversation } from "@/services/team";
import { sendMessageAction } from "@/app/actions/team";
import { ChatBox, AutoRefresh } from "@/components/Chat";

const when = (d: Date) => d.toLocaleString("en-US", { timeZone: process.env.APP_TIMEZONE || "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const c = await openConversation(user, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <AutoRefresh seconds={10} />
      <div className="flex items-center gap-2">
        <Link href="/messages" aria-label="Back" className="rounded p-1 text-slate-600 hover:bg-slate-100"><ChevronLeft className="h-5 w-5" /></Link>
        <div>
          <h1 className="text-lg font-semibold leading-tight">{c.title}</h1>
          {c.members.length > 2 ? <div className="text-xs text-slate-500">{c.members.map((m) => c.names.get(m.userId)?.split(" ")[0]).filter(Boolean).join(", ")}</div> : null}
        </div>
      </div>
      <div className="card min-h-[50vh] space-y-3 p-4">
        {c.messages.length === 0 ? <p className="text-sm text-slate-500">Say hello.</p> : c.messages.map((m) => {
          const mine = m.authorId === user.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-900"}`}>
                {!mine && c.members.length > 2 ? <div className="text-xs font-semibold text-slate-600">{c.names.get(m.authorId) ?? "Removed user"}</div> : null}
                <div className="whitespace-pre-line break-words">{m.body}</div>
                <div className={`mt-0.5 text-[11px] ${mine ? "text-white/70" : "text-slate-400"}`}>{when(m.createdAt)}</div>
              </div>
            </div>
          );
        })}
        <div id="end" />
      </div>
      <ChatBox action={sendMessageAction} conversationId={c.id} />
    </div>
  );
}
