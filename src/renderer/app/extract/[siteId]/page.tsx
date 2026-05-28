"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Play, Settings, Zap } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../../../components/AppShell";
import { Button } from "../../../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { Field, Input } from "../../../components/ui/Input";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import {
  defaultOrderFilters,
  OrderFilters,
  type OrderFilterState
} from "../../../components/OrderFilters";
import { OrderTable, type OrderRow } from "../../../components/OrderTable";
import {
  ExtractionLogTable,
  type ExtractionLogRow
} from "../../../components/ExtractionLogTable";
import {
  ExtractionProgressPanel,
  type ProgressItem
} from "../../../components/ExtractionProgressPanel";
import { OliveYoungManualImportPanel } from "../../../components/OliveYoungManualImportPanel";

type Site = {
  id: number;
  code: string;
  name: string;
  username: string;
  enabled: boolean;
};

type OrdersResult = { total: number; items: OrderRow[] };
type LogsResult = { total: number; items: ExtractionLogRow[] };

type ExtractOptions = {
  maxPages: string;
  since: string;
  until: string;
  includeNoTracking: boolean;
  headless: boolean;
};

function safeParseRawData(rawData?: string | null): Record<string, unknown> {
  if (!rawData) return {};
  try {
    const parsed = JSON.parse(rawData);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

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

function buildOrdersCsv(orders: OrderRow[], site: Site | null) {
  const header = [
    "siteName",
    "siteId",
    "orderNumber",
    "productName",
    "quantity",
    "amount",
    "currency",
    "shippingStatus",
    "carrier",
    "trackingNumber",
    "invoiceNumber",
    "invoiceUrl",
    "orderDate"
  ];

  const rows = orders.map((order) => {
    const raw = safeParseRawData(order.rawData);
    const rawString = (key: string) => {
      const value = raw[key];
      return typeof value === "string" ? value : "";
    };

    return [
      site?.name ?? "",
      (order as OrderRow & { siteId: number }).siteId,
      order.orderNumber,
      order.productName,
      order.quantity ?? "",
      order.amount ?? "",
      order.currency ?? "KRW",
      order.shippingStatus ?? "",
      rawString("carrier"),
      rawString("trackingNumber") || order.invoiceNumber || "",
      order.invoiceNumber ?? "",
      order.invoiceUrl ?? "",
      order.orderDate ?? ""
    ];
  });

  return [header, ...rows].map((row) => row.map(toCsvValue).join(",")).join("\n");
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
        raw.sourceOrderNumber
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

export default function SiteExtractPage() {
  const params = useParams<{ siteId: string }>();
  const siteId = Number(params.siteId);

  const [site, setSite] = useState<Site | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [logs, setLogs] = useState<ExtractionLogRow[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [filters, setFilters] = useState<OrderFilterState>(defaultOrderFilters);
  const [options, setOptions] = useState<ExtractOptions>({
    maxPages: "10",
    since: "",
    until: "",
    includeNoTracking: true,
    headless: false
  });
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);

  const filteredOrders = useMemo(
    () => filterOrders(orders, filters),
    [orders, filters]
  );

  const loadSite = useCallback(async () => {
    const sites = (await window.api.sites.list()) as Site[];
    const found = sites.find((item) => item.id === siteId) ?? null;
    setSite(found);
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

  const loadAll = useCallback(async () => {
    try {
      await Promise.all([loadSite(), loadOrders(), loadLogs()]);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "데이터를 불러오지 못했습니다."
      );
    }
  }, [loadSite, loadOrders, loadLogs]);

  useEffect(() => {
    if (Number.isFinite(siteId)) {
      void loadAll();
    }
  }, [siteId, loadAll]);

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
        if (item.phase === "success") {
          toast.success(item.message ?? "추출이 완료되었습니다.");
          // lastExtractedAt 갱신을 위해 site 정보를 다시 가져온다.
          void loadSite();
        } else {
          toast.error(item.message ?? "추출 실행이 중단되었습니다.");
        }
      }
    });
    return () => unsubscribe();
  }, [siteId, loadOrders, loadLogs, loadSite]);

  const handleExtract = async () => {
    if (!site) return;

    try {
      const maxPages = Number(options.maxPages);
      const result = (await window.api.extractor.run({
        siteId,
        options: {
          maxPages: Number.isFinite(maxPages) && maxPages > 0 ? maxPages : undefined,
          since: options.since || undefined,
          until: options.until || undefined,
          includeNoTracking: options.includeNoTracking,
          headless: options.headless
        }
      })) as { runId: string; alreadyRunning?: boolean };

      if (result.alreadyRunning) {
        toast.warning("이미 이 사이트의 추출이 실행 중입니다.");
        return;
      }

      setRunningRunId(result.runId);
      setProgressItems((current) => [
        {
          runId: result.runId,
          siteId,
          phase: "queued",
          message: `${site.name} 추출을 대기열에 등록했습니다.`
        },
        ...current
      ]);
      toast.success(`${site.name} 추출을 시작했습니다.`);
    } catch (error) {
      console.error(error);
      setRunningRunId(null);
      toast.error(
        error instanceof Error ? error.message : "추출 실행에 실패했습니다."
      );
    }
  };

  const handleExportCsv = () => {
    try {
      const csv = buildOrdersCsv(filteredOrders, site);
      const filename = `veasly-${site?.code ?? siteId}-${new Date()
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

  if (!Number.isFinite(siteId)) {
    return (
      <AppShell>
        <PageHeader eyebrow="주문 가져오기" title="잘못된 사이트입니다" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="주문 가져오기"
        title={site?.name ?? "쇼핑몰 로딩 중…"}
        description={
          site
            ? `${site.code} · ${site.username}`
            : "데이터를 불러오고 있습니다."
        }
        actions={
          <>
            <Link href="/extract">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" />
                목록으로
              </Button>
            </Link>
            {site && (
              <Link href={`/settings/sites/${site.id}`}>
                <Button variant="secondary" size="sm">
                  <Settings className="h-4 w-4" />
                  사이트 설정
                </Button>
              </Link>
            )}
            <Button
              variant="primary"
              disabled={!site?.enabled || Boolean(runningRunId)}
              onClick={handleExtract}
            >
              <Play className="h-4 w-4" />
              {runningRunId ? "실행 중…" : "지정 옵션으로 추출"}
            </Button>
          </>
        }
      />

      {!site ? (
        <Card className="mt-8 p-6 text-sm text-foreground-muted">
          사이트 정보를 불러오는 중…
        </Card>
      ) : (
        <div className="mt-8 space-y-6">
          {!site.enabled && (
            <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-5 py-4 text-sm text-warning-soft-foreground">
              <StatusBadge label="비활성" tone="warning" />
              <p>
                이 쇼핑몰은 현재 비활성 상태입니다. 추출을 실행하려면{" "}
                <Link
                  href={`/settings/sites/${site.id}`}
                  className="font-semibold underline"
                >
                  사이트 설정
                </Link>
                에서 활성화해 주세요.
              </p>
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>추출 옵션</CardTitle>
                  <p className="mt-0.5 text-sm text-foreground-muted">
                    범위와 동작 방식을 조정한 뒤 우측 상단 &lsquo;지정 옵션으로 추출&rsquo;을 누르세요.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setOptions({
                      maxPages: "10",
                      since: "",
                      until: "",
                      includeNoTracking: true,
                      headless: false
                    })
                  }
                >
                  초기화
                </Button>
              </CardHeader>
              <CardBody className="grid gap-5 md:grid-cols-2">
                <Field label="최대 주문 수" hint="최근 주문부터 최대 몇 건을 가져올지 지정 (기본 10)">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={options.maxPages}
                    onChange={(event) =>
                      setOptions((c) => ({ ...c, maxPages: event.target.value }))
                    }
                  />
                </Field>
                <Field label="기간" hint="시작일 / 종료일 (선택)">
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={options.since}
                      onChange={(event) =>
                        setOptions((c) => ({ ...c, since: event.target.value }))
                      }
                    />
                    <span className="text-foreground-subtle">~</span>
                    <Input
                      type="date"
                      value={options.until}
                      onChange={(event) =>
                        setOptions((c) => ({ ...c, until: event.target.value }))
                      }
                    />
                  </div>
                </Field>

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={options.includeNoTracking}
                    onChange={(event) =>
                      setOptions((c) => ({
                        ...c,
                        includeNoTracking: event.target.checked
                      }))
                    }
                    className="mt-1 h-4 w-4 rounded border-border"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-foreground">
                      송장 없는 주문도 저장
                    </span>
                    <span className="mt-0.5 block text-xs text-foreground-muted">
                      배송조회 버튼이 아직 없는 결제완료 주문도 함께 저장합니다.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={options.headless}
                    onChange={(event) =>
                      setOptions((c) => ({ ...c, headless: event.target.checked }))
                    }
                    className="mt-1 h-4 w-4 rounded border-border"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-foreground">
                      백그라운드 실행
                    </span>
                    <span className="mt-0.5 block text-xs text-foreground-muted">
                      저장된 세션을 사용해 브라우저를 최소화한 상태로 실행합니다.
                    </span>
                  </span>
                </label>
              </CardBody>
            </Card>

            <ExtractionProgressPanel
              items={progressItems}
              runningRunId={runningRunId}
              onClear={() => setProgressItems([])}
            />
          </div>

          {site.code === "oliveyoung" && (
            <OliveYoungManualImportPanel
              siteId={site.id}
              onImported={loadAll}
            />
          )}

          <OrderFilters
            value={filters}
            onChange={setFilters}
            resultCount={filteredOrders.length}
            totalCount={total}
          />

          <OrderTable
            orders={filteredOrders}
            total={filteredOrders.length}
            onRefresh={loadAll}
            onExportCsv={handleExportCsv}
            title={`${site.name} 주문`}
            emptyTitle="이 쇼핑몰에 저장된 주문이 없습니다"
            emptyDescription="추출 옵션을 설정한 뒤 우측 상단 '지정 옵션으로 추출' 버튼을 눌러 주문을 가져오세요."
            emptyAction={
              <Button variant="primary" onClick={handleExtract} disabled={!site.enabled}>
                <Zap className="h-4 w-4" />
                지금 추출
              </Button>
            }
          />

          <ExtractionLogTable
            logs={logs}
            total={logTotal}
            title="이 쇼핑몰의 추출 이력"
            onRefresh={loadLogs}
          />
        </div>
      )}
    </AppShell>
  );
}
