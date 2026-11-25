import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { currentUser } from "./auth";
import type { Actor } from "./actor";
import { UserError } from "./errors";
import { formToObject, zodMessage } from "./forms";
import type { UploadFile } from "@/services/documents";

export type ActionState = { ok?: boolean; error?: string; message?: string; at?: number };
export type ActionResult = void | string | { message?: string; redirectTo?: string };

/**
 * Wrap a server action: authenticate, run, convert known errors to friendly messages,
 * refresh all pages (so every module reflects the change), optionally redirect.
 */
export async function run(fd: FormData, fn: (actor: Actor, data: Record<string, unknown>, fd: FormData) => Promise<ActionResult>): Promise<ActionState> {
  const actor = await currentUser();
  if (!actor) return { error: "Your session has expired. Sign in again." };
  let redirectTo: string | undefined;
  let message: string | undefined;
  try {
    const res = await fn(actor, formToObject(fd), fd);
    if (typeof res === "string") message = res;
    else if (res) ({ message, redirectTo } = res);
  } catch (e) {
    return { error: errorMessage(e), at: Date.now() };
  }
  revalidatePath("/", "layout");
  if (redirectTo) redirect(redirectTo);
  return { ok: true, message: message ?? "Saved.", at: Date.now() };
}

export function errorMessage(e: unknown): string {
  if (e instanceof UserError) return e.message;
  if (e instanceof ZodError) return zodMessage(e);
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return "That record already exists (duplicate number or name).";
    if (e.code === "P2025") return "The record was not found. It may have been changed by someone else; refresh the page.";
    if (e.code === "P2003") return "This record is linked to other records and cannot be changed that way.";
  }
  if (e instanceof Prisma.PrismaClientUnknownRequestError || e instanceof Prisma.PrismaClientKnownRequestError) {
    const m = /ERROR: (.*)/.exec(String(e.message));
    if (m && /locked|not permitted|cannot|only change/i.test(m[1])) return m[1];
  }
  console.error("[action error]", e);
  return "Something went wrong. The error has been logged; please try again.";
}

export async function filesFrom(fd: FormData, key = "file"): Promise<UploadFile[]> {
  const out: UploadFile[] = [];
  for (const v of fd.getAll(key)) {
    if (v instanceof File && v.size > 0) out.push({ name: v.name, type: v.type, data: Buffer.from(await v.arrayBuffer()) });
  }
  return out;
}

export const str = (v: unknown) => (typeof v === "string" ? v : "");
