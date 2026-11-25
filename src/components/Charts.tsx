"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Categorical slots in fixed order (validated reference palette, light mode).
const SERIES = ["#257de0", "#f47230", "#00b894"];
const AXIS = { fontSize: 11, fill: "#666666" };

const money = (v: number) => (Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}K` : `$${Math.round(v)}`);
const fmt = (unit: "money" | "number" | "percent") => (v: number) => (unit === "money" ? money(v) : unit === "percent" ? `${v.toFixed(0)}%` : v.toLocaleString("en-CA"));

export type Series = { key: string; label: string };

/** Vertical bars: one series, or several side by side (never stacked unless they sum to a whole). */
export function BarsChart({ data, xKey, series, unit = "money", height = 240, emptyText = "No data yet" }: { data: Record<string, string | number>[]; xKey: string; series: Series[]; unit?: "money" | "number" | "percent"; height?: number; emptyText?: string }) {
  if (!data.length) return <div className="flex items-center justify-center text-sm text-slate-400" style={{ height }}>{emptyText}</div>;
  const f = fmt(unit);
  return (
    <div style={{ height }} role="img" aria-label={`Bar chart of ${series.map((s) => s.label).join(" and ")} by ${xKey}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="#eeeeee" />
          <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: "#d4d4d4" }} interval={0} angle={data.length > 6 ? -25 : 0} textAnchor={data.length > 6 ? "end" : "middle"} height={data.length > 6 ? 50 : 24} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={f} width={56} />
          <Tooltip formatter={(v, name) => [unit === "money" ? `$${Number(v).toLocaleString("en-CA", { maximumFractionDigits: 0 })}` : f(Number(v)), name]} cursor={{ fill: "rgba(15,23,42,0.04)" }} contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: "#e2e8f0" }} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12, color: "#191919" }} iconType="square" iconSize={10} /> : null}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={36} stroke="#ffffff" strokeWidth={1} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars for ranked items (e.g. margin by job). */
export function HBarsChart({ data, labelKey, series, unit = "money" }: { data: Record<string, string | number>[]; labelKey: string; series: Series[]; unit?: "money" | "number" | "percent" }) {
  if (!data.length) return <div className="flex h-40 items-center justify-center text-sm text-slate-400">No data yet</div>;
  const f = fmt(unit);
  const height = Math.max(160, data.length * (series.length > 1 ? 38 : 28) + 40);
  return (
    <div style={{ height }} role="img" aria-label={`Bar chart of ${series.map((s) => s.label).join(" and ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid horizontal={false} stroke="#eeeeee" />
          <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={f} />
          <YAxis type="category" dataKey={labelKey} tick={AXIS} tickLine={false} axisLine={{ stroke: "#d4d4d4" }} width={130} />
          <Tooltip formatter={(v, name) => [f(Number(v)), name]} cursor={{ fill: "rgba(15,23,42,0.04)" }} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" iconSize={10} /> : null}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} radius={[0, 4, 4, 0]} maxBarSize={18} stroke="#ffffff" strokeWidth={1} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
