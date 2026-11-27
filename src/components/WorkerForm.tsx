import { Field, Options } from "./ui";
import { ActionForm, Submit } from "./ActionForm";
import { saveWorkerAction } from "@/app/actions/labour";

type W = { id: string; name: string; trade: string; licenceNo: string | null; phone: string | null; regularRate: { toString(): string }; overtimeRate: { toString(): string }; userId: string | null; active: boolean };

export function WorkerForm({ worker, users }: { worker?: W; users: { value: string; label: string }[] }) {
  return (
    <ActionForm action={saveWorkerAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess={!worker}>
      {worker ? <input type="hidden" name="workerId" value={worker.id} /> : null}
      <Field label="Name *"><input name="name" required defaultValue={worker?.name} className="input" /></Field>
      <Field label="Trade / position *"><input name="trade" required defaultValue={worker?.trade} list="trades" className="input" /><datalist id="trades"><option value="Journeyperson 309A" /><option value="Apprentice" /><option value="Lead Hand" /><option value="Foreman" /><option value="Service Technician" /></datalist></Field>
      <Field label="Licence / C of Q #"><input name="licenceNo" defaultValue={worker?.licenceNo ?? ""} className="input" /></Field>
      <Field label="Phone"><input name="phone" defaultValue={worker?.phone ?? ""} className="input" /></Field>
      <Field label="Field app login" className="sm:col-span-2" hint="Link a user account (role Electrician or Site Supervisor) so this person can clock in from the field app."><select name="userId" defaultValue={worker?.userId ?? ""} className="input"><Options items={users} empty="None" /></select></Field>
      {worker ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={worker.active} /> Active</label> : null}
      <div className="sm:col-span-2"><Submit>{worker ? "Save" : "Add employee"}</Submit></div>
    </ActionForm>
  );
}
