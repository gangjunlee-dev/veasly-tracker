"use client";

import { Activity, X } from "lucide-react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { StatusBadge, type StatusTone } from "./ui/StatusBadge";

export type ProgressItem = {
  runId?: string;
  siteId?: number;
  siteCode?: string;
  phase?: string;
  message?: string;
  current?: number;
  total?: number;
  saved?: number;
  ordersFound?: number;
  error?: string;
  createdAt?: string;
};

type ExtractionProgressPanelProps = {
  items: ProgressItem[];
  runningRunId?: string | null;
  onClear: () => void;
};

const phaseToneMap: Record<string, { label: string; tone: StatusTone }> = {
  queued: { label: "대기열", tone: "neutral" },
  starting: { label: "시작", tone: "info" },
  browser: { label: "브라우저", tone: "info" },
  login: { label: "로그인", tone: "warning" },
  session: { label: "세션", tone: "primary" },
  extracting: { label: "추출 중", tone: "primary" },
  saving: { label: "저장 중", tone: "primary" },
  success: { label: "완료", tone: "success" },
  failed: { label: "실패", tone: "danger" },
  error: { label: "오류", tone: "danger" },
  cancelled: { label: "취소", tone: "neutral" }
};

function phaseEntry(phase?: string) {
  if (!phase) return { label: "진행", tone: "neutral" as StatusTone };
  return phaseToneMap[phase] ?? { label: phase, tone: "neutral" as StatusTone };
}

export function ExtractionProgressPanel({
  items,
  runningRunId,
  onClear
}: ExtractionProgressPanelProps) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">실시간 진행 상황</h2>
          <p className="mt-0.5 text-xs text-foreground-muted">
            {runningRunId ? "추출이 실행 중입니다" : "추출 트리거 결과가 여기 표시됩니다"}
          </p>
        </div>
        {items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="h-3.5 w-3.5" />
            지우기
          </Button>
        )}
      </div>

      {runningRunId && (
        <div className="flex items-center gap-3 border-b border-border bg-primary-soft px-5 py-3 text-sm text-primary-soft-foreground">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          <span className="font-semibold">실행 중</span>
          <span className="truncate font-mono text-xs opacity-75">{runningRunId}</span>
        </div>
      )}

      <div className="max-h-96 flex-1 overflow-y-auto px-2 py-2">
        {items.length === 0 ? (
          <div className="p-3">
            <EmptyState
              icon={Activity}
              title="진행 로그 없음"
              description="추출을 실행하면 단계별 로그가 실시간으로 표시됩니다."
            />
          </div>
        ) : (
          <ul className="space-y-1.5 px-2 py-1">
            {items.map((item, index) => {
              const entry = phaseEntry(item.phase);
              const hasProgress =
                typeof item.current === "number" || typeof item.total === "number";

              return (
                <li
                  key={`${item.runId ?? "run"}-${index}`}
                  className="rounded-xl border border-border bg-surface px-3.5 py-3 shadow-soft animate-fade-in"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={entry.label} tone={entry.tone} dot />
                    {hasProgress && (
                      <span className="text-xs font-medium text-foreground-muted">
                        {item.current ?? 0} / {item.total ?? "-"}
                      </span>
                    )}
                    {typeof item.ordersFound === "number" && (
                      <span className="text-xs font-semibold text-success-soft-foreground">
                        +{item.ordersFound}건 발견
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-foreground">
                    {item.message ?? "-"}
                  </p>
                  {item.error && (
                    <p className="mt-1.5 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger-soft-foreground">
                      {item.error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
