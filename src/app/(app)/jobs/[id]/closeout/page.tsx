import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { Badge, Card, Drawer, Field, Notice } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { DocList } from "@/components/DocList";
import { closeoutStatus } from "@/services/closeout";
import { addCloseoutItemAction, closeProjectAction, closeoutItemAction, startCloseoutAction } from "@/app/actions/closeout";

export default async function CloseoutPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const [project, status] = await Promise.all([prisma.project.findUniqueOrThrow({ where: { id } }), closeoutStatus(id)]);
  const people = await prisma.user.findMany({ where: { id: { in: status.rows.flatMap((x) => [x.item.completedById, x.item.waivedById]).filter((v): v is string => !!v) } }, select: { id: true, name: true } });
  const nameOf = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? "—";
  const r = user.role;
  const inCloseout = project.stage === "CLOSEOUT";
  const canEdit = can(r, "closeout.edit") && project.stage !== "CLOSED";
  const done = status.rows.filter((x) => x.satisfied).length;

  return (
    <div className="space-y-6">
      {project.stage === "CLOSED" ? <Notice tone="green">This job is closed.</Notice> : !inCloseout ? (
        <Notice>The job is not in closeout yet. You can still complete items early.{project.stage === "EXECUTION" && can(r, "closeout.close") ? <ActionForm action={startCloseoutAction} className="mt-2"><input type="hidden" name="projectId" value={id} /><Submit className="btn btn-primary btn-sm">Move job to closeout</Submit></ActionForm> : null}</Notice>
      ) : null}

      <Card title={<span>Closeout checklist <span className="text-sm font-normal text-slate-500">{done} of {status.rows.length} complete</span></span>} actions={canEdit ? (
        <Drawer label="Add item" className="btn btn-secondary btn-sm">
          <ActionForm action={addCloseoutItemAction} className="space-y-2">
            <input type="hidden" name="projectId" value={id} />
            <Field label="Item *"><input name="name" required className="input" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mandatory" defaultChecked /> Mandatory for closing</label>
            <Submit>Add</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        <ul className="divide-y divide-slate-100">
          {status.rows.map(({ item, auto, satisfied }) => (
            <li key={item.id} className="flex flex-wrap items-start gap-3 py-3">
              <span className={satisfied ? "mt-0.5 text-emerald-600" : "mt-0.5 text-slate-300"} aria-hidden>{satisfied ? "✔" : "○"}</span>
              <div className="min-w-64 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {item.name}
                  {item.mandatory ? <Badge tone="blue">Mandatory</Badge> : <Badge>Optional</Badge>}
                  {item.status === "WAIVED" ? <Badge tone="amber">Waived</Badge> : item.status === "COMPLETE" ? <Badge tone="green">Complete</Badge> : null}
                </div>
                {auto ? <div className={auto.ok ? "text-xs text-emerald-700" : "text-xs text-amber-700"}>System check: {auto.detail}</div> : null}
                {item.completedAt ? <div className="text-xs text-slate-500">Completed by {nameOf(item.completedById)} {fmtDateTime(item.completedAt)}{item.notes ? ` · ${item.notes}` : ""}</div> : null}
                {item.waivedAt ? <div className="text-xs text-amber-700">Waived by {nameOf(item.waivedById)} {fmtDateTime(item.waivedAt)}: {item.waiverReason}</div> : null}
                <DocList entityType="CloseoutItem" entityId={item.id} />
              </div>
              {canEdit ? (
                <div className="flex flex-wrap gap-1">
                  {item.status === "OPEN" ? (
                    <Drawer label="Complete" className="btn btn-success btn-sm">
                      <ActionForm action={closeoutItemAction} className="space-y-2">
                        <input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="projectId" value={id} /><input type="hidden" name="op" value="complete" /><input type="hidden" name="itemName" value={item.name} />
                        {auto && !auto.ok ? <p className="text-xs text-amber-700">The system check isn&apos;t met yet ({auto.detail}). Completing will be refused until it is, or the item can be waived.</p> : null}
                        <Field label="Notes"><input name="notes" className="input" /></Field>
                        <Field label="Supporting document(s)"><input type="file" name="files" multiple className="text-sm" /></Field>
                        <Submit className="btn btn-success">Mark complete</Submit>
                      </ActionForm>
                    </Drawer>
                  ) : (
                    <ActionForm action={closeoutItemAction}><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="projectId" value={id} /><input type="hidden" name="op" value="reopen" /><Submit className="btn btn-ghost btn-sm" pendingText="…">Reopen</Submit></ActionForm>
                  )}
                  {item.status === "OPEN" && can(r, "closeout.waive") ? (
                    <Drawer label="Waive" className="btn btn-ghost btn-sm">
                      <ActionForm action={closeoutItemAction} className="space-y-2">
                        <input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="projectId" value={id} /><input type="hidden" name="op" value="waive" />
                        <Field label="Reason for waiver *" hint="Recorded with your name in the audit trail"><textarea name="reason" required rows={2} className="input" /></Field>
                        <Submit className="btn btn-danger">Waive item</Submit>
                      </ActionForm>
                    </Drawer>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {inCloseout && can(r, "closeout.close") ? (
        <Card title="Close the job">
          {status.ready ? (
            <ActionForm action={closeProjectAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="projectId" value={id} />
              <Field label="Closing note"><input name="note" className="input w-96" /></Field>
              <Submit className="btn btn-success">Close job</Submit>
            </ActionForm>
          ) : (
            <Notice tone="amber">The job can be closed once every mandatory item is complete or formally waived. Still open: {status.blocking.map((b) => b.item.name).join(", ")}.</Notice>
          )}
        </Card>
      ) : null}
    </div>
  );
}
