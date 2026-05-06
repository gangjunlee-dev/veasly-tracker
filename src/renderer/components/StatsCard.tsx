"use client";

type StatsCardProps = {
  label: string;
  value: string | number;
  helper?: React.ReactNode;
};

export function StatsCard({ label, value, helper }: StatsCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-black text-slate-950">{value}</div>
      {helper ? <div className="mt-3">{helper}</div> : null}
    </div>
  );
}
