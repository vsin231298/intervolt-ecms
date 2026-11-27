import type { Role } from "@prisma/client";

/**
 * Permission matrix. Every server action and API route checks one of these.
 * Hiding a button in the UI is never the only protection.
 */
export const PERMISSIONS = [
  "jobs.view", // see jobs / leads list and project workspace
  "leads.edit", // create & edit leads / tenders, communications
  "leads.decide", // Doable / Not doable decision, assign estimator
  "jobs.create", // create small jobs / service work orders directly
  "estimate.edit",
  "estimate.finalize",
  "quote.edit",
  "submission.edit",
  "submission.approvePrice",
  "submission.outcome",
  "project.activate",
  "project.manage", // team, schedule, info, tasks
  "shopdrawing.edit",
  "shopdrawing.decide", // record consultant/internal decisions
  "procurement.edit", // POs, material requests
  "procurement.receive",
  "procurement.overrideDelivery",
  "materials.edit",
  "labour.schedule",
  "time.submit", // site supervisor submits for crew
  "time.manage", // edit / delete / approve any entry
  "field.use", // field app (clock in/out, photos, usage)
  "dailyreport.submit",
  "rfi.create",
  "change.edit",
  "change.approve",
  "financials.view", // see costs, values, profitability
  "billing.prepare", // draws
  "billing.edit", // invoices, payments
  "supplierInvoice.edit",
  "supplierInvoice.approve",
  "inspection.edit",
  "closeout.edit",
  "closeout.waive",
  "closeout.close",
  "documents.view",
  "documents.upload",
  "documents.approve",
  "company.documents", // company / employee document library
  "directory.edit", // organizations & contacts
  "workers.edit",
  "calendar.edit",
  "reports.view",
  "admin.users",
  "admin.settings",
  "admin.audit",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

const MATRIX: Record<Role, Set<Permission>> = {
  ADMIN: ALL,
  PROJECT_MANAGER: new Set<Permission>([
    "jobs.view", "leads.edit", "leads.decide", "jobs.create", "estimate.edit", "estimate.finalize", "quote.edit",
    "submission.edit", "submission.approvePrice", "submission.outcome", "project.activate", "project.manage",
    "shopdrawing.edit", "shopdrawing.decide", "procurement.edit", "procurement.receive", "procurement.overrideDelivery",
    "materials.edit", "labour.schedule", "time.submit", "time.manage", "dailyreport.submit", "rfi.create", "change.edit",
    "change.approve", "financials.view", "billing.prepare", "supplierInvoice.approve", "inspection.edit", "closeout.edit",
    "closeout.waive", "closeout.close", "documents.view", "documents.upload", "documents.approve", "company.documents",
    "directory.edit", "workers.edit", "calendar.edit", "reports.view", "field.use",
  ]),
  ESTIMATOR: new Set<Permission>([
    "jobs.view", "leads.edit", "estimate.edit", "quote.edit", "submission.edit", "financials.view", "documents.view",
    "documents.upload", "directory.edit", "change.edit", "calendar.edit", "reports.view",
  ]),
  PROCUREMENT: new Set<Permission>([
    "jobs.view", "quote.edit", "procurement.edit", "procurement.receive", "materials.edit", "shopdrawing.edit",
    "supplierInvoice.edit", "financials.view", "documents.view", "documents.upload", "directory.edit", "calendar.edit",
    "reports.view",
  ]),
  ACCOUNTING: new Set<Permission>([
    "jobs.view", "financials.view", "billing.prepare", "billing.edit", "supplierInvoice.edit", "supplierInvoice.approve",
    "closeout.edit", "documents.view", "documents.upload", "directory.edit", "company.documents", "calendar.edit",
    "reports.view", "time.manage",
  ]),
  // Office admin: sees the office side, invoices Ready-to-bill work in QuickBooks and marks them billed.
  OFFICE_ADMIN: new Set<Permission>([
    "jobs.view", "financials.view", "billing.edit", "documents.view", "documents.upload", "company.documents",
    "directory.edit", "calendar.edit", "reports.view",
  ]),
  SITE_SUPERVISOR: new Set<Permission>([
    "jobs.view", "labour.schedule", "time.submit", "dailyreport.submit", "rfi.create", "procurement.receive",
    "materials.edit", "inspection.edit", "closeout.edit", "documents.view", "documents.upload", "field.use",
    "calendar.edit", "shopdrawing.edit",
  ]),
  ELECTRICIAN: new Set<Permission>(["field.use"]),
  READ_ONLY: new Set<Permission>(["jobs.view", "financials.view", "documents.view", "reports.view"]),
};

export function can(role: Role, perm: Permission): boolean {
  return MATRIX[role]?.has(perm) ?? false;
}

export function permissionsFor(role: Role): Permission[] {
  return [...(MATRIX[role] ?? [])];
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  PROJECT_MANAGER: "Project Manager",
  ESTIMATOR: "Estimator",
  PROCUREMENT: "Procurement Manager",
  ACCOUNTING: "Accounting",
  OFFICE_ADMIN: "Office Admin",
  SITE_SUPERVISOR: "Site Supervisor",
  ELECTRICIAN: "Electrician",
  READ_ONLY: "Read-only User",
};

/** Roles whose users only see the field app and their assigned jobs. */
export function isFieldOnly(role: Role) {
  return role === "ELECTRICIAN";
}
