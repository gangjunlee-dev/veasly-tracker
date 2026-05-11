"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "../../../components/AppShell";
import { ExtractionLogTable, type ExtractionLogRow } from "../../../components/ExtractionLogTable";
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

type LogsResult = {
  total: number;
  items: ExtractionLogRow[];
};

type ExtractOptionState = {
  maxPages: string;
  since: string;
  until: string;
  includeNoTracking: boolean;
  headless: boolean;
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
  const [logs, setLogs] = useState<ExtractionLogRow[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [filters, setFilters] = useState<OrderFilterState>(defaultOrderFilters);
  const [extractOptions, setExtractOptions] = useState<ExtractOptionState>({
    maxPages: "10",
    since: "",
    until: "",
    includeNoTracking: true,
    headless: false
  });
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
    })) as OrdersResult;

    setOrders(result.items ?? []);
    setTotal(result.total ?? 0);
  }, [siteId]);

  const loadLogs = useCallback(async () => {
    const result = (await window.api.logs.listBySite({
      siteId,
      page: 1,
      pageSize: 10
    })) as LogsResult;

    setLogs(result.items ?? []);
    setLogTotal(result.total ?? 0);
  }, [siteId]);

  const loadData = useCallback(async () => {
    try {
      await Promise.all([loadSite(), loadOrders(), loadLogs()]);
      setMessage("Site detail loaded");
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Failed to load site detail");
    }
  }, [loadSite, loadOrders, loadLogs]);

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
        void loadLogs();
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
  }, [siteId, loadOrders, loadLogs]);

  const handleRefreshOrders = async () => {
    await loadOrders();
    await loadLogs();
  };

  const handleExtract = async () => {
    setMessage("Starting extractor...");

    try {
      const maxPages = Number(extractOptions.maxPages);

      const result = (await window.api.extractor.run({
        siteId,
        options: {
          maxPages: Number.isFinite(maxPages) && maxPages > 0 ? maxPages : undefined,
          since: extractOptions.since || undefined,
          until: extractOptions.until || undefined,
          includeNoTracking: extractOptions.includeNoTracking,
          headless: extractOptions.headless
        }
      })) as { runId: string };

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
            const siteLookup = new Map<number, { name: string; code: string }>(
        site ? [[site.id, { name: site.name, code: site.code }]] : []
      );
      const csv = buildOrdersCsv(filteredOrders, siteLookup);
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
      description="사이트별 주문, 추출 진행상황, 추출 로그, CSV export를 확인합니다."
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

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Extraction Options</h3>
                <p className="mt-1 text-sm text-slate-500">
                  주문 상세 조회 범위와 송장 없는 주문 저장 여부를 설정합니다.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setExtractOptions({
                    maxPages: "10",
                    since: "",
                    until: "",
                    includeNoTracking: true,
    headless: false
                  })
                }
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Reset Options
              </button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-5">
              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Max Detail Orders
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={extractOptions.maxPages}
                  onChange={(event) =>
                    setExtractOptions((current) => ({
                      ...current,
                      maxPages: event.target.value
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Since
                </label>
                <input
                  type="date"
                  value={extractOptions.since}
                  onChange={(event) =>
                    setExtractOptions((current) => ({
                      ...current,
                      since: event.target.value
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Until
                </label>
                <input
                  type="date"
                  value={extractOptions.until}
                  onChange={(event) =>
                    setExtractOptions((current) => ({
                      ...current,
                      until: event.target.value
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
                />
              </div>

              <label className="flex items-end gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={extractOptions.includeNoTracking}
                  onChange={(event) =>
                    setExtractOptions((current) => ({
                      ...current,
                      includeNoTracking: event.target.checked
                    }))
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span>Include No Tracking</span>
              </label>

              <label className="flex items-end gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={extractOptions.headless}
                  onChange={(event) =>
                    setExtractOptions((current) => ({
                      ...current,
                      headless: event.target.checked
                    }))
                  }
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span>
                  Run in background
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    저장된 로그인 세션으로 브라우저를 최소화하여 추출합니다.
                  </span>
                </span>
              </label>
            </div>
          </section>
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
              onRefresh={handleRefreshOrders}
              onExportCsv={handleExportCsv}
            />

            <ExtractionProgressPanel
              items={progressItems}
              runningRunId={runningRunId}
              onClear={() => setProgressItems([])}
            />
          </section>

          <ExtractionLogTable
            logs={logs}
            total={logTotal}
            title="Site Extraction Logs"
            onRefresh={loadLogs}
          />
        </div>
      )}
    </AppShell>
  );
}