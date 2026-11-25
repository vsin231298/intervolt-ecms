import { redirect } from "next/navigation";
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
        <div className="mb-6 text-center">
          <div className="inline-block rounded-lg bg-white px-5 py-3 shadow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo.png" alt="Intervolt Electric Ltd." className="h-16 w-auto" />
          </div>
          <div className="mt-3 text-sm text-slate-300">Contracting Management System</div>
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
