"use server";

import { redirect } from "next/navigation";
import { login, logout } from "@/lib/auth";
import { run, type ActionState } from "@/lib/action";
import { changeOwnPassword } from "@/services/admin";
import { str } from "@/lib/action";

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = str(fd.get("email"));
  const password = str(fd.get("password"));
  if (!email || !password) return { error: "Enter your email and password." };
  const res = await login(email, password);
  if (!res.ok) return { error: res.error };
  const next = str(fd.get("next"));
  redirect(res.fieldOnly ? "/field" : next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function changePasswordAction(_p: ActionState, fd: FormData) {
  return run(fd, async (actor, d) => {
    if (d.next !== d.confirm) throw new (await import("@/lib/errors")).UserError("The new passwords do not match.");
    await changeOwnPassword(actor, str(d.current), str(d.next));
    return "Password changed.";
  });
}
