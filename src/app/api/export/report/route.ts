import { NextResponse } from "next/server";
import type { JobType } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { parseDate, today } from "@/lib/dates";
import { JOB_TYPE_LABELS } from "@/lib/workflow";
import { fileResponse, toPdf, toXlsx } from "@/lib/exporting";
import { REPORT_TYPES, runReport, type ReportType } from "@/services/reports";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can(user.role, "reports.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const type = (Object.keys(REPORT_TYPES) as ReportType[]).find((k) => k === sp.get("type")) ?? "active";
  const from = parseDate(sp.get("from") ?? "") ?? today();
  const to = parseDate(sp.get("to") ?? "") ?? today();
  const jobType = (Object.keys(JOB_TYPE_LABELS) as JobType[]).find((k) => k === sp.get("jobType"));
  const res = await runReport({ type, from, to, jobType });
  const range = `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`;
  const name = `${REPORT_TYPES[type]} ${range}`;
  const rows = res.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? v.replace(/_/g, " ") : v])));
  if (sp.get("format") === "pdf") {
    const pdf = await toPdf({ title: REPORT_TYPES[type], subtitle: `${range}${jobType ? ` · ${JOB_TYPE_LABELS[jobType]}` : ""} · ${rows.length} row(s)`, landscape: res.columns.length > 6, blocks: [{ kind: "table", columns: res.columns, rows, totals: res.totals }] });
    return fileResponse(pdf, `${name}.pdf`, "pdf", true);
  }
  const buf = await toXlsx([{ name: REPORT_TYPES[type], title: `${name}${jobType ? ` · ${JOB_TYPE_LABELS[jobType]}` : ""}`, columns: res.columns, rows, totals: res.totals }]);
  return fileResponse(buf, `${name}.xlsx`, "xlsx");
}
