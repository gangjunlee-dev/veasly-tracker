"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, PackageSearch, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../../../components/AppShell";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input, Select } from "../../../components/ui/Input";
import { KpiCard } from "../../../components/ui/KpiCard";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge, type StatusTone } from "../../../components/ui/StatusBadge";
import { formatCurrency, formatDate } from "../../../lib/format";

type SiteOption = { id: number; name: string };

type UnshippedOrder = {
  id: number;
  siteName?: string;
  orderNumber: string;
  purchaseSiteOrderId?: string | null;
  sellerName?: string | null;
  orderDate: string;
  productName: string;
  productOption?: string | null;
  quantity: number;
  amount: number;
  shippingStatusNormalized?: string | null;
};

type Summary = { total: number; delayed: number; delayThresholdDays: number };

// 정규 배송상태(미발송 구간) → 한글 라벨/색상
const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  purchased: { label: "구매완료", tone: "primary" },
  awaiting_shipment: { label: "발송대기", tone: "warning" },
  preparing_shipment: { label: "발송준비중", tone: "info" },
  unknown: { label: "상태미상", tone: "neutral" }
};

function statusMeta(status: string | null | undefined) {
  if (status && STATUS_META[status]) return STATUS_META[status];
  return { label: status ?? "상태미상", tone: "neutral" as StatusTone };
}

/** 구매일로부터 경과한 일수. 날짜 파싱 실패 시 null. */
function daysSincePurchase(dateStr: string): number | null {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export default function UnshippedOrdersPage() {
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [siteId, setSiteId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("");
  const [seller, setSeller] = useState("");
  const [search, setSearch] = useState("");
  const [minDays, setMinDays] = useState("");

  const [orders, setOrders] = useState<UnshippedOrder[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total: 0,
    delayed: 0,
    delayThresholdDays: 3
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.api.sites
      .list()
      .then((rows) => {
        if (!cancelled) {
          setSites(rows.map((site) => ({ id: site.id, name: site.name })));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const loadOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const parsedMinDays = Number.parseInt(minDays, 10);
      const result = await window.api.orders.listUnshipped({
        page: 1,
        pageSize: 300,
        siteIds: siteId ? [Number(siteId)] : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        status: status || undefined,
        seller: seller.trim() || undefined,
        search: search.trim() || undefined,
        minDaysSincePurchase:
          Number.isFinite(parsedMinDays) && parsedMinDays > 0
            ? parsedMinDays
            : undefined
      });
      setOrders(result.items);
      setSummary(result.summary);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "미발송 주문을 불러오지 못했습니다."
      );
    } finally {
      setIsLoading(false);
    }
  }, [siteId, dateFrom, dateTo, status, seller, search, minDays]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const shownTotal = orders.length;

  const delayedShown = useMemo(
    () =>
      orders.filter((order) => {
        const days = daysSincePurchase(order.orderDate);
        return days !== null && days >= summary.delayThresholdDays;
      }).length,
    [orders, summary.delayThresholdDays]
  );

  return (
    <AppShell>
      <PageHeader
        eyebrow="구매 모니터링"
        title="구매했지만 미발송"
        description="구매 사이트에서 결제했지만 아직 송장·택배사 정보가 없는 주문입니다. 오래 묵은 항목을 먼저 확인하세요."
        actions={
          <Button
            variant="ghost"
            onClick={() => void loadOrders()}
            loading={isLoading}
            disabled={isLoading}
          >
            <RefreshCw className="h-4 w-4" />
            새로고침
          </Button>
        }
      />

      <div className="mt-8 space-y-6">
        <section className="grid gap-4 sm:grid-cols-3">
          <KpiCard
            label="미발송 주문"
            value={summary.total.toLocaleString("ko-KR")}
            hint="현재 필터 기준 전체 미발송 건수"
            icon={Truck}
            tone={summary.total > 0 ? "warning" : "default"}
          />
          <KpiCard
            label={`지연 (D+${summary.delayThresholdDays} 이상)`}
            value={summary.delayed.toLocaleString("ko-KR")}
            hint="구매 후 오래 경과한 미발송 건수"
            icon={AlertTriangle}
            tone={summary.delayed > 0 ? "danger" : "default"}
          />
          <KpiCard
            label="현재 화면 표시"
            value={shownTotal.toLocaleString("ko-KR")}
            hint={`이 중 지연 ${delayedShown}건 (최대 300건 표시)`}
            icon={Clock}
            tone="default"
          />
        </section>

        <Card>
          <div className="flex flex-wrap items-end gap-3 border-b border-border px-6 py-4">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground-muted">
                사이트
              </span>
              <Select
                value={siteId}
                onChange={(event) => setSiteId(event.target.value)}
                className="w-40"
              >
                <option value="">전체 사이트</option>
                {sites.map((site) => (
                  <option key={site.id} value={String(site.id)}>
                    {site.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground-muted">
                배송 상태
              </span>
              <Select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="w-36"
              >
                <option value="">전체 상태</option>
                <option value="purchased">구매완료</option>
                <option value="awaiting_shipment">발송대기</option>
                <option value="preparing_shipment">발송준비중</option>
                <option value="unknown">상태미상</option>
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground-muted">
                구매일 (시작)
              </span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="w-40"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground-muted">
                구매일 (끝)
              </span>
              <Input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="w-40"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground-muted">
                판매자
              </span>
              <Input
                value={seller}
                onChange={(event) => setSeller(event.target.value)}
                placeholder="판매자명"
                className="w-36"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground-muted">
                상품명
              </span>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="상품명 검색"
                className="w-44"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-foreground-muted">
                최소 경과일수
              </span>
              <Input
                type="number"
                min={0}
                value={minDays}
                onChange={(event) => setMinDays(event.target.value)}
                placeholder="예: 3"
                className="w-28"
              />
            </label>
          </div>

          {orders.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={PackageSearch}
                title={
                  isLoading ? "불러오는 중…" : "미발송 주문이 없습니다"
                }
                description="필터 조건에 맞는 미발송 주문이 없습니다. 주문 데이터를 먼저 가져온 뒤 확인해 주세요."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-foreground-muted">
                    <th className="px-4 py-3 text-left font-semibold">사이트</th>
                    <th className="px-4 py-3 text-left font-semibold">주문번호</th>
                    <th className="px-4 py-3 text-left font-semibold">판매자</th>
                    <th className="px-4 py-3 text-left font-semibold">구매일</th>
                    <th className="px-4 py-3 text-left font-semibold">상품</th>
                    <th className="px-4 py-3 text-right font-semibold">수량</th>
                    <th className="px-4 py-3 text-right font-semibold">금액</th>
                    <th className="px-4 py-3 text-left font-semibold">상태</th>
                    <th className="px-4 py-3 text-right font-semibold">경과</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((order) => {
                    const days = daysSincePurchase(order.orderDate);
                    const meta = statusMeta(order.shippingStatusNormalized);
                    const delayTone =
                      days !== null && days >= summary.delayThresholdDays
                        ? "bg-danger-soft"
                        : days !== null && days >= 2
                          ? "bg-warning-soft"
                          : "";

                    return (
                      <tr key={order.id} className={delayTone || "hover:bg-surface-2"}>
                        <td className="px-4 py-3 text-foreground-muted">
                          {order.siteName ?? "-"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-foreground">
                          {order.purchaseSiteOrderId ?? order.orderNumber}
                        </td>
                        <td className="px-4 py-3 text-foreground-muted">
                          {order.sellerName ?? "정보 없음"}
                        </td>
                        <td className="px-4 py-3 text-foreground-muted">
                          {formatDate(order.orderDate)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">
                            {order.productName}
                          </div>
                          {order.productOption ? (
                            <div className="text-xs text-foreground-muted">
                              {order.productOption}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground-muted">
                          {order.quantity}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground">
                          {formatCurrency(order.amount)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge label={meta.label} tone={meta.tone} dot />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">
                          {days === null ? "-" : `${days}일`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
