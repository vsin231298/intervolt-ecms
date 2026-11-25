import type { OrgType } from "@prisma/client";
import { Field } from "./ui";
import { ActionForm, Submit } from "./ActionForm";
import { saveOrgAction } from "@/app/actions/admin";

export const ORG_LABELS: Record<OrgType, string> = {
  CLIENT: "Client",
  CONSULTANT: "Consultant",
  GENERAL_CONTRACTOR: "General contractor",
  SUPPLIER: "Supplier",
  SUBCONTRACTOR: "Subcontractor",
  INSPECTOR: "Inspector / authority",
  OTHER: "Other",
};

type O = { id: string; name: string; type: OrgType; email: string | null; phone: string | null; address: string | null; website: string | null; notes: string | null; active: boolean };

export function OrgForm({ org, defaultType }: { org?: O; defaultType?: OrgType }) {
  return (
    <ActionForm action={saveOrgAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess={!org}>
      {org ? <input type="hidden" name="orgId" value={org.id} /> : null}
      <Field label="Name *"><input name="name" required defaultValue={org?.name} className="input" /></Field>
      <Field label="Type *"><select name="type" defaultValue={org?.type ?? defaultType ?? "CLIENT"} className="input">{(Object.entries(ORG_LABELS) as [OrgType, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Email"><input type="email" name="email" defaultValue={org?.email ?? ""} className="input" /></Field>
      <Field label="Phone"><input name="phone" defaultValue={org?.phone ?? ""} className="input" /></Field>
      <Field label="Address" className="sm:col-span-2"><input name="address" defaultValue={org?.address ?? ""} className="input" /></Field>
      <Field label="Website"><input name="website" defaultValue={org?.website ?? ""} className="input" /></Field>
      {org ? <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="active" defaultChecked={org.active} /> Active</label> : <span />}
      <Field label="Notes" className="sm:col-span-2"><textarea name="notes" rows={2} defaultValue={org?.notes ?? ""} className="input" /></Field>
      <div className="sm:col-span-2"><Submit>{org ? "Save" : "Add"}</Submit></div>
    </ActionForm>
  );
}
