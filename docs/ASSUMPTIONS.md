# Assumptions to confirm

These rules were not specified, so the system uses the defaults below. Change most of them in **Admin → Settings** without any code changes.

| # | Topic | Default used | Where to change |
|---|---|---|---|
| 1 | Sales tax | 13% HST on invoices (Ontario) | Settings → Billing |
| 2 | Holdback | 10% deducted on progress draws; tax charged on the amount after holdback; released by a separate holdback-release invoice | Settings → Billing (per job: Info tab) |
| 3 | Payment terms | Net 30 from invoice date | Settings → Billing |
| 4 | Progress draws | Due on the 25th of each month; client approval recorded before invoicing | Settings → Billing |
| 5 | Estimating | Labour $95/h, overhead 10% of direct cost, profit 10% of (direct + overhead) | Settings → Estimating |
| 6 | Change orders | Default markup 15%; credits allowed (negative quantities); markup applies to credits too | Settings → Estimating & changes |
| 7 | Overtime | Hours over 8 per day per worker count as overtime; clock time rounded to 15 minutes | Settings → Labour |
| 8 | Labour cost | Worker's hourly rate × hours; optional burden % (default 0%) | Settings → Labour; rates on each employee |
| 9 | Shop drawings | Deliveries on a PO that needs supplier shop drawings are held until approved; PM / admin can override with a reason (audited) | Settings → Procurement |
| 10 | 3-way match | Supplier invoice price may be up to 2% over the PO price; quantities may not exceed received-not-billed. Variances need an override reason to approve | Settings → Procurement |
| 11 | Activation | Work can't start until the activation checklist passes (contract, client PO, PM, start/finish dates) | Settings → Workflow |
| 12 | Closeout | Checklists per job type, with automatic system checks; mandatory items must be complete or waived (PM/admin, with reason) | Settings → Closeout checklists |
| 13 | Reminders | Tender deadlines 7/3/1 days before; quote follow-up after 3 days; certificate expiry 30 days before | Settings → Reminders |
| 14 | Who sees money | Admin, PM, Estimator, Procurement, Accounting and Read-only can see costs and billing; Site Supervisor and Electrician cannot | Ask for a change (code) |
| 15 | Electricians | See only jobs they are scheduled on today or are team members of | Schedule them on the Labour tab |
| 16 | Work order numbers | One sequence for all job types: WO-YYYY-#### | Prefix in Settings |
| 17 | Email | The system notifies inside the app (bell icon). Sending emails is not switched on; it can be added later with a free SMTP account | — |
| 18 | QuickBooks | Not connected yet; claims pipeline and reports export to Excel for now | Future integration |
