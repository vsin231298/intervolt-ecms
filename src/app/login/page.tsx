import { redirect } from "next/navigation";
import { Zap } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { ActionForm, Submit } from "@/components/ActionForm";
import { loginAction } from "@/app/actions/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect("/");
  const { next } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3 text-white">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-400 text-slate-900"><Zap className="h-6 w-6" /></span>
          <div>
            <div className="text-xl font-bold tracking-wide">INTERVOLT ELECTRIC</div>
            <div className="text-sm text-slate-300">Contracting Management System</div>
          </div>
        </div>
        <div className="card p-6">
          <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
          <ActionForm action={loginAction} resetOnSuccess={false} className="space-y-4">
            <input type="hidden" name="next" value={next ?? ""} />
            <label className="block">
              <span className="label">Email</span>
              <input name="email" type="email" autoComplete="username" required className="input" />
            </label>
            <label className="block">
              <span className="label">Password</span>
              <input name="password" type="password" autoComplete="current-password" required className="input" />
            </label>
            <Submit className="btn btn-primary w-full" pendingText="Signing in…">Sign in</Submit>
          </ActionForm>
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">Forgot your password? Ask an administrator to reset it.</p>
      </div>
    </div>
  );
}
