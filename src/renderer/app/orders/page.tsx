"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  ShoppingBag,
  Wallet,
  Zap
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../../components/AppShell";
import { Button } from "../../components/ui/Button";
import { KpiCard } from "../../components/ui/KpiCard";
import { PageHeader } from "../../components/ui/PageHeader";
import {
  defaultOrderFilters,
  OrderFilters,
  type OrderFilterState
} from "../../components/OrderFilters";
import { OrderTable, type OrderRow } from "../../components/OrderTable";
import { formatCurrency } from "../../lib/format";

type Site = {
  id: number;
  code: string;
  name: string;
  username: string;
  enabled: boolean;
};

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([`﻿${content}`], { type: "text/csv;charset=utf-8" });
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

function isDateInRange(
  orderDate: string | null | undefined,
  fromDate: string,
  toDate: string
) {
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
    if (
      filters.siteId !== "ALL" &&
      String((order as OrderRow & { siteId: number }).siteId) !== filters.siteId
    ) {
      return false;
    }
    if (!isDateInRange(order.orderDate, filters.fromDate, filters.toDate)) {
      return false;
    }
    return true;
  });
}

export default function OrdersPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [filters, setFilters] = useState<OrderFilterState>(defaultOrderFilters);

  const filteredOrders = useMemo(
    () => filterOrders(orders, filters),
    [orders, filters]
  );

  const kpis = useMemo(() => {
    const totalAmount = filteredOrders.reduce(
      (sum, order) => sum + Number(order.amount ?? 0),
      0
    );
    const delivered = filteredOrders.filter(
      (order) => order.shippingStatus === "DELIVERED"
    ).length;
    const inTransit = filteredOrders.filter((order) =>
      ["READY", "SHIPPED"].includes(order.shippingStatus ?? "")
    ).length;
    const pending = filteredOrders.filter(
      (order) => order.shippingStatus === "PENDING"
    ).length;

    return { totalAmount, delivered, inTransit, pending };
  }, [filteredOrders]);

  const loadData = useCallback(async () => {
    try {
      const [siteList, ordersResult] = await Promise.all([
        window.api.sites.list(),
        window.api.orders.listAll({ page: 1, pageSize: 1000 })
      ]);

      setSites(siteList as Site[]);
      setOrders(
        ((ordersResult as { items: OrderRow[] }).items ?? []) as OrderRow[]
      );
      setOrderTotal((ordersResult as { total: number }).total ?? 0);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "주문 데이터를 불러오지 못했습니다."
      );
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleExportCsv = () => {
    try {
      const siteLookup = new Map<number, { name: string; code: string }>(
        sites.map((site): [number, { name: string; code: string }] => [
          site.id,
          { name: site.name, code: site.code }
        ])
      );
      const csv = buildOrdersCsv(filteredOrders, siteLookup);
      const filename = `veasly-orders-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      downloadTextFile(filename, csv);
      toast.success(`${filename} 으로 내보냈습니다.`);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "CSV 내보내기에 실패했습니다."
      );
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="주문"
        title="전체 주문 관리"
        description="등록된 모든 쇼핑몰의 주문을 한 곳에서 조회·검색·CSV로 내보냅니다."
        actions={
          <Link href="/extract">
            <Button variant="primary">
              <Zap className="h-4 w-4" />
              지금 추출하기
            </Button>
          </Link>
        }
      />

      <div className="mt-8 space-y-6">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="필터 결과"
            value={filteredOrders.length.toLocaleString("ko-KR")}
            hint={`전체 ${orderTotal.toLocaleString("ko-KR")}건`}
            icon={ClipboardList}
            tone="primary"
          />
          <KpiCard
            label="합계 금액"
            value={formatCurrency(kpis.totalAmount)}
            hint="필터된 주문 기준"
            icon={Wallet}
            tone="success"
          />
          <KpiCard
            label="배송 완료"
            value={kpis.delivered.toLocaleString("ko-KR")}
            hint={`배송 중 ${kpis.inTransit.toLocaleString("ko-KR")}건`}
            icon={CheckCircle2}
            tone="info"
          />
          <KpiCard
            label="대기"
            value={kpis.pending.toLocaleString("ko-KR")}
            hint="배송 정보가 아직 없는 주문"
            icon={ShoppingBag}
            tone={kpis.pending > 0 ? "warning" : "default"}
          />
        </section>

        <OrderFilters
          value={filters}
          onChange={setFilters}
          sites={sites}
          showSiteFilter
          resultCount={filteredOrders.length}
          totalCount={orderTotal}
        />

        <OrderTable
          orders={filteredOrders}
          total={filteredOrders.length}
          onRefresh={loadData}
          onExportCsv={handleExportCsv}
        />
      </div>
    </AppShell>
  );
}
