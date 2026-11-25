import { requireUser } from "@/lib/auth";
import { orgOptions } from "@/lib/lookups";
import { Card, Field, Options, PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { createLeadAction } from "@/app/actions/jobs";
import { isoDate, today } from "@/lib/dates";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  await requireUser("leads.edit");
  const [clients, consultants, gcs] = await Promise.all([orgOptions(["CLIENT", "GENERAL_CONTRACTOR"]), orgOptions(["CONSULTANT"]), orgOptions(["GENERAL_CONTRACTOR"])]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="New lead / tender opportunity" subtitle="A Work Order Number is assigned when you save and stays with this job for life." crumbs={[{ href: "/leads", label: "Leads & tenders" }]} />
      <Card>
        <ActionForm action={createLeadAction} className="space-y-5" resetOnSuccess={false}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project name *" className="sm:col-span-2"><input name="name" required maxLength={200} className="input" /></Field>
            <Field label="Client"><select name="clientId" className="input"><Options items={clients} /></select></Field>
            <Field label="Client / tender reference #"><input name="clientProjectNo" className="input" /></Field>
            <Field label="Consultant"><select name="consultantId" className="input"><Options items={consultants} /></select></Field>
            <Field label="General contractor"><select name="gcId" className="input"><Options items={gcs} /></select></Field>
            <Field label="Location" className="sm:col-span-2"><input name="location" className="input" /></Field>
            <Field label="Estimated project value ($)"><input name="estimatedValue" inputMode="decimal" className="input" /></Field>
            <Field label="Tender invitation date"><input type="date" name="invitationDate" defaultValue={isoDate(today())} className="input" /></Field>
            <Field label="Submission deadline"><input type="datetime-local" name="submissionDeadline" className="input" /></Field>
            <Field label="Site visit (optional)"><input type="datetime-local" name="siteVisitDate" className="input" /></Field>
            <Field label="Scope summary" className="sm:col-span-2"><textarea name="scope" rows={3} className="input" /></Field>
            <Field label="Notes" className="sm:col-span-2"><textarea name="description" rows={2} className="input" /></Field>
          </div>
          <div className="rounded-md border border-dashed border-slate-300 p-4">
            <div className="mb-2 text-sm font-medium">Tender documents (optional)</div>
            <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
              <input type="file" name="files" multiple className="text-sm" />
              <select name="docCategory" className="input"><option>Tender document</option><option>Drawings</option><option>Specifications</option><option>Addendum</option><option>Invitation</option></select>
            </div>
            <p className="mt-1 text-xs text-slate-500">PDF, Word, Excel, DWG, images and more, up to 100 MB each.</p>
          </div>
          <Submit>Create lead</Submit>
        </ActionForm>
      </Card>
    </div>
  );
}
