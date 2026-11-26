"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { ClockForm } from "./FieldClient";
import { distanceMeters, fmtDistance } from "@/lib/geo";
import type { ActionState } from "@/lib/action";

type Call = { id: string; client: string; crew: string; since: string; location: string | null; lat: number | null; lng: number | null; namedMe?: boolean };

/** Shows only service calls near where the phone is (the server still enforces the site range on join). */
export function NearbyCalls({ calls, within, action }: { calls: Call[]; within: number; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<"locating" | "ok" | "denied" | "unavailable">("locating");
  const locate = () => {
    if (!("geolocation" in navigator)) return setStatus("unavailable");
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (p) => { setHere({ lat: p.coords.latitude, lng: p.coords.longitude }); setStatus("ok"); },
      (e) => setStatus(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };
  useEffect(locate, []);

  if (status === "locating") return <p className="mt-3 text-sm text-slate-500">Finding service calls near you…</p>;
  if (status !== "ok" || !here) {
    return (
      <div className="mt-3 space-y-2 text-sm text-slate-600">
        <p>{status === "denied" ? "Location is blocked, so we can't find calls near you. Allow location for your browser in your phone's settings." : "We couldn't get your location. Turn on Location and try again."}</p>
        <button type="button" onClick={locate} className="btn btn-secondary btn-sm">Try again</button>
      </div>
    );
  }
  const near = calls
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({ ...c, dist: distanceMeters(here, { lat: c.lat!, lng: c.lng! }) }))
    .filter((c) => c.namedMe || c.dist <= within)
    .sort((a, b) => Number(!!b.namedMe) - Number(!!a.namedMe) || a.dist - b.dist);
  if (!near.length) {
    return (
      <div className="mt-3 space-y-2 text-sm text-slate-500">
        <p>No service call has been started near you yet. Ask the person you&apos;re with to tap Start a service call, then refresh. If you got there first, start it yourself.</p>
        <button type="button" onClick={() => window.location.reload()} className="btn btn-secondary btn-sm">Refresh</button>
      </div>
    );
  }
  return (
    <ul className="mt-3 space-y-3">{near.map((c) => (
      <li key={c.id} className="rounded-lg border border-slate-200 p-3">
        <div className="font-semibold">{c.client}</div>
        {c.namedMe ? <div className="text-xs font-semibold text-accent-600">{c.crew} added you as co-worker on this call</div> : null}
        <div className="text-sm text-slate-600">With {c.crew} · since {c.since}</div>
        <div className="flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" />{c.location ? `${c.location} · ` : ""}{fmtDistance(c.dist)} away</div>
        <div className="mt-2"><ClockForm action={action} projectId={c.id} label="Join & clock in" tone="in" /></div>
      </li>
    ))}</ul>
  );
}
