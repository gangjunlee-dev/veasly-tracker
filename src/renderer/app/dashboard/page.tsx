"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/AppShell";
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

export default function DashboardPage() {
  const [ping, setPing] = useState("checking...");
  const [sites, setSites] = useState<Site[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");

  const dashboard = useMemo(() => {
    const totalAmount = orders.reduce(
      (sum, order) => sum + Number(order.amount ?? 0),
      0
    );
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
    try {
      const [pong, siteList] = await Promise.all([
        window.api.app.ping(),
        window.api.sites.list()
      ]);

      setPing(String(pong));
      setSites(siteList as Site[]);
      await loadOrders();
      setStatusMessage("Dashboard loaded");
    } catch (error) {
      console.error(error);
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to load dashboard"
      );
    }
  }, [loadOrders]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
        <StatsCard label="Orders" value={orderTotal} />
        <StatsCard label="Total Amount" value={formatCurrency(dashboard.totalAmount)} />
        <StatsCard
          label="Status"
          value=" "
          helper={
            <div className="flex flex-wrap gap-2 text-xs font-bold">
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
          }
        />
      </section>

      <section className="mt-6">
        <OrderTable
          orders={orders}
          total={orderTotal}
          onRefresh={loadOrders}
          onExportCsv={handleExportCsv}
        />
      </section>
    </AppShell>
  );
}
