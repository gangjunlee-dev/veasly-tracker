"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  GitCompare,
  KeyRound,
  Layers,
  LogIn,
  Package,
  RefreshCw,
  ShoppingCart,
  Wand2,
  X
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../../components/AppShell";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import { KpiCard } from "../../components/ui/KpiCard";
import { PageHeader } from "../../components/ui/PageHeader";
import type { AdminMatch, AdminStats } from "../../../shared/api.d";

type TabType = "ALL" | "AUTO" | "SUGGEST";

const REASON_BADGE: Record<string, { label: string; color: string }> = {
  L1_PURCHASE_URL: { label: "구매URL", color: "bg-purple-100 text-purple-700" },
  L2_DOMESTIC_TRACKING: { label: "송장번호", color: "bg-blue-100 text-blue-700" },
  L3_CARD_APPROVAL: { label: "카드승인", color: "bg-cyan-100 text-cyan-700" },
  L4_PRODUCT_URL: { label: "상품URL", color: "bg-green-100 text-green-700" },
  L5_AMOUNT_DATE: { label: "금액+날짜", color: "bg-orange-100 text-orange-700" }
};

function ScoreBar({ score }: { score: number }) {
  let barColor = "bg-red-500";
  if (score >= 80) barColor = "bg-green-500";
  else if (score >= 50) barColor = "bg-yellow-500";

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums text-foreground">
        {score}
      </span>
    </div>
  );
}

function ReasonBadges({ reasons }: { reasons: string }) {
  const keys = reasons.split(",").map((s) => s.trim()).filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((key) => {
        const badge = REASON_BADGE[key];
        return (
          <span
            key={key}
            className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${badge ? badge.color : "bg-gray-100 text-gray-600"}`}
          >
            {badge ? badge.label : key}
          </span>
        );
      })}
    </div>
  );
}

export default function AdminSyncPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [isConfirming, setIsConfirming] = useState<number | null>(null);

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [matches, setMatches] = useState<AdminMatch[]>([]);
  const [tab, setTab] = useState<TabType>("ALL");

  const loadStats = useCallback(async () => {
    try {
      const result = await window.api.admin.stats();
      if (result.ok) setStats(result);
    } catch {
      /* stats 로드 실패 무시 */
    }
  }, []);

  const loadMatches = useCallback(async (type?: string) => {
    try {
      const result = await window.api.admin.getMatches({
        type: type === "ALL" ? undefined : type
      });
      if (result.ok) setMatches(result.matches ?? []);
    } catch {
      /* 매칭 로드 실패 무시 */
    }
  }, []);

  useEffect(() => {
    void loadStats();
    void loadMatches(tab);
  }, [loadStats, loadMatches, tab]);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim() || isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      const result = await window.api.admin.login(username, password);
      if (result.ok) {
        setLoggedIn(true);
        toast.success("Admin 로그인 성공");
        void loadStats();
      } else {
        toast.error(result.error ?? "로그인 실패");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "로그인 실패");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await window.api.admin.sync();
      if (result.ok) {
        toast.success(
          `동기화 완료 · 전체 ${result.totalOrders ?? 0}건, 신규 ${result.newOrders ?? 0}건, 업데이트 ${result.updatedOrders ?? 0}건`
        );
        void loadStats();
      } else {
        toast.error(result.error ?? "동기화 실패");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "동기화 실패");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleMatch = async () => {
    if (isMatching) return;
    setIsMatching(true);
    try {
      const result = await window.api.admin.match();
      if (result.ok) {
        toast.success(
          `매칭 완료 · 전체 ${result.total ?? 0}건 (자동 ${result.auto ?? 0} / 수동확인 ${result.suggest ?? 0})`
        );
        void loadStats();
        void loadMatches(tab);
      } else {
        toast.error("매칭 실행 실패");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "매칭 실패");
    } finally {
      setIsMatching(false);
    }
  };

  const handleConfirm = async (matchId: number, confirm: boolean) => {
    if (isConfirming !== null) return;
    setIsConfirming(matchId);
    try {
      const result = await window.api.admin.confirmMatch(matchId, confirm);
      if (result.ok) {
        toast.success(confirm ? "매칭 확인됨" : "매칭 거부됨");
        void loadStats();
        void loadMatches(tab);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "처리 실패");
    } finally {
      setIsConfirming(null);
    }
  };

  const tabs: { key: TabType; label: string }[] = [
    { key: "ALL", label: "전체" },
    { key: "AUTO", label: "자동 매칭" },
    { key: "SUGGEST", label: "수동 확인" }
  ];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin 동기화"
        title="Veasly Admin 주문 매칭"
        description="Veasly Admin에서 주문을 동기화하고, Tracker 주문과 자동 매칭합니다."
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={handleSync}
              loading={isSyncing}
              disabled={isSyncing}
            >
              <RefreshCw className="h-4 w-4" />
              동기화
            </Button>
            <Button
              variant="primary"
              onClick={handleMatch}
              loading={isMatching}
              disabled={isMatching}
            >
              <Wand2 className="h-4 w-4" />
              매칭 실행
            </Button>
          </div>
        }
      />

      <div className="mt-8 space-y-6">
        {/* KPI + Login */}
        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiCard
              label="Admin 주문"
              value={(stats?.adminOrders ?? 0).toLocaleString("ko-KR")}
              hint="동기화된 Admin 주문 수"
              icon={ShoppingCart}
              tone="info"
            />
            <KpiCard
              label="Admin 아이템"
              value={(stats?.adminItems ?? 0).toLocaleString("ko-KR")}
              hint="Admin 주문 내 아이템 수"
              icon={Package}
              tone="default"
            />
            <KpiCard
              label="자동 매칭"
              value={(stats?.autoMatches ?? 0).toLocaleString("ko-KR")}
              hint="높은 점수로 자동 확정"
              icon={CheckCircle2}
              tone="success"
            />
            <KpiCard
              label="수동 확인"
              value={(stats?.suggestMatches ?? 0).toLocaleString("ko-KR")}
              hint="수동 확인 필요"
              icon={Layers}
              tone={stats?.suggestMatches ? "warning" : "default"}
            />
          </div>

          {!loggedIn ? (
            <Card className="flex flex-col justify-center">
              <div className="px-6 py-5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  <KeyRound className="h-4 w-4" />
                  Admin 로그인
                </div>
                <div className="mt-4 space-y-3">
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="아이디"
                  />
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="비밀번호"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleLogin();
                      }
                    }}
                  />
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => void handleLogin()}
                    loading={isLoggingIn}
                    disabled={isLoggingIn || !username.trim() || !password.trim()}
                  >
                    <LogIn className="h-4 w-4" />
                    로그인
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="flex flex-col justify-center">
              <div className="px-6 py-5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  로그인됨
                </div>
                <p className="mt-2 text-sm text-foreground-muted">
                  마지막 동기화:{" "}
                  <span className="font-semibold text-foreground">
                    {stats?.lastSync
                      ? new Date(stats.lastSync).toLocaleString("ko-KR")
                      : "기록 없음"}
                  </span>
                </p>
                <p className="mt-1 text-sm text-foreground-muted">
                  전체 매칭:{" "}
                  <span className="font-semibold text-foreground">
                    {(stats?.totalMatches ?? 0).toLocaleString("ko-KR")}건
                  </span>
                </p>
              </div>
            </Card>
          )}
        </section>

        {/* Match table */}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                매칭 결과
              </h2>
              <p className="mt-0.5 text-sm text-foreground-muted">
                Tracker 주문과 Admin 아이템 간 매칭 목록입니다.
              </p>
            </div>
            <div className="flex gap-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    tab === t.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-2 text-foreground-muted hover:bg-surface-2/80"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {matches.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={GitCompare}
                title="매칭 결과가 없습니다"
                description="동기화 후 매칭 실행을 눌러 주문을 매칭해 보세요."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-foreground-muted">
                    <th className="px-4 py-3 text-left font-semibold">점수</th>
                    <th className="px-4 py-3 text-left font-semibold">Tracker 주문</th>
                    <th className="px-4 py-3 text-left font-semibold">Admin 아이템</th>
                    <th className="px-4 py-3 text-left font-semibold">매칭 근거</th>
                    <th className="px-4 py-3 text-center font-semibold">상태</th>
                    <th className="px-4 py-3 text-center font-semibold">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {matches.map((m) => (
                    <tr key={m.id} className="hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <ScoreBar score={m.match_score} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-foreground-muted ring-1 ring-border">
                            {m.tracker_site_code}
                          </span>
                          <span className="text-xs font-semibold text-foreground">
                            {m.tracker_order_number}
                          </span>
                        </div>
                        <p className="mt-0.5 max-w-[200px] truncate text-xs text-foreground-muted">
                          {m.tracker_product_name}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-foreground">
                            {m.veasly_order_number}
                          </span>
                          <span className="text-[10px] text-foreground-muted">
                            {m.admin_item_number}
                          </span>
                        </div>
                        <p className="mt-0.5 max-w-[200px] truncate text-xs text-foreground-muted">
                          {m.admin_product_name}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <ReasonBadges reasons={m.match_reasons} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {m.confirmed === 1 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                            <CheckCircle2 className="h-3 w-3" />
                            확인됨
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold text-yellow-700">
                            대기
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {m.confirmed !== 1 && (
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleConfirm(m.id, true)}
                              disabled={isConfirming === m.id}
                              title="확인"
                            >
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleConfirm(m.id, false)}
                              disabled={isConfirming === m.id}
                              title="거부"
                            >
                              <X className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
