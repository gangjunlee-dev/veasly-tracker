"use client";

import { cn } from "../lib/format";

export type ProgressItem = {
  runId?: string;
  siteId?: number;
  phase?: string;
  message?: string;
  current?: number;
  total?: number;
  saved?: number;
  error?: string;
  createdAt?: string;
};

type ExtractionProgressPanelProps = {
  items: ProgressItem[];
  runningRunId?: string | null;
  onClear: () => void;
};

function getPhaseColor(phase?: string) {
  switch (phase) {
    case "success":
      return "bg-emerald-50 text-emerald-700 ring-emerald-100";
    case "error":
    case "failed":
      return "bg-rose-50 text-rose-700 ring-rose-100";
    case "saving":
      return "bg-purple-50 text-purple-700 ring-purple-100";
    case "extracting":
      return "bg-blue-50 text-blue-700 ring-blue-100";
    case "login":
    case "session":
      return "bg-amber-50 text-amber-700 ring-amber-100";
    default:
      return "bg-slate-50 text-slate-700 ring-slate-100";
  }
}

export function ExtractionProgressPanel({
  items,
  runningRunId,
  onClear
}: ExtractionProgressPanelProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Extraction Progress</h2>
          <p className="mt-1 text-sm text-slate-500">
            실시간 추출 진행상황입니다.
          </p>
        </div>

        <button
          type="button"
          onClick={onClear}
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Clear
        </button>
      </div>

      {runningRunId ? (
        <div className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white">
          Running job: <span className="font-mono">{runningRunId}</span>
        </div>
      ) : null}

      <div className="mt-4 max-h-80 space-y-3 overflow-auto">
        {items.length === 0 ? (
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            아직 진행 로그가 없습니다. 사이트 카드에서 Extract Orders를 눌러주세요.
          </div>
        ) : (
          items.map((item, index) => (
            <div
              key={`${item.runId ?? "run"}-${index}`}
              className="rounded-xl border border-slate-100 bg-slate-50 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-bold ring-1",
                    getPhaseColor(item.phase)
                  )}
                >
                  {item.phase ?? "progress"}
                </span>

                {typeof item.current === "number" || typeof item.total === "number" ? (
                  <span className="text-xs font-medium text-slate-500">
                    {item.current ?? 0} / {item.total ?? "-"}
                  </span>
                ) : null}

                {typeof item.saved === "number" ? (
                  <span className="text-xs font-medium text-emerald-700">
                    saved {item.saved}
                  </span>
                ) : null}
              </div>

              <p className="mt-2 text-sm font-medium text-slate-800">
                {item.message ?? "-"}
              </p>

              {item.error ? (
                <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
                  {item.error}
                </p>
              ) : null}

              {item.runId ? (
                <p className="mt-2 truncate font-mono text-xs text-slate-400">
                  {item.runId}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
