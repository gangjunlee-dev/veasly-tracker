"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "../../../components/AppShell";
import {
  ExtractionProgressPanel,
  type ProgressItem
} from "../../../components/ExtractionProgressPanel";
import { OrderTable, type OrderRow } from "../../../components/OrderTable";
import {
  SiteDetailHeader,
  type SiteDetailHeaderSite
} from "../../../components/SiteDetailHeader";

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

export default function SiteDetailPage() {
  const params = useParams<{ siteId: string }>();
  const siteId = Number(params.siteId);

  const [site, setSite] = useState<SiteDetailHeaderSite | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const loadSite = useCallback(async () => {
    const sites = (await window.api.sites.list()) as SiteDetailHeaderSite[];
    const found = sites.find((item) => item.id === siteId) ?? null;

    setSite(found);

    if (!found) {
      setMessage(`Site not found: ${siteId}`);
    }
  }, [siteId]);

  const loadOrders = useCallback(async () => {
    const result = (await window.api.orders.listBySite({
      siteId,
      page: 1,
      pageSize: 50
    } as any)) as OrdersResult;

    setOrders(result.items ?? []);
    setOrderTotal(result.total ?? 0);
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

      if (typeof item.siteId === "number" && item.siteId !== siteId) {
        return;
      }

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
    setMessage("Exporting CSV...");

    try {
      const csv = await window.api.orders.export({ siteId } as any);
      const filename = `veasly-site-${siteId}-orders-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

      downloadTextFile(filename, String(csv));
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
          <SiteDetailHeader
            site={site}
            running={Boolean(runningRunId)}
            onExtract={handleExtract}
          />

          <section className="grid gap-6 lg:grid-cols-[1fr_420px]">
            <OrderTable
              orders={orders}
              total={orderTotal}
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