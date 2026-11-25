import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import type { OrgType } from "@prisma/client";
import { Drawer, Empty, PageHeader, Tabs } from "@/components/ui";
import { OrgForm, ORG_LABELS } from "@/components/OrgForm";

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const user = await requireUser("jobs.view");
  const sp = await searchParams;
  const type = (Object.keys(ORG_LABELS) as OrgType[]).find((t) => t === sp.type);
  const orgs = await prisma.organization.findMany({
    where: { ...(type ? { type } : {}), ...(sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { contacts: { some: { name: { contains: sp.q, mode: "insensitive" } } } }] } : {}) },
    include: { contacts: true, _count: { select: { clientProjects: true, purchaseOrders: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Clients & Suppliers" subtitle="Clients, consultants, general contractors, suppliers, subcontractors and inspectors" actions={can(user.role, "directory.edit") ? <Drawer label="Add organization" className="btn btn-primary" wide><OrgForm defaultType={type} /></Drawer> : null} />
      <Tabs current={type ?? "all"} items={[{ key: "all", label: "All", href: "/directory" }, ...(Object.entries(ORG_LABELS) as [OrgType, string][]).map(([k, l]) => ({ key: k, label: l, href: `/directory?type=${k}` }))]} />
      <form className="flex gap-2">{type ? <input type="hidden" name="type" value={type} /> : null}<input name="q" defaultValue={sp.q} placeholder="Name or contact" className="input w-64" aria-label="Search" /><button className="btn btn-secondary">Search</button></form>
      {orgs.length === 0 ? <Empty>No organizations.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th>Email / phone</th><th>Contacts</th><th className="num">Jobs</th><th className="num">POs</th></tr></thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className={o.active ? "" : "text-slate-400"}>
                  <td><Link className="link font-medium" href={`/directory/${o.id}`}>{o.name}</Link>{o.active ? null : " (inactive)"}</td>
                  <td className="text-xs">{ORG_LABELS[o.type]}</td>
                  <td className="text-xs">{o.email}<div>{o.phone}</div></td>
                  <td className="text-xs">{o.contacts.map((c) => c.name).join(", ") || "—"}</td>
                  <td className="num">{o._count.clientProjects}</td>
                  <td className="num">{o._count.purchaseOrders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
