import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addDays, fmtDateTime, isoDate, parseDate, today } from "@/lib/dates";
import { Card, Empty, Field, PageHeader } from "@/components/ui";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; user?: string; from?: string; to?: string; page?: string }> }) {
  await requireUser("admin.audit");
  const sp = await searchParams;
  const t0 = today();
  const from = parseDate(sp.from ?? "") ?? addDays(t0, -30);
  const to = parseDate(sp.to ?? "") ?? t0;
  const page = Math.max(1, Number(sp.page) || 1);
  const size = 100;
  const where = {
    at: { gte: from, lt: addDays(to, 1) },
    ...(sp.user ? { userId: sp.user } : {}),
    ...(sp.q ? { OR: [{ summary: { contains: sp.q, mode: "insensitive" as const } }, { action: { contains: sp.q, mode: "insensitive" as const } }] } : {}),
  };
  const [logs, total, users] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * size, take: size, include: { user: { select: { name: true } } } }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const projects = await prisma.project.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.projectId).filter((x): x is string => !!x))] } }, select: { id: true, number: true } });
  const projectOf = (pid: string | null) => projects.find((p) => p.id === pid);
  const qs = (p: number) => `/admin/audit?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.user ? { user: sp.user } : {}), from: isoDate(from), to: isoDate(to), page: String(p) })}`;
  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" subtitle="Append-only record of every change, approval, download and login. It cannot be edited or deleted." />
      <form className="card flex flex-wrap items-end gap-3 p-4">
        <Field label="Search"><input name="q" defaultValue={sp.q} className="input w-64" placeholder="WO #, action, text…" /></Field>
        <Field label="User"><select name="user" defaultValue={sp.user ?? ""} className="input w-48"><option value="">Everyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="From"><input type="date" name="from" defaultValue={isoDate(from)} className="input" /></Field>
        <Field label="To"><input type="date" name="to" defaultValue={isoDate(to)} className="input" /></Field>
        <button className="btn btn-secondary">Filter</button>
      </form>
      <Card title={`${total} entr${total === 1 ? "y" : "ies"}`} bodyClass="overflow-x-auto">
        {logs.length === 0 ? <div className="p-4"><Empty>No entries.</Empty></div> : (
          <table className="table">
            <thead><tr><th>When</th><th>User</th><th>Job</th><th>What</th><th>Details</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(l.at)}</td>
                  <td className="text-xs">{l.user?.name ?? "System"}</td>
                  <td className="text-xs">{projectOf(l.projectId) ? <Link className="link font-mono" href={`/jobs/${l.projectId}/activity`}>{projectOf(l.projectId)!.number}</Link> : "—"}</td>
                  <td className="text-sm">{l.summary}<div className="font-mono text-[10px] text-slate-400">{l.action}</div></td>
                  <td>
                    {l.before || l.after ? (
                      <details className="text-xs"><summary className="cursor-pointer text-slate-500">Before / after</summary>
                        <pre className="mt-1 max-h-60 max-w-xl overflow-auto rounded bg-slate-50 p-2 text-[10px]">{JSON.stringify({ before: l.before, after: l.after }, null, 2)}</pre>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {total > size ? (
          <div className="flex justify-between p-3 text-sm">
            {page > 1 ? <a className="link" href={qs(page - 1)}>← Newer</a> : <span />}
            <span className="text-slate-500">Page {page} of {Math.ceil(total / size)}</span>
            {page * size < total ? <a className="link" href={qs(page + 1)}>Older →</a> : <span />}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
