"use client";

import { useEffect, useRef, useState } from "react";

type Props = { name: string; placeholder?: string; near?: { lat: number; lng: number } | null; className?: string; defaultValue?: string };
type Feature = { properties: { housenumber?: string; street?: string; name?: string; city?: string; town?: string; village?: string; district?: string; state?: string; postcode?: string; countrycode?: string } };

const PROV: Record<string, string> = { Ontario: "ON", Quebec: "QC", "British Columbia": "BC", Alberta: "AB", Manitoba: "MB", Saskatchewan: "SK", "Nova Scotia": "NS", "New Brunswick": "NB", "Newfoundland and Labrador": "NL", "Prince Edward Island": "PE" };

/** Typed house number when the map only knows the street ("115 Midair" → "115 Midair Court"). */
function label(f: Feature, typed: string) {
  const p = f.properties;
  const num = p.housenumber ?? (p.street ? undefined : /^\d+[a-z]?\b/i.exec(typed.trim())?.[0]);
  const road = p.street ?? p.name ?? "";
  const city = p.city ?? p.town ?? p.village ?? p.district ?? "";
  const tail = [PROV[p.state ?? ""] ?? p.state, p.postcode].filter(Boolean).join(" ");
  return [[num, road].filter(Boolean).join(" "), city, tail].filter(Boolean).join(", ");
}

/**
 * Address box with suggestions as you type (free OpenStreetMap search via Photon, no key),
 * nearest to the phone first. Free text still works if the address isn't found.
 */
export function AddressInput({ name, placeholder, near, className = "input", defaultValue }: Props) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [list, setList] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const picked = useRef<string | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 3 || q === picked.current) { setList([]); return; }
    const ctl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : "&lat=43.7&lon=-79.4";
        const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en${bias}`, { signal: ctl.signal });
        const j = (await r.json()) as { features: Feature[] };
        const seen = new Set<string>();
        const out = j.features.filter((f) => (f.properties.countrycode ?? "CA") === "CA").map((f) => label(f, q)).filter((s) => s && !seen.has(s) && seen.add(s));
        setList(out.slice(0, 5));
        setOpen(true);
      } catch { /* offline or blocked: plain text box */ }
    }, 300);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [value, near]);

  return (
    <div className="relative">
      <input name={name} value={value} placeholder={placeholder} autoComplete="off" className={className}
        onChange={(e) => { picked.current = null; setValue(e.target.value); }}
        onFocus={() => list.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && list.length ? (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white text-sm shadow-lg">
          {list.map((s) => (
            <li key={s}>
              <button type="button" className="block w-full px-3 py-2.5 text-left hover:bg-slate-50" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { picked.current = s; setValue(s); setList([]); setOpen(false); }}>{s}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
