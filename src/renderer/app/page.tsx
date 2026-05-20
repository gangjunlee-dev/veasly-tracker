"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Inbox,
  PackageSearch,
  ShoppingBag,
  Sparkles,
  Truck,
  Zap
} from "lucide-react";
import { AppShell } from "../components/AppShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ExtractionStatusBadge } from "../components/ui/StatusBadge";
import { KpiCard } from "../components/ui/KpiCard";
import { PageHeader } from "../components/ui/PageHeader";
import { formatCurrency } from "../lib/format";

type Site = {
  id: number;
  code: string;
  name: string;
  enabled: boolean;
  lastExtractedAt?: string | null;
};

type OrderRow = {
  id: number;
  amount?: number | null;
  shippingStatus?: string | null;
  warehouseStatus?: string | null;
  createdAt?: string | null;
  orderDate?: string | null;
  siteId: number;
};

type ExtractionLog = {
  id: number;
  status: string;
  siteId: number;
  siteName?: string;
  startedAt: string;
  finishedAt: string | null;
  totalOrders: number;
  newOrders: number;
  updatedOrders: number;
  message: string | null;
};

type WarehouseSummary = Record<string, number>;

function formatRelative(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;

  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function isToday(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

const workflowSteps = [
  {
    icon: ShoppingBag,
    title: "쇼핑몰 계정 등록",
    description:
      "추출 대상이 되는 쇼핑몰 (무신사, 29CM, 올리브영 등) 로그인 정보를 안전하게 저장합니다.",
    href: "/settings/sites",
    cta: "쇼핑몰 등록하기"
  },
  {
    icon: Zap,
    title: "주문 자동 가져오기",
    description:
      "쇼핑몰별 추출기를 실행해 상품·송장 번호·금액·배송 상태까지 한 번에 동기화합니다.",
    href: "/extract",
    cta: "주문 가져오기"
  },
  {
    icon: PackageSearch,
    title: "창고 입고 처리",
    description:
      "도착한 택배 송장을 바코드로 스캔하면 자동으로 주문과 매칭되어 입고 처리됩니다.",
    href: "/warehouse",
    cta: "입고 시작하기"
  }
];

export default function HomePage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [logs, setLogs] = useState<ExtractionLog[]>([]);
  const [warehouseSummary, setWarehouseSummary] = useState<WarehouseSummary>({});
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [siteList, ordersResult, logsResult, warehouseResult] =
        await Promise.all([
          window.api.sites.list(),
          window.api.orders.listAll({ page: 1, pageSize: 500 }),
          window.api.logs.list({ page: 1, pageSize: 5 }),
          window.api.warehouse.listInboundScans({ page: 1, pageSize: 1 })
        ]);

      setSites(siteList as Site[]);
      setOrders((ordersResult as { items: OrderRow[] }).items ?? []);
      setLogs((logsResult as { items: ExtractionLog[] }).items ?? []);
      setWarehouseSummary(
        (warehouseResult as { summary: WarehouseSummary }).summary ?? {}
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const kpis = useMemo(() => {
    const todayOrders = orders.filter((order) =>
      isToday(order.createdAt ?? order.orderDate)
    );
    const arrivedOrders = orders.filter(
      (order) => order.warehouseStatus === "ARRIVED"
    );
    const totalAmount = orders.reduce(
      (sum, order) => sum + Number(order.amount ?? 0),
      0
    );

    return {
      totalOrders: orders.length,
      todayOrders: todayOrders.length,
      arrivedRate: orders.length
        ? Math.round((arrivedOrders.length / orders.length) * 100)
        : 0,
      totalAmount,
      pendingInbound:
        (warehouseSummary.SCANNED ?? 0) + (warehouseSummary.UNMATCHED ?? 0),
      unmatched: warehouseSummary.UNMATCHED ?? 0
    };
  }, [orders, warehouseSummary]);

  const hasNoSites = !loading && sites.length === 0;

  return (
    <AppShell>
      <PageHeader
        eyebrow="홈"
        title={hasNoSites ? "Veasly Tracker에 오신 것을 환영합니다" : "오늘의 운영 현황"}
        description={
          hasNoSites
            ? "3단계로 운영을 시작할 수 있습니다. 먼저 쇼핑몰 계정을 등록해 보세요."
            : "주문 수집, 입고 매칭, 추출 이력을 한눈에 확인합니다."
        }
        actions={
          !hasNoSites && (
            <>
              <Link href="/extract">
                <Button variant="secondary">
                  <Zap className="h-4 w-4" />
                  주문 가져오기
                </Button>
              </Link>
              <Link href="/warehouse">
                <Button variant="primary">
                  <PackageSearch className="h-4 w-4" />
                  입고 시작
                </Button>
              </Link>
            </>
          )
        }
      />

      <div className="mt-8 space-y-8">
        {hasNoSites ? (
          <section>
            <div className="rounded-3xl border border-border bg-gradient-to-br from-primary-soft via-surface to-surface p-8">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft">
                  <Sparkles className="h-5 w-5" strokeWidth={2.25} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-primary-soft-foreground">
                    시작 가이드
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-foreground">
                    3단계로 끝나는 주문 ↔ 입고 자동화
                  </h2>
                  <p className="mt-1 text-sm text-foreground-muted">
                    각 단계는 언제든 다시 와서 변경할 수 있어요.
                  </p>
                </div>
              </div>

              <ol className="mt-8 grid gap-4 md:grid-cols-3">
                {workflowSteps.map((step, index) => {
                  const StepIcon = step.icon;
                  return (
                    <li key={step.href}>
                      <Card className="flex h-full flex-col">
                        <div className="flex-1 p-6">
                          <div className="flex items-center gap-3">
                            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                              <StepIcon className="h-5 w-5" strokeWidth={2.25} />
                            </span>
                            <span className="text-xs font-bold uppercase tracking-wide text-foreground-subtle">
                              Step {index + 1}
                            </span>
                          </div>
                          <h3 className="mt-4 text-base font-semibold text-foreground">
                            {step.title}
                          </h3>
                          <p className="mt-2 text-sm leading-6 text-foreground-muted">
                            {step.description}
                          </p>
                        </div>
                        <div className="border-t border-border bg-surface-2 px-6 py-3">
                          <Link
                            href={step.href}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary-hover"
                          >
                            {step.cta}
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="누적 주문"
              value={kpis.totalOrders.toLocaleString("ko-KR")}
              hint={`오늘 신규 ${kpis.todayOrders}건`}
              tone="primary"
              icon={ClipboardList}
            />
            <KpiCard
              label="누적 매출"
              value={formatCurrency(kpis.totalAmount)}
              hint={`등록 사이트 ${sites.length}곳`}
              tone="success"
              icon={ShoppingBag}
            />
            <KpiCard
              label="입고 처리율"
              value={`${kpis.arrivedRate}%`}
              hint="주문 중 창고 도착 비율"
              tone="info"
              icon={CheckCircle2}
            />
            <KpiCard
              label="입고 대기 송장"
              value={kpis.pendingInbound.toLocaleString("ko-KR")}
              hint={`그 중 미매칭 ${kpis.unmatched}건`}
              tone={kpis.unmatched > 0 ? "warning" : "default"}
              icon={Inbox}
            />
          </section>
        )}

        {!hasNoSites && (
          <section className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    최근 추출 결과
                  </h2>
                  <p className="mt-0.5 text-sm text-foreground-muted">
                    최근 5번의 자동 추출 실행 기록입니다.
                  </p>
                </div>
                <Link
                  href="/history"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"
                >
                  전체 이력 보기
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              {logs.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Zap}
                    title="추출 기록이 없습니다"
                    description="주문 가져오기를 한 번 실행하면 결과가 여기에 표시돼요."
                    action={
                      <Link href="/extract">
                        <Button variant="primary">
                          <Zap className="h-4 w-4" />
                          지금 추출하기
                        </Button>
                      </Link>
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {logs.map((log) => (
                    <li
                      key={log.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {log.siteName ?? `사이트 #${log.siteId}`}
                          </p>
                          <ExtractionStatusBadge status={log.status} />
                        </div>
                        <p className="mt-0.5 text-xs text-foreground-muted">
                          {formatRelative(log.startedAt)} · 신규 {log.newOrders} ·
                          업데이트 {log.updatedOrders}
                        </p>
                      </div>
                      <span className="text-sm tabular-nums text-foreground-muted">
                        총 {log.totalOrders.toLocaleString("ko-KR")}건
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <div className="border-b border-border px-6 py-4">
                <h2 className="text-base font-semibold text-foreground">
                  등록된 쇼핑몰
                </h2>
                <p className="mt-0.5 text-sm text-foreground-muted">
                  활성화 사이트는 자동 추출 대상이 됩니다.
                </p>
              </div>
              {sites.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={ShoppingBag}
                    title="등록된 사이트가 없습니다"
                    action={
                      <Link href="/settings/sites">
                        <Button variant="primary" size="sm">
                          쇼핑몰 등록
                        </Button>
                      </Link>
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {sites.slice(0, 6).map((site) => (
                    <li
                      key={site.id}
                      className="flex items-center justify-between gap-3 px-6 py-3.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {site.name}
                        </p>
                        <p className="text-xs text-foreground-muted">
                          {site.lastExtractedAt
                            ? `최근 추출 ${formatRelative(site.lastExtractedAt)}`
                            : "아직 추출 기록 없음"}
                        </p>
                      </div>
                      {site.enabled ? (
                        <span className="vt-chip bg-success-soft text-success-soft-foreground ring-success/25">
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                          활성
                        </span>
                      ) : (
                        <span className="vt-chip bg-surface-2 text-foreground-muted ring-border">
                          비활성
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t border-border bg-surface-2 px-6 py-3 text-right">
                <Link
                  href="/settings/sites"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"
                >
                  사이트 관리
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </Card>
          </section>
        )}

        {!hasNoSites && (
          <section className="rounded-2xl border border-border bg-surface px-6 py-5 text-sm text-foreground-muted">
            <div className="flex flex-wrap items-center gap-3">
              <Truck className="h-5 w-5 text-foreground-muted" />
              <span>
                창고 도착 송장 매칭이 완료되지 않은 주문은{" "}
                <Link
                  href="/warehouse"
                  className="font-semibold text-primary hover:text-primary-hover"
                >
                  입고 화면
                </Link>
                에서 스캔으로 정리하세요.
              </span>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
