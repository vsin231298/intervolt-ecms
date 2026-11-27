import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { addDays, parseDate, today } from "@/lib/dates";
import { fileResponse, toXlsx } from "@/lib/exporting";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can(user.role, "time.manage") && !can(user.role, "time.submit") && !can(user.role, "time.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const from = parseDate(sp.get("from") ?? "") ?? addDays(today(), -13);
  const to = parseDate(sp.get("to") ?? "") ?? today();
  const entries = await prisma.timeEntry.findMany({
    where: { date: { gte: from, lte: to }, ...(sp.get("worker") ? { workerId: sp.get("worker")! } : {}), ...(sp.get("job") ? { projectId: sp.get("job")! } : {}) },
    include: { worker: true, project: true },
    orderBy: [{ date: "asc" }, { worker: { name: "asc" } }],
  });
  const showCost = can(user.role, "financials.view");
  const columns = [
    { key: "date", label: "Date" }, { key: "worker", label: "Employee" }, { key: "wo", label: "WO #" }, { key: "job", label: "Job" },
    { key: "reg", label: "Regular h", num: true }, { key: "ot", label: "Overtime h", num: true },
    ...(showCost ? [{ key: "cost", label: "Cost", money: true }] : []),
    { key: "costCode", label: "Cost code" }, { key: "source", label: "Source" }, { key: "approved", label: "Approved" }, { key: "description", label: "Description" },
  ];
  const rows = entries.map((e) => ({ date: e.date, worker: e.worker.name, wo: e.project.number, job: e.project.name, reg: Number(e.regularHours), ot: Number(e.overtimeHours), cost: Number(e.cost), costCode: e.costCode ?? "", source: e.source.toLowerCase(), approved: e.approvedAt ? "yes" : "no", description: e.description ?? "" }));
  const totals = { reg: rows.reduce((s, r) => s + r.reg, 0), ot: rows.reduce((s, r) => s + r.ot, 0), ...(showCost ? { cost: rows.reduce((s, r) => s + r.cost, 0) } : {}) };
  const range = `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`;
  const buf = await toXlsx([{ name: "Timesheets", title: `Timesheets ${range}`, columns, rows, totals }]);
  return fileResponse(buf, `Timesheets ${range}.xlsx`, "xlsx");
}
