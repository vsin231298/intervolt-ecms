import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { ActionForm, Submit } from "@/components/ActionForm";
import { WorkOrderView } from "@/components/WorkOrderView";
import { myWorkOrder } from "@/services/labour";
import { workOrderNoteAction } from "@/app/actions/labour";

/** One submitted work order, read-only. Only notes can be added. */
export default async function MyWorkOrder({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("field.use");
  const { id } = await params;
  const s = await myWorkOrder(user, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link href="/my-work-orders" className="flex items-center gap-1 text-sm text-slate-600"><ChevronLeft className="h-4 w-4" /> My Work Orders</Link>
      <div>
        <div className="text-xs text-slate-500">{fmtDateTime(s.createdAt)}</div>
        <h1 className="text-xl font-semibold">{s.project.name}</h1>
        {s.project.location ? <p className="text-sm text-slate-500">{s.project.location}</p> : null}
      </div>
      <WorkOrderView
        s={s}
        footer={<p className="mt-3 text-xs text-slate-400">Can&apos;t be changed. Add a note below.</p>}
        notesFooter={
          <ActionForm action={workOrderNoteAction} className="space-y-2">
            <input type="hidden" name="signoffId" value={s.id} />
            <textarea name="text" required rows={3} placeholder="Forgot something? Add it here." className="input" />
            <Submit className="btn btn-primary w-full">Add note</Submit>
          </ActionForm>
        }
      />
    </div>
  );
}
