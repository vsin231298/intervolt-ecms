import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/rbac";
import { Card } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ActionForm";
import { messageDirectory } from "@/services/team";
import { startConversationAction } from "@/app/actions/team";
import { PeoplePicker } from "@/components/PeoplePicker";

export default async function NewMessagePage() {
  const user = await requireUser();
  const people = await messageDirectory(user);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/messages" className="flex items-center gap-1 text-sm text-slate-600"><ChevronLeft className="h-4 w-4" /> Messages</Link>
      <h1 className="text-xl font-semibold">New message</h1>
      <Card>
        <ActionForm action={startConversationAction} className="space-y-3">
          <PeoplePicker people={people.map((p) => ({ id: p.id, name: p.name, sub: [p.trade ?? ROLE_LABELS[p.role], p.sites].filter(Boolean).join(" · ") }))} />
          <Submit className="btn btn-primary w-full">Start chat</Submit>
        </ActionForm>
      </Card>
    </div>
  );
}
