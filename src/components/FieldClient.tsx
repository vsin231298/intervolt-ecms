"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

function Btn({ children, className }: { children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={className}>{pending ? "Working…" : children}</button>;
}

/** Clock in / out. Captures fresh GPS and submits; the server enforces the site geofence when it is switched on. */
export function ClockForm({ action, projectId, label, tone, children, notes = true }: { action: Action; projectId?: string; label: string; tone: "in" | "out"; children?: React.ReactNode; notes?: boolean }) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  const [locating, setLocating] = useState(false);
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    if (form.dataset.located === "1") return; // second pass: let it submit
    e.preventDefault();
    const go = (lat?: number, lng?: number, accuracy?: number, err?: string) => {
      const set = (n: string, v?: number | string) => ((form.elements.namedItem(n) as HTMLInputElement).value = v != null ? String(v) : "");
      set("lat", lat); set("lng", lng); set("accuracy", accuracy != null ? Math.round(accuracy) : undefined); set("geoError", err);
      form.dataset.located = "1";
      setLocating(false);
      form.requestSubmit();
      setTimeout(() => (form.dataset.located = ""), 500);
    };
    if (!("geolocation" in navigator)) return go(undefined, undefined, undefined, "unsupported");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => go(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
      (e) => go(undefined, undefined, undefined, e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };
  return (
    <form ref={ref} action={formAction} onSubmit={submit} className="space-y-2">
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <input type="hidden" name="lat" /><input type="hidden" name="lng" /><input type="hidden" name="accuracy" /><input type="hidden" name="geoError" />
      {children}
      {tone === "out" && notes ? <input name="notes" placeholder="Note for this shift (optional)" className="input" /> : null}
      <Btn className={tone === "in" ? "btn w-full bg-emerald-600 py-4 text-lg text-white hover:bg-emerald-700" : "btn w-full bg-red-600 py-4 text-lg text-white hover:bg-red-700"}>{locating ? "Getting location…" : label}</Btn>
      {state.error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
      {state.ok && state.message ? <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.message}</p> : null}
    </form>
  );
}

/** Finger / mouse signature pad. Writes a PNG data URL into a hidden input. */
export function SignaturePad({ name }: { name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);
  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
    const form = c.closest("form");
    const onReset = () => { ctx.clearRect(0, 0, c.width, c.height); setSigned(false); if (input.current) input.current.value = ""; };
    form?.addEventListener("reset", onReset);
    return () => form?.removeEventListener("reset", onReset);
  }, []);
  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: React.PointerEvent) => {
    drawing.current = true;
    canvas.current!.setPointerCapture(e.pointerId);
    const ctx = canvas.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(...pos(e));
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    ctx.lineTo(...pos(e));
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setSigned(true);
    if (input.current) input.current.value = canvas.current!.toDataURL("image/png");
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setSigned(false);
    if (input.current) input.current.value = "";
  };
  return (
    <div>
      <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} className="h-40 w-full touch-none rounded-md border-2 border-dashed border-slate-300 bg-white" aria-label="Signature area" />
      <input ref={input} type="hidden" name={name} />
      <div className="mt-1 flex justify-between text-xs text-slate-500"><span>{signed ? "Signed" : "Signature (optional)"}</span><button type="button" onClick={clear} className="link">Clear</button></div>
    </div>
  );
}
