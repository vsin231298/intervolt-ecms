# User guide

## The flow of a project job

1. **Leads & Tenders → New lead.** A work order number (WO-2026-0001) is assigned now and kept for the life of the job. Add client, deadline, documents.
2. **Start review → Doable / Not doable.** Not doable closes the lead with a reason. Doable assigns an estimator.
3. **Estimates & BOM.** Add lines or paste from Excel. Labour hours per unit drive labour cost. Make a new revision any time; compare revisions; **Finalize** locks it. Export to Excel or PDF.
4. **Supplier Quotes.** Create an RFQ from the BOM lines, record each supplier's prices, compare, select (or "lowest for every item"), and apply selected prices to a draft estimate revision.
5. **Submission.** Prepare the final price → a PM approves → record as submitted → record **Awarded** (client PO, contract value, dates) or **Not awarded** (reason).
6. **Award** automatically creates the contract (original value locked), billing line, material register, folders, schedule and closeout checklist. The job moves to **Active Jobs**.
7. **Activation.** When the checklist is green, click **Start work**.
8. **Procurement.** Material request → PO → if the supplier must send shop drawings, log them under **Shop Drawings**; deliveries are held until approved → receive deliveries (partial OK) → record the supplier invoice (3-way match runs automatically) → approve → record payment.
9. **Labour.** Schedule crews; electricians clock in/out from their phones; supervisors add or fix time; managers approve.
10. **Changes.** RFIs (answer: change required → a draft change order opens), ESIs, change orders priced with lines (negative quantities for credits) → submit → client approves/rejects. Approved changes add to the contract value; the original never changes.
11. **Billing.** Break the contract into a schedule of values, prepare monthly draws by % complete (holdback automatic), invoice, record payments, release holdback at the end.
12. **Inspections.** Schedule ESA and other inspections; a failed result requires deficiencies; commissioning tests.
13. **Closeout.** Work the checklist. System checks (inspection passed, invoices paid, etc.) must be true to complete an item, or a PM can waive it with a reason. **Close job** is only possible when every mandatory item is done or waived.

## Small jobs and service work orders

**Jobs → New job** creates them directly as active jobs (no tender). Schedule the electrician, they complete the work order with the customer's signature on the phone, then invoice from the **Billing** tab.

## Electricians (phone)

Open the app address on the phone and sign in. Tip: use *Add to Home Screen* so it opens like an app.

1. **My jobs** shows today's jobs.
2. Tap a job → **Navigate to site**.
3. **Clock in** (allow location).
4. Read the **scope & drawings**.
5. **Upload photos**, **log material used**, **send updates or report an issue** to the PM.
6. **Complete work order**: describe the work, tick complete, customer signs with a finger.
7. **Clock out**. Hours go to the timesheet automatically, with overtime split.

## Office tips

- **Dashboard → Operations** lists everything needing attention (late deliveries, overdue invoices, pending timesheets, open issues, expiring certificates). Click a signal to jump to the list.
- **Calendar** shows your meetings, inspections, tender deadlines, task due dates and deliveries. Switch to *Everyone* for the whole company.
- **Employee Schedule** views by employee, by job or by date.
- **Timesheets**: add missed entries, edit or delete (reason required), approve, export to Excel.
- **Reports**: active, completed, cancelled, invoiced jobs, tender results and labour hours for any date range; export Excel/PDF.
- **Documents**: approved document revisions are never overwritten; uploading again creates a new revision.
- Every change is recorded in **Admin → Audit Log**.
