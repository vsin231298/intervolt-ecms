import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, Search, LogOut, KeyRound } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { can, isFieldOnly, ROLE_LABELS } from "@/lib/rbac";
import { unreadAnnouncements, unreadConversations } from "@/services/team";
import { prisma } from "@/lib/db";
import { Sidebar, type NavItem } from "@/components/Sidebar";
import { logoutAction } from "@/app/actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  const r = user.role;
  const [annUnread, msgUnread, linkedWorker, pendingOff] = await Promise.all([
    unreadAnnouncements(user.id),
    unreadConversations(user.id),
    prisma.worker.count({ where: { userId: user.id, active: true } }),
    can(r, "labour.schedule") ? prisma.timeOff.count({ where: { status: "PENDING" } }) : 0,
  ]);
  const woReview = !isFieldOnly(r) && can(r, "jobs.view") ? await prisma.workOrderSignoff.count({ where: { reviewedAt: null } }) : 0;
  const items: NavItem[] = [];
  const add = (cond: boolean, it: NavItem) => cond && items.push(it);
  const office = !isFieldOnly(r);
  add(office, { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" });
  add(can(r, "jobs.view"), { href: "/leads", label: "Leads & Tenders", icon: "Target", section: "Work" });
  add(can(r, "jobs.view"), { href: "/jobs", label: "Jobs", icon: "Briefcase", section: "Work" });
  add(can(r, "jobs.view"), { href: "/claims", label: "Claims & Submittals", icon: "FileStack", section: "Work" });
  add(can(r, "jobs.view") || can(r, "procurement.edit"), { href: "/procurement", label: "Procurement", icon: "ShoppingCart", section: "Work" });
  add(office, { href: "/calendar", label: "Calendar", icon: "CalendarDays", section: "People & Time" });
  add(can(r, "labour.schedule") || can(r, "jobs.view"), { href: "/schedule", label: "Employee Schedule", icon: "Users", section: "People & Time" });
  add(can(r, "time.manage") || can(r, "time.submit"), { href: "/timesheets", label: "Timesheets", icon: "Clock", section: "People & Time" });
  add(can(r, "workers.edit") || can(r, "jobs.view"), { href: "/people", label: "Employees", icon: "HardHat", section: "People & Time" });
  // Office: what the guys sent in.
  add(office && can(r, "jobs.view"), { href: "/work-orders", label: "Work Orders", icon: "ClipboardList", section: "People & Time", badge: woReview || undefined });
  add(office && can(r, "labour.schedule"), { href: "/schedule?view=timeoff", label: "Time Off Requests", icon: "CalendarX", section: "People & Time", badge: pendingOff || undefined });
  // Field: only for people who clock in (field staff, or office staff linked to an employee).
  const clocksIn = can(r, "field.use") && (!office || linkedWorker > 0);
  add(clocksIn, { href: "/field", label: "Field App", icon: "Smartphone", section: "People & Time" });
  add(clocksIn, { href: "/my-work-orders", label: "My Work Orders", icon: "ClipboardList", section: "People & Time" });
  add(clocksIn, { href: "/time-off", label: office ? "My Time Off" : "Time Off", icon: "CalendarX", section: "People & Time" });
  add(true, { href: "/announcements", label: "Announcements", icon: "Megaphone", section: "People & Time", badge: annUnread || undefined });
  add(true, { href: "/messages", label: "Messages", icon: "MessageSquare", section: "People & Time", badge: msgUnread || undefined });
  add(can(r, "financials.view"), { href: "/finance", label: "Finance", icon: "Wallet", section: "Company" });
  add(can(r, "documents.view") || can(r, "company.documents"), { href: "/documents", label: "Documents", icon: "FolderOpen", section: "Company" });
  add(can(r, "jobs.view"), { href: "/directory", label: "Clients & Suppliers", icon: "Building2", section: "Company" });
  add(can(r, "reports.view"), { href: "/reports", label: "Reports", icon: "BarChart3", section: "Company" });
  add(can(r, "admin.users"), { href: "/admin/users", label: "Users & Roles", icon: "UserCog", section: "Admin" });
  add(can(r, "admin.settings"), { href: "/admin/settings", label: "Settings", icon: "Settings", section: "Admin" });
  add(can(r, "admin.audit"), { href: "/admin/audit", label: "Audit Log", icon: "ShieldCheck", section: "Admin" });

  return (
    <div className="min-h-screen">
      <Sidebar items={items} />
      <div className="lg:pl-60">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 pl-14 backdrop-blur lg:pl-6">
          {office ? (
            <form action="/search" className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input name="q" placeholder="Search jobs, WO #, POs, RFIs, invoices, documents…" className="input pl-9" aria-label="Global search" />
            </form>
          ) : <div className="flex-1 text-sm font-semibold text-slate-700">Intervolt Field</div>}
          <div className="ml-auto flex items-center gap-1">
            <Link href="/notifications" className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {unread ? <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[11px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span> : null}
            </Link>
            <details className="relative">
              <summary className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">{user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span>
                <span className="hidden text-left sm:block">
                  <span className="block text-sm font-medium leading-tight">{user.name}</span>
                  <span className="block text-xs text-slate-500">{ROLE_LABELS[user.role]}</span>
                </span>
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-52 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                <Link href="/account" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"><KeyRound className="h-4 w-4" /> Change password</Link>
                <form action={logoutAction}>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"><LogOut className="h-4 w-4" /> Sign out</button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
