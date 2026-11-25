import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fileResponse, money, toPdf } from "@/lib/exporting";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can(user.role, "procurement.edit") && !can(user.role, "financials.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, project: true, lines: { orderBy: { id: "asc" } } } });
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const pdf = await toPdf({
    title: `${po.status === "DRAFT" ? "DRAFT " : ""}Purchase Order ${po.number}`,
    subtitle: `${po.project.number} · ${po.project.name}`,
    blocks: [
      { kind: "kv", items: [
        ["Supplier", [po.supplier.name, po.supplier.address, po.supplier.email].filter(Boolean).join("\n")],
        ["Issued / expected delivery", `${po.issuedAt ? po.issuedAt.toISOString().slice(0, 10) : "not issued"} / ${po.expectedDelivery ? po.expectedDelivery.toISOString().slice(0, 10) : "—"}`],
        ["Deliver to", po.deliveryAddress ?? po.project.location ?? "—"],
        ["Reference on invoices", `${po.number} (job ${po.project.number})`],
      ] },
      ...(po.shopDrawingsRequired ? [{ kind: "text" as const, bold: true, text: "Shop drawings are required. Submit them for approval before delivery; deliveries are not accepted until drawings are approved." }] : []),
      { kind: "table", columns: [{ key: "d", label: "Description", width: 4 }, { key: "q", label: "Qty", num: true }, { key: "u", label: "Unit", width: 0.7 }, { key: "c", label: "Unit cost", money: true }, { key: "e", label: "Extended", money: true }], rows: po.lines.map((l) => ({ d: l.description, q: Number(l.quantity), u: l.unit, c: Number(l.unitCost), e: Number(l.quantity) * Number(l.unitCost) })) },
      { kind: "summary", items: [["Total before tax", money(Number(po.total)), true]] },
      ...(po.notes ? [{ kind: "text" as const, text: `Notes: ${po.notes}` }] : []),
    ],
  });
  return fileResponse(pdf, `${po.number}.pdf`, "pdf", true);
}
