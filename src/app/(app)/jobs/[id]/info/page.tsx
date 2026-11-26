import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate, fmtDateTime, isoDate, isoDateTimeLocal } from "@/lib/dates";
import { orgOptions, userOptions } from "@/lib/lookups";
import { ROLE_LABELS } from "@/lib/rbac";
import { Card, Drawer, Empty, Field, Options } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { DocList } from "@/components/DocList";
import { addMemberAction, assignEstimatorAction, communicationAction, removeMemberAction, setPmAction, siteLocationAction, updateInfoAction } from "@/app/actions/jobs";
import { SitePinInput } from "@/components/SitePin";
import { getSetting } from "@/lib/settings";

export default async function InfoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const p = await prisma.project.findUnique({ where: { id }, include: { members: { include: { user: true } }, communications: { orderBy: { date: "desc" } }, reviews: { orderBy: { decidedAt: "desc" } } } });
  if (!p) notFound();
  const isLead = ["OPPORTUNITY", "UNDER_REVIEW", "ESTIMATING", "QUOTING", "READY_TO_SUBMIT", "SUBMITTED"].includes(p.stage);
  const canEdit = p.stage !== "CLOSED" && can(user.role, isLead ? "leads.edit" : "project.manage");
  const [geofenceOn, defaultRadius] = await Promise.all([getSetting("field.geofenceEnabled"), getSetting("field.geofenceRadiusMeters")]);
  const pinText = p.siteLat != null && p.siteLng != null ? `${p.siteLat.toFixed(6)}, ${p.siteLng.toFixed(6)}` : "";
  const [clients, consultants, gcs, people, pms, estimators, reviewers] = await Promise.all([
    orgOptions(["CLIENT", "GENERAL_CONTRACTOR"]), orgOptions(["CONSULTANT"]), orgOptions(["GENERAL_CONTRACTOR"]),
    userOptions(), userOptions(["PROJECT_MANAGER", "ADMIN"]), userOptions(["ESTIMATOR", "PROJECT_MANAGER", "ADMIN"]),
    prisma.user.findMany({ where: { id: { in: p.reviews.map((r) => r.reviewerId) } } }),
  ]);
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card title="Job information" className="xl:col-span-2">
        <ActionForm action={updateInfoAction} resetOnSuccess={false} closeDetails={false} className="space-y-4">
          <input type="hidden" name="projectId" value={id} />
          <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2"><input name="name" defaultValue={p.name} required className="input" /></Field>
            <Field label="Client"><select name="clientId" defaultValue={p.clientId ?? ""} className="input"><Options items={clients} /></select></Field>
            <Field label="Client reference #"><input name="clientProjectNo" defaultValue={p.clientProjectNo ?? ""} className="input" /></Field>
            <Field label="Consultant"><select name="consultantId" defaultValue={p.consultantId ?? ""} className="input"><Options items={consultants} /></select></Field>
            <Field label="General contractor"><select name="gcId" defaultValue={p.gcId ?? ""} className="input"><Options items={gcs} /></select></Field>
            <Field label="Location" className="sm:col-span-2"><input name="location" defaultValue={p.location ?? ""} className="input" /></Field>
            <Field label="Site contact"><input name="siteContactName" defaultValue={p.siteContactName ?? ""} className="input" /></Field>
            <Field label="Site contact phone"><input name="siteContactPhone" defaultValue={p.siteContactPhone ?? ""} className="input" /></Field>
            <Field label="Estimated value ($)"><input name="estimatedValue" defaultValue={p.estimatedValue?.toString() ?? ""} className="input" /></Field>
            <Field label="Invitation date"><input type="date" name="invitationDate" defaultValue={isoDate(p.invitationDate)} className="input" /></Field>
            <Field label="Submission deadline"><input type="datetime-local" name="submissionDeadline" defaultValue={isoDateTimeLocal(p.submissionDeadline)} className="input" /></Field>
            <Field label="Site visit"><input type="datetime-local" name="siteVisitDate" defaultValue={isoDateTimeLocal(p.siteVisitDate)} className="input" /></Field>
            <Field label="Start date"><input type="date" name="startDate" defaultValue={isoDate(p.startDate)} className="input" /></Field>
            <Field label="Finish date"><input type="date" name="finishDate" defaultValue={isoDate(p.finishDate)} className="input" /></Field>
            <Field label="Scope" className="sm:col-span-2"><textarea name="scope" rows={4} defaultValue={p.scope ?? ""} className="input" /></Field>
            <Field label="Notes" className="sm:col-span-2"><textarea name="description" rows={2} defaultValue={p.description ?? ""} className="input" /></Field>
          </fieldset>
          {canEdit ? <Submit>Save details</Submit> : null}
        </ActionForm>
      </Card>

      <div className="space-y-6">
        <Card title="Site location for clock in / out">
          {!geofenceOn ? <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">The site range check is switched off in Admin → Settings, so the crew can clock in from anywhere.</p>
            : !pinText ? <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Not set. The crew can't clock in or out on this job until the site location is saved.</p>
            : <p className="mb-3 text-sm text-slate-600">The crew can only clock in and out within {p.geofenceRadiusM ?? defaultRadius} m of this point.</p>}
          <ActionForm action={siteLocationAction} resetOnSuccess={false} closeDetails={false} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <Field label="Site pin (latitude, longitude)"><SitePinInput defaultValue={pinText} address={p.location ?? ""} disabled={!canEdit} /></Field>
            <Field label={`Range in metres (blank = default ${defaultRadius} m)`}><input name="radius" type="number" min={10} max={5000} step={1} defaultValue={p.geofenceRadiusM ?? ""} className="input" disabled={!canEdit} /></Field>
            {canEdit ? <Submit>Save site location</Submit> : null}
          </ActionForm>
        </Card>
        <Card title="Responsibilities">
          <div className="space-y-4">
            {can(user.role, "project.manage") && !isLead ? (
              <ActionForm action={setPmAction} className="flex items-end gap-2" resetOnSuccess={false}>
                <input type="hidden" name="projectId" value={id} />
                <Field label="Project manager" className="flex-1"><select name="userId" defaultValue={p.projectManagerId ?? ""} required className="input"><Options items={pms} empty="Choose…" /></select></Field>
                <Submit className="btn btn-secondary">Set</Submit>
              </ActionForm>
            ) : null}
            {can(user.role, "leads.decide") && p.stage !== "CLOSED" ? (
              <ActionForm action={assignEstimatorAction} className="flex items-end gap-2" resetOnSuccess={false}>
                <input type="hidden" name="projectId" value={id} />
                <Field label="Estimator" className="flex-1"><select name="estimatorId" defaultValue={p.estimatorId ?? ""} required className="input"><Options items={estimators} empty="Choose…" /></select></Field>
                <Submit className="btn btn-secondary">Set</Submit>
              </ActionForm>
            ) : null}
            <div>
              <div className="label">Team</div>
              {p.members.length === 0 ? <p className="text-sm text-slate-500">No team members yet.</p> : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {p.members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between py-1.5">
                      <span>{m.user.name} <span className="text-xs text-slate-500">· {m.roleLabel} · {ROLE_LABELS[m.user.role]}</span></span>
                      {can(user.role, "project.manage") ? (
                        <ActionForm action={removeMemberAction}><input type="hidden" name="projectId" value={id} /><input type="hidden" name="userId" value={m.userId} /><Submit className="btn btn-ghost btn-sm text-red-600" pendingText="…">Remove</Submit></ActionForm>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {can(user.role, "project.manage") ? (
                <ActionForm action={addMemberAction} className="mt-2 flex items-end gap-2">
                  <input type="hidden" name="projectId" value={id} />
                  <select name="userId" className="input flex-1" required><Options items={people} empty="Add person…" /></select>
                  <select name="roleLabel" className="input w-36"><option>Site Supervisor</option><option>Electrician</option><option>Lead Hand</option><option>Apprentice</option><option>Coordinator</option><option>Estimator</option><option>Procurement</option></select>
                  <Submit className="btn btn-secondary">Add</Submit>
                </ActionForm>
              ) : null}
            </div>
          </div>
        </Card>

        {p.reviews.length ? (
          <Card title="Tender review decisions">
            <ul className="space-y-2 text-sm">
              {p.reviews.map((r) => (
                <li key={r.id}><b>{r.decision === "DOABLE" ? "Doable" : "Not bidding"}</b> — {reviewers.find((u) => u.id === r.reviewerId)?.name} · {fmtDate(r.decidedAt)}{r.reason ? <div className="text-slate-600">{r.reason}</div> : null}</li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      <Card title="Tender revisions & communications" className="xl:col-span-3" actions={can(user.role, "leads.edit") ? (
        <Drawer label="Log communication">
          <ActionForm action={communicationAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type"><select name="kind" className="input"><option>Email</option><option>Phone</option><option>Meeting</option><option>Addendum</option><option>Clarification</option><option>Site visit</option><option>Other</option></select></Field>
              <Field label="Date & time"><input type="datetime-local" name="date" required defaultValue={isoDateTimeLocal(new Date())} className="input" /></Field>
            </div>
            <Field label="Subject *"><input name="subject" required className="input" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><input name="fromParty" className="input" /></Field>
              <Field label="To"><input name="toParty" className="input" /></Field>
            </div>
            <Field label="Summary"><textarea name="summary" rows={3} className="input" /></Field>
            <Field label="Attachments (e.g. addendum PDF)"><input type="file" name="files" multiple className="text-sm" /></Field>
            <Submit>Save</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {p.communications.length === 0 ? <Empty>No communications logged. Record addenda, clarifications, calls and emails here to keep a full tender history.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {p.communications.map((c) => (
              <li key={c.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-slate-100 px-1.5 text-xs font-medium">{c.kind}</span><b>{c.subject}</b><span className="text-xs text-slate-500">{fmtDateTime(c.date)}{c.fromParty ? ` · from ${c.fromParty}` : ""}{c.toParty ? ` · to ${c.toParty}` : ""}</span></div>
                {c.summary ? <p className="mt-1 whitespace-pre-wrap text-slate-600">{c.summary}</p> : null}
                <div className="mt-1"><DocList entityType="Communication" entityId={c.id} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
