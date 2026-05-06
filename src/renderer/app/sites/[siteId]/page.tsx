"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "../../../components/AppShell";
import {
  defaultOrderFilters,
  OrderFilters,
  type OrderFilterState
} from "../../../components/OrderFilters";
import { OrderTable, type OrderRow } from "../../../components/OrderTable";
import {
  ExtractionProgressPanel,
  type ProgressItem
} from "../../../components/ExtractionProgressPanel";

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

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
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

function buildOrdersCsv(orders: OrderRow[]) {
  const header = [
    "siteId",
    "orderNumber",
    "orderDate",
    "productName",
    "quantity",
    "amount",
    "shippingStatus",
    "invoiceNumber"
  ];

  const rows = orders.map((order) => [
    order.siteId,
    order.orderNumber,
    order.orderDate ?? "",
    order.productName,
    order.quantity ?? "",
    order.amount ?? "",
    order.shippingStatus ?? "",
    order.invoiceNumber ?? ""
  ]);

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
      const haystack = `${order.orderNumber} ${order.productName}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    if (filters.status !== "ALL" && order.shippingStatus !== filters.status) {
      return false;
    }

    if (!isDateInRange(order.orderDate, filters.fromDate, filters.toDate)) {
      return false;
    }

    return true;
  });
}

export default function SiteDetailPage() {
  const params = useParams<{ siteId: string }>();
  const siteId = Number(params.siteId);

  const [site, setSite] = useState<Site | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<OrderFilterState>(defaultOrderFilters);
  const [message, setMessage] = useState("");
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);

  const filteredOrders = useMemo(() => {
    return filterOrders(orders, filters);
  }, [orders, filters]);

  const loadSite = useCallback(async () => {
    const sites = (await window.api.sites.list()) as Site[];
    const found = sites.find((item) => item.id === siteId) ?? null;
    setSite(found);
    if (!found) setMessage(`Site not found: ${siteId}`);
  }, [siteId]);

  const loadOrders = useCallback(async () => {
    const result = (await window.api.orders.listBySite({
      siteId,
      page: 1,
      pageSize: 500
    } as any)) as OrdersResult;

    setOrders(result.items ?? []);
    setTotal(result.total ?? 0);
  }, [siteId]);

  const loadData = useCallback(async () => {
    try {
      await Promise.all([loadSite(), loadOrders()]);
      setMessage("Site detail loaded");
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Failed to load site detail");
    }
  }, [loadSite, loadOrders]);

  useEffect(() => {
    if (Number.isFinite(siteId)) {
      void loadData();
    }
  }, [siteId, loadData]);

  useEffect(() => {
    const unsubscribe = window.api.extractor.onProgress((progress) => {
      const item = progress as ProgressItem;

      if (typeof item.siteId === "number" && item.siteId !== siteId) return;

      setProgressItems((current) => [item, ...current].slice(0, 30));

      if (item.phase === "saving" || item.phase === "success") {
        void loadOrders();
      }

      if (
        item.phase === "success" ||
        item.phase === "error" ||
        item.phase === "failed" ||
        item.phase === "cancelled"
      ) {
        setRunningRunId(null);
      }
    });

    return () => unsubscribe();
  }, [siteId, loadOrders]);

  const handleExtract = async () => {
    setMessage("Starting extractor...");

    try {
      const result = (await window.api.extractor.run({ siteId })) as { runId: string };

      setRunningRunId(result.runId);
      setProgressItems((current) => [
        {
          runId: result.runId,
          siteId,
          phase: "queued",
          message: "Extraction job queued"
        },
        ...current
      ]);

      setMessage(`Extractor started: ${result.runId}`);
    } catch (error) {
      console.error(error);
      setRunningRunId(null);
      setMessage(error instanceof Error ? error.message : "Failed to run extractor");
    }
  };

  const handleExportCsv = async () => {
    try {
      const csv = buildOrdersCsv(filteredOrders);
      const filename = `veasly-site-${siteId}-filtered-orders-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

      downloadTextFile(filename, csv);
      setMessage(`CSV exported: ${filename}`);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Failed to export CSV");
    }
  };

  return (
    <AppShell
      title="Site Detail"
      description="사이트별 주문, 추출 진행상황, CSV export를 확인합니다."
    >
      {message ? (
        <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm font-medium text-blue-800">
          {message}
        </div>
      ) : null}

      {!site ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
          Loading site...
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-black text-slate-950">{site.name}</h2>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                    {site.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                  <div>
                    <span className="font-bold text-slate-800">ID:</span> {site.id}
                  </div>
                  <div>
                    <span className="font-bold text-slate-800">Code:</span> {site.code}
                  </div>
                  <div>
                    <span className="font-bold text-slate-800">Username:</span>{" "}
                    {site.username}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  href="/sites"
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Back
                </Link>

                <Link
                  href={`/sites/${site.id}/settings`}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Settings
                </Link>

                <button
                  type="button"
                  disabled={!site.enabled || Boolean(runningRunId)}
                  onClick={handleExtract}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {runningRunId ? "Extracting..." : "Extract Orders"}
                </button>
              </div>
            </div>
          </div>

          <OrderFilters
            value={filters}
            onChange={setFilters}
            resultCount={filteredOrders.length}
            totalCount={total}
          />

          <section className="grid gap-6 lg:grid-cols-[1fr_420px]">
            <OrderTable
              orders={filteredOrders}
              total={filteredOrders.length}
              onRefresh={loadOrders}
              onExportCsv={handleExportCsv}
            />

            <ExtractionProgressPanel
              items={progressItems}
              runningRunId={runningRunId}
              onClear={() => setProgressItems([])}
            />
          </section>
        </div>
      )}
    </AppShell>
  );
}