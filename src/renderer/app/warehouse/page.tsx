"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Keyboard,
  PackageSearch,
  RefreshCw,
  Scan,
  Wand2
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../../components/AppShell";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input, Select } from "../../components/ui/Input";
import { KpiCard } from "../../components/ui/KpiCard";
import { PageHeader } from "../../components/ui/PageHeader";
import { WarehouseStatusBadge } from "../../components/ui/StatusBadge";

type InboundScan = {
  id: number;
  trackingNumber: string;
  normalizedTrackingNumber: string;
  carrier: string | null;
  rawInput: string | null;
  status: string;
  matchedOrderCount: number;
  scanCount: number;
  scannedAt: string;
  lastScannedAt: string | null;
  matchedAt: string | null;
  note: string | null;
};

type ScanListResult = {
  items: InboundScan[];
  total: number;
  summary: Record<string, number>;
};

type MatchedOrder = {
  id?: number;
  siteId?: number;
  siteName?: string;
  siteCode?: string;
  orderNumber: string;
  productName: string;
  optionName: string | null;
  brandName?: string | null;
  amount?: number;
  quantity?: number;
  carrier: string | null;
  trackingNumber: string | null;
};

type AutoMatchResult = {
  scannedCount: number;
  matchedScanCount: number;
  unmatchedScanCount: number;
  matchedOrderCount: number;
  matchedScans: Array<{
    scan: InboundScan;
    matchedOrders: MatchedOrder[];
  }>;
  unmatchedScans: InboundScan[];
};

type ScanResult = {
  result: string;
  message: string;
  scan: InboundScan | null;
  matchedOrders: MatchedOrder[];
};

function maskTracking(value: string | null | undefined) {
  if (!value) return "";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function formatDateTime(value: string | null | undefined) {
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

export default function WarehousePage() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [trackingNumber, setTrackingNumber] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [scans, setScans] = useState<InboundScan[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [lastAutoMatch, setLastAutoMatch] = useState<AutoMatchResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isMatching, setIsMatching] = useState(false);

  const loadScans = useCallback(async () => {
    const result = (await window.api.warehouse.listInboundScans({
      page: 1,
      pageSize: 100,
      status: statusFilter,
      search: search.trim() || undefined
    })) as ScanListResult;

    setScans(result.items ?? []);
    setTotal(result.total ?? 0);
    setSummary(result.summary ?? {});
  }, [statusFilter, search]);

  useEffect(() => {
    void loadScans();
  }, [loadScans]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const stats = useMemo(
    () => ({
      scanned: summary.SCANNED ?? 0,
      matched: summary.MATCHED ?? 0,
      unmatched: summary.UNMATCHED ?? 0,
      issue: summary.ISSUE ?? 0
    }),
    [summary]
  );

  const handleScan = async () => {
    const value = trackingNumber.trim();
    if (!value || isScanning) {
      inputRef.current?.focus();
      return;
    }

    setIsScanning(true);
    try {
      const result = (await window.api.warehouse.scanInbound({
        trackingNumber: value
      })) as ScanResult;

      setLastScan(result);
      setTrackingNumber("");

      if (result.result === "DUPLICATE") {
        toast.warning(result.message);
      } else if (result.matchedOrders.length > 0) {
        toast.success(
          `${maskTracking(result.scan?.normalizedTrackingNumber)} · 주문 ${result.matchedOrders.length}건 자동 매칭`
        );
      } else {
        toast.success(result.message);
      }

      await loadScans();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "송장 저장에 실패했습니다."
      );
    } finally {
      setIsScanning(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleAutoMatch = async () => {
    if (isMatching) return;
    setIsMatching(true);
    try {
      const result = (await window.api.warehouse.autoMatch()) as AutoMatchResult;
      setLastAutoMatch(result);

      if (result.scannedCount === 0) {
        toast.info("매칭 시도할 송장이 없습니다.");
      } else if (result.matchedScanCount > 0) {
        toast.success(
          `자동 매칭 완료 · 송장 ${result.matchedScanCount}건 매칭 / 주문 ${result.matchedOrderCount}건 입고`
        );
      } else {
        toast.warning(
          `송장 ${result.unmatchedScanCount}건이 아직 미매칭입니다. 주문을 가져온 뒤 다시 시도해 주세요.`
        );
      }

      await loadScans();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "자동 매칭에 실패했습니다."
      );
    } finally {
      setIsMatching(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="입고"
        title="송장 스캔으로 입고 처리"
        description="바코드 리더기로 도착한 택배 송장을 스캔하면 자동으로 주문과 매칭됩니다. 주문 데이터가 아직 없어도 송장은 먼저 저장됩니다."
        actions={
          <Button
            variant="primary"
            onClick={handleAutoMatch}
            loading={isMatching}
            disabled={isMatching}
          >
            <Wand2 className="h-4 w-4" />
            전체 자동 매칭
          </Button>
        }
      />

      <div className="mt-8 space-y-6">
        <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <Card className="overflow-hidden">
            <div className="border-b border-border bg-gradient-to-br from-primary-soft via-surface to-surface px-6 py-5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-soft-foreground">
                <Scan className="h-4 w-4" />
                바코드 스캔 입력
              </div>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-stretch">
                <Input
                  ref={inputRef}
                  value={trackingNumber}
                  onChange={(event) => setTrackingNumber(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleScan();
                    }
                  }}
                  placeholder="여기를 클릭한 뒤 바코드를 스캔하세요"
                  className="h-14 font-mono text-xl font-bold tracking-wider"
                  autoFocus
                />
                <Button
                  variant="primary"
                  className="h-14 px-6 text-base"
                  onClick={() => void handleScan()}
                  loading={isScanning}
                  disabled={isScanning || !trackingNumber.trim()}
                >
                  <Scan className="h-5 w-5" />
                  저장
                </Button>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-foreground-muted">
                <Keyboard className="h-3.5 w-3.5" />
                USB 바코드 리더기는 키보드처럼 동작합니다. 스캔 후 자동으로 Enter가 입력됩니다.
              </p>
            </div>

            <div className="px-6 py-5">
              {lastScan?.scan ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                        마지막 스캔
                      </p>
                      <p className="mt-1 font-mono text-2xl font-bold tracking-wide text-foreground">
                        {maskTracking(lastScan.scan.normalizedTrackingNumber)}
                      </p>
                    </div>
                    <WarehouseStatusBadge status={lastScan.scan.status} />
                  </div>
                  <p className="text-sm text-foreground-muted">{lastScan.message}</p>

                  {lastScan.matchedOrders.length > 0 && (
                    <div className="rounded-xl border border-success/20 bg-success-soft px-4 py-3">
                      <p className="text-xs font-semibold text-success-soft-foreground">
                        매칭된 주문 {lastScan.matchedOrders.length}건
                      </p>
                      <ul className="mt-2 space-y-1 text-sm text-success-soft-foreground">
                        {lastScan.matchedOrders.slice(0, 3).map((order) => (
                          <li key={order.orderNumber} className="truncate">
                            · {order.productName}{" "}
                            {order.optionName ? `(${order.optionName})` : ""}
                          </li>
                        ))}
                        {lastScan.matchedOrders.length > 3 && (
                          <li className="text-xs opacity-75">
                            외 {lastScan.matchedOrders.length - 3}건
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState
                  icon={PackageSearch}
                  title="스캔 결과가 여기에 표시됩니다"
                  description="입력창에 포커스를 둔 상태로 바코드를 스캔해 보세요."
                />
              )}
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <KpiCard
              label="스캔 대기"
              value={stats.scanned.toLocaleString("ko-KR")}
              hint="아직 매칭 시도 안 한 송장"
              icon={Inbox}
              tone="info"
            />
            <KpiCard
              label="매칭 완료"
              value={stats.matched.toLocaleString("ko-KR")}
              hint="주문과 자동 매칭된 송장"
              icon={CheckCircle2}
              tone="success"
            />
            <KpiCard
              label="미매칭"
              value={stats.unmatched.toLocaleString("ko-KR")}
              hint="주문 데이터를 가져온 뒤 다시 매칭"
              icon={AlertTriangle}
              tone={stats.unmatched > 0 ? "warning" : "default"}
            />
            <KpiCard
              label="전체 송장"
              value={total.toLocaleString("ko-KR")}
              hint={`이슈 ${stats.issue}건`}
              icon={Scan}
              tone="default"
            />
          </div>
        </section>

        {lastAutoMatch && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  최근 자동 매칭 결과
                </h2>
                <p className="mt-0.5 text-sm text-foreground-muted">
                  매칭된 송장과 어떤 상품에 연결되었는지 보여줍니다.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
                <span>
                  대상 <span className="font-semibold text-foreground">
                    {lastAutoMatch.scannedCount}
                  </span>
                </span>
                <span className="text-foreground-subtle">·</span>
                <span>
                  매칭{" "}
                  <span className="font-semibold text-success-soft-foreground">
                    {lastAutoMatch.matchedScanCount}
                  </span>
                </span>
                <span className="text-foreground-subtle">·</span>
                <span>
                  미매칭{" "}
                  <span className="font-semibold text-warning-soft-foreground">
                    {lastAutoMatch.unmatchedScanCount}
                  </span>
                </span>
                <span className="text-foreground-subtle">·</span>
                <span>
                  주문{" "}
                  <span className="font-semibold text-foreground">
                    {lastAutoMatch.matchedOrderCount}건 입고
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLastAutoMatch(null)}
                >
                  지우기
                </Button>
              </div>
            </div>

            {lastAutoMatch.matchedScans.length === 0 &&
            lastAutoMatch.unmatchedScans.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={Wand2}
                  title="이번 실행에서 처리한 송장이 없습니다"
                  description="스캔 풀이 비어 있거나 모든 송장이 이미 매칭되어 있습니다."
                />
              </div>
            ) : (
              <div className="divide-y divide-border">
                {lastAutoMatch.matchedScans.map(({ scan, matchedOrders }) => (
                  <div
                    key={`matched-${scan.id}`}
                    className="grid gap-3 px-6 py-4 lg:grid-cols-[280px_1fr]"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <WarehouseStatusBadge status="MATCHED" />
                        <span className="font-mono text-sm font-semibold text-foreground">
                          {maskTracking(scan.normalizedTrackingNumber)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-foreground-muted">
                        {scan.carrier ?? "택배사 미지정"} · {formatDateTime(scan.scannedAt)}
                      </p>
                    </div>
                    <ul className="space-y-2">
                      {matchedOrders.map((order, index) => (
                        <li
                          key={`${scan.id}-${order.orderNumber}-${index}`}
                          className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-success/15 bg-success-soft/40 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {order.siteName && (
                                <span className="rounded-md bg-surface px-2 py-0.5 text-[11px] font-semibold text-foreground-muted ring-1 ring-border">
                                  {order.siteName}
                                </span>
                              )}
                              {order.brandName && (
                                <span className="text-[11px] font-semibold text-foreground-muted">
                                  {order.brandName}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
                              {order.productName}
                            </p>
                            {(order.optionName || order.quantity) && (
                              <p className="text-xs text-foreground-muted">
                                {order.optionName ?? ""}
                                {order.optionName && order.quantity ? " · " : ""}
                                {order.quantity ? `${order.quantity}개` : ""}
                              </p>
                            )}
                          </div>
                          {typeof order.amount === "number" && order.amount > 0 && (
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                              {order.amount.toLocaleString("ko-KR")}원
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                {lastAutoMatch.unmatchedScans.length > 0 && (
                  <div className="space-y-3 px-6 py-4">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning-soft-foreground" />
                      <p className="text-sm font-semibold text-warning-soft-foreground">
                        매칭되지 않은 송장 {lastAutoMatch.unmatchedScans.length}건
                      </p>
                    </div>
                    <ul className="flex flex-wrap gap-2">
                      {lastAutoMatch.unmatchedScans.map((scan) => (
                        <li
                          key={`unmatched-${scan.id}`}
                          className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-1.5 font-mono text-xs text-warning-soft-foreground"
                        >
                          {maskTracking(scan.normalizedTrackingNumber)}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-foreground-muted">
                      주문 데이터를 가져온 뒤{" "}
                      <span className="font-semibold text-foreground">
                        전체 자동 매칭
                      </span>
                      을 다시 눌러주세요.
                    </p>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                스캔 풀
              </h2>
              <p className="mt-0.5 text-sm text-foreground-muted">
                먼저 스캔된 송장 목록입니다. 주문 데이터가 추가 입수되면 &lsquo;전체 자동 매칭&rsquo;으로 일괄 처리하세요.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="w-36"
              >
                <option value="ALL">전체 상태</option>
                <option value="SCANNED">스캔됨</option>
                <option value="MATCHED">매칭 완료</option>
                <option value="UNMATCHED">미매칭</option>
                <option value="ISSUE">이슈</option>
                <option value="IGNORED">제외</option>
              </Select>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="송장 검색"
                className="w-48"
              />
              <Button variant="ghost" size="sm" onClick={loadScans}>
                <RefreshCw className="h-3.5 w-3.5" />
                새로고침
              </Button>
            </div>
          </div>

          {scans.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Scan}
                title="아직 스캔된 송장이 없습니다"
                description="위 바코드 입력창에서 첫 송장을 스캔하면 여기에 표시됩니다."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-foreground-muted">
                    <th className="px-6 py-3 text-left font-semibold">송장</th>
                    <th className="px-6 py-3 text-left font-semibold">상태</th>
                    <th className="px-6 py-3 text-right font-semibold">매칭</th>
                    <th className="px-6 py-3 text-right font-semibold">스캔 횟수</th>
                    <th className="px-6 py-3 text-left font-semibold">최초 스캔</th>
                    <th className="px-6 py-3 text-left font-semibold">최근 스캔</th>
                    <th className="px-6 py-3 text-left font-semibold">매칭 시각</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {scans.map((scan) => (
                    <tr key={scan.id} className="hover:bg-surface-2">
                      <td className="px-6 py-3">
                        <div className="font-mono text-sm font-semibold text-foreground">
                          {maskTracking(scan.normalizedTrackingNumber)}
                        </div>
                        <div className="text-xs text-foreground-muted">
                          {scan.carrier ?? "택배사 미지정"}
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <WarehouseStatusBadge status={scan.status} />
                      </td>
                      <td className="px-6 py-3 text-right font-semibold tabular-nums text-foreground">
                        {scan.matchedOrderCount}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums text-foreground-muted">
                        {scan.scanCount}
                      </td>
                      <td className="px-6 py-3 text-foreground-muted">
                        {formatDateTime(scan.scannedAt)}
                      </td>
                      <td className="px-6 py-3 text-foreground-muted">
                        {formatDateTime(scan.lastScannedAt)}
                      </td>
                      <td className="px-6 py-3 text-foreground-muted">
                        {formatDateTime(scan.matchedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
