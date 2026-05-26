"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  Keyboard,
  PackageCheck,
  PackageSearch,
  RefreshCw,
  Scan,
  Search,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../../components/AppShell";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import { KpiCard } from "../../components/ui/KpiCard";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { playChime } from "../../lib/chime";
import type {
  AdminMatchedItem,
  AdminRescanUnmatchedResult,
  AdminScanAndMatchResult,
  WarehouseListTodayAndPendingResult,
  WarehouseTodayEntry,
} from "../../../shared/api";

const STATUS_LABELS: Record<string, string> = {
  PAYMENT_COMPLETED: "결제 완료",
  ORDER_PROCESSING: "주문 처리중",
  SHIPPING_TO_BDJ: "배대지 배송중",
  SHIPPING_TO_HOME: "해외 배송중",
  DELIVERED: "배송 완료",
  CANCEL_REQUESTED: "취소 요청",
  CANCEL_COMPLETED: "취소 완료",
};

type ActionRow =
  | {
      kind: "candidates";
      key: string;
      trackingNumber: string;
      candidates: AdminMatchedItem[];
    }
  | {
      kind: "unmatched";
      key: string;
      trackingNumber: string;
    };

function formatTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatDateTime(value: string | null | undefined): string {
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

function maskTracking(value: string | null | undefined): string {
  if (!value) return "-";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export default function WarehousePage() {
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const [scanValue, setScanValue] = useState("");
  const [scanning, setScanning] = useState(false);

  // 좌측: DB 기반 (오늘 + 어제 이전 미매칭)
  const [entries, setEntries] = useState<WarehouseTodayEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);

  // 우측: 세션 한정 액션 큐 (스캔 직후 후보 / 좌측 "지금 매칭" 클릭 / UNMATCHED 인라인 검색)
  const [actionItems, setActionItems] = useState<ActionRow[]>([]);
  const [manualSearch, setManualSearch] = useState<
    Record<string, { query: string; results: AdminMatchedItem[]; loading: boolean }>
  >({});
  const [confirming, setConfirming] = useState<number | null>(null);

  const [bulkRunning, setBulkRunning] = useState(false);

  // 좌측 데이터 로드
  const loadEntries = useCallback(async () => {
    try {
      const r: WarehouseListTodayAndPendingResult =
        await window.api.warehouse.listTodayAndPending();
      setEntries(r.entries);
    } catch (err) {
      console.error(err);
      toast.error(
        `목록 조회 실패: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setLoadingEntries(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    scanInputRef.current?.focus();
  }, []);

  const refocus = useCallback(() => {
    setTimeout(() => scanInputRef.current?.focus(), 30);
  }, []);

  // 통합 스캔 핸들러
  const handleScan = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value || scanning) return;
      setScanning(true);

      try {
        const r: AdminScanAndMatchResult = await window.api.admin.scanAndMatch({
          trackingNumber: value,
        });

        if (r.outcome === "AUTO_CONFIRMED" && r.confirmedItem) {
          playChime("success");
          if (r.adminSynced) {
            toast.success(`매칭+입고+동기화 완료: ${r.confirmedItem.vyCode}`);
          } else {
            toast.warning(
              `로컬 입고 완료 / Admin 동기화 보류: ${r.pushReason ?? "이유 미상"}`
            );
          }
        } else if (
          (r.outcome === "PARTIAL" || r.outcome === "MULTI_CANDIDATE") &&
          r.candidates &&
          r.candidates.length > 0
        ) {
          playChime("warn");
          // 즉시 우측 패널에 후보 표시
          setActionItems((prev) => [
            {
              kind: "candidates" as const,
              key: `action-${r.scan.id}-${Date.now()}`,
              trackingNumber: value,
              candidates: r.candidates!,
            },
            ...prev,
          ]);
          toast.warning(
            `후보 ${r.candidates.length}건 — 우측 패널에서 선택하세요`
          );
        } else {
          playChime("error");
          toast.error(`매칭 실패 — 좌측 목록에서 "지금 매칭"으로 처리하세요`);
        }
      } catch (err) {
        playChime("error");
        toast.error(`스캔 오류: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setScanValue("");
        setScanning(false);
        await loadEntries();
        refocus();
      }
    },
    [scanning, refocus, loadEntries]
  );

  // 좌측의 미매칭 행에서 "지금 매칭" 클릭 → 우측 액션 큐에 추가
  const handleOpenMatch = useCallback(
    (trackingNumber: string) => {
      const exists = actionItems.some(
        (a) => a.trackingNumber === trackingNumber && a.kind === "unmatched"
      );
      if (exists) {
        toast.info("이미 우측 패널에 있습니다.");
        return;
      }
      setActionItems((prev) => [
        {
          kind: "unmatched" as const,
          key: `action-manual-${trackingNumber}-${Date.now()}`,
          trackingNumber,
        },
        ...prev,
      ]);
    },
    [actionItems]
  );

  // 후보/검색결과 → confirmMatch
  const handleConfirmCandidate = useCallback(
    async (actionKey: string, trackingNumber: string, item: AdminMatchedItem) => {
      setConfirming(item.orderItemId);
      try {
        const r = await window.api.admin.confirmMatch({
          orderItemId: item.orderItemId,
          trackingNumber,
          vyCode: item.vyCode,
        });

        if (!r.ok) {
          toast.error("확정 실패");
          return;
        }

        playChime("success");
        setActionItems((prev) => prev.filter((a) => a.key !== actionKey));
        if (r.synced) {
          toast.success(`매칭 확정 + 동기화 완료: ${item.vyCode}`);
        } else {
          toast.warning(
            `로컬 확정 / Admin 동기화 보류: ${r.reason ?? "이유 미상"}`
          );
        }
        await loadEntries();
      } catch (err) {
        toast.error(
          `확정 오류: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setConfirming(null);
        refocus();
      }
    },
    [refocus, loadEntries]
  );

  const runManualSearch = useCallback(async (actionKey: string, query: string) => {
    const q = query.trim();
    if (!q) return;
    setManualSearch((m) => ({
      ...m,
      [actionKey]: { query: q, results: [], loading: true },
    }));
    try {
      const { results } = await window.api.admin.searchOrders({ query: q });
      setManualSearch((m) => ({
        ...m,
        [actionKey]: { query: q, results, loading: false },
      }));
      if (results.length === 0) toast.warning("검색 결과 없음");
    } catch (err) {
      setManualSearch((m) => ({
        ...m,
        [actionKey]: { query: q, results: [], loading: false },
      }));
      toast.error(
        `검색 오류: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }, []);

  const dismissAction = useCallback((actionKey: string) => {
    setActionItems((prev) => prev.filter((a) => a.key !== actionKey));
    setManualSearch((m) => {
      const next = { ...m };
      delete next[actionKey];
      return next;
    });
  }, []);

  // 누락분 재처리 (admin 기반 일괄 재매칭)
  const handleBulkRescan = useCallback(async () => {
    if (bulkRunning) return;
    setBulkRunning(true);
    try {
      const r: AdminRescanUnmatchedResult =
        await window.api.admin.rescanUnmatched();

      if (r.processed === 0) {
        toast.info("재매칭할 미매칭 송장이 없습니다.");
      } else {
        toast.success(
          `재매칭 완료 · 처리 ${r.processed} · 자동확정 ${r.autoConfirmed} · 후보발견 ${r.candidatesFound} · 여전히 미매칭 ${r.stillUnmatched}`
        );
      }
      if (r.noToken && r.autoConfirmed > 0) {
        toast.error("Admin 토큰 없음 — 동기화 건너뜀. 설정에서 로그인 필요.");
      } else if (r.adminFailed > 0) {
        toast.error(`Admin 동기화 실패 ${r.adminFailed}건 — 감사 로그 확인`);
      }
      await loadEntries();
    } catch (err) {
      toast.error(
        `재매칭 오류: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setBulkRunning(false);
      refocus();
    }
  }, [bulkRunning, refocus, loadEntries]);

  // KPI는 entries 기반 계산
  const stats = useMemo(() => {
    let todayMatched = 0;
    let todayUnmatched = 0;
    let oldUnmatched = 0;
    for (const e of entries) {
      if (e.isToday) {
        if (e.scan.status === "MATCHED") todayMatched++;
        else if (e.scan.status === "UNMATCHED") todayUnmatched++;
      } else if (e.scan.status === "UNMATCHED") {
        oldUnmatched++;
      }
    }
    return {
      todayMatched,
      todayUnmatched,
      oldUnmatched,
      actionPending: actionItems.length,
    };
  }, [entries, actionItems]);

  const lastScanDisplay = useMemo(() => {
    if (entries.length === 0) return null;
    return maskTracking(entries[0].scan.normalizedTrackingNumber);
  }, [entries]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="입고 & 매칭"
        title="송장 스캔 → 매칭 → 동기화"
        description="바코드를 스캔하면 admin 주문과 즉시 매칭됩니다. 미매칭 송장은 좌측에 누적되어 나중에 주문 데이터가 들어오면 다시 매칭할 수 있습니다."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={loadEntries} disabled={loadingEntries}>
              <RefreshCw className="h-4 w-4" />
              새로고침
            </Button>
            <Button
              variant="secondary"
              onClick={handleBulkRescan}
              loading={bulkRunning}
              disabled={bulkRunning}
            >
              <Wand2 className="h-4 w-4" />
              누락분 재처리
            </Button>
          </div>
        }
      />

      {/* KPI */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="오늘 매칭 완료"
          value={stats.todayMatched.toLocaleString("ko-KR")}
          hint="자동 + 수동 확정"
          icon={CheckCircle2}
          tone="success"
        />
        <KpiCard
          label="오늘 미매칭"
          value={stats.todayUnmatched.toLocaleString("ko-KR")}
          hint="처리 필요"
          icon={AlertTriangle}
          tone={stats.todayUnmatched > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="이전 누적 미매칭"
          value={stats.oldUnmatched.toLocaleString("ko-KR")}
          hint="주문 동기화 후 재매칭 가능"
          icon={Inbox}
          tone={stats.oldUnmatched > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="우측 처리 대기"
          value={stats.actionPending.toLocaleString("ko-KR")}
          hint="후보 선택 / 수동 검색"
          icon={XCircle}
          tone={stats.actionPending > 0 ? "warning" : "default"}
        />
      </div>

      {/* 스캔 입력 (sticky) */}
      <div className="sticky top-0 z-10 mt-6 -mx-6 bg-background/95 px-6 py-3 backdrop-blur lg:-mx-10 lg:px-10">
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-gradient-to-br from-primary-soft via-surface to-surface px-6 py-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-soft-foreground">
              <Scan className="h-4 w-4" />
              바코드 스캔 입력
            </div>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-stretch">
              <Input
                ref={scanInputRef}
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleScan(scanValue);
                  }
                }}
                placeholder="여기를 클릭한 뒤 바코드를 스캔하세요"
                className="h-14 font-mono text-xl font-bold tracking-wider"
                autoFocus
              />
              <Button
                variant="primary"
                className="h-14 px-6 text-base"
                onClick={() => void handleScan(scanValue)}
                loading={scanning}
                disabled={scanning || !scanValue.trim()}
              >
                <Scan className="h-5 w-5" />
                스캔
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-muted">
              <span className="flex items-center gap-1.5">
                <Keyboard className="h-3.5 w-3.5" />
                USB 스캐너 Enter 자동 입력. 미매칭 송장은 DB에 영구 저장됩니다.
              </span>
              {lastScanDisplay ? (
                <span className="font-mono text-foreground">
                  마지막: {lastScanDisplay}
                </span>
              ) : null}
            </div>
          </div>
        </Card>
      </div>

      {/* 좌/우 split */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        {/* LEFT — 오늘 입고 + 미매칭 누적 (DB 기반) */}
        <Card>
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                오늘 입고 + 미매칭 누적
              </h2>
              <p className="mt-0.5 text-sm text-foreground-muted">
                오늘 스캔된 모든 송장 + 이전 미매칭 송장 (영구 저장)
              </p>
            </div>
            <span className="text-xs tabular-nums text-foreground-muted">
              {entries.length}건
            </span>
          </div>
          {loadingEntries ? (
            <div className="p-6">
              <EmptyState
                icon={RefreshCw}
                title="목록 불러오는 중..."
                description=""
              />
            </div>
          ) : entries.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={PackageSearch}
                title="처리된 항목이 없습니다"
                description="위 입력창에서 바코드를 스캔하세요."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <EntryRow
                  key={`entry-${entry.scan.id}`}
                  entry={entry}
                  onOpenMatch={handleOpenMatch}
                />
              ))}
            </ul>
          )}
        </Card>

        {/* RIGHT — 처리 큐 */}
        <Card>
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">처리 큐</h2>
              <p className="mt-0.5 text-sm text-foreground-muted">
                후보 선택 / 수동 매칭 작업 공간
              </p>
            </div>
            <span className="text-xs tabular-nums text-foreground-muted">
              {actionItems.length}건
            </span>
          </div>
          {actionItems.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={CheckCircle2}
                title="처리할 항목이 없습니다"
                description="좌측 미매칭 행의 '지금 매칭' 버튼을 누르거나, 스캔 후 후보가 여러 건이면 여기에 표시됩니다."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {actionItems.map((action) => (
                <li key={action.key} className="space-y-3 px-6 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {action.kind === "candidates" ? (
                        <Clock className="h-4 w-4 text-warning-soft-foreground" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-warning-soft-foreground" />
                      )}
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {maskTracking(action.trackingNumber)}
                      </span>
                      <StatusBadge
                        label={action.kind === "candidates" ? "후보 선택" : "수동 검색"}
                        tone="warning"
                        dot
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => dismissAction(action.key)}
                      className="rounded p-1 text-foreground-muted transition hover:bg-surface-2 hover:text-foreground"
                      title="이 항목 닫기 (좌측 목록엔 그대로 남음)"
                      aria-label="닫기"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {action.kind === "candidates" ? (
                    <ul className="space-y-2">
                      {action.candidates.map((cand) => (
                        <li
                          key={`${action.key}-${cand.orderItemId}`}
                          className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/40 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-foreground">
                                {cand.vyCode || cand.orderNumber}
                              </span>
                              <StatusBadge
                                label={
                                  STATUS_LABELS[cand.itemStatus] ?? cand.itemStatus
                                }
                                tone="info"
                              />
                            </div>
                            <p className="mt-0.5 truncate text-xs text-foreground-muted">
                              {cand.productName}
                            </p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-foreground-muted">
                              <span>{cand.orderNumber}</span>
                              {cand.customerName ? (
                                <span>· {cand.customerName}</span>
                              ) : null}
                              {cand.domesticTrackingNumber ? (
                                <span className="font-mono">
                                  · {cand.domesticTrackingNumber}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() =>
                              void handleConfirmCandidate(
                                action.key,
                                action.trackingNumber,
                                cand
                              )
                            }
                            loading={confirming === cand.orderItemId}
                            disabled={confirming !== null}
                          >
                            <PackageCheck className="h-3.5 w-3.5" />
                            확정
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <UnmatchedSearch
                      actionKey={action.key}
                      trackingNumber={action.trackingNumber}
                      state={manualSearch[action.key]}
                      onSearch={runManualSearch}
                      onConfirm={(item) =>
                        void handleConfirmCandidate(
                          action.key,
                          action.trackingNumber,
                          item
                        )
                      }
                      confirming={confirming}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

// ─── 좌측 entry 한 줄 ───
function EntryRow(props: {
  entry: WarehouseTodayEntry;
  onOpenMatch: (trackingNumber: string) => void;
}) {
  const { entry, onOpenMatch } = props;
  const { scan, matchedItems, isToday } = entry;
  const matchedItem = matchedItems[0]; // 보통 1건; 여러 건이면 첫 번째 표시

  const isMatched = scan.status === "MATCHED" && matchedItem;
  const tracking = scan.normalizedTrackingNumber || scan.trackingNumber;

  return (
    <li className="flex items-start gap-3 px-6 py-3">
      {isMatched ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
      ) : (
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-soft-foreground" />
      )}
      <div className="min-w-0 flex-1">
        {isMatched ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {matchedItem.vyCode || matchedItem.orderNumber}
              </span>
              <StatusBadge
                label={STATUS_LABELS[matchedItem.itemStatus] ?? matchedItem.itemStatus}
                tone="info"
              />
              <StatusBadge label="입고 완료" tone="success" dot />
              {!isToday ? (
                <StatusBadge label="이전 매칭" tone="neutral" />
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-sm text-foreground-muted">
              {matchedItem.productName}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
              <span>
                {isToday ? formatTime(scan.matchedAt ?? scan.scannedAt) : formatDateTime(scan.scannedAt)}
              </span>
              {matchedItem.customerName ? <span>· {matchedItem.customerName}</span> : null}
              <span className="font-mono">· {maskTracking(tracking)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-foreground">
                {maskTracking(tracking)}
              </span>
              <StatusBadge label="미매칭" tone="warning" dot />
              {!isToday ? (
                <StatusBadge label={`${formatDateTime(scan.scannedAt)} 입고`} tone="neutral" />
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-foreground-muted">
              {isToday
                ? `${formatTime(scan.scannedAt)} · admin 주문이 동기화되면 매칭 가능`
                : "admin 주문이 추가된 후 우측 패널에서 매칭하세요"}
            </p>
          </>
        )}
      </div>
      {!isMatched ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onOpenMatch(scan.trackingNumber)}
        >
          <Search className="h-3 w-3" />
          지금 매칭
        </Button>
      ) : null}
    </li>
  );
}

// ─── UNMATCHED 인라인 수동 검색 ───
function UnmatchedSearch(props: {
  actionKey: string;
  trackingNumber: string;
  state: { query: string; results: AdminMatchedItem[]; loading: boolean } | undefined;
  onSearch: (actionKey: string, query: string) => void;
  onConfirm: (item: AdminMatchedItem) => void;
  confirming: number | null;
}) {
  const { actionKey, state, onSearch, onConfirm, confirming } = props;
  const [input, setInput] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSearch(actionKey, input);
              }
            }}
            placeholder="VY코드 / 고객명 / 상품명 / 주문번호"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSearch(actionKey, input)}
          loading={state?.loading}
          disabled={state?.loading || !input.trim()}
        >
          검색
        </Button>
      </div>
      {state && state.results.length > 0 ? (
        <ul className="space-y-1.5">
          {state.results.slice(0, 8).map((item) => (
            <li
              key={`${actionKey}-search-${item.orderItemId}`}
              className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/40 px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    {item.vyCode || item.orderNumber}
                  </span>
                  <StatusBadge
                    label={STATUS_LABELS[item.itemStatus] ?? item.itemStatus}
                    tone="info"
                  />
                </div>
                <p className="mt-0.5 truncate text-xs text-foreground-muted">
                  {item.productName}
                </p>
                {item.customerName ? (
                  <p className="text-[11px] text-foreground-muted">{item.customerName}</p>
                ) : null}
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onConfirm(item)}
                loading={confirming === item.orderItemId}
                disabled={confirming !== null}
              >
                확정
              </Button>
            </li>
          ))}
          {state.results.length > 8 ? (
            <li className="text-center text-[11px] text-foreground-muted">
              외 {state.results.length - 8}건 — 검색어를 더 구체적으로 입력하세요
            </li>
          ) : null}
        </ul>
      ) : state && !state.loading ? (
        <p className="text-[11px] text-foreground-muted">검색 결과 없음</p>
      ) : null}
    </div>
  );
}
