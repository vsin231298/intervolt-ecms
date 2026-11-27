import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { Card, Notice } from "@/components/ui";
import { WorkOrderForm } from "@/components/WorkOrderForm";
import { myWorkOrderRequest, workerForUser } from "@/services/labour";

const day = (d: Date) => d.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

/** Field: fill in a work order the office asked for. */
export default async function RequestedWorkOrder({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("field.use");
  const { id } = await params;
  const r = await myWorkOrderRequest(user, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const worker = await workerForUser(user.id);
  // co-workers: whoever clocked in on this job that day comes first, ticked
  const dayStart = new Date(r.date.getTime() - 6 * 3_600_000), dayEnd = new Date(r.date.getTime() + 30 * 3_600_000);
  const [crew, all, materials, asker] = await Promise.all([
    prisma.clockEntry.findMany({ where: { projectId: r.projectId, clockInAt: { gte: dayStart, lt: dayEnd }, ...(worker ? { workerId: { not: worker.id } } : {}) }, select: { workerId: true } }),
    prisma.worker.findMany({ where: { active: true, ...(worker ? { id: { not: worker.id } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.materialItem.findMany({ where: { projectId: r.projectId }, select: { description: true }, orderBy: { description: "asc" } }),
    prisma.user.findUnique({ where: { id: r.requestedById }, select: { name: true } }),
  ]);
  const crewIds = [...new Set(crew.map((c) => c.workerId))];
  const coWorkers = [...all.filter((w) => crewIds.includes(w.id)), ...all.filter((w) => !crewIds.includes(w.id))];
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link href="/field" className="flex items-center gap-1 text-sm text-slate-600"><ChevronLeft className="h-4 w-4" /> Field App</Link>
      <div>
        <h1 className="text-xl font-semibold">{r.project.name}</h1>
        {r.project.location ? <p className="text-sm text-slate-500">{r.project.location}</p> : null}
      </div>
      {r.doneAt ? <Notice tone="green">Done. Thanks.</Notice> : r.cancelledAt ? <Notice tone="blue">Office cancelled this. Nothing to do.</Notice> : (
        <>
          <Notice tone="amber"><b>Office needs your work order for {day(r.date)}.</b>{r.note ? <div className="mt-1">{r.note}</div> : null}<div className="mt-1 text-xs">Asked by {asker?.name ?? "office"}</div></Notice>
          <Card title="Work order">
            <WorkOrderForm projectId={r.projectId} requestId={r.id} coWorkers={coWorkers} crewIds={crewIds} suggestions={materials.map((m) => m.description)} submitLabel="Send work order" />
          </Card>
        </>
      )}
    </div>
  );
}
