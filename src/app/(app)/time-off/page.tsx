import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addDays, fmtDate, isoDate, today } from "@/lib/dates";
import { Badge, Card, Empty, Notice } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { TimeOffPicker } from "@/components/TimeOffPicker";
import { describeTimeOff } from "@/services/team";
import { cancelTimeOffAction, requestTimeOffAction } from "@/app/actions/team";

const STATUS: Record<string, { label: string; tone: "amber" | "green" | "red" | "gray" }> = {
  PENDING: { label: "Pending", tone: "amber" }, APPROVED: { label: "Approved", tone: "green" }, DECLINED: { label: "Declined", tone: "red" }, CANCELLED: { label: "Cancelled", tone: "gray" },
};

function eachDay(a: Date, b: Date) {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(isoDate(d));
  return out;
}

/** Field app: request days off on a calendar; see current and past requests. */
export default async function TimeOffPage() {
  const user = await requireUser("field.use");
  const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
  if (!worker) return <div className="mx-auto max-w-lg"><Notice tone="amber">Login not linked to an employee. Call office.</Notice></div>;
  const t0 = today();
  const [shifts, all] = await Promise.all([
    prisma.labourAssignment.findMany({ where: { workerId: worker.id, publishedAt: { not: null }, date: { gte: t0, lte: addDays(t0, 120) } }, select: { date: true } }),
    prisma.timeOff.findMany({ where: { workerId: worker.id }, orderBy: { startDate: "desc" }, take: 100 }),
  ]);
  const current = all.filter((o) => o.endDate >= t0 && o.status !== "CANCELLED").reverse();
  const past = all.filter((o) => !(o.endDate >= t0 && o.status !== "CANCELLED"));
  const Row = ({ o }: { o: (typeof all)[number] }) => (
    <li className="py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-slate-500">Time off</div>
        <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
      </div>
      <div className="font-semibold">{describeTimeOff(o)}</div>
      <div className="text-xs text-slate-500">{o.reason ? `${o.reason} · ` : ""}Sent {fmtDate(o.createdAt)}{o.decisionNote ? ` · Office: ${o.decisionNote}` : ""}</div>
      {o.status === "PENDING" ? <ActionForm action={cancelTimeOffAction} className="mt-1"><input type="hidden" name="id" value={o.id} /><Submit className="btn btn-ghost btn-sm text-red-700">Cancel request</Submit></ActionForm> : null}
    </li>
  );
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Time Off</h1>
        <p className="text-sm text-slate-500">Pick your days and send. The office approves or declines.</p>
      </div>
      <Card title="Request time off">
        <TimeOffPicker action={requestTimeOffAction} todayIso={isoDate(t0)} work={shifts.map((s) => isoDate(s.date))}
          requested={current.filter((o) => o.status === "PENDING").flatMap((o) => eachDay(o.startDate, o.endDate))}
          off={current.filter((o) => o.status === "APPROVED").flatMap((o) => eachDay(o.startDate, o.endDate))} />
      </Card>
      <Card title="My requests">
        {current.length === 0 ? <Empty>No current requests.</Empty> : <ul className="divide-y divide-slate-100">{current.map((o) => <Row key={o.id} o={o} />)}</ul>}
        {past.length ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-600">Past requests ({past.length})</summary>
            <ul className="divide-y divide-slate-100">{past.map((o) => <Row key={o.id} o={o} />)}</ul>
          </details>
        ) : null}
      </Card>
    </div>
  );
}
