import { requireUser } from "@/lib/auth";
import { addDays, fmtDate, isoDate, parseDate, today } from "@/lib/dates";
import { money, qty } from "@/lib/money";
import { JOB_TYPE_LABELS } from "@/lib/workflow";
import { Card, Empty, Field, PageHeader } from "@/components/ui";
import { REPORT_TYPES, runReport, type ReportType } from "@/services/reports";
import type { JobType } from "@prisma/client";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ type?: string; from?: string; to?: string; jobType?: string }> }) {
  await requireUser("reports.view");
  const sp = await searchParams;
  const t0 = today();
  const type = (Object.keys(REPORT_TYPES) as ReportType[]).find((k) => k === sp.type) ?? "active";
  const from = parseDate(sp.from ?? "") ?? new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), 1));
  const to = parseDate(sp.to ?? "") ?? t0;
  const jobType = (Object.keys(JOB_TYPE_LABELS) as JobType[]).find((k) => k === sp.jobType);
  const res = await runReport({ type, from, to, jobType });
  const qs = new URLSearchParams({ type, from: isoDate(from), to: isoDate(to), ...(jobType ? { jobType } : {}) }).toString();
  const fmt = (v: unknown, c: { money?: boolean; num?: boolean }) => (v == null || v === "" ? "—" : v instanceof Date ? fmtDate(v) : c.money ? money(v as number) : c.num ? qty(v as number) : String(v).replace(/_/g, " "));
  const presets: [string, Date, Date][] = [
    ["This month", new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), 1)), t0],
    ["Last month", new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() - 1, 1)), new Date(Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), 0))],
    ["Last 90 days", addDays(t0, -89), t0],
    ["Year to date", new Date(Date.UTC(t0.getUTCFullYear(), 0, 1)), t0],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle="Pick a report and date range. Export to Excel or PDF." />
      <form className="card flex flex-wrap items-end gap-3 p-4">
        <Field label="Report"><select name="type" defaultValue={type} className="input w-56">{Object.entries(REPORT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="From"><input type="date" name="from" defaultValue={isoDate(from)} className="input" /></Field>
        <Field label="To"><input type="date" name="to" defaultValue={isoDate(to)} className="input" /></Field>
        <Field label="Job type"><select name="jobType" defaultValue={jobType ?? ""} className="input"><option value="">All</option>{Object.entries(JOB_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <button className="btn btn-primary">Run</button>
        <div className="ml-auto flex gap-2">
          <a className="btn btn-secondary" href={`/api/export/report?${qs}&format=xlsx`}>Excel</a>
          <a className="btn btn-secondary" href={`/api/export/report?${qs}&format=pdf`} target="_blank" rel="noreferrer">PDF</a>
        </div>
        <div className="flex w-full flex-wrap gap-2 text-xs">
          {presets.map(([l, f, tt]) => <a key={l} className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50" href={`/reports?${new URLSearchParams({ type, from: isoDate(f), to: isoDate(tt), ...(jobType ? { jobType } : {}) })}`}>{l}</a>)}
        </div>
      </form>
      <Card title={`${REPORT_TYPES[type]} · ${fmtDate(from)} to ${fmtDate(to)} · ${res.rows.length} row(s)`} bodyClass="overflow-x-auto">
        {res.rows.length === 0 ? <div className="p-4"><Empty>No results for this period.</Empty></div> : (
          <table className="table">
            <thead><tr>{res.columns.map((c) => <th key={c.key} className={c.money || c.num ? "num" : ""}>{c.label}</th>)}</tr></thead>
            <tbody>
              {res.rows.map((row, i) => <tr key={i}>{res.columns.map((c) => <td key={c.key} className={c.money || c.num ? "num" : ""}>{fmt(row[c.key], c)}</td>)}</tr>)}
              {res.totals ? <tr className="font-semibold">{res.columns.map((c, i) => <td key={c.key} className={c.money || c.num ? "num" : ""}>{i === 0 ? "Total" : c.key in res.totals! ? fmt(res.totals![c.key], c) : ""}</td>)}</tr> : null}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
