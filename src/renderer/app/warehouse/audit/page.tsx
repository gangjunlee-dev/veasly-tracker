"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  ScanLine,
  XCircle
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../../../components/AppShell";
import { Button } from "../../../components/ui/Button";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CardDescription
} from "../../../components/ui/Card";
import { KpiCard } from "../../../components/ui/KpiCard";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge, type StatusTone } from "../../../components/ui/StatusBadge";

type AuditEntry = {
  id: number;
  eventType: string;
  trackingNumber: string | null;
  orderItemId: number | null;
  vyCode: string | null;
  orderNumber: string | null;
  productName: string | null;
  adminSynced: boolean;
  adminError: string | null;
  retryCount: number;
  createdAt: string;
};

const EVENT_CONFIG: Record<
  string,
  { label: string; tone: StatusTone; icon: typeof CheckCircle2 }
> = {
  SCAN_AUTO: { label: "자동 매칭", tone: "success", icon: CheckCircle2 },
  SCAN_PARTIAL: { label: "부분 매칭", tone: "warning", icon: AlertTriangle },
  SCAN_MISS: { label: "매칭 실패", tone: "danger", icon: XCircle },
  CONFIRM_LOCAL: { label: "로컬 확정", tone: "info", icon: ScanLine },
  CONFIRM_SYNCED: { label: "Admin 전송", tone: "success", icon: CheckCircle2 },
  CONFIRM_SYNC_FAILED: {
    label: "전송 실패",
    tone: "danger",
    icon: XCircle,
  },
  RETRY_SUCCESS: { label: "재시도 성공", tone: "success", icon: RefreshCw },
  RETRY_FAILED: { label: "재시도 실패", tone: "danger", icon: XCircle },
};

function formatTime(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await window.api.admin.auditLog({
        limit: 100,
        ...(filter ? { eventType: filter } : {}),
      });
      setEntries(result.entries);
      setStats(result.stats);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const result = await window.api.admin.retryPending();
      if (result.retried === 0) {
        toast.info("재시도할 항목이 없습니다.");
      } else {
        toast.success(
          `재시도 완료: ${result.succeeded}건 성공, ${result.failed}건 실패`
        );
        void load();
      }
    } catch (err) {
      toast.error("재시도 오류: " + String(err));
    } finally {
      setRetrying(false);
    }
  };

  const pendingCount =
    (stats["CONFIRM_SYNC_FAILED"] ?? 0) + (stats["RETRY_FAILED"] ?? 0);
  const totalScans =
    (stats["SCAN_AUTO"] ?? 0) +
    (stats["SCAN_PARTIAL"] ?? 0) +
    (stats["SCAN_MISS"] ?? 0);
  const totalConfirmed =
    (stats["CONFIRM_SYNCED"] ?? 0) + (stats["RETRY_SUCCESS"] ?? 0);

  const filterButtons: Array<{ key: string | null; label: string }> = [
    { key: null, label: "전체" },
    { key: "SCAN_AUTO", label: "자동 매칭" },
    { key: "SCAN_MISS", label: "매칭 실패" },
    { key: "CONFIRM_SYNCED", label: "전송 완료" },
    { key: "CONFIRM_SYNC_FAILED", label: "전송 실패" },
  ];

  return (
    <AppShell>
      <PageHeader
        eyebrow="창고"
        title="감사 로그"
        description="바코드 스캔, 매칭, Admin 전송 전 과정의 이벤트 기록입니다."
        actions={
          pendingCount > 0 ? (
            <Button
              variant="primary"
              size="sm"
              onClick={handleRetry}
              loading={retrying}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              실패 {pendingCount}건 재시도
            </Button>
          ) : undefined
        }
      />

      {/* KPI */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="총 스캔"
          value={totalScans}
          icon={ScanLine}
        />
        <KpiCard
          label="Admin 전송 완료"
          value={totalConfirmed}
          icon={CheckCircle2}
          tone="success"
        />
        <KpiCard
          label="전송 대기/실패"
          value={pendingCount}
          icon={AlertTriangle}
          tone={pendingCount > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="매칭 실패"
          value={stats["SCAN_MISS"] ?? 0}
          icon={XCircle}
          tone={(stats["SCAN_MISS"] ?? 0) > 0 ? "danger" : "default"}
        />
      </div>

      {/* 필터 + 테이블 */}
      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>이벤트 로그</CardTitle>
            <CardDescription>최근 100건</CardDescription>
          </div>
          <div className="flex gap-1">
            {filterButtons.map((fb) => (
              <button
                key={fb.key ?? "all"}
                onClick={() => {
                  setFilter(fb.key);
                  setLoading(true);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  filter === fb.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-2 text-foreground-muted hover:bg-surface-2/80"
                }`}
              >
                {fb.label}
              </button>
            ))}
          </div>
        </CardHeader>

        {loading ? (
          <CardBody>
            <div className="flex items-center justify-center py-10">
              <Clock className="h-5 w-5 animate-spin text-foreground-muted" />
            </div>
          </CardBody>
        ) : entries.length === 0 ? (
          <CardBody>
            <p className="py-10 text-center text-sm text-foreground-muted">
              이벤트 기록이 없습니다.
            </p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  <th className="px-6 py-3">시각</th>
                  <th className="px-6 py-3">이벤트</th>
                  <th className="px-6 py-3">송장번호</th>
                  <th className="px-6 py-3">VY코드</th>
                  <th className="px-6 py-3">주문번호</th>
                  <th className="px-6 py-3">상품명</th>
                  <th className="px-6 py-3">비고</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry) => {
                  const config =
                    EVENT_CONFIG[entry.eventType] ?? {
                      label: entry.eventType,
                      tone: "neutral" as const,
                      icon: Clock,
                    };

                  return (
                    <tr key={entry.id} className="hover:bg-surface-2/50">
                      <td className="whitespace-nowrap px-6 py-3 tabular-nums text-xs text-foreground-muted">
                        {formatTime(entry.createdAt)}
                      </td>
                      <td className="px-6 py-3">
                        <StatusBadge
                          label={config.label}
                          tone={config.tone}
                          dot
                        />
                      </td>
                      <td className="px-6 py-3 font-mono text-xs text-foreground-muted">
                        {entry.trackingNumber ?? "-"}
                      </td>
                      <td className="px-6 py-3 font-medium text-foreground">
                        {entry.vyCode ?? "-"}
                      </td>
                      <td className="px-6 py-3 font-mono text-xs text-foreground-muted">
                        {entry.orderNumber ?? "-"}
                      </td>
                      <td className="max-w-[180px] truncate px-6 py-3 text-foreground-muted">
                        {entry.productName ?? "-"}
                      </td>
                      <td className="px-6 py-3 text-xs text-foreground-muted">
                        {entry.adminError ? (
                          <span className="text-danger">{entry.adminError}</span>
                        ) : entry.adminSynced ? (
                          <span className="text-success">Admin 전송됨</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
