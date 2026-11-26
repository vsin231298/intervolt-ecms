import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin, Navigation, Phone, FileText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime, isoDate, today } from "@/lib/dates";
import { qty } from "@/lib/money";
import { Badge, Card, Field, Notice, Options } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { ClockForm, SignaturePad } from "@/components/FieldClient";
import { JOB_STATUSES, assertFieldAccess, firstClockInToday, needsWorkOrder, workerForUser } from "@/services/labour";
import { MaterialRows } from "@/components/MaterialRows";
import { clockInAction, clockOutAction, fieldUpdateAction, photosAction, signoffAction, takeOverLeadAction } from "@/app/actions/labour";
import { usageAction } from "@/app/actions/procurement";
import { getSetting } from "@/lib/settings";

export default async function FieldJob({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requireUser("field.use");
  const { projectId } = await params;
  try {
    await assertFieldAccess(user, projectId);
  } catch {
    redirect("/field");
  }
  const worker = await workerForUser(user.id);
  const [geofenceOn, defaultRadius] = await Promise.all([getSetting("field.geofenceEnabled"), getSetting("field.geofenceRadiusMeters")]);
  const openHere = worker ? await prisma.clockEntry.findFirst({ where: { workerId: worker.id, clockOutAt: null, projectId }, include: { project: true } }) : null;
  const woMissing = openHere ? await needsWorkOrder(prisma, user.id, openHere) : false;
  // Service call crew: who's on the call now, and who leads it.
  const onCall = await prisma.clockEntry.findMany({ where: { projectId, clockOutAt: null }, select: { worker: { select: { name: true, userId: true } } } });
  const leadRow = await prisma.project.findUnique({ where: { id: projectId }, select: { serviceLeadUserId: true, jobType: true } });
  const isService = leadRow?.jobType === "SERVICE";
  const leadId = leadRow?.serviceLeadUserId ?? null;
  const iAmLead = !!openHere && leadId === user.id;
  const leadName = onCall.find((c) => c.worker.userId === leadId)?.worker.name ?? (leadId === user.id ? user.name : null);
  const othersOnCall = onCall.filter((c) => c.worker.userId && c.worker.userId !== user.id);
  const withLead = onCall.filter((c) => c.worker.userId !== leadId);
  // Co-workers: everyone else on this job's clock today (ticked by default), plus all active employees to pick from.
  const sinceToday = new Date(Date.now() - 16 * 3_600_000);
  const [crewClocks, allWorkers] = await Promise.all([
    prisma.clockEntry.findMany({ where: { projectId, clockInAt: { gte: sinceToday }, ...(worker ? { workerId: { not: worker.id } } : {}) }, select: { workerId: true } }),
    prisma.worker.findMany({ where: { active: true, ...(worker ? { id: { not: worker.id } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const crewIds = new Set(crewClocks.map((c) => c.workerId));
  const coWorkers = [...allWorkers.filter((w) => crewIds.has(w.id)), ...allWorkers.filter((w) => !crewIds.has(w.id))];
  const [p, open, docs, materials, updates, deficiencies] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { client: true, projectManager: true } }),
    worker ? prisma.clockEntry.findFirst({ where: { workerId: worker.id, clockOutAt: null }, include: { project: true } }) : null,
    prisma.document.findMany({
      where: { projectId, OR: [{ module: { in: ["SHOP_DRAWING", "TENDER", "CONTRACT", "GENERAL"] } }, { category: { in: ["Drawings", "Drawing", "Specification", "Scope", "Shop drawing"] } }], versions: { some: {} } },
      include: { versions: { orderBy: { revision: "desc" }, take: 3 } },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.materialItem.findMany({ where: { projectId }, orderBy: { description: "asc" } }),
    prisma.fieldUpdate.findMany({ where: { projectId, authorId: user.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.deficiency.findMany({ where: { projectId, status: { not: "COMPLETED" } }, orderBy: { dueDate: "asc" } }),
  ]);
  const here = open?.projectId === projectId;
  const firstToday = worker && !open ? await firstClockInToday(worker.id) : false;
  const mapUrl = p.location ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.location)}` : null;
  // Prefer the approved revision; otherwise the latest.
  const drawingRows = docs.map((d) => ({ d, v: d.versions.find((v) => v.approvalStatus === "APPROVED") ?? d.versions[0] }));

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-10">
      <div>
        <Link href="/field" className="link text-sm">← My jobs</Link>
        <div className="mt-1 font-mono text-xs text-slate-500">{p.number}</div>
        <h1 className="text-xl font-semibold">{p.name}</h1>
        {p.client ? <div className="text-sm text-slate-600">{p.client.name}</div> : null}
      </div>

      <Card>
        <div className="space-y-2 text-sm">
          {p.location ? <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 text-slate-400" />{p.location}</div> : <div className="text-slate-500">No site address on file.</div>}
          {p.siteContactName ? <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-slate-400" />{p.siteContactName}{p.siteContactPhone ? <a className="link" href={`tel:${p.siteContactPhone}`}>{p.siteContactPhone}</a> : null}</div> : null}
          {p.projectManager ? <div className="text-xs text-slate-500">PM: {p.projectManager.name}</div> : null}
          {mapUrl ? <a href={mapUrl} target="_blank" rel="noreferrer" className="btn btn-secondary w-full"><Navigation className="h-4 w-4" /> Navigate to site</a> : null}
        </div>
      </Card>

      <Card id="clock" className="scroll-mt-20">
        {isService && openHere && leadName ? (
          <div className="mb-3 flex items-center justify-between gap-2 text-sm">
            <span>Lead: <b>{leadName}</b>{withLead.length ? <span className="text-slate-500"> · with {withLead.map((c) => c.worker.name).join(", ")}</span> : null}</span>
            {!iAmLead ? <ActionForm action={takeOverLeadAction} showSuccess={false}><input type="hidden" name="projectId" value={p.id} /><Submit className="btn btn-secondary btn-sm" pendingText="…">Take over as lead</Submit></ActionForm> : null}
          </div>
        ) : null}
        {!worker ? <Notice tone="amber">Login not linked to an employee. Call office.</Notice>
          : here && woMissing ? (
            <>
              <div className="mb-2 text-sm">Clocked in since {fmtDateTime(open!.clockInAt)}</div>
              <a href="#work-order" className="btn w-full bg-amber-500 py-4 text-lg text-white hover:bg-amber-600">Fill work order</a>
              {iAmLead && othersOnCall.length ? (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="mb-2 text-sm text-slate-600">Leaving before the job&apos;s done?</p>
                  {othersOnCall.map((c) => (
                    <ClockForm key={c.worker.userId} action={clockOutAction} label={`Hand lead to ${c.worker.name.split(" ")[0]} & clock out`} tone="out" notes={false}>
                      <input type="hidden" name="handLeadTo" value={c.worker.userId!} />
                    </ClockForm>
                  ))}
                </div>
              ) : null}
            </>
          )
          : here ? <><div className="mb-2 text-sm">Clocked in since {fmtDateTime(open!.clockInAt)}</div><ClockForm action={clockOutAction} label="Clock out" tone="out" /></>
          : open ? <Notice tone="amber">Clock out of {open.project.number} first. <Link className="link" href={`/field/${open.projectId}`}>Go there</Link></Notice>
          : <ClockForm action={clockInAction} projectId={p.id} label="Clock in" tone="in" officeFirst={firstToday} />}
        {worker && geofenceOn ? (
          p.siteLat == null || p.siteLng == null
            ? <p className="mt-2 text-xs text-amber-700">Site not set. Call office.</p>
            : <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" /> Must be within {p.geofenceRadiusM ?? defaultRadius} m.</p>
        ) : null}
      </Card>

      <Card title="Scope & drawings">
        {p.scope || p.description ? <p className="mb-3 whitespace-pre-line text-sm">{p.scope ?? p.description}</p> : null}
        {drawingRows.length === 0 ? <p className="text-sm text-slate-500">No drawings uploaded.</p> : (
          <ul className="space-y-2 text-sm">
            {drawingRows.map(({ d, v }) => (
              <li key={d.id} className="flex items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <a className="link min-w-0 flex-1 truncate" href={`/api/files/${v.id}?inline=1`} target="_blank" rel="noreferrer">{d.title}</a>
                {v.approvalStatus === "APPROVED" ? <Badge tone="green">Approved</Badge> : <Badge>rev {v.revision}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {deficiencies.length ? (
        <Card title="Open deficiencies">
          <ul className="space-y-1 text-sm">{deficiencies.map((x) => <li key={x.id}>• {x.description}{x.location ? <span className="text-slate-500"> ({x.location})</span> : null}</li>)}</ul>
        </Card>
      ) : null}

      <Card title="Upload photos">
        <ActionForm action={photosAction} className="space-y-2">
          <input type="hidden" name="projectId" value={p.id} />
          <input type="file" name="photos" accept="image/*" capture="environment" multiple required className="block w-full text-sm" aria-label="Photos" />
          <input name="message" placeholder="Caption (optional)" className="input" />
          <Submit className="btn btn-primary w-full">Upload photos</Submit>
        </ActionForm>
      </Card>

      <Card title="Log material used">
        <ActionForm action={usageAction} className="space-y-2">
          <input type="hidden" name="projectId" value={p.id} />
          <select name="materialItemId" className="input" aria-label="Material"><Options items={materials.map((m) => ({ value: m.id, label: `${m.description} (${m.unit})` }))} empty="Other (type below)" /></select>
          <input name="description" placeholder="Description, if not in the list" className="input" />
          <div className="grid grid-cols-3 gap-2">
            <input name="quantity" required inputMode="decimal" placeholder="Qty" className="input" aria-label="Quantity" />
            <input name="unit" placeholder="Unit" className="input" aria-label="Unit" />
            <input type="date" name="usedOn" required defaultValue={isoDate(today())} className="input" aria-label="Date" />
          </div>
          <input name="note" placeholder="Note (optional)" className="input" />
          <Submit className="btn btn-primary w-full">Log material</Submit>
        </ActionForm>
      </Card>

      <Card title="Send update to PM / report issue">
        <ActionForm action={fieldUpdateAction} className="space-y-2">
          <input type="hidden" name="projectId" value={p.id} />
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5"><input type="radio" name="kind" value="UPDATE" defaultChecked /> Update</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="kind" value="ISSUE" /> Issue / problem</label>
          </div>
          <textarea name="message" required rows={3} placeholder="What's happening on site?" className="input" />
          <input type="file" name="photos" accept="image/*" capture="environment" multiple className="block w-full text-sm" aria-label="Photos" />
          <Submit className="btn btn-primary w-full">Send</Submit>
        </ActionForm>
        {updates.length ? <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">{updates.map((u) => <li key={u.id}>{fmtDateTime(u.createdAt)} · {u.kind === "ISSUE" ? (u.resolvedAt ? "issue (resolved)" : "issue") : "update"}: {u.message.slice(0, 80)}</li>)}</ul> : null}
      </Card>

      {isService && openHere && !iAmLead ? (
        <Card title="Work order"><p className="text-sm text-slate-600">{leadName ?? "Lead"} fills this.</p></Card>
      ) : (
      <Card title="Work order" className="scroll-mt-20" id="work-order">
        <ActionForm action={signoffAction} className="space-y-4">
          <input type="hidden" name="projectId" value={p.id} />
          <Field label="Work description"><textarea name="workSummary" required rows={3} placeholder="What was done" className="input" /></Field>
          <Field label="Co-worker(s)">
            {coWorkers.length === 0 ? <p className="text-sm text-slate-500">No other employees set up.</p> : (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">{coWorkers.map((w) => (
                <label key={w.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="coWorkerIds" value={w.id} defaultChecked={crewIds.has(w.id)} /> {w.name}{crewIds.has(w.id) ? <span className="text-xs text-emerald-700">on call</span> : null}</label>
              ))}</div>
            )}
          </Field>
          <Field label="Materials used"><MaterialRows suggestions={materials.map((m) => m.description)} /></Field>
          <Field label="Job status">
            <select name="jobStatus" required defaultValue="" className="input">
              <option value="" disabled>Choose…</option>
              {Object.entries(JOB_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Parking $"><input name="parkingAmount" inputMode="decimal" placeholder="0.00" className="input" /></Field>
            <Field label="Receipt"><input type="file" name="parkingReceipt" accept="image/*,application/pdf" capture="environment" className="block w-full text-xs" /></Field>
          </div>
          <Field label="Customer name"><input name="customerName" className="input" /></Field>
          <SignaturePad name="signatureDataUrl" />
          <Submit className="btn btn-success w-full">Save work order</Submit>
        </ActionForm>
      </Card>
      )}

      {materials.length ? <p className="text-center text-xs text-slate-400">{materials.length} items on this job&apos;s material list · {qty(materials.reduce((s, m) => s + Number(m.quantityRequired), 0))} units total</p> : null}
    </div>
  );
}
