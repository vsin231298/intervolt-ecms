import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, isoDate, today } from "@/lib/dates";
import { userOptions } from "@/lib/lookups";
import { Card, Drawer, Empty, Field, Options, StatusBadge, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { createTaskAction, deleteTaskAction, scheduleItemAction, taskStatusAction } from "@/app/actions/jobs";

export default async function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const [tasks, schedule, users] = await Promise.all([
    prisma.task.findMany({ where: { projectId: id }, include: { assignee: true }, orderBy: [{ status: "asc" }, { dueDate: "asc" }] }),
    prisma.scheduleItem.findMany({ where: { projectId: id }, orderBy: [{ sortOrder: "asc" }] }),
    userOptions(),
  ]);
  const canManage = can(user.role, "project.manage");
  const t0 = today();
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Tasks" bodyClass="overflow-x-auto" actions={canManage ? (
        <Drawer label="New task" className="btn btn-primary btn-sm">
          <ActionForm action={createTaskAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <Field label="Task *"><input name="title" required className="input" /></Field>
            <Field label="Details"><textarea name="description" rows={2} className="input" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assign to"><select name="assigneeId" className="input"><Options items={users} empty="Unassigned" /></select></Field>
              <Field label="Deadline"><input type="date" name="dueDate" className="input" /></Field>
            </div>
            <Submit>Create task</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {tasks.length === 0 ? <div className="p-4"><Empty>No tasks yet.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Task</th><th>Assigned</th><th>Deadline</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {tasks.map((t) => {
                const overdue = t.status !== "DONE" && t.dueDate && t.dueDate < t0;
                const mine = t.assigneeId === user.id;
                return (
                  <tr key={t.id} className={t.status === "DONE" ? "text-slate-400" : ""}>
                    <td><div className={clsx(t.status === "DONE" && "line-through")}>{t.title}</div>{t.description ? <div className="text-xs text-slate-500">{t.description}</div> : null}</td>
                    <td>{t.assignee?.name ?? "—"}</td>
                    <td className={clsx(overdue && "font-semibold text-red-600")}>{fmtDate(t.dueDate)}{t.completedAt ? <div className="text-xs">done {fmtDate(t.completedAt)}</div> : null}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td>
                      {canManage || mine ? (
                        <div className="flex gap-1">
                          {t.status !== "DONE" ? (
                            <ActionForm action={taskStatusAction}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="status" value="DONE" /><Submit className="btn btn-success btn-sm" pendingText="…">Complete</Submit></ActionForm>
                          ) : (
                            <ActionForm action={taskStatusAction}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="status" value="OPEN" /><Submit className="btn btn-ghost btn-sm" pendingText="…">Reopen</Submit></ActionForm>
                          )}
                          {t.status === "OPEN" ? <ActionForm action={taskStatusAction}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="status" value="IN_PROGRESS" /><Submit className="btn btn-ghost btn-sm" pendingText="…">Start</Submit></ActionForm> : null}
                          {canManage ? <ActionForm action={deleteTaskAction}><input type="hidden" name="taskId" value={t.id} /><Submit className="btn btn-ghost btn-sm text-red-600" pendingText="…">Delete</Submit></ActionForm> : null}
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

      <Card title="Schedule & milestones" bodyClass="overflow-x-auto" actions={canManage ? (
        <Drawer label="Add item" className="btn btn-secondary btn-sm">
          <ScheduleForm projectId={id} />
        </Drawer>
      ) : null}>
        {schedule.length === 0 ? <div className="p-4"><Empty>No schedule items yet.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Item</th><th>Start</th><th>End</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {schedule.map((s) => {
                const late = s.status !== "COMPLETE" && s.endDate && s.endDate < t0;
                return (
                  <tr key={s.id}>
                    <td>{s.isMilestone ? "◆ " : ""}{s.name}</td>
                    <td>{fmtDate(s.startDate)}</td>
                    <td className={clsx(late && "font-semibold text-red-600")}>{fmtDate(s.endDate)}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td>{canManage ? <Drawer label="Edit" className="btn btn-ghost btn-sm"><ScheduleForm projectId={id} item={s} /></Drawer> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function ScheduleForm({ projectId, item }: { projectId: string; item?: { id: string; name: string; startDate: Date | null; endDate: Date | null; status: string; isMilestone: boolean } }) {
  return (
    <ActionForm action={scheduleItemAction} className="space-y-3" resetOnSuccess={!item}>
      <input type="hidden" name="projectId" value={projectId} />
      {item ? <input type="hidden" name="itemId" value={item.id} /> : null}
      <Field label="Name *"><input name="name" required defaultValue={item?.name} className="input" /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Start"><input type="date" name="startDate" defaultValue={item?.startDate ? isoDate(item.startDate) : ""} className="input" /></Field>
        <Field label="End"><input type="date" name="endDate" defaultValue={item?.endDate ? isoDate(item.endDate) : ""} className="input" /></Field>
        <Field label="Status"><select name="status" defaultValue={item?.status ?? "NOT_STARTED"} className="input"><option value="NOT_STARTED">Not started</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETE">Complete</option></select></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isMilestone" defaultChecked={item?.isMilestone} /> Milestone</label>
      <Submit>{item ? "Save" : "Add"}</Submit>
    </ActionForm>
  );
}
