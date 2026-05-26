"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Boxes,
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
  List,
  PackageSearch,
  Settings,
  type LucideIcon,
  Zap
} from "lucide-react";
import { cn } from "../lib/format";

type AppShellProps = {
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
};

const navItems: NavItem[] = [
  {
    href: "/",
    label: "홈",
    description: "오늘의 작업",
    icon: LayoutDashboard,
    match: (pathname) => pathname === "/"
  },
  {
    href: "/orders",
    label: "주문",
    description: "전체 주문 조회 / CSV",
    icon: ClipboardList
  },
  {
    href: "/extract",
    label: "주문 가져오기",
    description: "쇼핑몰별 자동 추출",
    icon: Zap
  },
  {
    href: "/warehouse",
    label: "입고 & 매칭",
    description: "스캔 → 매칭 → 동기화 한 번에",
    icon: PackageSearch,
    match: (pathname) =>
      pathname === "/warehouse" || pathname === "/warehouse/scan"
  },
  {
    href: "/warehouse/items",
    label: "동기화 목록",
    description: "Admin 주문 아이템 전체",
    icon: List,
    match: (pathname) => pathname === "/warehouse/items"
  },
  {
    href: "/warehouse/audit",
    label: "감사 로그",
    description: "매칭 이력 / 동기화 검증",
    icon: FileText,
    match: (pathname) => pathname === "/warehouse/audit"
  },
  {
    href: "/history",
    label: "추출 이력",
    description: "실행 로그 / 결과",
    icon: History
  },
  {
    href: "/settings",
    label: "설정",
    description: "쇼핑몰 계정 관리",
    icon: Settings
  }
];

function isActive(pathname: string, item: NavItem) {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

type SyncIndicatorState = {
  connected: boolean | null; // null = 확인 중
  lastSyncedAt: string | null;
  totalItems: number;
};

function SyncStatusIndicator() {
  const [state, setState] = useState<SyncIndicatorState>({
    connected: null,
    lastSyncedAt: null,
    totalItems: 0,
  });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const [adminStatus, syncStatus] = await Promise.all([
          window.api?.admin?.status?.(),
          window.api?.admin?.syncStatus?.(),
        ]);
        if (cancelled) return;
        setState({
          connected: adminStatus?.tokenValid ?? false,
          lastSyncedAt: syncStatus?.lastSyncedAt ?? null,
          totalItems: syncStatus?.totalItems ?? 0,
        });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, connected: false }));
      }
    }

    void check();
    const interval = setInterval(check, 60_000); // 1분마다 갱신
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const dotColor =
    state.connected === null
      ? "bg-foreground-subtle animate-pulse"
      : state.connected
        ? "bg-success"
        : "bg-danger";

  const label =
    state.connected === null
      ? "확인 중..."
      : state.connected
        ? "연결됨"
        : "미연결";

  const timeStr = state.lastSyncedAt
    ? (() => {
        const d = new Date(state.lastSyncedAt);
        if (Number.isNaN(d.getTime())) return state.lastSyncedAt;
        return new Intl.DateTimeFormat("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(d);
      })()
    : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor)} />
        <span className="text-[11px]">{label}</span>
      </div>
      {state.connected && timeStr ? (
        <p className="text-[10px] tabular-nums text-accent-foreground/40">
          Sync {timeStr} · {state.totalItems}건
        </p>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    window.api?.app
      ?.getVersion?.()
      .then((value) => {
        if (!cancelled) setAppVersion(String(value));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-accent text-accent-foreground lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5 px-6 pb-4 pt-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft">
            <Boxes className="h-5 w-5" strokeWidth={2.25} />
          </span>
          <div>
            <p className="text-sm font-bold leading-tight">Veasly Tracker</p>
            <p className="text-[11px] leading-tight text-accent-foreground/60">
              주문·입고 운영 콘솔
            </p>
          </div>
        </div>

        <nav className="mt-2 flex-1 space-y-1 px-3">
          {navItems.map((item) => {
            const active = isActive(pathname ?? "", item);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-start gap-3 rounded-xl px-3 py-2.5 transition",
                  active
                    ? "bg-white/10 text-white"
                    : "text-accent-foreground/70 hover:bg-white/5 hover:text-white"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-white/5 text-accent-foreground/70 group-hover:bg-white/10 group-hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={2.25} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span
                    className={cn(
                      "block truncate text-[11px]",
                      active ? "text-white/70" : "text-accent-foreground/50"
                    )}
                  >
                    {item.description}
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-6 py-4 text-[11px] text-accent-foreground/50">
          <SyncStatusIndicator />
          <div className="mt-2 pt-2 border-t border-white/5">
            <p className="font-semibold text-accent-foreground/80">
              Veasly Tracker
            </p>
            <p className="tabular-nums">
              {appVersion ? `v${appVersion}` : "·"} · 로컬 SQLite 보관
            </p>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}
