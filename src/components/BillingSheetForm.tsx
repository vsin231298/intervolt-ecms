"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { ActionForm, Submit } from "@/components/ActionForm";
import { saveSheetAction } from "@/app/actions/billsheet";

type Kind = "LABOUR" | "MATERIAL" | "OTHER";
type Line = { key: number; kind: Kind; date: string | null; who: string | null; description: string; quantity: string; unitPrice: string };
type In = { kind: Kind; date: string | null; who: string | null; description: string; quantity: number; unitPrice: number | null };

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const n = (v: string) => { const x = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(x) ? x : 0; };
const fmtDay = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");

const SECTIONS: { kind: Kind; title: string; qty: string; price: string; add: string; hint: string }[] = [
  { kind: "LABOUR", title: "Labour", qty: "Hours", price: "Rate $/h", add: "Add labour", hint: "Hours come from clock-in/out." },
  { kind: "MATERIAL", title: "Materials", qty: "Qty", price: "Price $", add: "Add material", hint: "From what the guys wrote. Add prices." },
  { kind: "OTHER", title: "Other", qty: "Qty", price: "Amount $", add: "Add other", hint: "Parking, disposal, permits…" },
];

/** PM billing sheet. Big boxes so the iPad pencil (Scribble) can write straight into them. */
export function BillingSheetForm({ projectId, description, lines, taxPercent }: { projectId: string; description: string; lines: In[]; taxPercent: number }) {
  const [desc, setDesc] = useState(description);
  const [rows, setRows] = useState<Line[]>(() => lines.map((l, i) => ({ key: i, kind: l.kind, date: l.date, who: l.who, description: l.description, quantity: String(l.quantity), unitPrice: l.unitPrice == null ? "" : String(l.unitPrice) })));
  const [next, setNext] = useState(lines.length);
  const set = (key: number, patch: Partial<Line>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const add = (kind: Kind) => { setRows((r) => [...r, { key: next, kind, date: null, who: null, description: kind === "LABOUR" ? "Labour" : "", quantity: "1", unitPrice: "" }]); setNext(next + 1); };
  const t = useMemo(() => {
    const by = (k: Kind) => rows.filter((r) => r.kind === k).reduce((s, r) => s + Math.round(n(r.quantity) * n(r.unitPrice) * 100) / 100, 0);
    const labour = by("LABOUR"), materials = by("MATERIAL"), other = by("OTHER");
    const subtotal = labour + materials + other;
    const tax = Math.round(subtotal * taxPercent) / 100;
    return { labour, materials, other, subtotal, tax, total: subtotal + tax };
  }, [rows, taxPercent]);
  const payload = JSON.stringify({ description: desc, lines: rows.map((r) => ({ kind: r.kind, date: r.date, who: r.who, description: r.description, quantity: r.quantity === "" ? 0 : r.quantity, unitPrice: r.unitPrice === "" ? null : r.unitPrice })) });

  return (
    <ActionForm action={saveSheetAction} resetOnSuccess={false} className="grid gap-4 lg:grid-cols-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="payload" value={payload} />
      <div className="space-y-4 lg:col-span-2">
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Description for the invoice</h2>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} className="input text-base leading-relaxed" placeholder="Write what goes on the invoice" />
          <p className="mt-1 text-xs text-slate-500">Starts from the guys&apos; notes. Their originals stay as they wrote them.</p>
        </section>
        {SECTIONS.map((sec) => {
          const mine = rows.filter((r) => r.kind === sec.kind);
          return (
            <section key={sec.kind} className="card p-4">
              <h2 className="mb-2 font-semibold">{sec.title}</h2>
              <div className="space-y-2">
                {mine.map((r) => (
                  <div key={r.key} className="rounded-lg border border-slate-200 p-2">
                    {r.date || r.who ? <div className="mb-1 text-xs text-slate-500">{fmtDay(r.date)}{r.date && r.who ? " · " : ""}{r.who}</div> : null}
                    <div className="grid grid-cols-12 items-center gap-2">
                      <input aria-label="Description" value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} className="input col-span-12 py-2.5 text-base sm:col-span-6" placeholder="Description" />
                      <label className="col-span-4 sm:col-span-2"><span className="sr-only">{sec.qty}</span><input inputMode="decimal" value={r.quantity} onChange={(e) => set(r.key, { quantity: e.target.value })} className="input py-2.5 text-right text-base" placeholder={sec.qty} title={sec.qty} /></label>
                      <label className="col-span-5 sm:col-span-2"><span className="sr-only">{sec.price}</span><input inputMode="decimal" value={r.unitPrice} onChange={(e) => set(r.key, { unitPrice: e.target.value })} className={"input py-2.5 text-right text-base " + (r.unitPrice === "" ? "border-amber-400 bg-amber-50" : "")} placeholder={sec.price} title={sec.price} /></label>
                      <div className="col-span-2 text-right text-sm font-medium sm:col-span-1">{r.unitPrice === "" ? "—" : cad.format(n(r.quantity) * n(r.unitPrice))}</div>
                      <button type="button" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} className="col-span-1 justify-self-end rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove line"><X className="h-5 w-5" /></button>
                    </div>
                  </div>
                ))}
                {!mine.length ? <p className="text-sm text-slate-400">None.</p> : null}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">{sec.hint} <span className="hidden sm:inline">Columns: {sec.qty} · {sec.price}.</span></span>
                <button type="button" onClick={() => add(sec.kind)} className="btn btn-secondary btn-sm"><Plus className="h-4 w-4" /> {sec.add}</button>
              </div>
            </section>
          );
        })}
      </div>
      <div className="space-y-4">
        <section className="card p-4 lg:sticky lg:top-20">
          <h2 className="mb-2 font-semibold">Total</h2>
          <div className="space-y-1 text-sm">
            <Row l="Labour" v={t.labour} /><Row l="Materials" v={t.materials} /><Row l="Other" v={t.other} />
            <div className="border-t border-slate-200 pt-1"><Row l="Subtotal" v={t.subtotal} /></div>
            <Row l={`HST ${taxPercent}%`} v={t.tax} />
            <div className="flex justify-between text-lg font-semibold"><span>Total</span><span>{cad.format(t.total)}</span></div>
          </div>
          {rows.some((r) => r.unitPrice === "") ? <p className="mt-2 text-xs text-amber-700">Lines in yellow need a price before Ready to bill.</p> : null}
          <Submit name="intent" value="save" className="btn btn-secondary mt-4 w-full py-3">Save draft</Submit>
          <Submit name="intent" value="ready" className="btn btn-success mt-2 w-full py-3 text-base">Ready to bill</Submit>
        </section>
      </div>
    </ActionForm>
  );
}

function Row({ l, v }: { l: string; v: number }) {
  return <div className="flex justify-between"><span>{l}</span><span>{cad.format(v)}</span></div>;
}

/** Print the read-only sheet (office admin copies it into QuickBooks). */
export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="btn btn-secondary">Print</button>;
}
