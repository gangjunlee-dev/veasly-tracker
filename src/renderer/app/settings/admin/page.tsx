"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Cloud,
  Download,
  Globe,
  Loader2,
  LogOut,
  Package,
  RefreshCw,
  XCircle
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../../../components/AppShell";
import { Card, CardBody, CardFooter, CardHeader, CardTitle, CardDescription } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { Button } from "../../../components/ui/Button";
import { Field, Input } from "../../../components/ui/Input";
import { StatusBadge } from "../../../components/ui/StatusBadge";

type AdminStatus = {
  hasCredentials: boolean;
  username: string | null;
  hasToken: boolean;
  tokenValid: boolean;
  expires: string | null;
};

type SyncStatus = {
  totalOrders: number;
  totalItems: number;
  byStatus: Record<string, number>;
  byWarehouse: Record<string, number>;
  lastSyncedAt: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  PAYMENT_COMPLETED: "결제 완료",
  ORDER_PROCESSING: "주문 처리중",
  SHIPPING_TO_BDJ: "배대지 배송중",
  SHIPPING_TO_HOME: "해외 배송중",
  DELIVERED: "배송 완료",
  COMPLETED: "완료",
  UNKNOWN: "알 수 없음",
};

export default function AdminSettingsPage() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // 입력 폼
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Ops 연동
  const [opsUrl, setOpsUrl] = useState("");
  const [opsApiKey, setOpsApiKey] = useState("");
  const [opsHasConfig, setOpsHasConfig] = useState(false);
  const [opsSaving, setOpsSaving] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const [s, ss, opsConfig] = await Promise.all([
        window.api.admin.status(),
        window.api.admin.syncStatus(),
        window.api.admin.getOpsConfig(),
      ]);
      setStatus(s);
      setSyncStatus(ss);
      if (s.username) {
        setUsername(s.username);
      }
      if (opsConfig.opsUrl) setOpsUrl(opsConfig.opsUrl);
      setOpsHasConfig(opsConfig.hasConfig);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // 자격증명 저장
  const handleSave = async () => {
    if (!username.trim() || !password.trim()) {
      toast.error("아이디와 비밀번호를 모두 입력해주세요.");
      return;
    }

    setSaving(true);
    try {
      await window.api.admin.saveCredentials({
        username: username.trim(),
        password: password.trim(),
      });
      setPassword("");
      toast.success("자격증명 저장 완료. 연결 테스트 중...");

      // 저장 후 바로 로그인 시도
      const loginResult = await window.api.admin.login();
      if (loginResult.ok) {
        toast.success("admin.veasly.com 연결 성공!");
      } else {
        toast.warning("자격증명은 저장됐지만 로그인 실패: " + (loginResult.error ?? ""));
      }

      await loadStatus();
    } catch (err) {
      toast.error("저장 실패: " + String(err));
    } finally {
      setSaving(false);
    }
  };

  // 연결 테스트 (로그인 + 토큰 검증)
  const handleLogin = async () => {
    setLoggingIn(true);
    const startTime = Date.now();
    try {
      const result = await window.api.admin.login();
      const elapsed = Date.now() - startTime;
      if (result.ok) {
        toast.success(
          `admin.veasly.com 연결 성공! (${elapsed}ms)`,
          { description: `만료: ${result.expires ?? "알 수 없음"}` }
        );
        await loadStatus();
      } else {
        toast.error("연결 실패", {
          description: result.error ?? "알 수 없는 오류",
          duration: 8000,
        });
      }
    } catch (err) {
      toast.error("연결 오류", {
        description: String(err),
        duration: 8000,
      });
    } finally {
      setLoggingIn(false);
    }
  };

  // 로그아웃
  const handleLogout = async () => {
    try {
      await window.api.admin.logout();
      setUsername("");
      setPassword("");
      toast.success("연결이 해제되었습니다.");
      await loadStatus();
    } catch (err) {
      toast.error("로그아웃 실패: " + String(err));
    }
  };

  // 주문 동기화
  const handleSync = async () => {
    setSyncing(true);
    const startTime = Date.now();
    try {
      console.log("[Sync] 동기화 시작...");
      const result = await window.api.admin.sync() as any;
      const elapsed = Date.now() - startTime;
      if (result.ok) {
        const opsMsg = result.opsPush?.ok
          ? ` → Ops 푸시 완료`
          : result.opsPush
            ? ` → Ops 푸시 실패`
            : "";
        const msg = `동기화 완료 (${elapsed}ms): ${result.fetched ?? 0}건 조회, ${result.created ?? 0}건 신규, ${result.updated ?? 0}건 업데이트${opsMsg}`;
        console.log(`[Sync] ${msg}`);
        if (result.errors && result.errors.length > 0) {
          console.warn(`[Sync] 오류 ${result.errors.length}건:`, result.errors);
        }
        toast.success(msg, {
          description: result.errors?.length
            ? `${result.errors.length}건 오류 (DevTools 확인)`
            : undefined,
        });
        await loadStatus();
      } else {
        console.error(`[Sync] 동기화 실패:`, result.error);
        toast.error("동기화 실패", {
          description: result.error ?? "알 수 없는 오류",
          duration: 8000,
        });
      }
    } catch (err) {
      console.error("[Sync] 동기화 예외:", err);
      toast.error("동기화 오류", {
        description: String(err),
        duration: 8000,
      });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-foreground-muted" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="설정"
        title="Admin 연동"
        description="admin.veasly.com 계정을 연결하여 마스터 주문 데이터와 동기화합니다."
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* 연결 상태 카드 */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>연결 상태</CardTitle>
              <CardDescription>admin.veasly.com 인증 상태</CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground-muted">자격증명</span>
                {status?.hasCredentials ? (
                  <StatusBadge label="저장됨" tone="success" dot />
                ) : (
                  <StatusBadge label="미설정" tone="warning" dot />
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground-muted">토큰</span>
                {status?.tokenValid ? (
                  <StatusBadge label="유효" tone="success" dot />
                ) : status?.hasToken ? (
                  <StatusBadge label="만료됨" tone="danger" dot />
                ) : (
                  <StatusBadge label="없음" tone="neutral" dot />
                )}
              </div>
              {status?.username ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground-muted">계정</span>
                  <span className="text-sm font-medium text-foreground">
                    {status.username}
                  </span>
                </div>
              ) : null}
              {status?.expires ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground-muted">만료</span>
                  <span className="text-sm tabular-nums text-foreground-muted">
                    {status.expires}
                  </span>
                </div>
              ) : null}
            </div>

            {/* 연결 상태 요약 */}
            <div className="mt-6 flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-3">
              {status?.tokenValid ? (
                <>
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">연결됨</p>
                    <p className="text-xs text-foreground-muted">
                      admin.veasly.com과 정상 통신 중입니다.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 shrink-0 text-foreground-subtle" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">미연결</p>
                    <p className="text-xs text-foreground-muted">
                      자격증명을 입력하고 연결 테스트를 진행해주세요.
                    </p>
                  </div>
                </>
              )}
            </div>
          </CardBody>
          <CardFooter>
            {status?.hasCredentials ? (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleLogin}
                  loading={loggingIn}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  연결 테스트
                </Button>
                <Button variant="ghost" size="sm" onClick={handleLogout}>
                  <LogOut className="mr-1.5 h-3.5 w-3.5" />
                  연결 해제
                </Button>
              </div>
            ) : null}
          </CardFooter>
        </Card>

        {/* 자격증명 입력 카드 */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>계정 설정</CardTitle>
              <CardDescription>
                admin.veasly.com 로그인에 사용하는 아이디와 비밀번호를 입력합니다.
                비밀번호는 AES-256-GCM으로 암호화되어 OS 키체인에 안전하게 저장됩니다.
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              <Field label="아이디" required>
                <Input
                  type="text"
                  placeholder="admin@veasly.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field
                label="비밀번호"
                required
                hint={
                  status?.hasCredentials
                    ? "이미 저장된 비밀번호가 있습니다. 변경하려면 새로 입력하세요."
                    : undefined
                }
              >
                <Input
                  type="password"
                  placeholder={status?.hasCredentials ? "********" : "비밀번호 입력"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            </div>
          </CardBody>
          <CardFooter>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              disabled={!username.trim() || !password.trim()}
            >
              <Globe className="mr-1.5 h-3.5 w-3.5" />
              {status?.hasCredentials ? "자격증명 업데이트" : "자격증명 저장"}
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* 동기화 현황 */}
      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>주문 동기화</CardTitle>
            <CardDescription>
              admin.veasly.com의 배송 대기 주문을 로컬에 캐시합니다.
            </CardDescription>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSync}
            loading={syncing}
            disabled={!status?.hasCredentials}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {syncing ? "동기화 중..." : "지금 동기화"}
          </Button>
        </CardHeader>
        <CardBody>
          {syncStatus && syncStatus.totalOrders > 0 ? (
            <div className="space-y-4">
              {/* 요약 수치 */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl bg-surface-2 px-4 py-3 text-center">
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {syncStatus.totalOrders}
                  </p>
                  <p className="text-xs text-foreground-muted">주문</p>
                </div>
                <div className="rounded-xl bg-surface-2 px-4 py-3 text-center">
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {syncStatus.totalItems}
                  </p>
                  <p className="text-xs text-foreground-muted">아이템</p>
                </div>
                <div className="rounded-xl bg-surface-2 px-4 py-3 text-center">
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {syncStatus.byWarehouse["PENDING"] ?? 0}
                  </p>
                  <p className="text-xs text-foreground-muted">입고 대기</p>
                </div>
              </div>

              {/* 상태별 분포 */}
              {Object.keys(syncStatus.byStatus).length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                    주문 상태 분포
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(syncStatus.byStatus).map(
                      ([key, count]) => (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1 text-xs"
                        >
                          <Package className="h-3 w-3 text-foreground-subtle" />
                          <span className="text-foreground-muted">
                            {STATUS_LABELS[key] ?? key}
                          </span>
                          <span className="font-semibold tabular-nums text-foreground">
                            {count}
                          </span>
                        </span>
                      )
                    )}
                  </div>
                </div>
              ) : null}

              {/* 마지막 동기화 */}
              {syncStatus.lastSyncedAt ? (
                <p className="text-xs text-foreground-muted">
                  마지막 동기화:{" "}
                  <span className="tabular-nums">
                    {syncStatus.lastSyncedAt}
                  </span>
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Package className="h-8 w-8 text-foreground-subtle" />
              <p className="text-sm text-foreground-muted">
                {status?.tokenValid
                  ? "아직 동기화된 주문이 없습니다. 위의 버튼을 눌러 시작하세요."
                  : "Admin에 연결한 후 주문을 동기화할 수 있습니다."}
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Ops 연동 */}
      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>Ops 연동</CardTitle>
            <CardDescription>
              동기화 데이터를 veasly-ops에 자동 푸시합니다. 다른 PC에서도 주문 현황을 볼 수 있습니다.
            </CardDescription>
          </div>
          {opsHasConfig ? (
            <StatusBadge label="설정됨" tone="success" dot />
          ) : (
            <StatusBadge label="미설정" tone="neutral" dot />
          )}
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            <Field label="Ops URL" hint="예: https://veasly-ops.pages.dev">
              <Input
                type="url"
                placeholder="https://veasly-ops.pages.dev"
                value={opsUrl}
                onChange={(e) => setOpsUrl(e.target.value)}
              />
            </Field>
            <Field
              label="API Key"
              hint={opsHasConfig ? "이미 저장된 키가 있습니다." : undefined}
            >
              <Input
                type="password"
                placeholder={opsHasConfig ? "********" : "API Key 입력"}
                value={opsApiKey}
                onChange={(e) => setOpsApiKey(e.target.value)}
              />
            </Field>
          </div>
        </CardBody>
        <CardFooter>
          <Button
            variant="primary"
            size="sm"
            loading={opsSaving}
            disabled={!opsUrl.trim() || !opsApiKey.trim()}
            onClick={async () => {
              setOpsSaving(true);
              try {
                await window.api.admin.saveOpsConfig({
                  opsUrl: opsUrl.trim(),
                  opsApiKey: opsApiKey.trim(),
                });
                setOpsApiKey("");
                setOpsHasConfig(true);
                toast.success("Ops 연동 설정 저장 완료");
              } catch (err) {
                toast.error("저장 실패: " + String(err));
              } finally {
                setOpsSaving(false);
              }
            }}
          >
            <Cloud className="mr-1.5 h-3.5 w-3.5" />
            {opsHasConfig ? "설정 업데이트" : "설정 저장"}
          </Button>
          {opsHasConfig ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  toast.info("Ops로 데이터 전송 중...");
                  const result = await window.api.admin.pushToOps();
                  if (result.ok) {
                    toast.success(
                      `Ops 전송 완료: ${result.created ?? 0}건 신규, ${result.updated ?? 0}건 업데이트`
                    );
                  } else {
                    toast.error("Ops 전송 실패: " + (result.error ?? ""));
                  }
                } catch (err) {
                  toast.error("전송 오류: " + String(err));
                }
              }}
            >
              <Cloud className="mr-1.5 h-3.5 w-3.5" />
              지금 전송
            </Button>
          ) : null}
        </CardFooter>
      </Card>

      {/* 안내 */}
      <Card className="mt-6">
        <CardBody>
          <h3 className="text-sm font-semibold text-foreground">작동 방식</h3>
          <ul className="mt-3 space-y-2 text-sm text-foreground-muted">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary-soft text-xs font-bold text-primary-soft-foreground">
                1
              </span>
              <span>
                <strong className="text-foreground">자격증명 저장</strong> — 아이디/비밀번호가 AES-256-GCM으로 암호화되어 OS 키체인에 보관됩니다.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary-soft text-xs font-bold text-primary-soft-foreground">
                2
              </span>
              <span>
                <strong className="text-foreground">자동 로그인</strong> — 앱 시작 시 저장된 자격증명으로 자동 로그인하여 accessToken을 획득합니다.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary-soft text-xs font-bold text-primary-soft-foreground">
                3
              </span>
              <span>
                <strong className="text-foreground">토큰 갱신</strong> — 토큰이 만료되면 저장된 자격증명으로 자동 재로그인합니다.
              </span>
            </li>
          </ul>
        </CardBody>
      </Card>
    </AppShell>
  );
}
