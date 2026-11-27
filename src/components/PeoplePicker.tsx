"use client";

import { useState } from "react";
import { Search } from "lucide-react";

/** Search and tick people. One person = private chat; more = group chat (needs a name). */
export function PeoplePicker({ people }: { people: { id: string; name: string; sub: string }[] }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const shown = people.filter((p) => !q || `${p.name} ${p.sub}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start a conversation with…" className="input pl-9" />
      </div>
      {picked.map((id) => <input key={id} type="hidden" name="userIds[]" value={id} />)}
      {picked.length > 1 ? <input name="title" required placeholder="Group name, e.g. Riverside crew" className="input" /> : null}
      <ul className="max-h-[55vh] divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
        {shown.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
              <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4" />
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">{p.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
              <span className="min-w-0"><span className="block font-medium">{p.name}</span><span className="block truncate text-xs text-orange-700">{p.sub}</span></span>
            </label>
          </li>
        ))}
        {shown.length === 0 ? <li className="px-3 py-4 text-sm text-slate-500">No one found.</li> : null}
      </ul>
      <p className="text-xs text-slate-500">{picked.length === 0 ? "Tick one person for a private chat, or several for a group." : picked.length === 1 ? "Private chat." : `Group chat with ${picked.length} people.`}</p>
    </div>
  );
}
