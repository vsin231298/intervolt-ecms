"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Send } from "lucide-react";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Re-checks for new messages every few seconds while nobody is typing. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    document.getElementById("end")?.scrollIntoView({ block: "end" });
    const id = setInterval(() => {
      const typing = (document.activeElement as HTMLTextAreaElement | null)?.value;
      if (!typing && document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

function SendBtn() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} aria-label="Send" className="btn btn-primary h-11 w-11 shrink-0 p-0"><Send className="h-4 w-4" /></button>;
}

export function ChatBox({ action, conversationId }: { action: Action; conversationId: string }) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) { ref.current?.reset(); document.getElementById("end")?.scrollIntoView({ block: "end" }); }
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="sticky bottom-0 relative flex items-end gap-2 bg-slate-50 py-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <textarea name="body" required rows={1} placeholder="Type a message" className="input min-h-11 flex-1 resize-none"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
      <SendBtn />
      {state.error ? <p role="alert" className="absolute -top-6 text-xs text-red-700">{state.error}</p> : null}
    </form>
  );
}
