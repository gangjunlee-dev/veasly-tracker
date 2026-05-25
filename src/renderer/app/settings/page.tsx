"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Database,
  Globe,
  KeyRound,
  ShieldCheck,
  ShoppingBag
} from "lucide-react";
import { AppShell } from "../../components/AppShell";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";

type Site = {
  id: number;
  enabled: boolean;
};

export default function SettingsPage() {
  const [siteCount, setSiteCount] = useState(0);
  const [enabledCount, setEnabledCount] = useState(0);
  const [appVersion, setAppVersion] = useState<string>("-");
  const [adminConnected, setAdminConnected] = useState(false);
  const [adminUsername, setAdminUsername] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [sites, version, adminStatus] = await Promise.all([
        window.api.sites.list(),
        window.api.app.getVersion(),
        window.api.admin.status()
      ]);
      const list = sites as Site[];
      setSiteCount(list.length);
      setEnabledCount(list.filter((site) => site.enabled).length);
      setAppVersion(String(version));
      setAdminConnected(adminStatus.tokenValid);
      setAdminUsername(adminStatus.username);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const tiles = [
    {
      href: "/settings/admin",
      icon: Globe,
      title: "Admin 연동",
      description: "admin.veasly.com 계정을 연결하여 주문 동기화를 활성화합니다.",
      stat: adminConnected
        ? `연결됨 · ${adminUsername ?? ""}`
        : "미연결"
    },
    {
      href: "/settings/sites",
      icon: ShoppingBag,
      title: "쇼핑몰 계정 관리",
      description: "등록된 쇼핑몰 추가·편집·삭제를 한 화면에서 관리합니다.",
      stat: `등록 ${siteCount}곳 · 활성 ${enabledCount}곳`
    }
  ];

  return (
    <AppShell>
      <PageHeader
        eyebrow="설정"
        title="운영 환경 설정"
        description="쇼핑몰 계정과 앱 정보를 관리합니다."
      />

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link key={tile.href} href={tile.href} className="group block">
              <Card className="h-full transition group-hover:border-primary group-hover:shadow-elevated">
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                      <Icon className="h-5 w-5" strokeWidth={2.25} />
                    </span>
                    <ArrowRight className="h-4 w-4 text-foreground-subtle transition group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-foreground">
                    {tile.title}
                  </h3>
                  <p className="mt-1 text-sm text-foreground-muted">
                    {tile.description}
                  </p>
                  <p className="mt-4 text-xs font-semibold text-primary">
                    {tile.stat}
                  </p>
                </div>
              </Card>
            </Link>
          );
        })}

        <Card className="md:col-span-2">
          <div className="p-6">
            <h3 className="text-base font-semibold text-foreground">
              보안 및 저장소
            </h3>
            <p className="mt-1 text-sm text-foreground-muted">
              계정 정보와 데이터가 어떻게 보관되는지에 관한 정보입니다.
            </p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2">
              <li className="flex items-start gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-success-soft text-success-soft-foreground">
                  <KeyRound className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    AES-256-GCM 암호화
                  </p>
                  <p className="text-xs text-foreground-muted">
                    모든 쇼핑몰 비밀번호는 마스터 키로 암호화 저장됩니다.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-info-soft text-info-soft-foreground">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    OS 키체인 보관
                  </p>
                  <p className="text-xs text-foreground-muted">
                    마스터 키는 macOS 키체인 / Windows 자격증명 관리자에 안전하게 저장됩니다.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                  <Database className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    로컬 SQLite 저장소
                  </p>
                  <p className="text-xs text-foreground-muted">
                    모든 주문/입고 데이터는 사용자 PC의 로컬 DB에만 보관됩니다.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning-soft text-warning-soft-foreground">
                  <Database className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Veasly Tracker
                  </p>
                  <p className="text-xs text-foreground-muted">버전 {appVersion}</p>
                </div>
              </li>
            </ul>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
