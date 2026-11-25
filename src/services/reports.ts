import type { JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { d, sum } from "@/lib/money";
import { ACTIVE_STAGES } from "@/lib/workflow";

export const REPORT_TYPES = {
  active: "Active jobs",
  completed: "Completed jobs",
  cancelled: "Cancelled jobs",
  invoiced: "Invoiced (client invoices)",
  tenders: "Tender results",
  labour: "Labour hours",
} as const;
export type ReportType = keyof typeof REPORT_TYPES;

export type ReportInput = { type: ReportType; from: Date; to: Date; jobType?: JobType };

export type ReportResult = { columns: { key: string; label: string; money?: boolean; num?: boolean }[]; rows: Record<string, string | number | Date | null>[]; totals?: Record<string, number> };

const toDate = (dt: Date) => new Date(dt.getTime() + 86_400_000); // inclusive end

/** Date-range reports. "Date" means: active = active during range; completed/cancelled = closed in range; invoiced = invoice date in range. */
export async function runReport({ type, from, to, jobType }: ReportInput): Promise<ReportResult> {
  const end = toDate(to);
  const jt: Prisma.ProjectWhereInput = jobType ? { jobType } : {};
  if (type === "active") {
    const ps = await prisma.project.findMany({
      where: { ...jt, stage: { in: ACTIVE_STAGES }, OR: [{ startDate: null }, { startDate: { lt: end } }] },
      include: { client: true, projectManager: true, contract: true },
      orderBy: { number: "asc" },
    });
    return {
      columns: [{ key: "number", label: "WO #" }, { key: "name", label: "Job" }, { key: "jobType", label: "Type" }, { key: "client", label: "Client" }, { key: "pm", label: "PM" }, { key: "stage", label: "Stage" }, { key: "startDate", label: "Start" }, { key: "finishDate", label: "Finish" }, { key: "value", label: "Contract value", money: true }],
      rows: ps.map((p) => ({ number: p.number, name: p.name, jobType: p.jobType, client: p.client?.name ?? "", pm: p.projectManager?.name ?? "", stage: p.stage, startDate: p.startDate, finishDate: p.finishDate, value: p.contract ? Number(p.contract.currentValue) : null })),
      totals: { value: sum(ps.map((p) => p.contract?.currentValue ?? 0)).toNumber() },
    };
  }
  if (type === "completed" || type === "cancelled") {
    const reasons = type === "completed" ? ["COMPLETED"] : ["CANCELLED", "NOT_DOABLE", "LOST_BID"];
    const ps = await prisma.project.findMany({
      where: { ...jt, stage: "CLOSED", closeReason: { in: reasons as never }, closedAt: { gte: from, lt: end } },
      include: { client: true, projectManager: true, contract: true, invoices: { where: { status: { notIn: ["VOID", "DRAFT"] } } } },
      orderBy: { closedAt: "asc" },
    });
    return {
      columns: [{ key: "number", label: "WO #" }, { key: "name", label: "Job" }, { key: "jobType", label: "Type" }, { key: "client", label: "Client" }, { key: "pm", label: "PM" }, { key: "reason", label: "Reason" }, { key: "closedAt", label: "Closed" }, { key: "value", label: "Contract value", money: true }, { key: "invoiced", label: "Invoiced", money: true }],
      rows: ps.map((p) => ({ number: p.number, name: p.name, jobType: p.jobType, client: p.client?.name ?? "", pm: p.projectManager?.name ?? "", reason: [p.closeReason, p.closeNote].filter(Boolean).join(": "), closedAt: p.closedAt, value: p.contract ? Number(p.contract.currentValue) : null, invoiced: sum(p.invoices.map((i) => i.subtotal)).toNumber() })),
      totals: { value: sum(ps.map((p) => p.contract?.currentValue ?? 0)).toNumber(), invoiced: sum(ps.flatMap((p) => p.invoices.map((i) => i.subtotal))).toNumber() },
    };
  }
  if (type === "invoiced") {
    const invs = await prisma.invoice.findMany({ where: { status: { notIn: ["VOID", "DRAFT"] }, invoiceDate: { gte: from, lt: end }, project: jt }, include: { project: { include: { client: true } } }, orderBy: { invoiceDate: "asc" } });
    return {
      columns: [{ key: "number", label: "Invoice #" }, { key: "date", label: "Date" }, { key: "wo", label: "WO #" }, { key: "job", label: "Job" }, { key: "client", label: "Client" }, { key: "status", label: "Status" }, { key: "subtotal", label: "Subtotal", money: true }, { key: "holdback", label: "Holdback", money: true }, { key: "tax", label: "Tax", money: true }, { key: "total", label: "Total", money: true }, { key: "paid", label: "Paid", money: true }],
      rows: invs.map((i) => ({ number: i.number, date: i.invoiceDate, wo: i.project.number, job: i.project.name, client: i.project.client?.name ?? "", status: i.status, subtotal: Number(i.subtotal), holdback: Number(i.holdback), tax: Number(i.tax), total: Number(i.total), paid: Number(i.paidAmount) })),
      totals: Object.fromEntries((["subtotal", "holdback", "tax", "total", "paidAmount"] as const).map((k) => [k === "paidAmount" ? "paid" : k, sum(invs.map((i) => i[k])).toNumber()])),
    };
  }
  if (type === "tenders") {
    const subs = await prisma.tenderSubmission.findMany({ where: { submittedAt: { gte: from, lt: end }, project: jt }, include: { project: { include: { client: true } } }, orderBy: { submittedAt: "asc" } });
    return {
      columns: [{ key: "wo", label: "WO #" }, { key: "job", label: "Job" }, { key: "client", label: "Client" }, { key: "submitted", label: "Submitted" }, { key: "amount", label: "Our price", money: true }, { key: "outcome", label: "Outcome" }, { key: "winning", label: "Winning price", money: true }, { key: "reason", label: "Reason" }],
      rows: subs.map((s) => ({ wo: s.project.number, job: s.project.name, client: s.project.client?.name ?? "", submitted: s.submittedAt, amount: s.submittedAmount ? Number(s.submittedAmount) : null, outcome: s.outcome, winning: s.winningAmount ? Number(s.winningAmount) : null, reason: s.outcomeReason ?? "" })),
      totals: { amount: sum(subs.map((s) => s.submittedAmount ?? 0)).toNumber() },
    };
  }
  const entries = await prisma.timeEntry.findMany({ where: { date: { gte: from, lt: end }, project: jt }, include: { worker: true, project: true } });
  const groups = new Map<string, { worker: string; job: string; wo: string; reg: number; ot: number; cost: number }>();
  for (const e of entries) {
    const k = `${e.workerId}|${e.projectId}`;
    const g = groups.get(k) ?? { worker: e.worker.name, job: e.project.name, wo: e.project.number, reg: 0, ot: 0, cost: 0 };
    g.reg += Number(e.regularHours);
    g.ot += Number(e.overtimeHours);
    g.cost = d(g.cost).plus(d(e.cost)).toNumber();
    groups.set(k, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.worker.localeCompare(b.worker) || a.wo.localeCompare(b.wo));
  return {
    columns: [{ key: "worker", label: "Employee" }, { key: "wo", label: "WO #" }, { key: "job", label: "Job" }, { key: "reg", label: "Regular h", num: true }, { key: "ot", label: "Overtime h", num: true }, { key: "cost", label: "Cost", money: true }],
    rows,
    totals: { reg: rows.reduce((s, r) => s + r.reg, 0), ot: rows.reduce((s, r) => s + r.ot, 0), cost: rows.reduce((s, r) => s + r.cost, 0) },
  };
}
