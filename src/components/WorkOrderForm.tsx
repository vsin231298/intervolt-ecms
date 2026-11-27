import { Field } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { SignaturePad } from "@/components/FieldClient";
import { MaterialRows } from "@/components/MaterialRows";
import { JOB_STATUSES } from "@/services/labour";
import { signoffAction } from "@/app/actions/labour";

/** The field work order form. Used on the job screen and for a work order the office asked for. */
export function WorkOrderForm({ projectId, coWorkers, crewIds, suggestions, requestId, submitLabel = "Save work order" }: {
  projectId: string;
  coWorkers: { id: string; name: string }[];
  crewIds: string[];
  suggestions: string[];
  requestId?: string;
  submitLabel?: string;
}) {
  const crew = new Set(crewIds);
  return (
    <ActionForm action={signoffAction} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />
      {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
      <Field label="Work description"><textarea name="workSummary" required rows={3} placeholder="What was done" className="input" /></Field>
      <Field label="Co-worker(s)">
        {coWorkers.length === 0 ? <p className="text-sm text-slate-500">No other employees set up.</p> : (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">{coWorkers.map((w) => (
            <label key={w.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="coWorkerIds" value={w.id} defaultChecked={crew.has(w.id)} /> {w.name}{crew.has(w.id) ? <span className="text-xs text-emerald-700">on call</span> : null}</label>
          ))}</div>
        )}
      </Field>
      <Field label="Materials used"><MaterialRows suggestions={suggestions} /></Field>
      <Field label="Job status">
        <select name="jobStatus" required defaultValue="" className="input">
          <option value="" disabled>Choose…</option>
          {Object.entries(JOB_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Parking $"><input name="parkingAmount" inputMode="decimal" placeholder="0.00" className="input" /></Field>
        <Field label="Receipt"><input type="file" name="parkingReceipt" accept="image/*,application/pdf" capture="environment" className="block w-full text-xs" /></Field>
      </div>
      <Field label="Customer name"><input name="customerName" className="input" /></Field>
      <SignaturePad name="signatureDataUrl" />
      <Submit className="btn btn-success w-full">{submitLabel}</Submit>
    </ActionForm>
  );
}
