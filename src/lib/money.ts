import { Prisma } from "@prisma/client";

export const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;
export type Num = Prisma.Decimal | number | string | null | undefined;

export function d(v: Num): Prisma.Decimal {
  if (v === null || v === undefined || v === "") return new D(0);
  return new D(v as Prisma.Decimal.Value);
}
export function round2(v: Num): Prisma.Decimal {
  return d(v).toDecimalPlaces(2, D.ROUND_HALF_UP);
}
export function sum(values: Num[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(d(v)), new D(0));
}
export function pct(base: Num, percent: Num): Prisma.Decimal {
  return round2(d(base).times(d(percent)).dividedBy(100));
}
export function toNum(v: Num): number {
  return d(v).toNumber();
}

const cad = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });
const cad0 = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

export function money(v: Num): string {
  return cad.format(toNum(v));
}
export function moneyShort(v: Num): string {
  const n = toNum(v);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `$${(n / 1000).toFixed(0)}K`;
  return cad0.format(n);
}
export function qty(v: Num): string {
  return num.format(toNum(v));
}
