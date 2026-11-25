import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { isFieldOnly } from "@/lib/rbac";

export default async function Home() {
  const u = await currentUser();
  if (!u) redirect("/login");
  redirect(isFieldOnly(u.role) ? "/field" : "/dashboard");
}
