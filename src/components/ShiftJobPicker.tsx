"use client";

import { useState } from "react";
import { Field } from "@/components/ui";
import { AddressInput } from "./AddressInput";

/** Create shift: pick an existing job (client · address) or type a new one. */
export function ShiftJobPicker({ jobs }: { jobs: { id: string; label: string }[] }) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  return (
    <div className="space-y-2">
      <div className="label">Job *</div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" name="jobMode" value="existing" checked={mode === "existing"} onChange={() => setMode("existing")} /> Existing job</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="jobMode" value="new" checked={mode === "new"} onChange={() => setMode("new")} /> New job</label>
      </div>
      {mode === "existing" ? (
        <Field label="Pick job"><select name="projectId" required defaultValue="" className="input"><option value="" disabled>Choose…</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</select></Field>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client name *"><input name="customer" required className="input" /></Field>
          <Field label="Client phone"><input name="phone" className="input" /></Field>
          <Field label="Job location (address) *" className="col-span-2" hint="Pick from the suggestions so the guys can clock in there.">
            <AddressInput name="address" required placeholder="Start typing the address" latName="lat" lngName="lng" />
          </Field>
        </div>
      )}
    </div>
  );
}
