import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { today } from "@/lib/dates";
import { Badge, Drawer, Empty, PageHeader } from "@/components/ui";
import { WorkerForm } from "@/components/WorkerForm";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; inactive?: string }> }) {
  const user = await requireUser("jobs.view");
  const sp = await searchParams;
  const t0 = today();
  const soon = new Date(t0.getTime() + 30 * 86_400_000);
  const [workers, users] = await Promise.all([
    prisma.worker.findMany({
      where: { ...(sp.inactive ? {} : { active: true }), ...(sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { trade: { contains: sp.q, mode: "insensitive" } }] } : {}) },
      include: { user: true, documents: { where: { expiresAt: { not: null } }, select: { expiresAt: true } }, assignments: { where: { date: t0 }, include: { project: { select: { number: true } } } } },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({ where: { active: true, worker: null }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Employees" subtitle="Profiles, certifications and documents" actions={can(user.role, "workers.edit") ? (
        <Drawer label="Add employee" className="btn btn-primary">
          <WorkerForm users={users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))} />
        </Drawer>
      ) : null} />
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Name or trade" className="input w-64" aria-label="Search" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inactive" value="1" defaultChecked={!!sp.inactive} /> Include inactive</label>
        <button className="btn btn-secondary">Search</button>
      </form>
      {workers.length === 0 ? <Empty>No employees yet.</Empty> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {workers.map((w) => {
            const expired = w.documents.filter((d) => d.expiresAt! < t0).length;
            const expiring = w.documents.filter((d) => d.expiresAt! >= t0 && d.expiresAt! <= soon).length;
            return (
              <Link key={w.id} href={`/people/${w.id}`} className="card block p-4 hover:border-brand-300">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-semibold">{w.name}</div><div className="text-sm text-slate-500">{w.trade}{w.licenceNo ? ` · ${w.licenceNo}` : ""}</div></div>
                  {!w.active ? <Badge>Inactive</Badge> : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-xs">
                  {w.assignments.length ? <Badge tone="blue">Today: {w.assignments.map((a) => a.project.number).join(", ")}</Badge> : <Badge>Not scheduled today</Badge>}
                  {w.user ? <Badge tone="green">Field app login</Badge> : null}
                  {expired ? <Badge tone="red">{expired} expired cert(s)</Badge> : null}
                  {expiring ? <Badge tone="amber">{expiring} expiring soon</Badge> : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
