import Link from "next/link";
import { Card, Empty, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { StatusBadge } from "@/components/WorkOrderView";
import { fmtDateTime } from "@/lib/dates";
import { JOB_STATUSES } from "@/services/labour";
import type { reviewQueue } from "@/services/workorders";
import { fileWorkOrderAction } from "@/app/actions/team";

const day = (d: Date) => d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const status = (s: string | null) => (s && s in JOB_STATUSES ? JOB_STATUSES[s as keyof typeof JOB_STATUSES] : null);

type Item = Awaited<ReturnType<typeof reviewQueue>>[number];

/** Office: each new work order → Existing job (pick it) or New work order. */
export function ReviewQueue({ items, canFile }: { items: Item[]; canFile: boolean }) {
  if (!items.length) return <Empty>All work orders are filed.</Empty>;
  return (
    <div className="space-y-4">
      {items.map((s) => {
        const pending = s.project.pendingReview;
        const top = s.candidates.slice(0, pending ? 5 : 4);
        const rest = s.candidates.slice(top.length);
        const best = pending && s.candidates[0]?.match >= 2 ? s.candidates[0].id : null;
        const def = pending ? (best ?? "NEW") : "KEEP";
        const materials = Array.isArray(s.materialsUsed) ? (s.materialsUsed as { item: string; quantity: string }[]) : [];
        return (
          <Card key={s.id} title={<span className="flex flex-wrap items-center gap-2"><b>{s.submittedBy}</b><span className="font-normal text-slate-500">· {day(s.day)} · sent {fmtDateTime(s.createdAt)}</span></span>}
            actions={<Link className="text-sm link" href={`/work-orders/${s.id}`}>Open</Link>}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-1 text-sm">
                <div><span className="text-slate-500">Customer:</span> <b>{s.project.client?.name ?? s.project.siteContactName ?? s.project.name}</b></div>
                <div><span className="text-slate-500">Address:</span> {s.project.location ?? "Not given"}</div>
                {!pending ? <div><span className="text-slate-500">Filed on:</span> <span className="font-mono text-xs">{s.project.number}</span> {s.project.name}</div> : <div className="text-xs text-amber-700">Service call started on site. No WO number yet.</div>}
                <div><span className="text-slate-500">Work done:</span> <span className="whitespace-pre-line">{s.workSummary}</span></div>
                <div className="flex flex-wrap items-center gap-1"><span className="text-slate-500">Status:</span> <StatusBadge status={s.jobStatus} />
                  {s.hours ? <span>· {s.hours} h</span> : null}
                  {materials.length ? <span>· {materials.map((m) => `${m.quantity ? `${m.quantity} × ` : ""}${m.item}`).join(", ")}</span> : null}
                  {s.parkingAmount != null ? <span>· parking ${Number(s.parkingAmount).toFixed(2)}</span> : null}
                </div>
              </div>
              {canFile ? (
                <ActionForm action={fileWorkOrderAction} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <input type="hidden" name="signoffId" value={s.id} />
                  <div className="text-sm font-semibold">Where does this go?</div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Existing job</div>
                  {!pending ? (
                    <Option value="KEEP" def={def} title={<><span className="font-mono text-xs">{s.project.number}</span> <b>{s.project.name}</b> <span className="text-xs font-semibold text-brand-700">this job</span></>} sub="Keep it here" />
                  ) : null}
                  {top.map((c) => (
                    <Option key={c.id} value={c.id} def={def}
                      title={<><span className="font-mono text-xs">{c.number}</span> <b>{c.customer ?? c.name}</b>{c.match >= 2 ? <span className="ml-1 text-xs font-semibold text-emerald-700">same address</span> : c.match === 1 ? <span className="ml-1 text-xs font-semibold text-emerald-700">same customer</span> : null}</>}
                      sub={`${c.location ?? "No address"}${c.lastAt ? ` · last: ${day(c.lastAt)}${c.lastBy ? ` · ${c.lastBy}` : ""}${status(c.lastStatus) ? ` · ${status(c.lastStatus)}` : ""}` : " · no visits yet"}`} />
                  ))}
                  {rest.length ? (
                    <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm">
                      <input type="radio" name="target" value="OTHER" />
                      <select name="otherId" defaultValue="" className="input py-1 text-sm"><option value="">Other open job…</option>{rest.map((c) => <option key={c.id} value={c.id}>{c.number} {c.customer ?? c.name}{c.location ? `, ${c.location}` : ""}</option>)}</select>
                    </label>
                  ) : null}
                  {!s.candidates.length && pending ? <div className="text-xs text-slate-500">No open jobs to pick from.</div> : null}
                  <div className="pt-1 text-xs font-medium uppercase tracking-wide text-slate-500">Or</div>
                  <Option value="NEW" def={def} title={<b>New work order</b>} sub={pending ? "Gets the next WO number" : "Split this visit into a new WO number"} />
                  <p className="text-xs text-slate-500">Only open jobs not ticked Billed. Same address and customer on top.</p>
                  <Submit className="btn btn-primary w-full">Save</Submit>
                </ActionForm>
              ) : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Option({ value, def, title, sub }: { value: string; def: string; title: React.ReactNode; sub: string }) {
  return (
    <label className={clsx("flex cursor-pointer items-start gap-2 rounded-md border bg-white px-2 py-1.5 text-sm has-[:checked]:border-brand-400 has-[:checked]:ring-1 has-[:checked]:ring-brand-300", "border-slate-200")}>
      <input type="radio" name="target" value={value} defaultChecked={value === def} className="mt-1" />
      <span className="min-w-0 flex-1">{title}<span className="block text-xs text-slate-500">{sub}</span></span>
    </label>
  );
}
