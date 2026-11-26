"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin } from "lucide-react";
import { ClockForm } from "./FieldClient";
import { AddressInput } from "./AddressInput";
import { distanceMeters, fmtDistance } from "@/lib/geo";
import type { ActionState } from "@/lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Call = { id: string; client: string; crew: string; location: string | null; lat: number | null; lng: number | null; namedMe?: boolean };

/**
 * One "Service call" button: if someone already started a call here, offer Join; otherwise Start.
 * Re-checks every 15 s while waiting (only when nothing has been typed). The server enforces the site range.
 */
export function ServiceCall({ calls, coWorkers, within, joinAction, startAction, officeFirst = false }: { calls: Call[]; coWorkers: { id: string; name: string }[]; within: number; joinAction: Action; startAction: Action; officeFirst?: boolean }) {
  const router = useRouter();
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<"locating" | "ok" | "denied" | "unavailable">("locating");
  const [startAnyway, setStartAnyway] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const locate = () => {
    if (!("geolocation" in navigator)) return setStatus("unavailable");
    navigator.geolocation.getCurrentPosition(
      (p) => { setHere({ lat: p.coords.latitude, lng: p.coords.longitude }); setStatus("ok"); },
      (e) => setStatus(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };
  useEffect(locate, []);

  const near = here
    ? calls
        .filter((c) => c.lat != null && c.lng != null)
        .map((c) => ({ ...c, dist: distanceMeters(here, { lat: c.lat!, lng: c.lng! }) }))
        .filter((c) => c.namedMe || c.dist <= within)
        .sort((a, b) => Number(!!b.namedMe) - Number(!!a.namedMe) || a.dist - b.dist)
    : [];

  // While nobody has started a call here, check again every 15 s, unless they're typing.
  useEffect(() => {
    if (status !== "ok" || near.length) return;
    const id = setInterval(() => {
      const typed = [...(formRef.current?.querySelectorAll("input") ?? [])].some((i) => i.value.trim());
      const busy = formRef.current?.contains(document.activeElement);
      if (!typed && !busy) router.refresh();
    }, 15000);
    return () => clearInterval(id);
  }, [status, near.length, router]);

  if (status === "locating") return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>;
  if (status !== "ok") {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-red-700">{status === "denied" ? "Location blocked. Allow it in phone settings." : "Turn on location."}</p>
        <button type="button" onClick={() => { setStatus("locating"); locate(); }} className="btn btn-secondary btn-sm">Try again</button>
      </div>
    );
  }

  const startForm = (
    <div ref={formRef}>
      <ClockForm action={startAction} label="Start & clock in" tone="in" officeFirst={officeFirst}>
        <input name="customer" required placeholder="Client name" className="input" />
        <AddressInput name="address" placeholder="Address (optional)" near={here} />
        <select name="helperWorkerId" defaultValue="" className="input" aria-label="Co-worker (optional)">
          <option value="">Co-worker (optional): None</option>
          {coWorkers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </ClockForm>
    </div>
  );

  if (near.length && !startAnyway) {
    return (
      <div className="space-y-3">
        {near.map((c) => (
          <div key={c.id} className="rounded-lg border border-emerald-300 bg-emerald-50/50 p-3">
            <div className="font-semibold">{c.crew} started {c.client}{c.namedMe ? "" : " here"}.</div>
            {c.namedMe ? <div className="text-xs font-semibold text-accent-600">{c.crew.split(",")[0]} added you</div> : null}
            <div className="flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" />{c.location ? `${c.location} · ` : ""}{fmtDistance(c.dist)} away</div>
            <div className="mt-2"><ClockForm action={joinAction} projectId={c.id} label="Join & clock in" tone="in" officeFirst={officeFirst} /></div>
          </div>
        ))}
        <button type="button" onClick={() => setStartAnyway(true)} className="link text-sm">Different job? Start new call</button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {startForm}
      {near.length ? <button type="button" onClick={() => setStartAnyway(false)} className="link text-sm">Back to calls here</button>
        : <p className="text-xs text-slate-500">No call started here yet. Partner starting? This updates by itself.</p>}
    </div>
  );
}
