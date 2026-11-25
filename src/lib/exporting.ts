import "server-only";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import path from "node:path";
import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { getSetting } from "./settings";

export type Col = { key: string; label: string; money?: boolean; num?: boolean; width?: number };
type Cell = string | number | Date | null | undefined;

const fmtMoney = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const fmtCell = (v: Cell, c: Col) => (v == null || v === "" ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : c.money ? fmtMoney(Number(v)) : c.num ? Number(v).toLocaleString("en-CA", { maximumFractionDigits: 2 }) : String(v));

/** One or more sheets → xlsx buffer. */
export async function toXlsx(sheets: { name: string; title?: string; columns: Col[]; rows: Record<string, Cell>[]; totals?: Record<string, number> }[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = await getSetting("company.name");
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    let r = 1;
    if (s.title) {
      ws.getCell(r, 1).value = s.title;
      ws.getCell(r, 1).font = { bold: true, size: 13 };
      r += 2;
    }
    const header = ws.getRow(r);
    s.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.label;
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
      ws.getColumn(i + 1).width = c.width ?? Math.max(10, Math.min(48, c.label.length + 6, ...s.rows.slice(0, 200).map((row) => String(row[c.key] ?? "").length + 2)));
      if (c.money) ws.getColumn(i + 1).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
      else if (c.num) ws.getColumn(i + 1).numFmt = "#,##0.00";
    });
    ws.views = [{ state: "frozen", ySplit: r }];
    for (const row of s.rows) {
      r += 1;
      const x = ws.getRow(r);
      s.columns.forEach((c, i) => {
        const v = row[c.key];
        x.getCell(i + 1).value = v == null ? null : v instanceof Date ? v : c.money || c.num ? Number(v) : String(v);
        if (v instanceof Date) x.getCell(i + 1).numFmt = "yyyy-mm-dd";
      });
    }
    if (s.totals) {
      r += 1;
      const x = ws.getRow(r);
      x.font = { bold: true };
      x.getCell(1).value = "Total";
      s.columns.forEach((c, i) => {
        if (c.key in s.totals! && i > 0) x.getCell(i + 1).value = s.totals![c.key];
      });
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

type PdfBlock =
  | { kind: "kv"; items: [string, string][] }
  | { kind: "text"; text: string; bold?: boolean }
  | { kind: "table"; columns: Col[]; rows: Record<string, Cell>[]; totals?: Record<string, number> }
  | { kind: "summary"; items: [string, string, boolean?][] };

/** Simple branded PDF: header, blocks, footer. Landscape for wide tables. */
export async function toPdf(opts: { title: string; subtitle?: string; blocks: PdfBlock[]; landscape?: boolean }) {
  const [company, address, phone, hst] = await Promise.all([getSetting("company.name"), getSetting("company.address"), getSetting("company.phone"), getSetting("company.hstNumber")]);
  const doc = new PDFDocument({ size: "LETTER", layout: opts.landscape ? "landscape" : "portrait", margin: 40, bufferPages: true, info: { Title: opts.title, Author: company } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const W = doc.page.width - 80;

  const logo = path.join(process.cwd(), "public", "brand", "logo.png");
  if (existsSync(logo)) {
    doc.image(logo, 40, 34, { height: 44 });
    doc.y = 84;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#1e3962").text(company, 40, doc.y);
  } else {
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#1e3962").text(company, 40, 40);
  }
  doc.font("Helvetica").fontSize(8).fillColor("#475569").text([address, phone, hst ? `HST ${hst}` : ""].filter(Boolean).join("  ·  "));
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#0f172a").text(opts.title);
  if (opts.subtitle) doc.font("Helvetica").fontSize(9).fillColor("#475569").text(opts.subtitle);
  doc.moveDown(0.6);

  const ensure = (h: number) => {
    if (doc.y + h > doc.page.height - 50) doc.addPage();
  };

  for (const b of opts.blocks) {
    if (b.kind === "text") {
      ensure(30);
      doc.font(b.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor("#0f172a").text(b.text, 40, doc.y, { width: W });
      doc.moveDown(0.5);
    } else if (b.kind === "kv") {
      const colW = W / 2;
      for (let i = 0; i < b.items.length; i += 2) {
        ensure(28);
        const y = doc.y;
        let maxY = y;
        b.items.slice(i, i + 2).forEach(([k, v], j) => {
          doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(k.toUpperCase(), 40 + j * colW, y, { width: colW - 10 });
          doc.font("Helvetica").fontSize(9).fillColor("#0f172a").text(v || "—", 40 + j * colW, doc.y, { width: colW - 10 });
          maxY = Math.max(maxY, doc.y);
        });
        doc.y = maxY + 4;
      }
      doc.moveDown(0.4);
    } else if (b.kind === "summary") {
      for (const [k, v, strong] of b.items) {
        ensure(16);
        const y = doc.y;
        doc.font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(strong ? 10 : 9).fillColor("#0f172a");
        doc.text(k, 40 + W - 260, y, { width: 150, align: "left" });
        doc.text(v, 40 + W - 110, y, { width: 110, align: "right" });
        doc.y = y + (strong ? 15 : 13);
      }
      doc.moveDown(0.4);
    } else {
      const weights = b.columns.map((c) => c.width ?? (c.money || c.num ? 1 : 2));
      const total = weights.reduce((a, x) => a + x, 0);
      const widths = weights.map((w) => (w / total) * W);
      const drawHeader = () => {
        const y = doc.y;
        doc.rect(40, y - 2, W, 14).fill("#e8eef7");
        let x = 40;
        b.columns.forEach((c, i) => {
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#0f172a").text(c.label, x + 3, y + 1, { width: widths[i] - 6, align: c.money || c.num ? "right" : "left", lineBreak: false, ellipsis: true });
          x += widths[i];
        });
        doc.y = y + 15;
      };
      ensure(40);
      drawHeader();
      const drawRow = (cells: string[], bold = false) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
        const h = Math.max(11, ...cells.map((t, i) => doc.heightOfString(t || " ", { width: widths[i] - 6 }))) + 3;
        if (doc.y + h > doc.page.height - 50) {
          doc.addPage();
          drawHeader();
        }
        const y = doc.y;
        let x = 40;
        cells.forEach((t, i) => {
          const c = b.columns[i];
          doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).fillColor("#0f172a").text(t, x + 3, y, { width: widths[i] - 6, align: c.money || c.num ? "right" : "left" });
          x += widths[i];
        });
        doc.moveTo(40, y + h - 1).lineTo(40 + W, y + h - 1).lineWidth(0.3).strokeColor("#e2e8f0").stroke();
        doc.y = y + h;
      };
      for (const row of b.rows) drawRow(b.columns.map((c) => fmtCell(row[c.key], c)));
      if (b.totals) drawRow(b.columns.map((c, i) => (i === 0 ? "Total" : c.key in b.totals! ? fmtCell(b.totals![c.key], c) : "")), true);
      doc.moveDown(0.6);
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(7).fillColor("#94a3b8").text(`${company} · ${opts.title} · Page ${i + 1} of ${range.count} · Generated ${new Date().toLocaleString("en-CA", { timeZone: "America/Toronto" })}`, 40, doc.page.height - 30, { width: W, align: "center", lineBreak: false });
  }
  doc.end();
  return done;
}

export function fileResponse(data: Buffer, fileName: string, kind: "xlsx" | "pdf", inline = false) {
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export const money = fmtMoney;
