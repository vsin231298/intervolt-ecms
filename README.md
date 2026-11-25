# Intervolt ECMS — Electrical Contracting Management System

A web application for Intervolt Electric that runs the whole job lifecycle in one place:
lead/tender → doable decision → estimate & BOM → supplier quotes → submission → award → activation →
procurement & shop drawings → materials & labour → field work → RFIs/ESIs/change orders → billing → inspections → closeout.

Everything runs on free software. No per-user fees, and no outside accounts are needed for your staff.

- **Setup guide (start here):** [docs/SETUP.md](docs/SETUP.md)
- **How to use it, by role:** [docs/USER-GUIDE.md](docs/USER-GUIDE.md)
- **Assumptions you should confirm:** [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)

## What's inside

| Area | Highlights |
|---|---|
| Leads & tenders | Work order number assigned at lead stage and kept for life (WO-YYYY-####), Doable / Not doable review with reason, deadlines and reminders, communications log |
| Estimating | BOM editor, paste from Excel, labour units, overhead & profit, revisions (copy, compare, finalize), Excel/PDF export |
| Supplier quotes | RFQs from BOM lines, quote recording, comparison matrix, lowest-price selection, link prices to the BOM, PO from quote |
| Submission | Final price approval, submitted record, Awarded / Not awarded branch; award auto-creates contract, client PO, billing line, material register, folders, schedule and closeout list |
| Job types | Project jobs, Small jobs / minor work orders, Service work orders (direct jobs start active) |
| Procurement | Material requests → PO → supplier shop drawings → approval gate → delivery (partial) → tagged to job → supplier invoice → 3-way match → approval → payment |
| Shop drawings | Intervolt review, submit, Approved / Approved as noted / Revise and resubmit (new revision), linked PO deliveries held until approved |
| Materials | Register (required / ordered / received / used), manual entries (project, supplier, who ordered, date, Ordered/Received/Cancelled/Invoiced), usage |
| Labour | Crew scheduling with double-booking warnings, timesheets, clock-in/out with GPS, overtime split, approval, edit/delete with reason (audited), estimated vs actual |
| Field app (phone) | Today's assigned jobs, navigate to site, clock in/out, drawings & scope, photos, materials used, updates/issues to PM, complete work order, customer signature |
| Changes | RFIs, ESIs, change orders with pricing (credits allowed), client decision; original contract value is locked and every change goes to an append-only ledger |
| Billing | Schedule of values, progress draws with holdback, invoices (PDF), payments, holdback release, AR aging |
| Inspections & closeout | ESA and other inspections, deficiencies, commissioning, closeout checklist with system checks; job closes only when every mandatory item is complete or formally waived |
| Company | Dashboards (Operations, Projects claims pipeline, Finance), calendar ("My Schedule"), employee schedule by employee/job/date, document library with versioning and expiry, employees & certifications, clients & suppliers, reports (Excel/PDF), notifications, global search |
| Security | 8 roles with permissions, hashed passwords, login rate-limit, sessions in the database, audit log of every change, database-level guards against tampering |

## Tech

Next.js 15 (App Router, server actions) · TypeScript · PostgreSQL 16 · Prisma · Tailwind CSS · Recharts · ExcelJS · PDFKit · Docker.

## Developer quick start

```bash
cp .env.example .env            # point DATABASE_URL at a local PostgreSQL
npm install
npm run db:migrate              # create tables
ADMIN_EMAIL=you@x.ca ADMIN_PASSWORD='Choose1234' npm run db:setup
npm run dev                     # http://localhost:3000
```

Optional sample data for a demo database only (refuses to run in production): `DEMO_DATA=1 npm run demo`.

Tests (need an empty database whose name ends in `_test`):

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/intervolt_test npm test
```

## Project layout

```
prisma/              schema + migrations (incl. integrity triggers)
src/lib/             auth, permissions, money, dates, settings, storage, numbering, audit, exports
src/services/        business logic (one file per module) — used by pages, actions and tests
src/app/actions/     server actions (forms) — thin wrappers over services
src/app/(app)/       pages: dashboard, leads, jobs/[id]/*, company pages, field app, admin
src/app/api/         file downloads, Excel/PDF exports, health check, reminder runner
scripts/             first-admin setup, reminder runner, backup/restore, demo data
tests/               end-to-end business scenarios against PostgreSQL
```
