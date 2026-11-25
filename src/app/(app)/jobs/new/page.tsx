import { requireUser } from "@/lib/auth";
import { orgOptions, userOptions } from "@/lib/lookups";
import { isoDate, today } from "@/lib/dates";
import { Card, Field, Options, PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { createDirectJobAction } from "@/app/actions/jobs";

export const metadata = { title: "New work order" };

export default async function NewJobPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const user = await requireUser("jobs.create");
  const { type } = await searchParams;
  const [clients, pms] = await Promise.all([orgOptions(["CLIENT", "GENERAL_CONTRACTOR"]), userOptions(["PROJECT_MANAGER", "ADMIN"])]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="New small job / service work order" subtitle="These start straight as active jobs. Construction projects that need a tender start as a lead instead." crumbs={[{ href: "/jobs", label: "Jobs" }]} />
      <Card>
        <ActionForm action={createDirectJobAction} className="space-y-4" resetOnSuccess={false}>
          <fieldset className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="jobType" value="SERVICE" defaultChecked={type !== "SMALL_JOB"} /> Service work order / maintenance call</label>
            <label className="flex items-center gap-2"><input type="radio" name="jobType" value="SMALL_JOB" defaultChecked={type === "SMALL_JOB"} /> Small job / minor work order</label>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Job name / problem description *" className="sm:col-span-2"><input name="name" required className="input" /></Field>
            <Field label="Client"><select name="clientId" className="input"><Options items={clients} /></select></Field>
            <Field label="Project manager"><select name="projectManagerId" className="input" defaultValue={user.role === "PROJECT_MANAGER" ? user.id : ""}><Options items={pms} /></select></Field>
            <Field label="Site address" className="sm:col-span-2"><input name="location" className="input" /></Field>
            <Field label="Site contact"><input name="siteContactName" className="input" /></Field>
            <Field label="Site contact phone"><input name="siteContactPhone" type="tel" className="input" /></Field>
            <Field label="Client PO # (if issued)"><input name="clientPoNumber" className="input" /></Field>
            <Field label="Quoted / contract value ($)" hint="Leave blank for time & material"><input name="contractValue" inputMode="decimal" className="input" /></Field>
            <Field label="Start date"><input type="date" name="startDate" defaultValue={isoDate(today())} className="input" /></Field>
            <Field label="Target finish"><input type="date" name="finishDate" className="input" /></Field>
            <Field label="Scope of work" className="sm:col-span-2"><textarea name="scope" rows={4} className="input" /></Field>
          </div>
          <Submit>Create work order</Submit>
        </ActionForm>
      </Card>
    </div>
  );
}
