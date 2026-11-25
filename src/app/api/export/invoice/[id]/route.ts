import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fileResponse, money, toPdf } from "@/lib/exporting";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can(user.role, "financials.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { project: { include: { client: true, contract: true } }, clientPo: true, changeOrder: true, payments: true, draw: { include: { lines: { include: { billingLine: true } } } } },
  });
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const p = inv.project;
  const lines = inv.draw
    ? inv.draw.lines.filter((l) => Number(l.thisPeriodAmount) !== 0).map((l) => ({ d: l.billingLine.description, sv: Number(l.billingLine.scheduledValue), prev: Number(l.previousAmount), now: Number(l.thisPeriodAmount), todate: Number(l.previousAmount) + Number(l.thisPeriodAmount) }))
    : [{ d: inv.description ?? (inv.isHoldbackRelease ? "Release of holdback" : inv.changeOrder ? `${inv.changeOrder.number} ${inv.changeOrder.title}` : "Services"), sv: null, prev: null, now: Number(inv.subtotal), todate: null }];
  const pdf = await toPdf({
    title: `${inv.status === "DRAFT" ? "DRAFT " : ""}Invoice ${inv.number}`,
    subtitle: `${p.number} · ${p.name}`,
    blocks: [
      { kind: "kv", items: [
        ["Bill to", [p.client?.name, p.client?.address].filter(Boolean).join("\n") || "—"],
        ["Invoice date / due", `${inv.invoiceDate.toISOString().slice(0, 10)} / ${inv.dueDate.toISOString().slice(0, 10)}`],
        ["Work order", `${p.number} ${p.name}${p.location ? `\n${p.location}` : ""}`],
        ["Client PO", inv.clientPo?.poNumber ?? p.contract?.clientPoNumber ?? inv.changeOrder?.clientPoNumber ?? "—"],
      ] },
      inv.draw
        ? { kind: "table", columns: [{ key: "d", label: "Description", width: 3 }, { key: "sv", label: "Scheduled value", money: true }, { key: "prev", label: "Previously billed", money: true }, { key: "now", label: "This period", money: true }, { key: "todate", label: "Billed to date", money: true }], rows: lines }
        : { kind: "table", columns: [{ key: "d", label: "Description", width: 4 }, { key: "now", label: "Amount", money: true }], rows: lines },
      { kind: "summary", items: [
        ["Subtotal", money(Number(inv.subtotal))],
        ...(Number(inv.holdback) ? [[`Less holdback`, `(${money(Number(inv.holdback))})`] as [string, string]] : []),
        [`HST ${Number(inv.taxPercent)}%`, money(Number(inv.tax))],
        ["Total due", money(Number(inv.total)), true],
        ...(Number(inv.paidAmount) ? [["Paid", money(Number(inv.paidAmount))] as [string, string], ["Balance", money(Number(inv.total) - Number(inv.paidAmount)), true] as [string, string, boolean]] : []),
      ] },
      ...(inv.draw ? [{ kind: "text" as const, text: `Progress draw #${inv.draw.drawNumber}, period ending ${inv.draw.periodEnd.toISOString().slice(0, 10)}.` }] : []),
    ],
  });
  return fileResponse(pdf, `${inv.number}.pdf`, "pdf", true);
}
