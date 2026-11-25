import { requireUser } from "@/lib/auth";
import { ROLE_LABELS, permissionsFor } from "@/lib/rbac";
import { Card, DL, PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { changePasswordAction } from "@/app/actions/auth";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const u = await requireUser();
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="My account" />
      <Card title="Profile">
        <DL items={[["Name", u.name], ["Email", u.email], ["Role", ROLE_LABELS[u.role]], ["Permissions", `${permissionsFor(u.role).length} permissions`]]} />
      </Card>
      <Card title="Change password">
        <ActionForm action={changePasswordAction} className="space-y-3">
          <label className="block"><span className="label">Current password</span><input name="current" type="password" required className="input" autoComplete="current-password" /></label>
          <label className="block"><span className="label">New password (10+ characters, letters and numbers)</span><input name="next" type="password" required minLength={10} className="input" autoComplete="new-password" /></label>
          <label className="block"><span className="label">Confirm new password</span><input name="confirm" type="password" required className="input" autoComplete="new-password" /></label>
          <Submit>Change password</Submit>
        </ActionForm>
      </Card>
    </div>
  );
}
