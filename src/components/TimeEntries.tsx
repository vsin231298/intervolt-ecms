import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { fmtDate, isoDate } from "@/lib/dates";
import { money, qty } from "@/lib/money";
import { Drawer, Empty, Field, Options, StatusBadge } from "./ui";
import { ActionForm, Submit } from "./ActionForm";
import { approveTimeAction, deleteTimeAction, editTimeAction } from "@/app/actions/labour";

export type TimeRow = Prisma.TimeEntryGetPayload<{ include: { worker: true; project: { select: { id: true; number: true; name: true } } } }>;

/** Time entries with approve / edit / delete (management) — used on the job Labour tab and the company Timesheets page. */
export function TimeEntries({ rows, canManage, showCost, showProject, formId, coOptions = [] }: { rows: TimeRow[]; canManage: boolean; showCost: boolean; showProject?: boolean; formId: string; coOptions?: { value: string; label: string }[] }) {
  if (!rows.length) return <div className="p-4"><Empty>No time entries for this selection.</Empty></div>;
  const pending = rows.filter((r) => !r.approvedAt);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              {canManage ? <th><span className="sr-only">Select</span></th> : null}
              <th>Date</th><th>Employee</th>{showProject ? <th>Job</th> : null}<th className="num">Reg</th><th className="num">OT</th>{showCost ? <th className="num">Cost</th> : null}<th>Source</th><th>Description</th><th>Status</th>{canManage ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                {canManage ? <td>{!e.approvedAt ? <input type="checkbox" name="ids" value={e.id} form={formId} aria-label="Select entry" /> : null}</td> : null}
                <td>{fmtDate(e.date)}</td>
                <td>{e.worker.name}</td>
                {showProject ? <td><Link className="link font-mono text-xs" href={`/jobs/${e.project.id}/labour`}>{e.project.number}</Link><div className="text-xs text-slate-500">{e.project.name}</div></td> : null}
                <td className="num">{qty(e.regularHours)}</td>
                <td className="num">{qty(e.overtimeHours)}</td>
                {showCost ? <td className="num">{money(e.cost)}</td> : null}
                <td className="text-xs">{e.source.toLowerCase()}{e.editedById ? " · edited" : ""}</td>
                <td className="max-w-xs text-xs">{e.costCode ? <b>{e.costCode} </b> : null}{e.description}</td>
                <td>{e.approvedAt ? <StatusBadge status="APPROVED" /> : <StatusBadge status="PENDING" />}</td>
                {canManage ? (
                  <td>
                    <div className="flex gap-1">
                      <Drawer label="Edit" className="btn btn-ghost btn-sm">
                        <ActionForm action={editTimeAction} className="space-y-2" resetOnSuccess={false}>
                          <input type="hidden" name="id" value={e.id} />
                          <div className="grid grid-cols-3 gap-2">
                            <Field label="Date"><input type="date" name="date" required defaultValue={isoDate(e.date)} className="input" /></Field>
                            <Field label="Regular"><input name="regularHours" required defaultValue={e.regularHours.toString()} className="input" /></Field>
                            <Field label="Overtime"><input name="overtimeHours" defaultValue={e.overtimeHours.toString()} className="input" /></Field>
                          </div>
                          <Field label="Cost code"><input name="costCode" defaultValue={e.costCode ?? ""} className="input" /></Field>
                          {coOptions.length ? <Field label="Change order"><select name="changeOrderId" defaultValue={e.changeOrderId ?? ""} className="input"><Options items={coOptions} empty="Base contract" /></select></Field> : null}
                          <Field label="Description"><input name="description" defaultValue={e.description ?? ""} className="input" /></Field>
                          <p className="text-xs text-slate-500">Edits are recorded in the audit trail and reset approval.</p>
                          <Submit>Save</Submit>
                        </ActionForm>
                      </Drawer>
                      <Drawer label="Delete" className="btn btn-ghost btn-sm text-red-600">
                        <ActionForm action={deleteTimeAction} className="space-y-2">
                          <input type="hidden" name="id" value={e.id} />
                          <Field label="Reason *"><input name="reason" required className="input" /></Field>
                          <Submit className="btn btn-danger">Delete entry</Submit>
                        </ActionForm>
                      </Drawer>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && pending.length ? (
        <ActionForm action={approveTimeAction} id={formId} className="border-t border-slate-100 p-3">
          <Submit className="btn btn-success btn-sm">Approve selected</Submit>
        </ActionForm>
      ) : null}
    </>
  );
}
