import { prisma, type Tx } from "./db";

/**
 * Configurable business rules. Defaults below are ASSUMPTIONS pending confirmation by Intervolt
 * (see architecture doc, section 8). Admins change them in Settings without code changes.
 */
export const SETTING_DEFAULTS = {
  "company.name": "Intervolt Electric",
  "company.address": "",
  "company.phone": "",
  "company.email": "",
  "company.hstNumber": "",
  "numbering.workOrderPrefix": "WO",
  "tax.percent": 13,
  "billing.holdbackPercent": 10,
  "billing.paymentTermsDays": 30,
  "billing.drawDueDay": 25,
  "estimate.labourRate": 95,
  "estimate.overheadPercent": 10,
  "estimate.profitPercent": 10,
  "change.markupPercent": 15,
  "labour.overtimeAfterHours": 8,
  "labour.burdenPercent": 0,
  "field.geofenceEnabled": true,
  "field.geofenceRadiusMeters": 50,
  "field.allowServiceCalls": true,
  "field.requireWorkOrderBeforeClockOut": true,
  "field.helperLateFlagMinutes": 30,
  "reminders.tenderDeadlineDays": [7, 3, 1],
  "reminders.quoteFollowUpDays": 3,
  "reminders.certificateExpiryDays": 30,
  "procurement.blockDeliveryUntilDrawingsApproved": true,
  "procurement.matchTolerancePercent": 2,
  "workflow.requireActivationChecklist": true,
  "schedule.template": [
    "Mobilization",
    "Shop drawings & submittals",
    "Procurement",
    "Rough-in",
    "ESA rough-in inspection",
    "Device install & finishes",
    "Testing & commissioning",
    "ESA final inspection",
    "Closeout",
  ],
  "folders.template": [
    "Tender Documents",
    "Estimates",
    "Supplier Quotes",
    "Submission",
    "Contract & POs",
    "Shop Drawings",
    "Procurement",
    "Site Reports & Photos",
    "RFIs & ESIs",
    "Change Orders",
    "Billing",
    "Inspections",
    "Commissioning",
    "Closeout",
  ],
  "closeout.template.PROJECT": [
    { key: "final_inspection", name: "Final inspection passed", mandatory: true, autoCheck: "FINAL_INSPECTION_PASSED" },
    { key: "esa_certificate", name: "ESA certificate / reports received", mandatory: true },
    { key: "commissioning_docs", name: "Commissioning documentation complete", mandatory: true, autoCheck: "COMMISSIONING_PASSED" },
    { key: "shop_drawings", name: "All shop drawings approved", mandatory: true, autoCheck: "SHOP_DRAWINGS_APPROVED" },
    { key: "as_builts", name: "As-built drawings submitted", mandatory: true },
    { key: "om_manuals", name: "O&M manuals submitted", mandatory: true },
    { key: "warranty", name: "Warranty documentation submitted", mandatory: true },
    { key: "deficiencies", name: "All deficiencies completed", mandatory: true, autoCheck: "DEFICIENCIES_COMPLETE" },
    { key: "final_invoice", name: "Final invoice issued", mandatory: true, autoCheck: "FINAL_INVOICE_ISSUED" },
    { key: "payments", name: "All payments received", mandatory: true, autoCheck: "PAYMENTS_RECEIVED" },
    { key: "supplier_invoices", name: "All supplier invoices settled", mandatory: true, autoCheck: "SUPPLIER_INVOICES_PAID" },
    { key: "final_docs", name: "Final project documentation archived", mandatory: true },
  ],
  "closeout.template.SMALL_JOB": [
    { key: "work_complete", name: "Work order completed and signed off", mandatory: true, autoCheck: "WORK_ORDER_SIGNED" },
    { key: "esa_certificate", name: "ESA certificate (if permit required)", mandatory: false },
    { key: "deficiencies", name: "All deficiencies completed", mandatory: true, autoCheck: "DEFICIENCIES_COMPLETE" },
    { key: "final_invoice", name: "Final invoice issued", mandatory: true, autoCheck: "FINAL_INVOICE_ISSUED" },
    { key: "payments", name: "All payments received", mandatory: true, autoCheck: "PAYMENTS_RECEIVED" },
  ],
  "closeout.template.SERVICE": [
    { key: "work_complete", name: "Work order completed and signed off", mandatory: true, autoCheck: "WORK_ORDER_SIGNED" },
    { key: "final_invoice", name: "Invoice issued", mandatory: true, autoCheck: "FINAL_INVOICE_ISSUED" },
    { key: "payments", name: "Payment received", mandatory: true, autoCheck: "PAYMENTS_RECEIVED" },
  ],
  "email.enabled": false,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
type Widen<T> = T extends number ? number : T extends string ? string : T extends boolean ? boolean : T extends readonly (infer U)[] ? Widen<U>[] : T extends object ? { -readonly [K in keyof T]: Widen<T[K]> } : T;
export type SettingValue<K extends SettingKey> = Widen<(typeof SETTING_DEFAULTS)[K]>;

export async function getSetting<K extends SettingKey>(key: K, client: Tx | typeof prisma = prisma): Promise<SettingValue<K>> {
  const row = await client.setting.findUnique({ where: { key } });
  return (row ? row.value : SETTING_DEFAULTS[key]) as SettingValue<K>;
}

export async function getAllSettings(): Promise<Record<SettingKey, unknown>> {
  const rows = await prisma.setting.findMany();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<SettingKey, unknown>;
  for (const k of Object.keys(SETTING_DEFAULTS) as SettingKey[]) out[k] = k in map ? map[k] : SETTING_DEFAULTS[k];
  return out;
}

export type CloseoutTemplateItem = { key: string; name: string; mandatory: boolean; autoCheck?: string };
