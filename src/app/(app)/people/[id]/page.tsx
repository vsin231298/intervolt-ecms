import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { addDays, fmtDate, isoDate, today } from "@/lib/dates";
import { money, qty, sum } from "@/lib/money";
import { Card, DL, Drawer, Empty, Field, PageHeader, StatusBadge, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { WorkerForm } from "@/components/WorkerForm";
import { fileSize } from "@/components/DocList";
import { uploadAction } from "@/app/actions/documents";

const CERTS = ["Certificate of Qualification (309A)", "Working at Heights", "WHMIS", "First Aid / CPR", "Arc Flash (CSA Z462)", "Lockout / Tagout", "Elevating Work Platform", "Driver's licence", "Other certification"];

export default async function WorkerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const t0 = today();
  const w = await prisma.worker.findUnique({
    where: { id },
    include: {
      user: true,
      documents: { include: { versions: { orderBy: { revision: "desc" }, take: 1 } }, orderBy: { category: "asc" } },
      assignments: { where: { date: { gte: t0, lt: addDays(t0, 14) } }, include: { project: { select: { id: true, number: true, name: true } } }, orderBy: { date: "asc" } },
      timeEntries: { where: { date: { gte: addDays(t0, -30) } }, include: { project: { select: { id: true, number: true } } }, orderBy: { date: "desc" } },
    },
  });
  if (!w) notFound();
  const r = user.role;
  const canEdit = can(r, "workers.edit");
  const canDocs = can(r, "company.documents") && can(r, "documents.upload");
  const showRates = can(r, "financials.view") || canEdit;
  const users = canEdit ? await prisma.user.findMany({ where: { active: true, OR: [{ worker: null }, { id: w.userId ?? "" }] }, orderBy: { name: "asc" } }) : [];

  return (
    <div className="space-y-6">
      <PageHeader title={w.name} subtitle={`${w.trade}${w.active ? "" : " · inactive"}`} crumbs={[{ href: "/people", label: "Employees" }]} actions={canEdit ? (
        <Drawer label="Edit profile" className="btn btn-secondary" wide><WorkerForm worker={w} users={users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))} /></Drawer>
      ) : null} />
      <Card>
        <DL cols={4} items={[
          ["Licence / C of Q", w.licenceNo ?? "—"],
          ["Phone", w.phone ? <a key="p" className="link" href={`tel:${w.phone}`}>{w.phone}</a> : "—"],
          ["Field app login", w.user ? `${w.user.email} (${w.user.role.replace(/_/g, " ").toLowerCase()})` : "None"],
          ["Rates", showRates ? `${money(w.regularRate)}/h · OT ${money(w.overtimeRate)}/h` : "—"],
        ]} />
      </Card>

      <Card title="Certifications & documents" bodyClass="overflow-x-auto" actions={canDocs ? (
        <Drawer label="Upload certificate" className="btn btn-primary btn-sm">
          <ActionForm action={uploadAction} className="space-y-3">
            <input type="hidden" name="workerId" value={w.id} /><input type="hidden" name="module" value="EMPLOYEE" />
            <Field label="Type *"><select name="category" className="input">{CERTS.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Title"><input name="title" className="input" placeholder="Defaults to the file name" /></Field>
            <Field label="Expiry date"><input type="date" name="expiresAt" className="input" /></Field>
            <Field label="File *"><input type="file" name="files" required className="text-sm" /></Field>
            <Submit>Upload</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {w.documents.length === 0 ? <div className="p-4"><Empty>No certifications on file.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Document</th><th>Type</th><th>Expiry</th><th>File</th>{canDocs ? <th></th> : null}</tr></thead>
            <tbody>
              {w.documents.map((doc) => {
                const v = doc.versions[0];
                const expired = doc.expiresAt && doc.expiresAt < t0;
                const soon = doc.expiresAt && !expired && doc.expiresAt < addDays(t0, 30);
                return (
                  <tr key={doc.id}>
                    <td>{doc.title}</td>
                    <td className="text-xs">{doc.category}</td>
                    <td className={clsx(expired ? "font-semibold text-red-600" : soon && "font-semibold text-amber-700")}>{fmtDate(doc.expiresAt)}{expired ? " (expired)" : soon ? " (soon)" : ""}</td>
                    <td className="text-xs">{v ? <a className="link" href={`/api/files/${v.id}?inline=1`} target="_blank" rel="noreferrer">rev {v.revision} · {fileSize(v.sizeBytes)}</a> : "—"}</td>
                    {canDocs ? (
                      <td>
                        <Drawer label="Renew" className="btn btn-ghost btn-sm">
                          <ActionForm action={uploadAction} className="space-y-2">
                            <input type="hidden" name="documentId" value={doc.id} /><input type="hidden" name="workerId" value={w.id} /><input type="hidden" name="module" value="EMPLOYEE" /><input type="hidden" name="category" value={doc.category} />
                            <Field label="New expiry date"><input type="date" name="expiresAt" className="input" /></Field>
                            <Field label="Renewed certificate *"><input type="file" name="files" required className="text-sm" /></Field>
                            <Submit>Upload new revision</Submit>
                          </ActionForm>
                        </Drawer>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Schedule (next 2 weeks)">
          {w.assignments.length === 0 ? <Empty>Not scheduled.</Empty> : <ul className="space-y-1 text-sm">{w.assignments.map((a) => <li key={a.id}><b>{fmtDate(a.date)}</b> · <Link className="link" href={`/jobs/${a.project.id}/labour`}>{a.project.number}</Link> {a.project.name} · {qty(a.hours)}h</li>)}</ul>}
        </Card>
        <Card title="Hours, last 30 days" bodyClass="overflow-x-auto">
          {w.timeEntries.length === 0 ? <div className="p-4"><Empty>No time recorded.</Empty></div> : (
            <>
              <div className="px-4 pt-3 text-sm">{qty(sum(w.timeEntries.map((e) => e.regularHours)))} regular + {qty(sum(w.timeEntries.map((e) => e.overtimeHours)))} overtime hours. <Link className="link" href={`/timesheets?worker=${w.id}&from=${isoDate(addDays(t0, -30))}`}>Open in timesheets</Link></div>
              <table className="table">
                <thead><tr><th>Date</th><th>Job</th><th className="num">Reg</th><th className="num">OT</th><th>Status</th></tr></thead>
                <tbody>{w.timeEntries.map((e) => <tr key={e.id}><td>{fmtDate(e.date)}</td><td><Link className="link font-mono text-xs" href={`/jobs/${e.project.id}/labour`}>{e.project.number}</Link></td><td className="num">{qty(e.regularHours)}</td><td className="num">{qty(e.overtimeHours)}</td><td><StatusBadge status={e.approvedAt ? "APPROVED" : "PENDING"} /></td></tr>)}</tbody>
              </table>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
