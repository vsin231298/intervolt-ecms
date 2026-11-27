"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ActionForm, Submit } from "./ActionForm";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** Month calendar: work days shaded, tap a day (or two for a range), then Next. */
export function TimeOffPicker({ action, todayIso, work, requested, off }: { action: Action; todayIso: string; work: string[]; requested: string[]; off: string[] }) {
  const t0 = new Date(todayIso + "T00:00:00Z");
  const [month, setMonth] = useState(utc(t0.getUTCFullYear(), t0.getUTCMonth(), 1));
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [step, setStep] = useState<"pick" | "details">("pick");
  const [partial, setPartial] = useState(false);
  const start = a && b ? (a < b ? a : b) : a;
  const end = a && b ? (a < b ? b : a) : a;
  const days = Math.round(((end ? new Date(end).getTime() : 0) - (start ? new Date(start).getTime() : 0)) / 86_400_000) + 1;
  const tap = (d: string) => {
    if (!a || (a && b)) { setA(d); setB(null); }
    else if (d === a) setA(null);
    else setB(d);
  };
  const first = month.getUTCDay();
  const count = utc(month.getUTCFullYear(), month.getUTCMonth() + 1, 0).getUTCDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => utc(month.getUTCFullYear(), month.getUTCMonth(), i + 1))];
  const label = (s: string) => new Date(s + "T00:00:00Z").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  if (step === "details" && start) {
    return (
      <ActionForm action={action} className="space-y-3">
        <input type="hidden" name="startDate" value={start} />
        <input type="hidden" name="endDate" value={end ?? start} />
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm"><b>{start === end ? label(start) : `${label(start)} – ${label(end!)}`}</b> · {days} day{days === 1 ? "" : "s"}</div>
        {days === 1 ? (
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="radio" checked={!partial} onChange={() => setPartial(false)} /> Full day</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="partial" value="on" checked={partial} onChange={() => setPartial(true)} /> Part of the day</label>
          </div>
        ) : null}
        {partial && days === 1 ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">From<input type="time" name="startTime" required className="input mt-1" /></label>
            <label className="text-sm">To<input type="time" name="endTime" required className="input mt-1" /></label>
          </div>
        ) : null}
        <textarea name="reason" rows={2} placeholder="Reason (optional)" className="input" />
        <div className="flex gap-2">
          <button type="button" onClick={() => setStep("pick")} className="btn btn-secondary">Back</button>
          <Submit className="btn btn-primary flex-1">Send request</Submit>
        </div>
      </ActionForm>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Previous month" onClick={() => setMonth(utc(month.getUTCFullYear(), month.getUTCMonth() - 1, 1))} className="rounded p-2 hover:bg-slate-100"><ChevronLeft className="h-5 w-5" /></button>
        <div className="font-semibold">{month.toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
        <button type="button" aria-label="Next month" onClick={() => setMonth(utc(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))} className="rounded p-2 hover:bg-slate-100"><ChevronRight className="h-5 w-5" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="py-1 text-xs font-semibold text-slate-500">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const k = iso(d);
          const past = k < todayIso;
          const sel = start && end && k >= start && k <= end;
          return (
            <button key={k} type="button" disabled={past} onClick={() => tap(k)}
              className={[
                "relative rounded-md py-2.5",
                past ? "text-slate-300" : sel ? "" : "hover:bg-slate-100",
                !sel && work.includes(k) ? "border border-emerald-400 bg-emerald-50" : "",
                !sel && off.includes(k) ? "bg-slate-200 text-slate-500" : "",
                !sel && requested.includes(k) ? "border border-purple-300 bg-purple-50" : "",
                sel ? "bg-orange-600 font-bold text-white" : "",
                k === todayIso && !sel ? "font-bold underline" : "",
              ].join(" ")}>{d.getUTCDate()}</button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border border-emerald-400 bg-emerald-50" /> Scheduled to work</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border border-purple-300 bg-purple-50" /> Requested</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-slate-200" /> Time off</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">{start ? `${start === end ? label(start) : `${label(start)} – ${label(end!)}`} selected. Tap another day for a range.` : "Tap a day. Tap a second day for a range."}</p>
      <button type="button" disabled={!start} onClick={() => setStep("details")} className="btn btn-primary mt-3 w-full disabled:opacity-40">Next</button>
    </div>
  );
}
