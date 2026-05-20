"use client";

import { ExternalLink, RefreshCw, FileDown } from "lucide-react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { ShippingStatusBadge } from "./ui/StatusBadge";
import { formatCurrency, formatDate } from "../lib/format";

export type OrderRow = {
  id: number;
  siteId: number;
  orderNumber: string;
  orderDate?: string | null;
  productName: string;
  quantity?: number | null;
  amount?: number | null;
  currency?: string | null;
  invoiceNumber?: string | null;
  invoiceUrl?: string | null;
  shippingStatus?: string | null;
  rawData?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type OrderTableProps = {
  orders: OrderRow[];
  total: number;
  onRefresh?: () => void;
  onExportCsv?: () => void;
  title?: string;
  description?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
};

function parseRawData(order: OrderRow): Record<string, unknown> {
  if (!order.rawData) return {};
  try {
    const parsed = JSON.parse(order.rawData);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getCarrier(order: OrderRow) {
  const raw = parseRawData(order);
  const carrier = raw.carrier;
  return typeof carrier === "string" && carrier.trim() ? carrier.trim() : "-";
}

function maskInvoice(value?: string | null) {
  if (!value) return "-";
  const text = String(value).trim();
  if (!text) return "-";
  if (text.length <= 8) return text;
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

export function OrderTable({
  orders,
  total,
  onRefresh,
  onExportCsv,
  title = "주문 목록",
  description,
  emptyTitle = "표시할 주문이 없습니다",
  emptyDescription = "주문 가져오기를 실행하거나 필터를 조정해 보세요.",
  emptyAction
}: OrderTableProps) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-sm text-foreground-muted">
            {description ?? `총 ${total.toLocaleString("ko-KR")}건`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onRefresh && (
            <Button variant="secondary" size="sm" onClick={onRefresh}>
              <RefreshCw className="h-3.5 w-3.5" />
              새로고침
            </Button>
          )}
          {onExportCsv && (
            <Button variant="primary" size="sm" onClick={onExportCsv}>
              <FileDown className="h-3.5 w-3.5" />
              CSV 내보내기
            </Button>
          )}
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-foreground-muted">
                <th className="whitespace-nowrap px-6 py-3 text-left font-semibold">
                  주문번호
                </th>
                <th className="px-6 py-3 text-left font-semibold">상품</th>
                <th className="whitespace-nowrap px-6 py-3 text-right font-semibold">
                  수량
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-right font-semibold">
                  금액
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-left font-semibold">
                  상태
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-left font-semibold">
                  택배사
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-left font-semibold">
                  송장번호
                </th>
                <th className="whitespace-nowrap px-6 py-3 text-left font-semibold">
                  주문일
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-surface-2">
                  <td className="whitespace-nowrap px-6 py-3 font-mono text-xs text-foreground-muted">
                    {order.orderNumber}
                  </td>
                  <td className="max-w-[28rem] px-6 py-3">
                    <div className="truncate font-medium text-foreground">
                      {order.productName}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right tabular-nums text-foreground-muted">
                    {order.quantity ?? 1}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right font-semibold tabular-nums text-foreground">
                    {formatCurrency(order.amount)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <ShippingStatusBadge status={order.shippingStatus} />
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-foreground-muted">
                    {getCarrier(order)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 font-mono text-xs">
                    {order.invoiceUrl ? (
                      <a
                        href={order.invoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-primary hover:text-primary-hover hover:underline"
                        title={order.invoiceNumber ?? ""}
                      >
                        {maskInvoice(order.invoiceNumber)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-foreground-subtle">
                        {maskInvoice(order.invoiceNumber)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-foreground-muted">
                    {formatDate(order.orderDate)}
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
