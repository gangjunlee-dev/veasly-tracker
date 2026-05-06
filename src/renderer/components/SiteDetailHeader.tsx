"use client";

import Link from "next/link";
import { cn } from "../lib/format";

export type SiteDetailHeaderSite = {
  id: number;
  code: string;
  name: string;
  username: string;
  enabled: boolean;
};

type SiteDetailHeaderProps = {
  site: SiteDetailHeaderSite;
  running?: boolean;
  onExtract?: () => void;
  showExtract?: boolean;
};

export function SiteDetailHeader({
  site,
  running = false,
  onExtract,
  showExtract = true
}: SiteDetailHeaderProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-black text-slate-950">{site.name}</h2>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-bold",
                site.enabled
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
              )}
            >
              {site.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>

          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
            <div>
              <span className="font-bold text-slate-800">ID:</span> {site.id}
            </div>
            <div>
              <span className="font-bold text-slate-800">Code:</span> {site.code}
            </div>
            <div>
              <span className="font-bold text-slate-800">Username:</span>{" "}
              {site.username}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/sites"
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to Sites
          </Link>

          <Link
            href={`/sites/${site.id}/settings`}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Settings
          </Link>

          {showExtract ? (
            <button
              type="button"
              disabled={!site.enabled || running}
              onClick={onExtract}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-bold transition",
                site.enabled && !running
                  ? "bg-slate-900 text-white hover:bg-slate-700"
                  : "cursor-not-allowed bg-slate-100 text-slate-400"
              )}
            >
              {running ? "Extracting..." : "Extract Orders"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
