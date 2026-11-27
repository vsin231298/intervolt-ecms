import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { Badge, Card } from "@/components/ui";
import { DocList } from "@/components/DocList";
import { JOB_STATUSES } from "@/services/labour";
import { documentsFor } from "@/services/documents";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="py-2"><div className="text-xs text-slate-500">{label}</div><div className="text-sm">{children}</div></div>;
}

export function StatusBadge({ status }: { status: string | null }) {
  return status && status in JOB_STATUSES ? <Badge tone={status === "COMPLETE" ? "green" : "amber"}>{JOB_STATUSES[status as keyof typeof JOB_STATUSES]}</Badge> : <>—</>;
}

type Signoff = {
  id: string; workSummary: string; jobStatus: string | null; coWorkerIds: string[]; materialsUsed: unknown;
  parkingAmount: unknown; parkingReceiptDocId: string | null; customerName: string | null; signedAt: Date | null; signatureDocId: string | null;
  notes: { id: string; createdAt: Date; text: string }[];
};

/** The submitted work order (read-only) and its notes. Shared by the field and office views. */
export async function WorkOrderView({ s, submittedBy, footer, notesFooter }: { s: Signoff; submittedBy?: string; footer?: React.ReactNode; notesFooter?: React.ReactNode }) {
  const coWorkers = s.coWorkerIds.length ? await prisma.worker.findMany({ where: { id: { in: s.coWorkerIds } }, select: { name: true } }) : [];
  const materials = Array.isArray(s.materialsUsed) ? (s.materialsUsed as { item: string; quantity: string }[]) : [];
  const docs = await documentsFor("WorkOrderSignoff", s.id);
  const photos = docs.filter((d) => d.category === "Site photo" && d.versions[0]?.mimeType.startsWith("image/"));
  return (
    <>
      <Card title="Submitted">
        <div className="divide-y divide-slate-100">
          {submittedBy ? <Row label="Submitted by">{submittedBy}</Row> : null}
          <Row label="Work description"><span className="whitespace-pre-line">{s.workSummary}</span></Row>
          <Row label="Job status"><StatusBadge status={s.jobStatus} /></Row>
          <Row label="Co-worker(s)">{coWorkers.length ? coWorkers.map((w) => w.name).join(", ") : "None"}</Row>
          <Row label="Materials">{materials.length ? <ul>{materials.map((m, i) => <li key={i}>{m.quantity ? `${m.quantity} × ` : ""}{m.item}</li>)}</ul> : "None"}</Row>
          <Row label="Parking">{s.parkingAmount != null ? `$${Number(s.parkingAmount).toFixed(2)}${s.parkingReceiptDocId ? " (receipt)" : ""}` : "None"}</Row>
          <Row label="Customer">{s.customerName ?? "—"}{s.signedAt ? " · signed" : ""}</Row>
        </div>
        {photos.length ? (
          <div className="mt-3"><div className="mb-1 text-xs text-slate-500">Site photos</div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{photos.map((d) => (
              <a key={d.id} href={`/api/files/${d.versions[0].id}?inline=1`} target="_blank" rel="noreferrer"><img src={`/api/files/${d.versions[0].id}?inline=1`} alt={d.title} className="aspect-square w-full rounded-md border border-slate-200 object-cover" /></a>
            ))}</div>
          </div>
        ) : null}
        {docs.length ? <div className="mt-3"><div className="mb-1 text-xs text-slate-500">Files</div><DocList entityType="WorkOrderSignoff" entityId={s.id} /></div> : null}
        {footer}
      </Card>
      {s.notes.length || notesFooter ? (
        <Card title="Notes added later">
          {s.notes.length ? (
            <ul className="mb-3 space-y-2">{s.notes.map((n) => (
              <li key={n.id} className="rounded-md bg-amber-50 px-3 py-2 text-sm"><div className="text-xs text-slate-500">{fmtDateTime(n.createdAt)}</div><div className="whitespace-pre-line">{n.text}</div></li>
            ))}</ul>
          ) : <p className="text-sm text-slate-500">None.</p>}
          {notesFooter}
        </Card>
      ) : null}
    </>
  );
}
