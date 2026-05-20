"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  History as HistoryIcon,
  XCircle,
  Zap
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../../components/AppShell";
import {
  ExtractionLogTable,
  type ExtractionLogRow
} from "../../components/ExtractionLogTable";
import { Button } from "../../components/ui/Button";
import { KpiCard } from "../../components/ui/KpiCard";
import { PageHeader } from "../../components/ui/PageHeader";

type LogsResult = {
  items: ExtractionLogRow[];
  total: number;
};

export default function HistoryPage() {
  const [logs, setLogs] = useState<ExtractionLogRow[]>([]);
  const [total, setTotal] = useState(0);

  const loadLogs = useCallback(async () => {
    try {
      const result = (await window.api.logs.list({
        page: 1,
        pageSize: 100
      })) as LogsResult;
      setLogs(result.items ?? []);
      setTotal(result.total ?? 0);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "추출 이력을 불러오지 못했습니다."
      );
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const summary = useMemo(() => {
    const success = logs.filter((log) => log.status === "success").length;
    const failed = logs.filter((log) => log.status === "failed").length;
    const totalOrders = logs.reduce((sum, log) => sum + log.totalOrders, 0);

    return { success, failed, totalOrders };
  }, [logs]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="추출 이력"
        title="자동 추출 실행 기록"
        description="언제, 어떤 쇼핑몰에서, 몇 건의 주문을 수집했는지 모두 추적할 수 있습니다."
        actions={
          <Link href="/extract">
            <Button variant="primary">
              <Zap className="h-4 w-4" />
              새 추출 실행
            </Button>
          </Link>
        }
      />

      <div className="mt-8 space-y-6">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="총 실행"
            value={total.toLocaleString("ko-KR")}
            hint="누적 추출 작업 수"
            icon={HistoryIcon}
            tone="primary"
          />
          <KpiCard
            label="성공"
            value={summary.success.toLocaleString("ko-KR")}
            hint="최근 100건 기준"
            icon={CheckCircle2}
            tone="success"
          />
          <KpiCard
            label="실패"
            value={summary.failed.toLocaleString("ko-KR")}
            hint={summary.failed > 0 ? "실패 사유는 메시지 컬럼 참고" : "전부 정상"}
            icon={XCircle}
            tone={summary.failed > 0 ? "danger" : "default"}
          />
          <KpiCard
            label="수집된 주문"
            value={summary.totalOrders.toLocaleString("ko-KR")}
            hint="최근 100건 합계"
            icon={Zap}
            tone="info"
          />
        </section>

        <ExtractionLogTable
          logs={logs}
          total={total}
          title="추출 이력"
          description={`최근 ${logs.length}건 표시 (전체 ${total.toLocaleString("ko-KR")}건)`}
          onRefresh={loadLogs}
        />
      </div>
    </AppShell>
  );
}
