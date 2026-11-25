import Link from "next/link";
import type { Prisma, ProjectStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { money } from "@/lib/money";
import { CLOSE_REASON_LABELS, JOB_TYPE_LABELS, LEAD_STAGES, STAGE_LABELS } from "@/lib/workflow";
import { Badge, Empty, SortTh, StatusBadge } from "@/components/ui";

export type SP = { q?: string; type?: string; status?: string; stage?: string; pm?: string; sort?: string; dir?: string; filter?: string };

const STATUS_FILTERS: Record<string, Prisma.ProjectWhereInput> = {
  active: { stage: { in: ["ACTIVATION", "EXECUTION", "CLOSEOUT"] } },
  tenders: { stage: { in: LEAD_STAGES } },
  submitted: { stage: "SUBMITTED" },
  completed: { stage: "CLOSED", closeReason: "COMPLETED" },
  cancelled: { stage: "CLOSED", closeReason: "CANCELLED" },
  lost: { stage: "CLOSED", closeReason: { in: ["LOST_BID", "NOT_DOABLE"] } },
  closed: { stage: "CLOSED" },
};

export async function JobsTable({ sp, basePath, leadsOnly }: { sp: SP; basePath: string; leadsOnly?: boolean }) {
  const where: Prisma.ProjectWhereInput = { AND: [] };
  const and = where.AND as Prisma.ProjectWhereInput[];
  if (leadsOnly) and.push({ jobType: "PROJECT", OR: [{ stage: { in: LEAD_STAGES } }, { stage: "CLOSED", closeReason: { in: ["NOT_DOABLE", "LOST_BID"] } }] });
  if (sp.q) and.push({ OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { number: { contains: sp.q, mode: "insensitive" } }, { location: { contains: sp.q, mode: "insensitive" } }, { client: { name: { contains: sp.q, mode: "insensitive" } } }, { clientProjectNo: { contains: sp.q, mode: "insensitive" } }] });
  if (sp.type) and.push({ jobType: sp.type as never });
  if (sp.status && STATUS_FILTERS[sp.status]) and.push(STATUS_FILTERS[sp.status]);
  if (sp.stage === "new") and.push({ stage: { in: ["OPPORTUNITY", "UNDER_REVIEW"] } });
  else if (sp.stage === "pricing") and.push({ stage: { in: ["ESTIMATING", "QUOTING", "READY_TO_SUBMIT"] } });
  else if (sp.stage) and.push({ stage: sp.stage as ProjectStage });
  if (sp.pm) and.push({ OR: [{ projectManagerId: sp.pm }, { estimatorId: sp.pm }] });
  if (sp.filter === "issues") and.push({ fieldUpdates: { some: { kind: "ISSUE", resolvedAt: null } } });
  const dir = sp.dir === "asc" ? "asc" : "desc";
  const orderBy: Prisma.ProjectOrderByWithRelationInput =
    sp.sort === "name" ? { name: dir } : sp.sort === "number" ? { number: dir } : sp.sort === "deadline" ? { submissionDeadline: { sort: dir, nulls: "last" } } : sp.sort === "value" ? { estimatedValue: { sort: dir, nulls: "last" } } : sp.sort === "client" ? { client: { name: dir } } : sp.sort === "stage" ? { stage: dir } : { updatedAt: "desc" };
  const [rows, users] = await Promise.all([
    prisma.project.findMany({ where, orderBy, take: 500, include: { client: true, projectManager: true, estimator: true, contract: true } }),
    prisma.user.findMany({ where: { role: { in: ["PROJECT_MANAGER", "ESTIMATOR", "ADMIN"] }, active: true }, orderBy: { name: "asc" } }),
  ]);
  const params = Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>;
  return (
    <div className="card">
      <form className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3" action={basePath}>
        <input name="q" defaultValue={sp.q} placeholder="Search name, WO #, client, location…" className="input w-64" />
        {!leadsOnly ? (
          <select name="type" defaultValue={sp.type ?? ""} className="input w-44">
            <option value="">All job types</option>
            {Object.entries(JOB_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        ) : null}
        <select name="status" defaultValue={sp.status ?? ""} className="input w-44">
          <option value="">{leadsOnly ? "All leads" : "All statuses"}</option>
          {!leadsOnly ? <option value="active">Active jobs</option> : null}
          <option value="tenders">Open tenders</option>
          <option value="submitted">Submitted tenders</option>
          {!leadsOnly ? <option value="completed">Completed</option> : null}
          {!leadsOnly ? <option value="cancelled">Cancelled</option> : null}
          <option value="lost">Lost / not doable</option>
          {!leadsOnly ? <option value="closed">All closed</option> : null}
        </select>
        <select name="stage" defaultValue={sp.stage ?? ""} className="input w-44">
          <option value="">Any stage</option>
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="pm" defaultValue={sp.pm ?? ""} className="input w-44">
          <option value="">Any PM / estimator</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button className="btn btn-secondary">Filter</button>
        <Link href={basePath} className="btn btn-ghost">Clear</Link>
        <span className="ml-auto text-xs text-slate-500">{rows.length} result{rows.length === 1 ? "" : "s"}</span>
      </form>
      <div className="overflow-x-auto">
        {rows.length === 0 ? <div className="p-4"><Empty>No jobs match these filters.</Empty></div> : (
          <table className="table">
            <thead>
              <tr>
                <SortTh label="WO #" k="number" params={params} />
                <SortTh label="Name" k="name" params={params} />
                <th>Type</th>
                <SortTh label="Client" k="client" params={params} />
                <SortTh label="Stage" k="stage" params={params} />
                <th>{leadsOnly ? "Estimator" : "PM / Estimator"}</th>
                <SortTh label={leadsOnly ? "Deadline" : "Deadline"} k="deadline" params={params} />
                <SortTh label="Value" k="value" params={params} className="num" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const overdue = p.submissionDeadline && p.submissionDeadline < new Date() && LEAD_STAGES.includes(p.stage) && p.stage !== "SUBMITTED";
                return (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap font-mono text-xs"><Link className="link" href={`/jobs/${p.id}`}>{p.number}</Link></td>
                    <td><Link href={`/jobs/${p.id}`} className="font-medium hover:text-brand-700">{p.name}</Link>{p.location ? <div className="text-xs text-slate-500">{p.location}</div> : null}</td>
                    <td><Badge>{JOB_TYPE_LABELS[p.jobType]}</Badge></td>
                    <td>{p.client?.name ?? "—"}</td>
                    <td><StatusBadge status={p.stage === "CLOSED" && p.closeReason ? p.closeReason : p.stage} label={p.stage === "CLOSED" && p.closeReason ? `Closed · ${CLOSE_REASON_LABELS[p.closeReason]}` : STAGE_LABELS[p.stage]} /></td>
                    <td className="text-xs">{p.projectManager?.name ?? "—"}{p.estimator ? <div className="text-slate-500">Est: {p.estimator.name}</div> : null}</td>
                    <td className={`whitespace-nowrap text-xs ${overdue ? "font-semibold text-red-600" : ""}`}>{p.submissionDeadline ? fmtDate(p.submissionDeadline) : p.finishDate ? `Finish ${fmtDate(p.finishDate)}` : "—"}</td>
                    <td className="num whitespace-nowrap">{p.contract ? money(p.contract.currentValue) : p.estimatedValue ? <span className="text-slate-500">~{money(p.estimatedValue)}</span> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
