import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { Badge, Empty } from "@/components/ui";
import { JOB_STATUSES, myWorkOrders } from "@/services/labour";

/** Field app: the work orders this person submitted. Only their own. */
export default async function MyWorkOrders() {
  const user = await requireUser("field.use");
  const list = await myWorkOrders(user);
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-xl font-semibold">My Work Orders</h1>
        <p className="text-sm text-slate-500">What you submitted. Tap one to add a note.</p>
      </div>
      {list.length === 0 ? <Empty>None yet.</Empty> : (
        <ul className="space-y-2">{list.map((s) => (
          <li key={s.id}>
            <Link href={`/my-work-orders/${s.id}`} className="card flex items-center gap-3 p-4 hover:bg-slate-50">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="font-mono">{s.project.number}</span> · {fmtDateTime(s.createdAt)}</div>
                <div className="truncate font-semibold">{s.project.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {s.jobStatus && s.jobStatus in JOB_STATUSES ? <Badge tone={s.jobStatus === "COMPLETE" ? "green" : "amber"}>{JOB_STATUSES[s.jobStatus as keyof typeof JOB_STATUSES]}</Badge> : null}
                  {s._count.notes ? <span className="text-xs text-slate-500">{s._count.notes} note{s._count.notes === 1 ? "" : "s"}</span> : null}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-400" />
            </Link>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
