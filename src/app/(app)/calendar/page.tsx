import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { isoDate, isoDateTimeLocal, today } from "@/lib/dates";
import { userOptions } from "@/lib/lookups";
import { Card, Drawer, Field, Options, PageHeader, clsx } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { agenda } from "@/services/dashboard";
import { deleteEventAction, saveEventAction } from "@/app/actions/admin";

const TZ = "America/Toronto";
const KIND_STYLE: Record<string, string> = {
  Meeting: "bg-brand-50 text-brand-800 border-brand-200",
  Inspection: "bg-orange-50 text-orange-800 border-orange-200",
  "Tender due": "bg-red-50 text-red-800 border-red-200",
  "Task due": "bg-slate-50 text-slate-700 border-slate-200",
  Delivery: "bg-emerald-50 text-emerald-800 border-emerald-200",
};
const dateOnlyKinds = new Set(["Task due", "Delivery"]);
const dayKey = (at: Date, kind: string) => (dateOnlyKinds.has(kind) ? at.toISOString().slice(0, 10) : at.toLocaleDateString("en-CA", { timeZone: TZ }));
const time = (at: Date) => at.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: TZ });

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; date?: string; who?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const t0 = today();
  const [y, m] = (sp.month ?? sp.date?.slice(0, 7) ?? isoDate(t0).slice(0, 7)).split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const gridStart = new Date(first.getTime() - first.getUTCDay() * 86_400_000);
  const gridEnd = new Date(gridStart.getTime() + 42 * 86_400_000);
  const all = sp.who === "all";
  const [items, users, projects, myEvents] = await Promise.all([
    agenda(user.id, new Date(gridStart.getTime() - 86_400_000), new Date(gridEnd.getTime() + 86_400_000), all),
    userOptions(),
    prisma.project.findMany({ where: { stage: { not: "CLOSED" } }, orderBy: { number: "desc" }, select: { id: true, number: true, name: true } }),
    prisma.calendarEvent.findMany({ where: { startsAt: { gte: gridStart, lt: gridEnd } }, include: { attendees: true } }),
  ]);
  const byDay = new Map<string, typeof items>();
  for (const it of items) {
    const k = dayKey(it.at, it.kind);
    byDay.set(k, [...(byDay.get(k) ?? []), it]);
  }
  const selected = sp.date ?? null;
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const who = all ? "&who=all" : "";
  const canEdit = can(user.role, "calendar.edit");
  const todayKey = isoDate(t0);
  const selectedItems = selected ? byDay.get(selected) ?? [] : [];
  const defaultStart = selected ? `${selected}T09:00` : isoDateTimeLocal(new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000));
  const defaultEnd = selected ? `${selected}T10:00` : isoDateTimeLocal(new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 3_600_000));

  return (
    <div className="space-y-4">
      <PageHeader title="My Schedule" subtitle="Meetings, inspections, tender deadlines, task deadlines and deliveries" actions={canEdit ? (
        <Drawer label="New meeting" className="btn btn-primary" wide>
          <ActionForm action={saveEventAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Title *" className="sm:col-span-2"><input name="title" required className="input" /></Field>
            <Field label="Starts *"><input type="datetime-local" name="startsAt" required defaultValue={defaultStart} className="input" /></Field>
            <Field label="Ends *"><input type="datetime-local" name="endsAt" required defaultValue={defaultEnd} className="input" /></Field>
            <Field label="Location"><input name="location" className="input" placeholder="Site, office, Teams…" /></Field>
            <Field label="Job"><select name="projectId" className="input"><Options items={projects.map((p) => ({ value: p.id, label: `${p.number} ${p.name}` }))} empty="—" /></select></Field>
            <div className="sm:col-span-2">
              <div className="label">Invite</div>
              <div className="grid max-h-40 grid-cols-2 gap-1 overflow-auto rounded border border-slate-200 p-2 sm:grid-cols-3">
                {users.map((u) => <label key={u.value} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="attendeeIds[]" value={u.value} defaultChecked={u.value === user.id} /> {u.label}</label>)}
              </div>
            </div>
            <Field label="Notes" className="sm:col-span-2"><textarea name="notes" rows={2} className="input" /></Field>
            <div className="sm:col-span-2"><Submit>Save meeting</Submit></div>
          </ActionForm>
        </Drawer>
      ) : null} />

      <div className="flex flex-wrap items-center gap-2">
        <Link className="btn btn-secondary btn-sm" href={`/calendar?month=${prev}${who}`} aria-label="Previous month">‹</Link>
        <Link className="btn btn-secondary btn-sm" href={`/calendar?month=${todayKey.slice(0, 7)}${who}`}>Today</Link>
        <Link className="btn btn-secondary btn-sm" href={`/calendar?month=${next}${who}`} aria-label="Next month">›</Link>
        <h2 className="ml-2 text-lg font-semibold">{first.toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
        <div className="ml-auto flex gap-1 text-sm">
          <Link href={`/calendar?month=${y}-${String(m).padStart(2, "0")}`} className={clsx("rounded px-3 py-1", !all ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100")}>Mine</Link>
          <Link href={`/calendar?month=${y}-${String(m).padStart(2, "0")}&who=all`} className={clsx("rounded px-3 py-1", all ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100")}>Everyone</Link>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium uppercase text-slate-500">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, i) => {
              const day = new Date(gridStart.getTime() + i * 86_400_000);
              const k = day.toISOString().slice(0, 10);
              const list = byDay.get(k) ?? [];
              const inMonth = day.getUTCMonth() === m - 1;
              return (
                <Link key={k} href={`/calendar?date=${k}${who}`} className={clsx("min-h-24 border-b border-r border-slate-100 p-1 text-left hover:bg-slate-50", !inMonth && "bg-slate-50/60 text-slate-400", selected === k && "ring-2 ring-inset ring-brand-500")}>
                  <div className={clsx("mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs", k === todayKey && "bg-brand-600 font-semibold text-white")}>{day.getUTCDate()}</div>
                  <div className="space-y-0.5">
                    {list.slice(0, 3).map((it) => <div key={it.kind + it.id} className={clsx("truncate rounded border px-1 text-[11px]", KIND_STYLE[it.kind])}>{dateOnlyKinds.has(it.kind) ? "" : `${time(it.at)} `}{it.title}</div>)}
                    {list.length > 3 ? <div className="text-[11px] text-slate-500">+{list.length - 3} more</div> : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <Card title={selected ? new Date(`${selected}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) : "Pick a day"}>
          {!selected ? <p className="text-sm text-slate-500">Click a day to see its details.</p> : selectedItems.length === 0 ? <p className="text-sm text-slate-500">Nothing scheduled.</p> : (
            <ul className="space-y-3">
              {selectedItems.map((it) => {
                const ev = it.kind === "Meeting" ? myEvents.find((e) => e.id === it.id) : null;
                const mayEdit = ev && (ev.createdById === user.id || can(user.role, "admin.settings"));
                return (
                  <li key={it.kind + it.id} className={clsx("rounded border p-2 text-sm", KIND_STYLE[it.kind])}>
                    <div className="text-xs font-medium uppercase opacity-70">{it.kind}{dateOnlyKinds.has(it.kind) ? "" : ` · ${time(it.at)}${it.end ? `–${time(it.end)}` : ""}`}</div>
                    <Link href={it.href} className="font-medium hover:underline">{it.title}</Link>
                    {it.sub ? <div className="text-xs opacity-80">{it.sub}</div> : null}
                    {ev ? <div className="mt-1 text-xs opacity-80">{ev.attendees.length} attendee(s){ev.notes ? ` · ${ev.notes}` : ""}</div> : null}
                    {mayEdit ? <ActionForm action={deleteEventAction} className="mt-1"><input type="hidden" name="eventId" value={ev.id} /><Submit className="text-xs text-red-600 hover:underline" pendingText="…">Cancel meeting</Submit></ActionForm> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">{Object.entries(KIND_STYLE).map(([k, c]) => <span key={k} className={clsx("rounded border px-2 py-0.5", c)}>{k}</span>)}</div>
    </div>
  );
}
