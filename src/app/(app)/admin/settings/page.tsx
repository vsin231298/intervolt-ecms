import { requireUser } from "@/lib/auth";
import { getAllSettings, SETTING_DEFAULTS, type SettingKey } from "@/lib/settings";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { runJobsNowAction, saveSettingsAction } from "@/app/actions/admin";

const GROUPS: { title: string; note?: string; keys: { key: SettingKey; label: string; hint?: string }[] }[] = [
  { title: "Company", keys: [
    { key: "company.name", label: "Company name" }, { key: "company.address", label: "Address (shown on invoices, POs)" },
    { key: "company.phone", label: "Phone" }, { key: "company.email", label: "Email" }, { key: "company.hstNumber", label: "HST registration #" },
    { key: "numbering.workOrderPrefix", label: "Work order prefix", hint: "Numbers look like WO-2026-0001" },
  ] },
  { title: "Billing", note: "Assumptions pending confirmation: 13% HST (Ontario), 10% holdback, net 30, draws due on the 25th.", keys: [
    { key: "tax.percent", label: "Sales tax %" }, { key: "billing.holdbackPercent", label: "Default holdback %", hint: "Applied to new jobs; each job can override" },
    { key: "billing.paymentTermsDays", label: "Payment terms (days)" }, { key: "billing.drawDueDay", label: "Progress draw due day of month" },
  ] },
  { title: "Estimating & changes", keys: [
    { key: "estimate.labourRate", label: "Default labour rate ($/h)" }, { key: "estimate.overheadPercent", label: "Default overhead %" },
    { key: "estimate.profitPercent", label: "Default profit %" }, { key: "change.markupPercent", label: "Default change order markup %" },
  ] },
  { title: "Labour", keys: [
    { key: "labour.overtimeAfterHours", label: "Overtime after (hours per day)", hint: "Used when splitting clock-in/out time" },
    { key: "labour.burdenPercent", label: "Labour burden % added to wage cost" },
    { key: "labour.payTravelBetweenJobs", label: "Pay travel between jobs", hint: "Gap between clocking out of one job and into the next, same day, is added as regular hours" },
    { key: "field.geofenceEnabled", label: "Only allow clock in / out at the job site", hint: "Uses the phone's GPS and the site pin set on each job's Info tab" },
    { key: "field.geofenceRadiusMeters", label: "Clock-in range (metres from the site pin)", hint: "Each job can override this on its Info tab" },
    { key: "field.requireWorkOrderBeforeClockOut", label: "Service calls: work order form must be filled in before clock out", hint: "Applies to service work orders; the office can still clock someone out from Timesheets" },
    { key: "field.helperLateFlagMinutes", label: "Flag a co-worker who stays clocked in this many minutes after the journeyman leaves", hint: "Shown on Timesheets for the office to check; hours are not changed" },
    { key: "field.allowServiceCalls", label: "Let field staff start a service call from the phone", hint: "Creates a service work order pinned where they stand and clocks them in; the office is notified" },
  ] },
  { title: "Procurement", keys: [
    { key: "procurement.blockDeliveryUntilDrawingsApproved", label: "Hold deliveries until supplier shop drawings are approved" },
    { key: "procurement.matchTolerancePercent", label: "3-way match price tolerance %" },
  ] },
  { title: "Workflow & reminders", keys: [
    { key: "workflow.requireActivationChecklist", label: "Require activation checklist before work starts" },
    { key: "reminders.tenderDeadlineDays", label: "Tender deadline reminders (days before, one per line)" },
    { key: "reminders.quoteFollowUpDays", label: "Supplier quote follow-up after (days)" },
    { key: "reminders.certificateExpiryDays", label: "Certificate expiry warning (days before)" },
  ] },
  { title: "Templates", note: "One item per line. Applied to new jobs only.", keys: [
    { key: "schedule.template", label: "Project schedule template" },
    { key: "folders.template", label: "Job document folders" },
  ] },
  { title: "Closeout checklists (JSON)", note: "Each item: key, name, mandatory, and optional autoCheck: FINAL_INSPECTION_PASSED, COMMISSIONING_PASSED, SHOP_DRAWINGS_APPROVED, DEFICIENCIES_COMPLETE, FINAL_INVOICE_ISSUED, PAYMENTS_RECEIVED, SUPPLIER_INVOICES_PAID, WORK_ORDER_SIGNED.", keys: [
    { key: "closeout.template.PROJECT", label: "Project jobs" },
    { key: "closeout.template.SMALL_JOB", label: "Small jobs / minor work orders" },
    { key: "closeout.template.SERVICE", label: "Service work orders" },
  ] },
];

export default async function SettingsPage() {
  await requireUser("admin.settings");
  const values = await getAllSettings();
  const input = (key: SettingKey) => {
    const def = SETTING_DEFAULTS[key] as unknown;
    const v = values[key];
    const name = `s__${key}`;
    if (typeof def === "boolean") return <><input type="hidden" name={`${name}__present`} value="1" /><input type="checkbox" name={name} defaultChecked={Boolean(v)} className="h-4 w-4" /></>;
    if (Array.isArray(def) && (def.length === 0 || typeof def[0] !== "object")) return <textarea name={name} rows={Math.min(10, (v as unknown[]).length + 1)} defaultValue={(v as unknown[]).join("\n")} className="input font-mono text-xs" />;
    if (Array.isArray(def)) return <textarea name={name} rows={10} defaultValue={JSON.stringify(v, null, 2)} className="input font-mono text-xs" spellCheck={false} />;
    return <input name={name} defaultValue={String(v ?? "")} inputMode={typeof def === "number" ? "decimal" : undefined} className="input" />;
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Business rules are configurable here; nothing is hard-coded. Changes are recorded in the audit log." actions={
        <ActionForm action={runJobsNowAction}><Submit className="btn btn-secondary">Run reminder check now</Submit></ActionForm>
      } />
      <ActionForm action={saveSettingsAction} className="space-y-6" resetOnSuccess={false}>
        {GROUPS.map((g) => (
          <Card key={g.title} title={g.title}>
            {g.note ? <div className="mb-4"><Notice>{g.note}</Notice></div> : null}
            <div className="grid gap-4 md:grid-cols-2">
              {g.keys.map((k) => {
                const isBool = typeof SETTING_DEFAULTS[k.key] === "boolean";
                const wide = Array.isArray(SETTING_DEFAULTS[k.key]);
                return isBool ? (
                  <label key={k.key} className="flex items-center gap-2 text-sm md:col-span-2">{input(k.key)} {k.label}</label>
                ) : (
                  <Field key={k.key} label={k.label} hint={k.hint} className={wide ? "md:col-span-2" : ""}>{input(k.key)}</Field>
                );
              })}
            </div>
          </Card>
        ))}
        <div className="sticky bottom-0 -mx-1 border-t border-slate-200 bg-white/90 p-3 backdrop-blur"><Submit>Save settings</Submit></div>
      </ActionForm>
    </div>
  );
}
