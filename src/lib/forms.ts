import { z } from "zod";
import { parseDate, parseDateTimeLocal } from "./dates";

/** Zod helpers that accept raw form strings and produce clean typed values. */
const blankToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v);

export const zText = (max = 500) => z.preprocess(blankToUndef, z.string().max(max));
export const zOptText = (max = 5000) => z.preprocess(blankToUndef, z.string().max(max).optional());
export const zId = z.preprocess(blankToUndef, z.string().min(1).max(64));
export const zOptId = z.preprocess(blankToUndef, z.string().max(64).optional());

const numStr = (v: unknown) => {
  const b = blankToUndef(v);
  if (typeof b === "string") {
    const cleaned = b.replace(/[$,\s]/g, "");
    return cleaned === "" ? undefined : Number(cleaned);
  }
  return b;
};
export const zMoney = z.preprocess(numStr, z.number({ invalid_type_error: "Enter a number" }).finite().min(-1e11).max(1e11));
export const zOptMoney = z.preprocess(numStr, z.number({ invalid_type_error: "Enter a number" }).finite().min(-1e11).max(1e11).optional());
export const zNonNeg = z.preprocess(numStr, z.number({ invalid_type_error: "Enter a number" }).finite().min(0, "Must be 0 or more").max(1e11));
export const zOptNonNeg = z.preprocess(numStr, z.number({ invalid_type_error: "Enter a number" }).finite().min(0, "Must be 0 or more").max(1e11).optional());
export const zPercent = z.preprocess(numStr, z.number({ invalid_type_error: "Enter a percentage" }).min(0).max(100));
export const zInt = z.preprocess(numStr, z.number().int());
export const zOptInt = z.preprocess(numStr, z.number().int().optional());

export const zDate = z.preprocess((v) => (typeof v === "string" ? parseDate(v) ?? undefined : v), z.date({ required_error: "Date is required", invalid_type_error: "Enter a valid date" }));
export const zOptDate = z.preprocess((v) => (typeof v === "string" ? parseDate(v) ?? undefined : v), z.date().optional());
export const zDateTime = z.preprocess((v) => (typeof v === "string" ? parseDateTimeLocal(v) ?? undefined : v), z.date({ required_error: "Date and time are required" }));
export const zOptDateTime = z.preprocess((v) => (typeof v === "string" ? parseDateTimeLocal(v) ?? undefined : v), z.date().optional());
export const zBool = z.preprocess((v) => v === "on" || v === "true" || v === true || v === "1", z.boolean());

export function enumOf<T extends Record<string, string>>(e: T) {
  return z.nativeEnum(e);
}

/** FormData → plain object. Repeated keys ending in [] become arrays. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (v instanceof File) continue;
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      ((out[key] as unknown[]) ??= []).push(v);
    } else out[k] = v;
  }
  return out;
}

export function zodMessage(err: z.ZodError) {
  return err.issues
    .slice(0, 3)
    .map((i) => (i.path.length ? `${humanize(String(i.path[i.path.length - 1]))}: ${i.message}` : i.message))
    .join("; ");
}
function humanize(k: string) {
  return k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}
