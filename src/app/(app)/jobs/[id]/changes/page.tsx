import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, isoDate, isoDateTimeLocal, today } from "@/lib/dates";
import { d, money, sum } from "@/lib/money";
import { userOptions } from "@/lib/lookups";
import { Card, Drawer, Empty, Field, Options, Stat, StatusBadge, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { DocList } from "@/components/DocList";
import { createCoAction, createRfiAction, esiAction, esiDecideAction, rfiResponseAction, rfiSentAction } from "@/app/actions/changes";

export default async function ChangesPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const [rfis, esis, cos, contract, users, project] = await Promise.all([
    prisma.rfi.findMany({ where: { projectId: id }, include: { changeOrders: true }, orderBy: { number: "desc" } }),
    prisma.esi.findMany({ where: { projectId: id }, include: { changeOrders: true }, orderBy: { receivedAt: "desc" } }),
    prisma.changeOrder.findMany({ where: { projectId: id }, include: { invoices: true }, orderBy: { number: "desc" } }),
    prisma.contract.findUnique({ where: { projectId: id }, include: { changes: { orderBy: { at: "asc" } } } }),
    userOptions(),
    prisma.project.findUniqueOrThrow({ where: { id } }),
  ]);
  const r = user.role;
  const showMoney = can(r, "financials.view") || can(r, "change.edit");
  const live = ["ACTIVATION", "EXECUTION", "CLOSEOUT"].includes(project.stage);
  const t0 = today();
  const nameOf = (uid: string | null) => users.find((u) => u.value === uid)?.label ?? "—";
  const approvedTotal = sum(cos.filter((c) => c.status === "APPROVED").map((c) => c.approvedAmount ?? 0));
  const pendingTotal = sum(cos.filter((c) => c.status === "SUBMITTED").map((c) => c.proposedAmount));

  return (
    <div className="space-y-6">
      {showMoney && contract ? (
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Original contract (locked)" value={money(contract.originalValue)} />
          <Stat label="Approved changes" value={money(approvedTotal)} sub={`${cos.filter((c) => c.status === "APPROVED").length} CO(s)`} />
          <Stat label="Revised contract" value={money(contract.currentValue)} />
          <Stat label="Pending client approval" value={money(pendingTotal)} sub={`${cos.filter((c) => c.status === "SUBMITTED").length} submitted`} tone={pendingTotal.greaterThan(0) ? "amber" : undefined} />
        </div>
      ) : null}

      <Card title="Change orders" bodyClass="overflow-x-auto" actions={live && can(r, "change.edit") ? (
        <Drawer label="New change order" className="btn btn-primary btn-sm" wide>
          <ActionForm action={createCoAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <Field label="Title *"><input name="title" required className="input" /></Field>
            <Field label="Scope of change *"><textarea name="description" required rows={3} className="input" /></Field>
            <Field label="Reason *"><input name="reason" required className="input" placeholder="Client request, site condition, design change…" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From RFI"><select name="rfiId" className="input"><Options items={rfis.map((x) => ({ value: x.id, label: `${x.number} ${x.subject}` }))} empty="—" /></select></Field>
              <Field label="From ESI"><select name="esiId" className="input"><Options items={esis.map((x) => ({ value: x.id, label: `${x.number}` }))} empty="—" /></select></Field>
            </div>
            <Submit>Create draft and price it</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {cos.length === 0 ? <div className="p-4"><Empty>No change orders.</Empty></div> : (
          <table className="table">
            <thead><tr><th>CO #</th><th>Title</th><th>Status</th><th>Submitted</th><th>Decided</th>{showMoney ? <><th className="num">Proposed</th><th className="num">Approved</th></> : null}<th>Client PO</th><th>Invoiced</th></tr></thead>
            <tbody>
              {cos.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs"><Link className="link" href={`/jobs/${id}/changes/${c.id}`}>{c.number}</Link></td>
                  <td><Link className="hover:text-brand-700" href={`/jobs/${id}/changes/${c.id}`}>{c.title}</Link></td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="text-xs">{fmtDate(c.submittedAt)}</td>
                  <td className="text-xs">{fmtDate(c.decidedAt)}</td>
                  {showMoney ? <><td className="num">{money(c.proposedAmount)}</td><td className="num">{c.approvedAmount ? money(c.approvedAmount) : "—"}</td></> : null}
                  <td className="text-xs">{c.clientPoNumber ?? "—"}</td>
                  <td className="text-xs">{c.status === "APPROVED" ? (c.invoices.length ? `${c.invoices.length} invoice(s)` : <span className="text-amber-700">Not invoiced</span>) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="RFIs" bodyClass="overflow-x-auto" actions={live && (can(r, "rfi.create") || can(r, "change.edit")) ? (
          <Drawer label="New RFI" className="btn btn-secondary btn-sm" wide>
            <ActionForm action={createRfiAction} className="space-y-3">
              <input type="hidden" name="projectId" value={id} />
              <Field label="Subject *"><input name="subject" required className="input" /></Field>
              <Field label="Question *"><textarea name="question" required rows={4} className="input" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Response required by"><input type="date" name="requiredBy" className="input" /></Field>
                <Field label="Responsible (Intervolt)"><select name="responsibleId" defaultValue={user.id} className="input"><Options items={users} empty="—" /></select></Field>
              </div>
              <Field label="Attachments"><input type="file" name="files" multiple className="text-sm" /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sendNow" /> Already sent to the client / consultant</label>
              <Submit>Create RFI</Submit>
            </ActionForm>
          </Drawer>
        ) : null}>
          {rfis.length === 0 ? <div className="p-4"><Empty>No RFIs.</Empty></div> : (
            <table className="table">
              <thead><tr><th>RFI</th><th>Status</th><th>Required by</th><th></th></tr></thead>
              <tbody>
                {rfis.map((x) => {
                  const overdue = x.status === "OPEN" && x.requiredBy && x.requiredBy < t0;
                  return (
                    <tr key={x.id}>
                      <td>
                        <span className="font-mono text-xs">{x.number}</span> {x.subject}
                        <details className="text-xs text-slate-600"><summary className="cursor-pointer text-slate-400">Details</summary>
                          <p className="whitespace-pre-line">{x.question}</p>
                          {x.response ? <p className="mt-1 whitespace-pre-line text-emerald-800">Response{x.respondedBy ? ` (${x.respondedBy})` : ""}: {x.response}</p> : null}
                          <DocList entityType="Rfi" entityId={x.id} />
                        </details>
                        {x.changeOrders.map((c) => <Link key={c.id} className="link mr-2 text-xs" href={`/jobs/${id}/changes/${c.id}`}>→ {c.number}</Link>)}
                      </td>
                      <td><StatusBadge status={x.status} />{x.sentAt ? <div className="text-xs text-slate-500">sent {fmtDate(x.sentAt)}</div> : <div className="text-xs text-amber-700">not sent</div>}</td>
                      <td className={clsx("text-xs", overdue && "font-semibold text-red-600")}>{fmtDate(x.requiredBy)}<div className="text-slate-500">{nameOf(x.responsibleId)}</div></td>
                      <td>
                        {x.status === "OPEN" && can(r, "change.edit") ? (
                          <div className="flex flex-col gap-1">
                            {!x.sentAt ? <ActionForm action={rfiSentAction}><input type="hidden" name="rfiId" value={x.id} /><Submit className="btn btn-ghost btn-sm" pendingText="…">Mark sent</Submit></ActionForm> : null}
                            <Drawer label="Record response" className="btn btn-secondary btn-sm">
                              <ActionForm action={rfiResponseAction} className="space-y-2">
                                <input type="hidden" name="rfiId" value={x.id} /><input type="hidden" name="projectId" value={id} />
                                <Field label="Response *"><textarea name="response" required rows={3} className="input" /></Field>
                                <div className="grid grid-cols-2 gap-2">
                                  <Field label="Received *"><input type="datetime-local" name="respondedAt" required defaultValue={isoDateTimeLocal(new Date())} className="input" /></Field>
                                  <Field label="From"><input name="respondedBy" className="input" /></Field>
                                </div>
                                <Field label="Change required? *"><select name="changeRequired" className="input"><option value="no">No: close the RFI</option><option value="yes">Yes: open a draft change order</option></select></Field>
                                <Field label="Response document"><input type="file" name="files" className="text-sm" /></Field>
                                <Submit>Save response</Submit>
                              </ActionForm>
                            </Drawer>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="ESIs / site instructions" bodyClass="overflow-x-auto" actions={live && can(r, "change.edit") ? (
          <Drawer label="Record ESI" className="btn btn-secondary btn-sm">
            <ActionForm action={esiAction} className="space-y-3">
              <input type="hidden" name="projectId" value={id} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="ESI number" hint="Blank = auto"><input name="number" className="input" /></Field>
                <Field label="Received *"><input type="date" name="receivedAt" required defaultValue={isoDate(t0)} className="input" /></Field>
              </div>
              <Field label="Issued by"><input name="issuedBy" className="input" /></Field>
              <Field label="Instruction *"><textarea name="description" required rows={3} className="input" /></Field>
              <Field label="Change to contract?"><select name="changeRequired" className="input"><option value="unknown">Not yet assessed</option><option value="yes">Yes: open a draft change order</option><option value="no">No</option></select></Field>
              <Field label="Document"><input type="file" name="files" className="text-sm" /></Field>
              <Submit>Save ESI</Submit>
            </ActionForm>
          </Drawer>
        ) : null}>
          {esis.length === 0 ? <div className="p-4"><Empty>No ESIs.</Empty></div> : (
            <table className="table">
              <thead><tr><th>ESI</th><th>Received</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {esis.map((e) => (
                  <tr key={e.id}>
                    <td><span className="font-mono text-xs">{e.number}</span> <span className="text-xs text-slate-500">{e.issuedBy}</span><p className="text-sm">{e.description}</p><DocList entityType="Esi" entityId={e.id} />{e.changeOrders.map((c) => <Link key={c.id} className="link mr-2 text-xs" href={`/jobs/${id}/changes/${c.id}`}>→ {c.number}</Link>)}</td>
                    <td className="text-xs">{fmtDate(e.receivedAt)}</td>
                    <td><StatusBadge status={e.status} /></td>
                    <td>
                      {e.status === "OPEN" && e.changeRequired == null && can(r, "change.edit") ? (
                        <div className="flex flex-col gap-1">
                          <ActionForm action={esiDecideAction}><input type="hidden" name="esiId" value={e.id} /><input type="hidden" name="changeRequired" value="yes" /><Submit className="btn btn-secondary btn-sm" pendingText="…">Change required</Submit></ActionForm>
                          <ActionForm action={esiDecideAction}><input type="hidden" name="esiId" value={e.id} /><input type="hidden" name="changeRequired" value="no" /><Submit className="btn btn-ghost btn-sm" pendingText="…">No change</Submit></ActionForm>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {showMoney && contract ? (
        <Card title="Contract value history (append-only)" bodyClass="overflow-x-auto">
          <table className="table">
            <thead><tr><th>When</th><th>Reason</th><th className="num">Change</th><th className="num">Previous</th><th className="num">New value</th></tr></thead>
            <tbody>
              <tr><td className="text-xs">{fmtDateTime(contract.createdAt)}</td><td>Original contract, PO {contract.clientPoNumber}</td><td className="num">—</td><td className="num">—</td><td className="num font-semibold">{money(contract.originalValue)}</td></tr>
              {contract.changes.map((c) => <tr key={c.id}><td className="text-xs">{fmtDateTime(c.at)}</td><td>{c.reason}</td><td className={clsx("num", d(c.amount).lessThan(0) && "text-red-600")}>{money(c.amount)}</td><td className="num">{money(c.previousValue)}</td><td className="num font-semibold">{money(c.newValue)}</td></tr>)}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
