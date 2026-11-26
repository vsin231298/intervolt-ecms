"use client";

import { useRef, useState } from "react";

/** Site pin input with "use my location" and "find from address" helpers (free OpenStreetMap lookup). */
export function SitePinInput({ defaultValue, address, disabled }: { defaultValue: string; address: string; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (lat: number, lng: number, note: string) => {
    if (ref.current) ref.current.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    setMsg(note);
  };
  const here = () => {
    if (!("geolocation" in navigator)) return setMsg("This browser can't share its location.");
    setBusy(true);
    setMsg("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => { setBusy(false); set(p.coords.latitude, p.coords.longitude, `Your current location (accurate to about ${Math.round(p.coords.accuracy)} m). Click Save site location.`); },
      () => { setBusy(false); setMsg("Couldn't get your location. Allow location for this site and try again."); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };
  const lookup = async () => {
    if (!address.trim()) return setMsg("Add the job's Location (address) above first, and save it.");
    setBusy(true);
    setMsg("Looking up the address…");
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca&q=${encodeURIComponent(address)}`, { headers: { Accept: "application/json" } });
      const j = (await r.json()) as { lat: string; lon: string; display_name: string }[];
      if (!j.length) setMsg("Address not found. Use Google Maps instead: right-click the site, click the numbers at the top of the menu to copy them, and paste here.");
      else set(Number(j[0].lat), Number(j[0].lon), `Found: ${j[0].display_name}. Check it on the map, then click Save site location.`);
    } catch {
      setMsg("Address lookup isn't available right now. Paste the location from Google Maps instead.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <input ref={ref} name="pin" defaultValue={defaultValue} placeholder="43.653200, -79.383200" className="input font-mono" disabled={disabled} />
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={lookup} disabled={busy} className="btn btn-sm">Find from job address</button>
          <button type="button" onClick={here} disabled={busy} className="btn btn-sm">Use my current location</button>
          <button type="button" onClick={() => { const v = ref.current?.value.trim(); if (v) window.open(`https://www.google.com/maps?q=${encodeURIComponent(v)}`, "_blank", "noopener"); }} className="btn btn-ghost btn-sm">View on map</button>
        </div>
      ) : null}
      {msg ? <p className="text-xs text-slate-600">{msg}</p> : null}
    </div>
  );
}
