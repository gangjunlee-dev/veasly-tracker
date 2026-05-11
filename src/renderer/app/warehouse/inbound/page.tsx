"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../../components/AppShell";

type InboundScan = {
  id: number;
  trackingNumber: string;
  normalizedTrackingNumber: string;
  carrier: string | null;
  rawInput: string | null;
  status: string;
  matchedOrderCount: number;
  scanCount: number;
  scannedAt: string;
  lastScannedAt: string | null;
  matchedAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

type ScanListResult = {
  items: InboundScan[];
  total: number;
  page: number;
  pageSize: number;
  summary: Record<string, number>;
};

type AutoMatchResult = {
  scannedCount: number;
  matchedScanCount: number;
  unmatchedScanCount: number;
  matchedOrderCount: number;
};

type ScanResult = {
  result: string;
  message: string;
  scan: InboundScan | null;
  matchedOrders: Array<{
    orderNumber: string;
    productName: string;
    optionName: string | null;
    carrier: string | null;
    trackingNumber: string | null;
  }>;
};

function maskTracking(value: string | null | undefined) {
  if (!value) return "";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function getStatusLabel(status: string) {
  switch (status) {
    case "SCANNED":
      return "스캔됨";
    case "MATCHED":
      return "자동매칭";
    case "UNMATCHED":
      return "미매칭";
    case "DUPLICATE":
      return "중복";
    case "ISSUE":
      return "이슈";
    case "IGNORED":
      return "제외";
    default:
      return status;
  }
}

function getStatusClass(status: string) {
  switch (status) {
    case "MATCHED":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "UNMATCHED":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "SCANNED":
      return "bg-sky-50 text-sky-700 ring-sky-200";
    case "DUPLICATE":
      return "bg-slate-50 text-slate-700 ring-slate-200";
    case "ISSUE":
      return "bg-rose-50 text-rose-700 ring-rose-200";
    case "IGNORED":
      return "bg-zinc-50 text-zinc-600 ring-zinc-200";
    default:
      return "bg-slate-50 text-slate-600 ring-slate-200";
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

export default function WarehouseInboundPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [trackingNumber, setTrackingNumber] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [scans, setScans] = useState<InboundScan[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [lastAutoMatch, setLastAutoMatch] = useState<AutoMatchResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isMatching, setIsMatching] = useState(false);

  const loadScans = useCallback(async () => {
    const result = (await window.api.warehouse.listInboundScans({
      page: 1,
      pageSize: 100,
      status: statusFilter,
      search: search.trim() || undefined
    })) as ScanListResult;

    setScans(result.items ?? []);
    setTotal(result.total ?? 0);
    setSummary(result.summary ?? {});
  }, [search, statusFilter]);

  useEffect(() => {
    void loadScans();
  }, [loadScans]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const stats = useMemo(() => {
    return {
      scanned: summary.SCANNED ?? 0,
      matched: summary.MATCHED ?? 0,
      unmatched: summary.UNMATCHED ?? 0,
      issue: summary.ISSUE ?? 0
    };
  }, [summary]);

  const handleScan = async () => {
    const value = trackingNumber.trim();

    if (!value || isScanning) {
      inputRef.current?.focus();
      return;
    }

    setIsScanning(true);
    setMessage("송장 스캔 저장 중...");

    try {
      const result = (await window.api.warehouse.scanInbound({
        trackingNumber: value
      })) as ScanResult;

      setLastScanResult(result);
      setMessage(result.message);
      setTrackingNumber("");
      await loadScans();
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "스캔 저장에 실패했습니다.");
    } finally {
      setIsScanning(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleAutoMatch = async () => {
    if (isMatching) return;

    setIsMatching(true);
    setMessage("자동 매칭 실행 중...");

    try {
      const result = (await window.api.warehouse.autoMatch()) as AutoMatchResult;

      setLastAutoMatch(result);
      setMessage(
        `자동 매칭 완료: 송장 ${result.matchedScanCount}건 매칭 / 주문 ${result.matchedOrderCount}건 입고 처리 / 미매칭 ${result.unmatchedScanCount}건`
      );

      await loadScans();
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "자동 매칭에 실패했습니다.");
    } finally {
      setIsMatching(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <AppShell
      title="Warehouse Inbound"
      description="창고에 도착한 택배 송장을 먼저 스캔 저장하고, 구매 사이트 주문 송장과 일괄 매칭합니다."
    >
      <div className="space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex-1">
              <label className="text-sm font-semibold text-slate-700">
                송장 바코드 스캔
              </label>
              <input
                ref={inputRef}
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleScan();
                  }
                }}
                placeholder="바코드 리더기로 송장을 스캔하세요"
                className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-4 font-mono text-2xl font-bold tracking-wide outline-none ring-emerald-200 transition focus:border-emerald-500 focus:ring-4"
                autoFocus
              />
              <p className="mt-2 text-xs text-slate-500">
                USB 바코드 리더기는 대부분 키보드처럼 동작합니다. 스캔 후 Enter가 입력되면 자동 저장됩니다.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleScan()}
                disabled={isScanning}
                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isScanning ? "Saving..." : "Scan Save"}
              </button>
              <button
                type="button"
                onClick={() => void handleAutoMatch()}
                disabled={isMatching}
                className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isMatching ? "Matching..." : "Auto Match"}
              </button>
            </div>
          </div>

          {message ? (
            <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
              {message}
            </div>
          ) : null}

          {lastScanResult?.scan ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase text-slate-400">
                    Last Scan
                  </div>
                  <div className="mt-1 font-mono text-lg font-black text-slate-900">
                    {maskTracking(lastScanResult.scan.normalizedTrackingNumber)}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {lastScanResult.message}
                  </div>
                </div>
                <span
                  className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-bold ring-1 ${getStatusClass(
                    lastScanResult.scan.status
                  )}`}
                >
                  {getStatusLabel(lastScanResult.scan.status)}
                </span>
              </div>
            </div>
          ) : null}
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase text-slate-400">SCANNED</div>
            <div className="mt-2 text-3xl font-black text-sky-700">{stats.scanned}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase text-slate-400">MATCHED</div>
            <div className="mt-2 text-3xl font-black text-emerald-700">{stats.matched}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase text-slate-400">UNMATCHED</div>
            <div className="mt-2 text-3xl font-black text-amber-700">{stats.unmatched}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase text-slate-400">TOTAL</div>
            <div className="mt-2 text-3xl font-black text-slate-900">{total}</div>
          </div>
        </section>

        {lastAutoMatch ? (
          <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
            <div className="font-bold">최근 자동 매칭 결과</div>
            <div className="mt-2 grid gap-2 md:grid-cols-4">
              <div>대상 송장: {lastAutoMatch.scannedCount}</div>
              <div>매칭 송장: {lastAutoMatch.matchedScanCount}</div>
              <div>미매칭 송장: {lastAutoMatch.unmatchedScanCount}</div>
              <div>입고 주문: {lastAutoMatch.matchedOrderCount}</div>
            </div>
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-900">
                Inbound Scan Pool
              </h2>
              <p className="text-sm text-slate-500">
                먼저 스캔된 송장 목록입니다. 주문 데이터가 나중에 들어와도 Auto Match로 입고 처리할 수 있습니다.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="ALL">All</option>
                <option value="SCANNED">SCANNED</option>
                <option value="MATCHED">MATCHED</option>
                <option value="UNMATCHED">UNMATCHED</option>
                <option value="ISSUE">ISSUE</option>
                <option value="IGNORED">IGNORED</option>
              </select>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="송장 검색"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => void loadScans()}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Tracking</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Matched</th>
                  <th className="px-4 py-3">Scan Count</th>
                  <th className="px-4 py-3">Scanned At</th>
                  <th className="px-4 py-3">Last Scan</th>
                  <th className="px-4 py-3">Matched At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {scans.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      아직 스캔된 송장이 없습니다.
                    </td>
                  </tr>
                ) : (
                  scans.map((scan) => (
                    <tr key={scan.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-mono font-bold text-slate-900">
                          {maskTracking(scan.normalizedTrackingNumber)}
                        </div>
                        <div className="text-xs text-slate-400">
                          {scan.carrier ?? "-"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${getStatusClass(
                            scan.status
                          )}`}
                        >
                          {getStatusLabel(scan.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-700">
                        {scan.matchedOrderCount}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-700">
                        {scan.scanCount}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDateTime(scan.scannedAt)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDateTime(scan.lastScannedAt)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDateTime(scan.matchedAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}