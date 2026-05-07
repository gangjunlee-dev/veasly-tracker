"use client";

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
  onRefresh: () => void;
  onExportCsv: () => void;
};

function getStatusClass(status?: string | null) {
  switch (status) {
    case "PAID":
      return "bg-indigo-50 text-indigo-700";
    case "READY":
      return "bg-emerald-50 text-emerald-700";
    case "SHIPPED":
      return "bg-blue-50 text-blue-700";
    case "DELIVERED":
      return "bg-green-50 text-green-700";
    case "PENDING":
      return "bg-amber-50 text-amber-700";
    case "PAYMENT_ERROR":
      return "bg-orange-50 text-orange-700";
    case "CANCELLED":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function getStatusLabel(status?: string | null) {
  switch (status) {
    case "PAID":
      return "결제완료";
    case "READY":
      return "출고준비";
    case "SHIPPED":
      return "배송중";
    case "DELIVERED":
      return "배송완료";
    case "PENDING":
      return "대기";
    case "PAYMENT_ERROR":
      return "결제오류";
    case "CANCELLED":
      return "취소";
    default:
      return status ?? "UNKNOWN";
  }
}

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
  onExportCsv
}: OrderTableProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Orders</h2>
          <p className="mt-1 text-sm text-slate-500">Total {total} order(s)</p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={onExportCsv}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-slate-600">
                  Order No.
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-slate-600">
                  Product
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-bold text-slate-600">
                  Qty
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-bold text-slate-600">
                  Amount
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-slate-600">
                  Status
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-slate-600">
                  Carrier
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-slate-600">
                  Invoice
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-slate-600">
                  Date
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    아직 주문이 없습니다. Extract Orders를 실행해 주세요.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">
                      {order.orderNumber}
                    </td>

                    <td className="min-w-64 px-4 py-3 font-medium text-slate-900">
                      {order.productName}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600">
                      {order.quantity ?? 1}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-slate-900">
                      {formatCurrency(order.amount)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${getStatusClass(
                          order.shippingStatus
                        )}`}
                        title={order.shippingStatus ?? "UNKNOWN"}
                      >
                        {getStatusLabel(order.shippingStatus)}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {getCarrier(order)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">
                      {order.invoiceUrl ? (
                        <a
                          href={order.invoiceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-bold text-blue-700 hover:text-blue-500 hover:underline"
                          title={order.invoiceNumber ?? ""}
                        >
                          {maskInvoice(order.invoiceNumber)}
                        </a>
                      ) : (
                        <span className="text-slate-400">
                          {maskInvoice(order.invoiceNumber)}
                        </span>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {formatDate(order.orderDate)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}