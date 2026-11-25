"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action";

type Props = {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** Close a surrounding <details> on success. */
  closeDetails?: boolean;
  showSuccess?: boolean;
  id?: string;
};

export function ActionForm({ action, children, className, resetOnSuccess = true, closeDetails = true, showSuccess = true, id }: Props) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && state.at) {
      if (resetOnSuccess) ref.current?.reset();
      if (closeDetails) ref.current?.closest("details")?.removeAttribute("open");
    }
  }, [state, resetOnSuccess, closeDetails]);
  return (
    <form ref={ref} action={formAction} className={className} id={id}>
      {children}
      {state.error ? (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {showSuccess && state.ok && state.message && state.message !== "Saved." ? (
        <p role="status" className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function Submit({ children, className = "btn btn-primary", pendingText = "Saving…", name, value, disabled }: { children: React.ReactNode; className?: string; pendingText?: string; name?: string; value?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}
