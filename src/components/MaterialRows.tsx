"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

/** Repeating "item + quantity" rows for materials used on a visit. Posts materialItem[] / materialQty[]. */
export function MaterialRows({ suggestions = [] }: { suggestions?: string[] }) {
  const [rows, setRows] = useState([0]);
  const [next, setNext] = useState(1);
  return (
    <div className="space-y-2">
      {suggestions.length ? <datalist id="material-suggestions">{suggestions.map((s) => <option key={s} value={s} />)}</datalist> : null}
      {rows.map((k) => (
        <div key={k} className="grid grid-cols-[1fr_5rem_auto] items-center gap-2">
          <input name="materialItem" placeholder="Item, e.g. 20A breaker" list="material-suggestions" className="input" />
          <input name="materialQty" placeholder="Qty" inputMode="decimal" className="input" />
          {rows.length > 1 ? (
            <button type="button" aria-label="Remove row" onClick={() => setRows(rows.filter((r) => r !== k))} className="btn btn-ghost btn-sm px-2"><X className="h-4 w-4" /></button>
          ) : null}
        </div>
      ))}
      <button type="button" onClick={() => { setRows([...rows, next]); setNext(next + 1); }} className="btn btn-ghost btn-sm"><Plus className="h-4 w-4" /> Add another item</button>
    </div>
  );
}
