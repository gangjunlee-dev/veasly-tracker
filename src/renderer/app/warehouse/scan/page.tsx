"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Package,
  PackageCheck,
  Search,
  XCircle
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../../../components/AppShell";
import { Button } from "../../../components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { Input } from "../../../components/ui/Input";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge } from "../../../components/ui/StatusBadge";

type MatchedItem = {
  orderItemId: number;
  vyCode: string;
  productName: string;
  itemStatus: string;
  warehouseStatus: string;
  warehouseMatchedAt: string | null;
  domesticTrackingNumber: string | null;
  domesticCarrier: string | null;
  orderNumber: string;
  customerName: string | null;
  orderStatus: string;
};

type MatchResult = {
  matchType: "AUTO" | "PARTIAL" | "NONE";
  items: MatchedItem[];
};

const STATUS_LABELS: Record<string, string> = {
  PAYMENT_COMPLETED: "결제 완료",
  ORDER_PROCESSING: "주문 처리중",
  SHIPPING_TO_BDJ: "배대지 배송중",
  SHIPPING_TO_HOME: "해외 배송중",
  DELIVERED: "배송 완료",
};

function formatTime(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function ScanMatchPage() {
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // 스캔 상태
  const [scanValue, setScanValue] = useState("");
  const [scanning, setScanning] = useState(false);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [lastScanned, setLastScanned] = useState("");

  // 수동 검색
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MatchedItem[]>([]);
  const [searching, setSearching] = useState(false);

  // 확정 처리
  const [confirming, setConfirming] = useState<number | null>(null);

  // 최근 이력
  const [recentItems, setRecentItems] = useState<MatchedItem[]>([]);

  // 최근 매칭 이력 로드
  const loadRecent = useCallback(async () => {
    try {
      const { items } = await window.api.admin.recentMatches({ limit: 15 });
      setRecentItems(items);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    void loadRecent();
    // 페이지 진입 시 스캔 입력 포커스
    scanInputRef.current?.focus();
  }, [loadRecent]);

  // ── 바코드 스캔 처리 ──
  const handleScan = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setScanning(true);
    setMatchResult(null);
    setSearchResults([]);
    setLastScanned(trimmed);

    try {
      const result = await window.api.admin.matchBarcode({
        trackingNumber: trimmed,
      });
      setMatchResult(result);

      if (result.matchType === "AUTO") {
        toast.success(`자동 매칭: ${result.items.length}건 발견`);
      } else if (result.matchType === "PARTIAL") {
        toast.warning(`부분 매칭: ${result.items.length}건 (확인 필요)`);
      } else {
        toast.error("매칭 실패: 해당 송장번호를 찾을 수 없습니다.");
      }
    } catch (err) {
      toast.error("스캔 오류: " + String(err));
    } finally {
      setScanning(false);
      setScanValue("");
      scanInputRef.current?.focus();
    }
  };

  // ── 수동 검색 ──
  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;

    setSearching(true);
    try {
      const { results } = await window.api.admin.searchOrders({ query: q });
      setSearchResults(results);
      setMatchResult(null);
      if (results.length === 0) {
        toast.warning("검색 결과가 없습니다.");
      }
    } catch (err) {
      toast.error("검색 오류: " + String(err));
    } finally {
      setSearching(false);
    }
  };

  // ── 매칭 확정 ──
  const handleConfirm = async (item: MatchedItem) => {
    setConfirming(item.orderItemId);
    try {
      const result = await window.api.admin.confirmMatch({
        orderItemId: item.orderItemId,
        trackingNumber: lastScanned || item.domesticTrackingNumber || "",
        vyCode: item.vyCode,
      });

      if (result.ok) {
        if (result.synced) {
          toast.success(
            `입고 확정 + Admin 송장 등록 완료: ${item.vyCode}`
          );
        } else {
          toast.warning(
            `입고 확정 (로컬만): ${item.vyCode} — Admin 등록 보류: ${result.reason}`
          );
        }

        // 결과에서 해당 아이템 상태 업데이트
        const updateItem = (items: MatchedItem[]) =>
          items.map((i) =>
            i.orderItemId === item.orderItemId
              ? { ...i, warehouseStatus: "ARRIVED", warehouseMatchedAt: new Date().toISOString() }
              : i
          );

        if (matchResult) {
          setMatchResult({ ...matchResult, items: updateItem(matchResult.items) });
        }
        setSearchResults((prev) => updateItem(prev));
        void loadRecent();
      } else {
        toast.error("확정 실패");
      }
    } catch (err) {
      toast.error("확정 오류: " + String(err));
    } finally {
      setConfirming(null);
    }
  };

  // 스캔 입력 엔터 처리
  const onScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleScan(scanValue);
    }
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSearch();
    }
  };

  // 현재 표시할 아이템 목록
  const displayItems = matchResult?.items ?? searchResults;
  const displayMode = matchResult
    ? matchResult.matchType
    : searchResults.length > 0
      ? "SEARCH"
      : null;

  return (
    <AppShell>
      <PageHeader
        eyebrow="창고"
        title="스캔 매칭"
        description="바코드를 스캔하여 Admin 주문과 자동 매칭합니다."
      />

      {/* 스캔 + 검색 입력 영역 */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* 바코드 스캔 */}
        <Card>
          <CardBody>
            <div className="flex items-center gap-2 mb-3">
              <Package className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                바코드 스캔
              </h3>
            </div>
            <div className="flex gap-2">
              <Input
                ref={scanInputRef}
                type="text"
                placeholder="송장번호 스캔 또는 입력..."
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={onScanKeyDown}
                autoFocus
                className="font-mono"
              />
              <Button
                variant="primary"
                onClick={() => handleScan(scanValue)}
                loading={scanning}
                disabled={!scanValue.trim()}
              >
                스캔
              </Button>
            </div>
            {lastScanned ? (
              <p className="mt-2 text-xs text-foreground-muted">
                마지막 스캔:{" "}
                <span className="font-mono font-medium text-foreground">
                  {lastScanned}
                </span>
              </p>
            ) : (
              <p className="mt-2 text-xs text-foreground-muted">
                바코드 스캐너로 송장번호를 스캔하세요. Enter 키로 자동 검색됩니다.
              </p>
            )}
          </CardBody>
        </Card>

        {/* 수동 검색 */}
        <Card>
          <CardBody>
            <div className="flex items-center gap-2 mb-3">
              <Search className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                수동 검색
              </h3>
            </div>
            <div className="flex gap-2">
              <Input
                ref={searchInputRef}
                type="text"
                placeholder="고객명, 상품명, VY코드, 주문번호..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
              />
              <Button
                variant="secondary"
                onClick={handleSearch}
                loading={searching}
                disabled={!searchQuery.trim()}
              >
                검색
              </Button>
            </div>
            <p className="mt-2 text-xs text-foreground-muted">
              바코드가 매칭되지 않을 때 고객명/상품명으로 직접 검색합니다.
            </p>
          </CardBody>
        </Card>
      </div>

      {/* 매칭 결과 */}
      {displayItems.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>
                {displayMode === "AUTO"
                  ? "자동 매칭 결과"
                  : displayMode === "PARTIAL"
                    ? "부분 매칭 결과 (확인 필요)"
                    : displayMode === "SEARCH"
                      ? "검색 결과"
                      : "매칭 결과"}
              </CardTitle>
              {displayMode === "AUTO" ? (
                <StatusBadge label="자동" tone="success" dot />
              ) : displayMode === "PARTIAL" ? (
                <StatusBadge label="부분 일치" tone="warning" dot />
              ) : null}
            </div>
            <span className="text-sm tabular-nums text-foreground-muted">
              {displayItems.length}건
            </span>
          </CardHeader>
          <div className="divide-y divide-border">
            {displayItems.map((item) => (
              <div
                key={item.orderItemId}
                className="flex items-center gap-4 px-6 py-4"
              >
                {/* 상태 아이콘 */}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2">
                  {item.warehouseStatus === "ARRIVED" ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : (
                    <Package className="h-5 w-5 text-foreground-subtle" />
                  )}
                </span>

                {/* 주문 정보 */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {item.vyCode || item.orderNumber}
                    </span>
                    <StatusBadge
                      label={STATUS_LABELS[item.itemStatus] ?? item.itemStatus}
                      tone={
                        item.itemStatus === "SHIPPING_TO_BDJ"
                          ? "info"
                          : item.itemStatus === "PAYMENT_COMPLETED"
                            ? "primary"
                            : "neutral"
                      }
                    />
                    {item.warehouseStatus === "ARRIVED" ? (
                      <StatusBadge label="입고 완료" tone="success" dot />
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-foreground-muted">
                    {item.productName}
                  </p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-foreground-muted">
                    <span>{item.orderNumber}</span>
                    {item.customerName ? (
                      <span>{item.customerName}</span>
                    ) : null}
                    {item.domesticTrackingNumber ? (
                      <span className="font-mono">
                        {item.domesticTrackingNumber}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* 확정 버튼 */}
                {item.warehouseStatus === "PENDING" ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleConfirm(item)}
                    loading={confirming === item.orderItemId}
                  >
                    <PackageCheck className="mr-1 h-3.5 w-3.5" />
                    입고 확정
                  </Button>
                ) : (
                  <span className="text-xs text-success font-medium">
                    {formatTime(item.warehouseMatchedAt)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      ) : displayMode === "NONE" ? (
        <Card className="mt-6">
          <CardBody>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <XCircle className="h-10 w-10 text-foreground-subtle" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  매칭 실패
                </p>
                <p className="mt-1 text-sm text-foreground-muted">
                  송장번호 <span className="font-mono font-medium">{lastScanned}</span>에
                  해당하는 주문을 찾을 수 없습니다.
                </p>
                <p className="mt-1 text-xs text-foreground-muted">
                  수동 검색으로 고객명이나 상품명으로 찾아보세요.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* 최근 입고 이력 */}
      {recentItems.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-foreground-subtle" />
              <CardTitle>최근 입고 이력</CardTitle>
            </div>
            <span className="text-sm tabular-nums text-foreground-muted">
              {recentItems.length}건
            </span>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  <th className="px-6 py-3">VY코드</th>
                  <th className="px-6 py-3">상품명</th>
                  <th className="px-6 py-3">주문번호</th>
                  <th className="px-6 py-3">고객명</th>
                  <th className="px-6 py-3">송장번호</th>
                  <th className="px-6 py-3">입고 시각</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentItems.map((item) => (
                  <tr key={item.orderItemId} className="hover:bg-surface-2/50">
                    <td className="px-6 py-3 font-medium text-foreground">
                      {item.vyCode}
                    </td>
                    <td className="max-w-[200px] truncate px-6 py-3 text-foreground-muted">
                      {item.productName}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-foreground-muted">
                      {item.orderNumber}
                    </td>
                    <td className="px-6 py-3 text-foreground-muted">
                      {item.customerName ?? "-"}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-foreground-muted">
                      {item.domesticTrackingNumber ?? "-"}
                    </td>
                    <td className="px-6 py-3 tabular-nums text-foreground-muted">
                      {formatTime(item.warehouseMatchedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </AppShell>
  );
}
