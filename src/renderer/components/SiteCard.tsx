"use client";

import Link from "next/link";
import { cn } from "../lib/format";

export type SiteCardSite = {
  id: number;
  code: string;
  name: string;
  username: string;
  enabled: boolean;
};

type ExtractorInfo = {
  code: string;
  name: string;
  version?: string;
  enabled?: boolean;
  description?: string;
};

type SiteCardProps = {
  site: SiteCardSite;
  extractor?: ExtractorInfo;
  isRunning: boolean;
  onExtract: (siteId: number) => void;
};

export function SiteCard({ site, extractor, isRunning, onExtract }: SiteCardProps) {
  const hasExtractor = Boolean(extractor);
  const canRun = site.enabled && hasExtractor && !isRunning;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-slate-900">{site.name}</h3>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold",
                site.enabled
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
              )}
            >
              {site.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>

          <div className="mt-2 space-y-1 text-sm text-slate-500">
            <p>
              <span className="font-medium text-slate-700">Code:</span> {site.code}
            </p>
            <p>
              <span className="font-medium text-slate-700">Username:</span>{" "}
              {site.username}
            </p>
          </div>
        </div>

        <div className="text-right">
          {extractor ? (
            <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700">
              <div className="font-bold">{extractor.name}</div>
              <div>v{extractor.version ?? "0.0.0"}</div>
            </div>
          ) : (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
              No extractor
            </div>
          )}
        </div>
      </div>

      {extractor?.description ? (
        <p className="mt-4 line-clamp-2 text-sm text-slate-500">
          {extractor.description}
        </p>
      ) : null}

      <div className="mt-5 grid gap-2">
        <button
          type="button"
          disabled={!canRun}
          onClick={() => onExtract(site.id)}
          className={cn(
            "w-full rounded-xl px-4 py-3 text-sm font-bold transition",
            canRun
              ? "bg-slate-900 text-white hover:bg-slate-700"
              : "cursor-not-allowed bg-slate-100 text-slate-400"
          )}
        >
          {isRunning ? "Extracting..." : "Extract Orders"}
        </button>

        <div className="grid grid-cols-2 gap-2">
          <Link
            href={`/sites/${site.id}`}
            className="rounded-xl border border-slate-200 px-4 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Detail
          </Link>

          <Link
            href={`/sites/${site.id}/settings`}
            className="rounded-xl border border-slate-200 px-4 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
