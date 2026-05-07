"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { ExtractionLogTable, type ExtractionLogRow } from "../../components/ExtractionLogTable";
import {
  defaultOrderFilters,
  OrderFilters,
  type OrderFilterState
} from "../../components/OrderFilters";
import { OrderTable, type OrderRow } from "../../components/OrderTable";
import { StatsCard } from "../../components/StatsCard";
import { formatCurrency } from "../../lib/format";

type Site = {
  id: number;
  code: string;
  name: string;
  username: string;
  enabled: boolean;
};

type OrdersResult = {
  total: number;
  items: OrderRow[];
};

type LogsResult = {
  total: number;
  items: ExtractionLogRow[];
};

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

function toCsvValue(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function safeParseRawData(rawData?: string | null): Record<string, unknown> {
  if (!rawData) return {};

  try {
    const parsed = JSON.parse(rawData);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function buildOrdersCsv(
  orders: OrderRow[],
  siteLookup: Map<number, { name: string; code: string }> = new Map()
) {
  const header = [
    "siteName",
    "siteCode",
    "siteId",
    "orderNumber",
    "sourceOrderNumber",
    "ordOptNo",
    "brandName",
    "productName",
    "optionName",
    "quantity",
    "amount",
    "currency",
    "shippingStatus",
    "carrier",
    "trackingNumber",
    "invoiceNumber",
    "invoiceUrl",
    "orderDate",
    "noTracking",
    "createdAt",
    "updatedAt"
  ];

  const rows = orders.map((order) => {
    const raw = safeParseRawData(order.rawData);
    const site = siteLookup.get(order.siteId);

    const rawString = (key: string) => {
      const value = raw[key];
      return typeof value === "string" ? value : "";
    };

    return [
      site?.name ?? rawString("siteName"),
      site?.code ?? rawString("siteCode"),
      order.siteId,
      order.orderNumber,
      rawString("sourceOrderNumber"),
      rawString("ordOptNo"),
      rawString("brandName"),
      order.productName,
      rawString("optionName"),
      order.quantity ?? "",
      order.amount ?? "",
      order.currency ?? "KRW",
      order.shippingStatus ?? "",
      rawString("carrier"),
      rawString("trackingNumber") || order.invoiceNumber || "",
      order.invoiceNumber ?? "",
      order.invoiceUrl ?? "",
      order.orderDate ?? "",
      raw.noTracking === true ? "true" : "false",
      order.createdAt ?? "",
      order.updatedAt ?? ""
    ];
  });

  return [header, ...rows]
    .map((row) => row.map(toCsvValue).join(","))
    .join("\n");
}
function isDateInRange(orderDate: string | null | undefined, fromDate: string, toDate: string) {
  if (!fromDate && !toDate) return true;
  if (!orderDate) return false;

  const value = orderDate.slice(0, 10);

  if (fromDate && value < fromDate) return false;
  if (toDate && value > toDate) return false;

  return true;
}

function filterOrders(orders: OrderRow[], filters: OrderFilterState) {
  const search = filters.search.trim().toLowerCase();

  return orders.filter((order) => {
    if (search) {
      const raw = safeParseRawData(order.rawData);
      const haystack = [
        order.orderNumber,
        order.productName,
        order.invoiceNumber,
        raw.carrier,
        raw.sourceOrderNumber,
        raw.ordOptNo,
        raw.optionName,
        raw.brandName
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(search)) return false;
    }

    if (filters.status !== "ALL" && order.shippingStatus !== filters.status) {
      return false;
    }

    if (filters.siteId !== "ALL" && String(order.siteId) !== filters.siteId) {
      return false;
    }

    if (!isDateInRange(order.orderDate, filters.fromDate, filters.toDate)) {
      return false;
    }

    return true;
  });
}

export default function DashboardPage() {
  const [ping, setPing] = useState("checking...");
  const [sites, setSites] = useState<Site[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [logs, setLogs] = useState<ExtractionLogRow[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [filters, setFilters] = useState<OrderFilterState>(defaultOrderFilters);
  const [statusMessage, setStatusMessage] = useState("");

  const filteredOrders = useMemo(() => {
    return filterOrders(orders, filters);
  }, [orders, filters]);

  const dashboard = useMemo(() => {
    const totalAmount = filteredOrders.reduce(
      (sum, order) => sum + Number(order.amount ?? 0),
      0
    );
    const paid = filteredOrders.filter((order) => order.shippingStatus === "PAID").length;
    const ready = filteredOrders.filter((order) => order.shippingStatus === "READY").length;
    const shipped = filteredOrders.filter((order) => order.shippingStatus === "SHIPPED").length;
    const delivered = filteredOrders.filter((order) => order.shippingStatus === "DELIVERED").length;
    const pending = filteredOrders.filter((order) => order.shippingStatus === "PENDING").length;
    const noTracking = filteredOrders.filter((order) => {
      const raw = safeParseRawData(order.rawData);
      return raw.noTracking === true;
    }).length;

    return {
      totalAmount,
      paid,
      ready,
      shipped,
      delivered,
      pending,
      noTracking
    };
  }, [filteredOrders]);

  const loadOrders = useCallback(async () => {
    const result = (await window.api.orders.listAll({
      page: 1,
      pageSize: 500
    })) as OrdersResult;

    setOrders(result.items ?? []);
    setOrderTotal(result.total ?? 0);
  }, []);

  const loadLogs = useCallback(async () => {
    const result = (await window.api.logs.list({
      page: 1,
      pageSize: 10
    })) as LogsResult;

    setLogs(result.items ?? []);
    setLogTotal(result.total ?? 0);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [pong, siteList] = await Promise.all([
        window.api.app.ping(),
        window.api.sites.list()
      ]);

      setPing(String(pong));
      setSites(siteList as Site[]);

      await Promise.all([loadOrders(), loadLogs()]);

      setStatusMessage("Dashboard loaded");
    } catch (error) {
      console.error(error);
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to load dashboard"
      );
    }
  }, [loadOrders, loadLogs]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRefreshOrders = async () => {
    await loadOrders();
    await loadLogs();
  };

  const handleExportCsv = async () => {
    setStatusMessage("Exporting filtered CSV...");

    try {
            const siteLookup = new Map<number, { name: string; code: string }>(
        sites.map((site): [number, { name: string; code: string }] => [
          site.id,
          { name: site.name, code: site.code }
        ])
      );
      const csv = buildOrdersCsv(filteredOrders, siteLookup);
      const filename = `veasly-filtered-orders-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

      downloadTextFile(filename, csv);
      setStatusMessage(`CSV exported: ${filename}`);
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error ? error.message : "Failed to export CSV");
    }
  };

  return (
    <AppShell
      title="Dashboard"
      description="전체 쇼핑몰 주문 현황과 추출 결과를 통합 조회합니다."
      rightSlot={
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-right shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-400">
            Electron IPC
          </div>
          <div className="mt-1 font-mono text-sm font-bold text-emerald-700">
            {ping}
          </div>
        </div>
      }
    >
      {statusMessage ? (
        <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm font-medium text-blue-800">
          {statusMessage}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <StatsCard label="Sites" value={sites.length} />
        <StatsCard label="Filtered Orders" value={filteredOrders.length} />
        <StatsCard label="Total Amount" value={formatCurrency(dashboard.totalAmount)} />
        <StatsCard
          label="Status"
          value=" "
          helper={
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700">
                PAID {dashboard.paid}
              </span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                READY {dashboard.ready}
              </span>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
                SHIPPED {dashboard.shipped}
              </span>
              <span className="rounded-full bg-green-50 px-2.5 py-1 text-green-700">
                DELIVERED {dashboard.delivered}
              </span>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
                PENDING {dashboard.pending}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                NO TRACKING {dashboard.noTracking}
              </span>
            </div>
          }
        />
      </section>

      <section className="mt-6">
        <OrderFilters
          value={filters}
          onChange={setFilters}
          sites={sites}
          showSiteFilter
          resultCount={filteredOrders.length}
          totalCount={orderTotal}
        />
      </section>

      <section className="mt-6">
        <OrderTable
          orders={filteredOrders}
          total={filteredOrders.length}
          onRefresh={handleRefreshOrders}
          onExportCsv={handleExportCsv}
        />
      </section>

      <section className="mt-6">
        <ExtractionLogTable
          logs={logs}
          total={logTotal}
          title="Recent Extraction Logs"
          onRefresh={loadLogs}
        />
      </section>
    </AppShell>
  );
}