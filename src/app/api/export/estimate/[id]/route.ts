import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fileResponse, money, toPdf, toXlsx, type Col } from "@/lib/exporting";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can(user.role, "jobs.view") || !(can(user.role, "estimate.edit") || can(user.role, "financials.view"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const e = await prisma.estimate.findUnique({ where: { id }, include: { project: { include: { client: true } }, lines: { orderBy: [{ sortOrder: "asc" }] } } });
  if (!e) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  const columns: Col[] = [
    { key: "section", label: "Section" },
    { key: "category", label: "Type" },
    { key: "description", label: "Description", width: 3 },
    { key: "mfr", label: "Manufacturer / model" },
    { key: "quantity", label: "Qty", num: true },
    { key: "unit", label: "Unit", width: 0.6 },
    { key: "unitPrice", label: "Unit price", money: true },
    { key: "materialTotal", label: "Material", money: true },
    { key: "hpu", label: "Labour h/unit", num: true },
    { key: "labourHours", label: "Labour h", num: true },
  ];
  const rows = e.lines.map((l) => ({
    section: l.section ?? "",
    category: l.category.toLowerCase(),
    description: l.description,
    mfr: [l.manufacturer, l.model].filter(Boolean).join(" "),
    quantity: Number(l.quantity),
    unit: l.unit,
    unitPrice: l.category === "LABOUR" ? null : Number(l.unitPrice),
    materialTotal: Number(l.materialTotal),
    hpu: l.category === "LABOUR" ? null : Number(l.labourHoursPerUnit),
    labourHours: Number(l.labourHours),
  }));
  const totals = { materialTotal: Number(e.materialTotal) + Number(e.equipmentTotal) + Number(e.subcontractTotal), labourHours: Number(e.labourHours) };
  const summary: [string, string, boolean?][] = [
    ["Material", money(Number(e.materialTotal))],
    ["Equipment", money(Number(e.equipmentTotal))],
    ["Subcontract", money(Number(e.subcontractTotal))],
    [`Labour ${Number(e.labourHours)} h × ${money(Number(e.labourRate))}`, money(Number(e.labourTotal))],
    ["Direct cost", money(Number(e.directCost)), true],
    [`Overhead ${Number(e.overheadPercent)}%`, money(Number(e.overheadAmount))],
    [`Profit ${Number(e.profitPercent)}%`, money(Number(e.profitAmount))],
    ["Sell price", money(Number(e.sellPrice)), true],
  ];
  const name = `${e.project.number} Estimate Rev ${e.revision}`;
  await prisma.auditLog.create({ data: { userId: user.id, action: "estimate.export", entityType: "Estimate", entityId: e.id, projectId: e.projectId, summary: `${name} exported (${format})` } });
  if (format === "xlsx") {
    const buf = await toXlsx([
      { name: "BOM", title: `${name} — ${e.project.name} (${e.status.toLowerCase()})`, columns, rows, totals },
      { name: "Summary", columns: [{ key: "k", label: "Item" }, { key: "v", label: "Amount" }], rows: summary.map(([k, v]) => ({ k, v })) },
    ]);
    return fileResponse(buf, `${name}.xlsx`, "xlsx");
  }
  const pdf = await toPdf({
    title: `Estimate Rev ${e.revision}: ${e.title}`,
    subtitle: `${e.project.number} · ${e.project.name}${e.project.client ? ` · ${e.project.client.name}` : ""} · ${e.status.toLowerCase()}`,
    landscape: true,
    blocks: [{ kind: "table", columns, rows, totals }, { kind: "summary", items: summary }, ...(e.notes ? [{ kind: "text" as const, text: `Notes: ${e.notes}` }] : [])],
  });
  return fileResponse(pdf, `${name}.pdf`, "pdf", true);
}
