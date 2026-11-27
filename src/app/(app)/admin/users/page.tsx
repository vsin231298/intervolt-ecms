import type { Role } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";
import { ROLE_LABELS } from "@/lib/rbac";
import { Badge, Card, Drawer, Field, PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { saveUserAction } from "@/app/actions/admin";

const ROLE_HELP: Record<Role, string> = {
  ADMIN: "Everything, including users, settings and audit log",
  PROJECT_MANAGER: "Runs leads, tenders and jobs end to end; approves prices, changes and waivers",
  ESTIMATOR: "Estimates, BOMs, supplier quotes and tender submissions",
  PROCUREMENT: "Purchase orders, deliveries, shop drawing tracking, supplier invoices",
  ACCOUNTING: "Billing, invoices, payments, supplier payments, finance reports",
  OFFICE_ADMIN: "Sees Ready to bill work orders, invoices them in QuickBooks, marks them billed",
  SITE_SUPERVISOR: "Crew schedule, timesheets, daily reports, RFIs, deficiencies",
  ELECTRICIAN: "Field app only: assigned jobs, clock in/out, photos, materials, sign-off",
  READ_ONLY: "View jobs and documents; no changes",
};

type U = { id: string; name: string; email: string; role: Role; phone: string | null; active: boolean };

function UserForm({ u }: { u?: U }) {
  return (
    <ActionForm action={saveUserAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess={!u}>
      {u ? <input type="hidden" name="userId" value={u.id} /> : null}
      <Field label="Name *"><input name="name" required defaultValue={u?.name} className="input" /></Field>
      <Field label="Email (login) *"><input type="email" name="email" required defaultValue={u?.email} className="input" /></Field>
      <Field label="Role *"><select name="role" defaultValue={u?.role ?? "READ_ONLY"} className="input">{(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
      <Field label="Phone"><input name="phone" defaultValue={u?.phone ?? ""} className="input" /></Field>
      <Field label={u ? "Reset password" : "Temporary password *"} hint="At least 10 characters" className="sm:col-span-2"><input type="password" name="password" required={!u} autoComplete="new-password" className="input" /></Field>
      {u ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} /> Active (unticking signs them out and blocks login)</label> : null}
      <div className="sm:col-span-2"><Submit>{u ? "Save" : "Create user"}</Submit></div>
    </ActionForm>
  );
}

export default async function UsersPage() {
  await requireUser("admin.users");
  const users = await prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { worker: true } });
  return (
    <div className="space-y-6">
      <PageHeader title="Users & Roles" actions={<Drawer label="Add user" className="btn btn-primary" wide><UserForm /></Drawer>} />
      <Card bodyClass="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Employee profile</th><th>Last login</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? "" : "text-slate-400"}>
                <td className="font-medium">{u.name}</td>
                <td>{u.email}</td>
                <td>{ROLE_LABELS[u.role]}</td>
                <td className="text-xs">{u.worker ? u.worker.name : u.role === "ELECTRICIAN" ? <span className="text-amber-700">Not linked: link it in Employees</span> : "—"}</td>
                <td className="text-xs">{fmtDateTime(u.lastLoginAt)}</td>
                <td>{u.active ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>}</td>
                <td><Drawer label="Edit" className="btn btn-ghost btn-sm" wide><UserForm u={u} /></Drawer></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="What each role can do">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">{(Object.keys(ROLE_HELP) as Role[]).map((r) => <div key={r}><dt className="font-medium">{ROLE_LABELS[r]}</dt><dd className="text-slate-600">{ROLE_HELP[r]}</dd></div>)}</dl>
      </Card>
    </div>
  );
}
