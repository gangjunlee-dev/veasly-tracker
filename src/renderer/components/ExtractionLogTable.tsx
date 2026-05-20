"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { ExtractionStatusBadge } from "./ui/StatusBadge";

export type ExtractionLogRow = {
  id: number;
  siteId: number;
  siteName?: string;
  siteCode?: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
  totalOrders: number;
  newOrders: number;
  updatedOrders: number;
  savedOrders: number;
  errorStack: string | null;
  createdAt: string;
};

type ExtractionLogTableProps = {
  logs: ExtractionLogRow[];
  total: number;
  title?: string;
  description?: string;
  onRefresh?: () => void;
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getDuration(startedAt?: string | null, finishedAt?: string | null) {
  if (!startedAt || !finishedAt) return "-";

  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "-";

  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}초`;

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}분 ${rest}초`;
}

export function ExtractionLogTable({
  logs,
  total,
  title = "추출 이력",
  description,
  onRefresh
}: ExtractionLogTableProps) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-sm text-foreground-muted">
            {description ?? `총 ${total.toLocaleString("ko-KR")}건`}
          </p>
        </div>
        {onRefresh && (
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
            새로고침
          </Button>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="아직 추출 기록이 없습니다"
            description="주문 가져오기를 한 번 실행하면 결과가 여기에 표시됩니다."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-foreground-muted">
                <th className="whitespace-nowrap px-6 py-3 text-left font-semibold">
                  실행
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-left font-semibold">
                  쇼핑몰
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-left font-semibold">
                  상태
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-right font-semibold">
                  총 주문
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-right font-semibold">
                  신규
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-right font-semibold">
                  업데이트
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-left font-semibold">
                  시작
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-left font-semibold">
                  소요
                </th>
                <th className="px-6 py-3 text-left font-semibold">메시지</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-surface-2">
                  <td className="whitespace-nowrap px-6 py-3 font-mono text-xs text-foreground-muted">
                    #{log.id}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <div className="font-semibold text-foreground">
                      {log.siteName ?? `사이트 #${log.siteId}`}
                    </div>
                    <div className="text-xs text-foreground-muted">
                      {log.siteCode ?? "-"}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <ExtractionStatusBadge status={log.status} />
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums font-semibold text-foreground">
                    {log.totalOrders}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums text-foreground-muted">
                    {log.newOrders}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums text-foreground-muted">
                    {log.updatedOrders}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-foreground-muted">
                    {formatDateTime(log.startedAt)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-foreground-muted">
                    {getDuration(log.startedAt, log.finishedAt)}
                  </td>
                  <td className="min-w-[18rem] max-w-md px-6 py-3 text-foreground-muted">
                    <div className="line-clamp-2 text-xs">
                      {log.status === "failed"
                        ? log.errorStack || log.message || "-"
                        : log.message || "-"}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
