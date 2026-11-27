import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { Badge, Card } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { DocList } from "@/components/DocList";
import { JOB_STATUSES, myWorkOrder } from "@/services/labour";
import { workOrderNoteAction } from "@/app/actions/labour";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="py-2"><div className="text-xs text-slate-500">{label}</div><div className="text-sm">{children}</div></div>;
}

/** One submitted work order, read-only. Only notes can be added. */
export default async function MyWorkOrder({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("field.use");
  const { id } = await params;
  const s = await myWorkOrder(user, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const coWorkers = s.coWorkerIds.length ? await prisma.worker.findMany({ where: { id: { in: s.coWorkerIds } }, select: { name: true } }) : [];
  const materials = Array.isArray(s.materialsUsed) ? (s.materialsUsed as { item: string; quantity: string }[]) : [];
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link href="/my-work-orders" className="flex items-center gap-1 text-sm text-slate-600"><ChevronLeft className="h-4 w-4" /> My Work Orders</Link>
      <div>
        <div className="text-xs text-slate-500"><span className="font-mono">{s.project.number}</span> · {fmtDateTime(s.createdAt)}</div>
        <h1 className="text-xl font-semibold">{s.project.name}</h1>
        {s.project.location ? <p className="text-sm text-slate-500">{s.project.location}</p> : null}
      </div>
      <Card title="Submitted">
        <div className="divide-y divide-slate-100">
          <Row label="Work description"><span className="whitespace-pre-line">{s.workSummary}</span></Row>
          <Row label="Job status">{s.jobStatus && s.jobStatus in JOB_STATUSES ? <Badge tone={s.jobStatus === "COMPLETE" ? "green" : "amber"}>{JOB_STATUSES[s.jobStatus as keyof typeof JOB_STATUSES]}</Badge> : "—"}</Row>
          <Row label="Co-worker(s)">{coWorkers.length ? coWorkers.map((w) => w.name).join(", ") : "None"}</Row>
          <Row label="Materials">{materials.length ? <ul>{materials.map((m, i) => <li key={i}>{m.quantity ? `${m.quantity} × ` : ""}{m.item}</li>)}</ul> : "None"}</Row>
          <Row label="Parking">{s.parkingAmount != null ? `$${Number(s.parkingAmount).toFixed(2)}${s.parkingReceiptDocId ? " (receipt)" : ""}` : "None"}</Row>
          <Row label="Customer">{s.customerName ?? "—"}{s.signedAt ? " · signed" : ""}</Row>
        </div>
        {s.signatureDocId || s.parkingReceiptDocId ? <div className="mt-2"><DocList entityType="WorkOrderSignoff" entityId={s.id} /></div> : null}
        <p className="mt-3 text-xs text-slate-400">Can&apos;t be changed. Add a note below.</p>
      </Card>
      <Card title="Notes">
        {s.notes.length ? (
          <ul className="mb-3 space-y-2">{s.notes.map((n) => (
            <li key={n.id} className="rounded-md bg-amber-50 px-3 py-2 text-sm"><div className="text-xs text-slate-500">{fmtDateTime(n.createdAt)}</div><div className="whitespace-pre-line">{n.text}</div></li>
          ))}</ul>
        ) : null}
        <ActionForm action={workOrderNoteAction} className="space-y-2">
          <input type="hidden" name="signoffId" value={s.id} />
          <textarea name="text" required rows={3} placeholder="Forgot something? Add it here." className="input" />
          <Submit className="btn btn-primary w-full">Add note</Submit>
        </ActionForm>
      </Card>
    </div>
  );
}
