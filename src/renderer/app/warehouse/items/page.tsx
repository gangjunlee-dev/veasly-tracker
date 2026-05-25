"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  Search
} from "lucide-react";
import { AppShell } from "../../../components/AppShell";
import { Button } from "../../../components/ui/Button";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle
} from "../../../components/ui/Card";
import { Input } from "../../../components/ui/Input";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge, type StatusTone } from "../../../components/ui/StatusBadge";

type MatchedItem = {
  orderItemId: number;
  vyCode: string;
  productName: string;
  itemStatus: string;
  warehouseStatus: string;
  warehouseMatchedAt: string | null;
  domesticTrackingNumber: string | null;
  domesticCarrier: string | null;
  orderNumber: string;
  customerName: string | null;
  orderStatus: string;
};

const STATUS_CONFIG: Record<string, { label: string; tone: StatusTone }> = {
  PAYMENT_COMPLETED: { label: "결제 완료", tone: "primary" },
  ORDER_PROCESSING: { label: "주문 처리중", tone: "info" },
  SHIPPING_TO_BDJ: { label: "배대지 배송중", tone: "info" },
  SHIPPING_TO_HOME: { label: "해외 배송중", tone: "success" },
  DELIVERED: { label: "배송 완료", tone: "success" },
  COMPLETED: { label: "완료", tone: "neutral" },
  CANCEL_COMPLETED: { label: "취소 완료", tone: "neutral" },
  CANCEL_REQUESTED: { label: "취소 요청", tone: "warning" },
};

const WAREHOUSE_CONFIG: Record<string, { label: string; tone: StatusTone }> = {
  PENDING: { label: "입고 대기", tone: "warning" },
  ARRIVED: { label: "입고 완료", tone: "success" },
  SHIPPED: { label: "출고 완료", tone: "info" },
};

type FilterTab = {
  key: string | undefined;
  label: string;
  count?: number;
};

export default function ItemsPage() {
  const [items, setItems] = useState<MatchedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [counts, setCounts] = useState<Record<string, number>>({});

  const pageSize = 50;

  // 상태별 카운트 로드
  useEffect(() => {
    window.api.admin
      .syncStatus()
      .then((ss) => setCounts(ss.byStatus))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.api.admin.listItems({
        page,
        pageSize,
        status: statusFilter,
        search: search || undefined,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleSearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  const handleStatusFilter = (status: string | undefined) => {
    setStatusFilter(status);
    setPage(1);
  };

  // 필터 탭
  const totalCount = Object.values(counts).reduce((s, c) => s + c, 0);
  const filterTabs: FilterTab[] = [
    { key: undefined, label: "전체", count: totalCount },
    { key: "ORDER_PROCESSING", label: "주문 처리중", count: counts["ORDER_PROCESSING"] },
    { key: "PAYMENT_COMPLETED", label: "결제 완료", count: counts["PAYMENT_COMPLETED"] },
    { key: "SHIPPING_TO_BDJ", label: "배대지 배송중", count: counts["SHIPPING_TO_BDJ"] },
    { key: "SHIPPING_TO_HOME", label: "해외 배송중", count: counts["SHIPPING_TO_HOME"] },
    { key: "CANCEL_COMPLETED", label: "취소", count: counts["CANCEL_COMPLETED"] },
  ];

  return (
    <AppShell>
      <PageHeader
        eyebrow="창고"
        title="동기화 아이템"
        description={`admin.veasly.com에서 동기화된 전체 아이템 목록입니다. (총 ${total}건)`}
      />

      {/* 검색 + 필터 */}
      <div className="mt-6 space-y-4">
        {/* 검색 */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <Input
              type="text"
              placeholder="VY코드, 상품명, 주문번호, 고객명, 송장번호 검색..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9"
            />
          </div>
          <Button variant="secondary" onClick={handleSearch} disabled={!searchInput.trim()}>
            검색
          </Button>
          {search ? (
            <Button variant="ghost" onClick={handleClearSearch}>
              초기화
            </Button>
          ) : null}
        </div>

        {/* 상태 필터 탭 */}
        <div className="flex flex-wrap gap-1.5">
          {filterTabs.map((tab) => (
            <button
              key={tab.key ?? "all"}
              onClick={() => handleStatusFilter(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === tab.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-2 text-foreground-muted hover:bg-surface-2/80"
              }`}
            >
              {tab.label}
              {tab.count != null ? (
                <span className="ml-1.5 tabular-nums opacity-70">{tab.count}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* 테이블 */}
      <Card className="mt-4">
        {loading ? (
          <CardBody>
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
            </div>
          </CardBody>
        ) : items.length === 0 ? (
          <CardBody>
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Package className="h-8 w-8 text-foreground-subtle" />
              <p className="text-sm text-foreground-muted">
                {search
                  ? `"${search}"에 대한 검색 결과가 없습니다.`
                  : "동기화된 아이템이 없습니다."}
              </p>
            </div>
          </CardBody>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                    <th className="px-4 py-3">VY코드</th>
                    <th className="px-4 py-3">상품명</th>
                    <th className="px-4 py-3">주문번호</th>
                    <th className="px-4 py-3">고객명</th>
                    <th className="px-4 py-3">주문 상태</th>
                    <th className="px-4 py-3">입고</th>
                    <th className="px-4 py-3">국내 송장</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((item) => {
                    const sc = STATUS_CONFIG[item.itemStatus];
                    const wc = WAREHOUSE_CONFIG[item.warehouseStatus];
                    return (
                      <tr key={`${item.orderNumber}-${item.orderItemId}`} className="hover:bg-surface-2/50">
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">
                          {item.vyCode || "-"}
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-foreground-muted">
                          {item.productName || "-"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-foreground-muted">
                          {item.orderNumber}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-foreground-muted">
                          {item.customerName ?? "-"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusBadge
                            label={sc?.label ?? item.itemStatus}
                            tone={sc?.tone ?? "neutral"}
                            dot
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusBadge
                            label={wc?.label ?? item.warehouseStatus}
                            tone={wc?.tone ?? "neutral"}
                            dot
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-foreground-muted">
                          {item.domesticTrackingNumber ?? "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 페이지네이션 */}
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <span className="text-xs text-foreground-muted">
                {total}건 중 {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 text-xs tabular-nums text-foreground-muted">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </AppShell>
  );
}
