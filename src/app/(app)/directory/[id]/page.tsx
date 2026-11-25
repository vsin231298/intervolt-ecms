import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { money } from "@/lib/money";
import { STAGE_LABELS } from "@/lib/workflow";
import { Card, DL, Drawer, Empty, Field, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { OrgForm, ORG_LABELS } from "@/components/OrgForm";
import { addContactAction, deleteContactAction } from "@/app/actions/admin";

export default async function OrgPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("jobs.view");
  const { id } = await params;
  const o = await prisma.organization.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: { name: "asc" } },
      clientProjects: { orderBy: { createdAt: "desc" }, take: 50 },
      consultantProjects: { orderBy: { createdAt: "desc" }, take: 50 },
      gcProjects: { orderBy: { createdAt: "desc" }, take: 50 },
      purchaseOrders: { include: { project: true }, orderBy: { createdAt: "desc" }, take: 50 },
      supplierQuotes: { include: { quoteRequest: { include: { project: true } } }, orderBy: { quoteDate: "desc" }, take: 30 },
    },
  });
  if (!o) notFound();
  const canEdit = can(user.role, "directory.edit");
  const showMoney = can(user.role, "financials.view") || can(user.role, "procurement.edit");
  const projects = [...o.clientProjects.map((p) => ({ p, as: "Client" })), ...o.consultantProjects.map((p) => ({ p, as: "Consultant" })), ...o.gcProjects.map((p) => ({ p, as: "GC" }))];

  return (
    <div className="space-y-6">
      <PageHeader title={o.name} subtitle={`${ORG_LABELS[o.type]}${o.active ? "" : " · inactive"}`} crumbs={[{ href: "/directory", label: "Clients & Suppliers" }]} actions={canEdit ? <Drawer label="Edit" className="btn btn-secondary" wide><OrgForm org={o} /></Drawer> : null} />
      <Card>
        <DL cols={4} items={[["Email", o.email ? <a key="e" className="link" href={`mailto:${o.email}`}>{o.email}</a> : "—"], ["Phone", o.phone ?? "—"], ["Address", o.address ?? "—"], ["Website", o.website ?? "—"]]} />
        {o.notes ? <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{o.notes}</p> : null}
      </Card>

      <Card title="Contacts" bodyClass="overflow-x-auto" actions={canEdit ? (
        <Drawer label="Add contact" className="btn btn-primary btn-sm">
          <ActionForm action={addContactAction} className="space-y-2">
            <input type="hidden" name="orgId" value={o.id} />
            <Field label="Name *"><input name="name" required className="input" /></Field>
            <Field label="Title"><input name="title" className="input" /></Field>
            <Field label="Email"><input type="email" name="email" className="input" /></Field>
            <Field label="Phone"><input name="phone" className="input" /></Field>
            <Submit>Add</Submit>
          </ActionForm>
        </Drawer>
      ) : null}>
        {o.contacts.length === 0 ? <div className="p-4"><Empty>No contacts.</Empty></div> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Phone</th>{canEdit ? <th></th> : null}</tr></thead>
            <tbody>{o.contacts.map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.title}</td><td>{c.email ? <a className="link" href={`mailto:${c.email}`}>{c.email}</a> : null}</td><td>{c.phone}</td>{canEdit ? <td><ActionForm action={deleteContactAction}><input type="hidden" name="id" value={c.id} /><Submit className="btn btn-ghost btn-sm text-red-600" pendingText="…">Remove</Submit></ActionForm></td> : null}</tr>)}</tbody>
          </table>
        )}
      </Card>

      {projects.length ? (
        <Card title="Jobs" bodyClass="overflow-x-auto">
          <table className="table">
            <thead><tr><th>WO #</th><th>Job</th><th>Role</th><th>Stage</th></tr></thead>
            <tbody>{projects.map(({ p, as }) => <tr key={p.id + as}><td className="font-mono text-xs"><Link className="link" href={`/jobs/${p.id}`}>{p.number}</Link></td><td>{p.name}</td><td>{as}</td><td><StatusBadge status={p.stage} label={STAGE_LABELS[p.stage]} /></td></tr>)}</tbody>
          </table>
        </Card>
      ) : null}

      {o.purchaseOrders.length ? (
        <Card title="Purchase orders" bodyClass="overflow-x-auto">
          <table className="table">
            <thead><tr><th>PO #</th><th>Job</th><th>Issued</th><th>Status</th>{showMoney ? <th className="num">Total</th> : null}</tr></thead>
            <tbody>{o.purchaseOrders.map((po) => <tr key={po.id}><td className="font-mono text-xs"><Link className="link" href={`/jobs/${po.projectId}/procurement/${po.id}`}>{po.number}</Link></td><td className="text-xs">{po.project.number} {po.project.name}</td><td>{fmtDate(po.issuedAt)}</td><td><StatusBadge status={po.status} /></td>{showMoney ? <td className="num">{money(po.total)}</td> : null}</tr>)}</tbody>
          </table>
        </Card>
      ) : null}

      {o.supplierQuotes.length ? (
        <Card title="Quotations" bodyClass="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Quote #</th><th>RFQ</th><th>Date</th>{showMoney ? <th className="num">Total</th> : null}</tr></thead>
            <tbody>{o.supplierQuotes.map((q) => <tr key={q.id}><td>{q.quoteNumber}</td><td className="text-xs"><Link className="link" href={`/jobs/${q.quoteRequest.projectId}/quotes/${q.quoteRequestId}`}>{q.quoteRequest.number}</Link> {q.quoteRequest.project.name}</td><td>{fmtDate(q.quoteDate)}</td>{showMoney ? <td className="num">{money(q.total)}</td> : null}</tr>)}</tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
