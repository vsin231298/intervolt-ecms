import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, isoDate, today } from "@/lib/dates";
import { userOptions } from "@/lib/lookups";
import { Card, Drawer, Empty, Field, Options, StatusBadge, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { DocList } from "@/components/DocList";
import { addCommissioningAction, addDeficiencyAction, commissioningResultAction, deficiencyStatusAction, inspectionResultAction, scheduleInspectionAction } from "@/app/actions/closeout";

const TYPES = ["ESA Rough-in", "ESA Cover", "ESA Final", "Fire Alarm Verification", "Consultant Site Review", "Client Walkthrough", "Internal QA"];

export default async function InspectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const [inspections, deficiencies, commissioning, users, project] = await Promise.all([
    prisma.inspection.findMany({ where: { projectId: id }, include: { deficiencies: true }, orderBy: { scheduledAt: "desc" } }),
    prisma.deficiency.findMany({ where: { projectId: id }, include: { inspection: true }, orderBy: [{ status: "asc" }, { dueDate: "asc" }] }),
    prisma.commissioningItem.findMany({ where: { projectId: id }, orderBy: { createdAt: "asc" } }),
    userOptions(),
    prisma.project.findUniqueOrThrow({ where: { id } }),
  ]);
  const r = user.role;
  const canEdit = can(r, "inspection.edit") && project.stage !== "CLOSED";
  const t0 = today();
  const nameOf = (uid: string | null) => users.find((u) => u.value === uid)?.label ?? "—";

  return (
    <div className="space-y-6">
      <Card title="Inspections (ESA and others)" bodyClass="overflow-x-auto" actions={canEdit ? (
        <Drawer label="Schedule inspection" className="btn btn-primary btn-sm">
          <ActionForm action={scheduleInspectionAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <Field label="Type *"><input name="type" required list="insp-types" className="input" /><datalist id="insp-types">{TYPES.map((t) => <option key={t} value={t} />)}</datalist></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date & time *"><input type="datetime-local" name="scheduledAt" required className="input" /></Field>
              <Field label="Inspector"><input name="inspector" className="input" /></Field>
              <Field label="ESA notification #"><input name="esaNotificationNo" className="input" /></Field>
              <Field label="Re-inspection of"><select name="reinspectionOfId" className="input"><Options items={inspections.filter((i) => i.result === "FAILED").map((i) => ({ value: i.id, label: `${i.type} ${fmtDate(i.scheduledAt)}` }))} empty="—" /></select></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isEsa" defaultChecked /> ESA inspection</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isFinal" /> Final inspection (required for closeout)</label>
            <Field label="Notes"><input name="notes" className="input" /></Field>
            <Submit>Schedule</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {inspections.length === 0 ? <div className="p-4"><Empty>No inspections yet.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Inspection</th><th>Scheduled</th><th>Inspector</th><th>Result</th><th>Report</th><th></th></tr></thead>
            <tbody>
              {inspections.map((i) => (
                <tr key={i.id}>
                  <td>{i.type}<div className="text-xs text-slate-500">{[i.isEsa ? "ESA" : null, i.isFinal ? "Final" : null, i.esaNotificationNo ? `#${i.esaNotificationNo}` : null, i.reinspectionOfId ? "Re-inspection" : null].filter(Boolean).join(" · ")}</div></td>
                  <td className="text-xs">{fmtDateTime(i.scheduledAt)}</td>
                  <td>{i.inspector ?? "—"}</td>
                  <td><StatusBadge status={i.result} />{i.resultDate ? <div className="text-xs text-slate-500">{fmtDate(i.resultDate)}</div> : null}{i.deficiencies.length ? <div className="text-xs text-slate-500">{i.deficiencies.length} deficienc{i.deficiencies.length === 1 ? "y" : "ies"}</div> : null}{i.notes ? <div className="max-w-xs text-xs text-slate-500">{i.notes}</div> : null}</td>
                  <td><DocList entityType="Inspection" entityId={i.id} /></td>
                  <td>
                    {canEdit && i.result === "SCHEDULED" ? (
                      <Drawer label="Record result" className="btn btn-secondary btn-sm" wide>
                        <ActionForm action={inspectionResultAction} className="space-y-3">
                          <input type="hidden" name="inspectionId" value={i.id} /><input type="hidden" name="projectId" value={id} />
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Result *"><select name="result" className="input"><option value="PASSED">Passed</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option></select></Field>
                            <Field label="Date *"><input type="date" name="resultDate" required defaultValue={isoDate(t0)} className="input" /></Field>
                          </div>
                          <Field label="Notes"><input name="notes" className="input" /></Field>
                          <Field label="Inspection report"><input type="file" name="files" multiple className="text-sm" /></Field>
                          <div>
                            <div className="label">Deficiencies (required if failed)</div>
                            <table className="table">
                              <thead><tr><th>Description</th><th>Location</th><th>Assigned</th><th>Due</th></tr></thead>
                              <tbody>
                                {[0, 1, 2, 3, 4].map((n) => (
                                  <tr key={n}>
                                    <td><input name="defDescription" className="input py-1" aria-label={`Deficiency ${n + 1}`} /></td>
                                    <td><input name="defLocation" className="input py-1" aria-label={`Location ${n + 1}`} /></td>
                                    <td><select name="defAssignee" className="input py-1" aria-label={`Assignee ${n + 1}`}><Options items={users} empty="—" /></select></td>
                                    <td><input type="date" name="defDue" className="input py-1" aria-label={`Due ${n + 1}`} /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <Submit>Save result</Submit>
                        </ActionForm>
                      </Drawer>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Deficiencies" bodyClass="overflow-x-auto" actions={canEdit ? (
        <Drawer label="Add deficiency" className="btn btn-secondary btn-sm">
          <ActionForm action={addDeficiencyAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <Field label="Description *"><textarea name="description" required rows={2} className="input" /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Location"><input name="location" className="input" /></Field>
              <Field label="Assigned to"><select name="assignedToId" className="input"><Options items={users} empty="—" /></select></Field>
              <Field label="Due"><input type="date" name="dueDate" className="input" /></Field>
            </div>
            <Submit>Add</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {deficiencies.length === 0 ? <div className="p-4"><Empty>No deficiencies.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Deficiency</th><th>From</th><th>Assigned</th><th>Due</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {deficiencies.map((x) => {
                const overdue = x.status !== "COMPLETED" && x.dueDate && x.dueDate < t0;
                return (
                  <tr key={x.id}>
                    <td>{x.description}{x.location ? <div className="text-xs text-slate-500">{x.location}</div> : null}{x.correctiveAction ? <div className="text-xs text-emerald-700">Fix: {x.correctiveAction}</div> : null}</td>
                    <td className="text-xs">{x.inspection?.type ?? "Manual"}</td>
                    <td>{nameOf(x.assignedToId)}</td>
                    <td className={clsx(overdue && "font-semibold text-red-600")}>{fmtDate(x.dueDate)}</td>
                    <td><StatusBadge status={x.status} />{x.completedAt ? <div className="text-xs text-slate-500">{fmtDate(x.completedAt)}</div> : null}</td>
                    <td>
                      {x.status !== "COMPLETED" && (canEdit || x.assignedToId === user.id) ? (
                        <div className="flex gap-1">
                          {x.status === "OPEN" ? <ActionForm action={deficiencyStatusAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="status" value="IN_PROGRESS" /><Submit className="btn btn-ghost btn-sm" pendingText="…">Start</Submit></ActionForm> : null}
                          <Drawer label="Complete" className="btn btn-success btn-sm">
                            <ActionForm action={deficiencyStatusAction} className="space-y-2"><input type="hidden" name="id" value={x.id} /><input type="hidden" name="status" value="COMPLETED" /><Field label="Corrective action *"><textarea name="correctiveAction" required rows={2} className="input" /></Field><Submit className="btn btn-success">Mark corrected</Submit></ActionForm>
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

      <Card title="Testing & commissioning" bodyClass="overflow-x-auto" actions={canEdit ? (
        <Drawer label="Add test" className="btn btn-secondary btn-sm">
          <ActionForm action={addCommissioningAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <Field label="System *"><input name="system" required className="input" placeholder="Emergency lighting, fire alarm, generator…" /></Field>
            <Field label="Test *"><input name="test" required className="input" placeholder="90-minute discharge test" /></Field>
            <Field label="Scheduled"><input type="date" name="scheduledAt" className="input" /></Field>
            <Submit>Add</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {commissioning.length === 0 ? <div className="p-4"><Empty>No commissioning items.</Empty></div> : (
          <table className="table">
            <thead><tr><th>System</th><th>Test</th><th>Scheduled</th><th>Result</th><th>Report</th><th></th></tr></thead>
            <tbody>
              {commissioning.map((c) => (
                <tr key={c.id}>
                  <td>{c.system}</td>
                  <td>{c.test}{c.notes ? <div className="text-xs text-slate-500">{c.notes}</div> : null}</td>
                  <td>{fmtDate(c.scheduledAt)}</td>
                  <td><StatusBadge status={c.result} />{c.performedAt ? <div className="text-xs text-slate-500">{fmtDate(c.performedAt)} {c.performedBy}</div> : null}</td>
                  <td><DocList entityType="CommissioningItem" entityId={c.id} /></td>
                  <td>
                    {canEdit && c.result !== "PASSED" ? (
                      <Drawer label="Record result" className="btn btn-secondary btn-sm">
                        <ActionForm action={commissioningResultAction} className="space-y-2">
                          <input type="hidden" name="id" value={c.id} /><input type="hidden" name="projectId" value={id} />
                          <Field label="Result"><select name="result" className="input"><option value="PASSED">Passed</option><option value="FAILED">Failed</option></select></Field>
                          <Field label="Performed on *"><input type="date" name="performedAt" required defaultValue={isoDate(t0)} className="input" /></Field>
                          <Field label="Performed by"><input name="performedBy" className="input" /></Field>
                          <Field label="Notes"><input name="notes" className="input" /></Field>
                          <Field label="Test report"><input type="file" name="files" className="text-sm" /></Field>
                          <Submit>Save</Submit>
                        </ActionForm>
                      </Drawer>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
