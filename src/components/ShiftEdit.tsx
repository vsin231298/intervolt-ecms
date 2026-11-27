import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { isoDate } from "@/lib/dates";
import { removeAssignmentAction, updateAssignmentAction } from "@/app/actions/labour";

type Shift = { id: string; date: Date; projectId: string; startTime: string | null; endTime: string | null; breakMin: number; hours: unknown; notes: string | null; publishedAt: Date | null };

/** Edit any shift, draft or published. Published shifts stay published; the worker gets an alert. */
export function ShiftEditForm({ a, jobs }: { a: Shift; jobs?: { id: string; number: string; name: string }[] }) {
  return (
    <div className="space-y-3">
      <ActionForm action={updateAssignmentAction} className="space-y-3" resetOnSuccess={false}>
        <input type="hidden" name="id" value={a.id} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" name="date" required defaultValue={isoDate(a.date)} className="input" /></Field>
          {jobs ? (
            <Field label="Job"><select name="projectId" defaultValue={a.projectId} className="input">{jobs.map((j) => <option key={j.id} value={j.id}>{j.number} {j.name}</option>)}</select></Field>
          ) : <div />}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start"><input type="time" name="startTime" defaultValue={a.startTime ?? ""} className="input" /></Field>
          <Field label="End"><input type="time" name="endTime" defaultValue={a.endTime ?? ""} className="input" /></Field>
          <Field label="Break (min)"><input type="number" name="breakMin" min={0} step={5} defaultValue={a.breakMin} className="input" /></Field>
        </div>
        <Field label="Hours (only if no start/end)"><input name="hours" defaultValue={String(a.hours)} className="input" /></Field>
        <Field label="Notes"><input name="notes" defaultValue={a.notes ?? ""} className="input" /></Field>
        <div className="text-xs text-slate-500">{a.publishedAt ? "Published. The worker gets a \"Schedule changed\" alert." : "Draft. The worker won't see it until you publish."}</div>
        <Submit>Save</Submit>
      </ActionForm>
      <ActionForm action={removeAssignmentAction}><input type="hidden" name="id" value={a.id} /><Submit className="btn btn-ghost btn-sm text-red-600">Remove shift</Submit></ActionForm>
    </div>
  );
}
