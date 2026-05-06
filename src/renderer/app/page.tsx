"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExtractionProgressPanel,
  type ProgressItem
} from "../components/ExtractionProgressPanel";
import { OrderTable, type OrderRow } from "../components/OrderTable";
import { SiteCard, type SiteCardSite } from "../components/SiteCard";
import { formatCurrency } from "../lib/format";

type ExtractorInfo = {
  code: string;
  name: string;
  version?: string;
  enabled?: boolean;
  description?: string;
  loginUrl?: string;
  ordersUrl?: string;
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

export default function HomePage() {
  const [ping, setPing] = useState<string>("checking...");
  const [sites, setSites] = useState<SiteCardSite[]>([]);
  const [extractors, setExtractors] = useState<ExtractorInfo[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const extractorByCode = useMemo(() => {
    return new Map(extractors.map((extractor) => [extractor.code, extractor]));
  }, [extractors]);

  const dashboard = useMemo(() => {
    const totalAmount = orders.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
    const ready = orders.filter((order) => order.shippingStatus === "READY").length;
    const shipped = orders.filter((order) => order.shippingStatus === "SHIPPED").length;
    const pending = orders.filter((order) => order.shippingStatus === "PENDING").length;

    return {
      totalAmount,
      ready,
      shipped,
      pending
    };
  }, [orders]);

  const loadOrders = useCallback(async () => {
    const result = (await window.api.orders.listAll({
      page: 1,
      pageSize: 50
    })) as OrdersResult;

    setOrders(result.items ?? []);
    setOrderTotal(result.total ?? 0);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [pong, siteList, extractorList] = await Promise.all([
        window.api.app.ping(),
        window.api.sites.list(),
        window.api.extractor.available()
      ]);

      setPing(String(pong));
      setSites(siteList as SiteCardSite[]);
      setExtractors(extractorList as ExtractorInfo[]);

      await loadOrders();
      setStatusMessage("Loaded successfully");
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error ? error.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [loadOrders]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const unsubscribe = window.api.extractor.onProgress((progress) => {
      const item = progress as ProgressItem;

      setProgressItems((current) => [item, ...current].slice(0, 30));

      if (item.phase === "success" || item.phase === "saving") {
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

    return () => {
      unsubscribe();
    };
  }, [loadOrders]);

  const handleCreateDemoSite = async () => {
    setStatusMessage("Creating demo site...");

    try {
      const suffix = Date.now();

      await window.api.sites.create({
        code: "demo",
        name: `Demo Mall ${suffix}`,
        username: `demo-${suffix}`,
        password: "demo-password",
        enabled: true
      });

      await loadData();
      setStatusMessage("Demo site created");
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error ? error.message : "Failed to create demo site");
    }
  };

  const handleExtract = async (siteId: number) => {
    setStatusMessage("Starting extractor...");

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

      setStatusMessage(`Extractor started: ${result.runId}`);
    } catch (error) {
      console.error(error);
      setRunningRunId(null);
      setStatusMessage(error instanceof Error ? error.message : "Failed to run extractor");
    }
  };

  const handleExportCsv = async () => {
    setStatusMessage("Exporting CSV...");

    try {
      const csv = await window.api.orders.export({});

      const filename = `veasly-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadTextFile(filename, String(csv));

      setStatusMessage(`CSV exported: ${filename}`);
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error ? error.message : "Failed to export CSV");
    }
  };

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-blue-600">
              Veasly Tracker
            </p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">
              Cross-border Order Extraction Console
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              쇼핑몰 계정 등록, 추출기 실행, 주문 통합 조회를 한 화면에서 검증하는
              Phase 3 최소 운영 UI입니다.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-right shadow-sm">
            <div className="text-xs font-semibold uppercase text-slate-400">
              Electron IPC
            </div>
            <div className="mt-1 font-mono text-sm font-bold text-emerald-700">
              {ping}
            </div>
          </div>
        </header>

        {statusMessage ? (
          <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm font-medium text-blue-800">
            {statusMessage}
          </div>
        ) : null}

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-500">Sites</div>
            <div className="mt-2 text-3xl font-black text-slate-950">
              {sites.length}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-500">Orders</div>
            <div className="mt-2 text-3xl font-black text-slate-950">
              {orderTotal}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-500">Total Amount</div>
            <div className="mt-2 text-2xl font-black text-slate-950">
              {formatCurrency(dashboard.totalAmount)}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-500">Status</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                READY {dashboard.ready}
              </span>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
                SHIPPED {dashboard.shipped}
              </span>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
                PENDING {dashboard.pending}
              </span>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_420px]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Sites</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    등록된 쇼핑몰 계정과 연결 가능한 extractor입니다.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCreateDemoSite}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700"
                >
                  Create Demo Site
                </button>
              </div>

              {loading ? (
                <div className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">
                  Loading...
                </div>
              ) : sites.length === 0 ? (
                <div className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">
                  사이트가 없습니다. Create Demo Site를 눌러 테스트 계정을 만드세요.
                </div>
              ) : (
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {sites.map((site) => (
                    <SiteCard
                      key={site.id}
                      site={site}
                      extractor={extractorByCode.get(site.code)}
                      isRunning={Boolean(runningRunId)}
                      onExtract={handleExtract}
                    />
                  ))}
                </div>
              )}
            </div>

            <OrderTable
              orders={orders}
              total={orderTotal}
              onRefresh={loadOrders}
              onExportCsv={handleExportCsv}
            />
          </div>

          <ExtractionProgressPanel
            items={progressItems}
            runningRunId={runningRunId}
            onClear={() => setProgressItems([])}
          />
        </section>
      </div>
    </main>
  );
}
