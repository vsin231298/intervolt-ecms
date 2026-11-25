import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fileResponse, money, toPdf } from "@/lib/exporting";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can(user.role, "change.edit") && !can(user.role, "financials.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const co = await prisma.changeOrder.findUnique({ where: { id }, include: { project: { include: { client: true, contract: true } }, lines: { orderBy: { id: "asc" } }, rfi: true, esi: true } });
  if (!co) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = co.lines.map((l) => {
    const lab = l.category === "LABOUR";
    return { t: l.category.toLowerCase(), d: l.description, q: Number(l.quantity), u: l.unit, p: lab ? null : Number(l.unitPrice), m: lab ? null : Number(l.quantity) * Number(l.unitPrice), h: lab ? Number(l.quantity) : Number(l.quantity) * Number(l.labourHoursPerUnit) };
  });
  const pdf = await toPdf({
    title: `Change Order ${co.number}${co.status === "DRAFT" ? " (draft)" : ""}`,
    subtitle: `${co.project.number} · ${co.project.name}`,
    blocks: [
      { kind: "kv", items: [
        ["To", co.project.client?.name ?? "—"],
        ["Reference", [co.rfi ? `RFI ${co.rfi.number}` : null, co.esi ? `ESI ${co.esi.number}` : null, co.project.contract ? `Contract PO ${co.project.contract.clientPoNumber}` : null].filter(Boolean).join(" · ") || "—"],
        ["Title", co.title],
        ["Schedule impact", `${co.scheduleImpactDays} working day(s)`],
      ] },
      { kind: "text", text: co.description },
      { kind: "text", text: `Reason: ${co.reason}` },
      { kind: "table", columns: [{ key: "t", label: "Type", width: 1 }, { key: "d", label: "Description", width: 3 }, { key: "q", label: "Qty", num: true }, { key: "u", label: "Unit", width: 0.6 }, { key: "p", label: "Unit price", money: true }, { key: "m", label: "Material", money: true }, { key: "h", label: "Labour h", num: true }], rows },
      { kind: "summary", items: [
        ["Material / equipment / subcontract", money(Number(co.materialCost))],
        [`Labour ${Number(co.labourHours)} h × ${money(Number(co.labourRate))}`, money(Number(co.labourCost))],
        ["Other", money(Number(co.otherCost))],
        [`Markup ${Number(co.markupPercent)}%`, money(Number(co.proposedAmount) - Number(co.materialCost) - Number(co.labourCost) - Number(co.otherCost))],
        ["Change order price (before tax)", money(Number(co.proposedAmount)), true],
      ] },
      { kind: "text", text: "Approved by (client): ____________________________   Date: ______________   PO #: ______________" },
    ],
  });
  return fileResponse(pdf, `${co.number}.pdf`, "pdf", true);
}
