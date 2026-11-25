import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { STAGE_LABELS } from "@/lib/workflow";
import { Card, Empty } from "@/components/ui";

export default async function ActivityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  await requireUser("jobs.view");
  const { id } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const size = 100;
  const [logs, total, stages] = await Promise.all([
    prisma.auditLog.findMany({ where: { projectId: id }, orderBy: { at: "desc" }, skip: (page - 1) * size, take: size, include: { user: { select: { name: true } } } }),
    prisma.auditLog.count({ where: { projectId: id } }),
    prisma.stageHistory.findMany({ where: { projectId: id }, orderBy: { at: "asc" }, }),
  ]);
  const people = await prisma.user.findMany({ where: { id: { in: stages.map((s) => s.byId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card title="Stage history">
        {stages.length === 0 ? <Empty>No stage changes.</Empty> : (
          <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
            {stages.map((s) => (
              <li key={s.id} className="text-sm">
                <div className="font-medium">{s.fromStage ? `${STAGE_LABELS[s.fromStage]} → ` : ""}{STAGE_LABELS[s.toStage]}</div>
                <div className="text-xs text-slate-500">{fmtDateTime(s.at)} · {people.find((p) => p.id === s.byId)?.name ?? "System"}</div>
                {s.note ? <div className="text-xs text-slate-600">{s.note}</div> : null}
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card title={`Audit trail (${total})`} className="xl:col-span-2" bodyClass="overflow-x-auto">
        {logs.length === 0 ? <div className="p-4"><Empty>No activity.</Empty></div> : (
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
            <tbody>{logs.map((l) => <tr key={l.id}><td className="whitespace-nowrap text-xs">{fmtDateTime(l.at)}</td><td className="text-xs">{l.user?.name ?? "System"}</td><td className="text-sm">{l.summary}<div className="font-mono text-[10px] text-slate-400">{l.action}</div></td></tr>)}</tbody>
          </table>
        )}
        {total > size ? (
          <div className="flex justify-between p-3 text-sm">
            {page > 1 ? <a className="link" href={`?page=${page - 1}`}>← Newer</a> : <span />}
            {page * size < total ? <a className="link" href={`?page=${page + 1}`}>Older →</a> : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
