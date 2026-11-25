export const DAY = 86_400_000;
export const TZ = process.env.APP_TIMEZONE || "America/Toronto";

/** Parse a yyyy-mm-dd string as a UTC date (for @db.Date columns). */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}
/** Today's calendar date in the company time zone, as a UTC-midnight Date. */
export function today(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parseDate(parts)!;
}
export function addDays(dt: Date, days: number): Date {
  return new Date(dt.getTime() + days * DAY);
}
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY);
}
export function fmtDate(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const dt = typeof v === "string" ? new Date(v) : v;
  return dt.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
export function fmtDateTime(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const dt = typeof v === "string" ? new Date(v) : v;
  return dt.toLocaleString("en-CA", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}
/** yyyy-mm-dd for <input type="date"> */
export function isoDate(v: Date | string | null | undefined): string {
  if (!v) return "";
  const dt = typeof v === "string" ? new Date(v) : v;
  return dt.toISOString().slice(0, 10);
}
/** yyyy-mm-ddThh:mm for <input type="datetime-local">, in company time zone */
export function isoDateTimeLocal(v: Date | null | undefined): string {
  if (!v) return "";
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return f.format(v).replace(" ", "T");
}
/** Parse datetime-local input as company-time-zone wall time. */
export function parseDateTimeLocal(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return parseDate(s);
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // find the offset of TZ at that instant
  const tzStr = new Date(asUtc).toLocaleString("en-US", { timeZone: TZ });
  const offset = new Date(tzStr + " UTC").getTime() - asUtc;
  return new Date(asUtc - offset);
}
