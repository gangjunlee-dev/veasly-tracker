"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../../../components/AppShell";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge } from "../../../components/ui/StatusBadge";

type Site = {
  id: number;
  code: string;
  name: string;
  username: string;
  enabled: boolean;
  lastExtractedAt?: string | null;
};

type ExtractorInfo = {
  code: string;
  name: string;
};

function formatRelative(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export default function SettingsSitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [extractors, setExtractors] = useState<ExtractorInfo[]>([]);

  const extractorByCode = useMemo(
    () => new Map(extractors.map((e) => [e.code, e])),
    [extractors]
  );

  const load = useCallback(async () => {
    try {
      const [siteList, extractorList] = await Promise.all([
        window.api.sites.list(),
        window.api.extractor.available()
      ]);
      setSites(siteList as Site[]);
      setExtractors(extractorList as ExtractorInfo[]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "사이트를 불러오지 못했습니다."
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="설정 / 쇼핑몰"
        title="쇼핑몰 계정 관리"
        description="추출 대상 쇼핑몰의 로그인 정보를 안전하게 등록·편집·삭제합니다."
        actions={
          <Link href="/settings/sites/new">
            <Button variant="primary">
              <Plus className="h-4 w-4" />
              새 쇼핑몰 등록
            </Button>
          </Link>
        }
      />

      <div className="mt-8">
        <Card>
          {sites.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={ShoppingBag}
                title="등록된 쇼핑몰이 없습니다"
                description="자동 추출을 시작하려면 먼저 쇼핑몰 계정을 등록하세요."
                action={
                  <Link href="/settings/sites/new">
                    <Button variant="primary">
                      <Plus className="h-4 w-4" />
                      첫 쇼핑몰 등록
                    </Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {sites.map((site) => {
                const extractor = extractorByCode.get(site.code);
                const lastRun = formatRelative(site.lastExtractedAt);
                return (
                  <li key={site.id}>
                    <Link
                      href={`/settings/sites/${site.id}`}
                      className="flex items-center gap-4 px-6 py-4 transition hover:bg-surface-2"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                        <ShoppingBag className="h-5 w-5" strokeWidth={2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-base font-semibold text-foreground">
                            {site.name}
                          </span>
                          {site.enabled ? (
                            <StatusBadge label="활성" tone="success" dot />
                          ) : (
                            <StatusBadge label="비활성" tone="neutral" />
                          )}
                          {!extractor && (
                            <StatusBadge label="추출기 없음" tone="warning" />
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-foreground-muted">
                          {site.username} · {extractor?.name ?? site.code}
                        </p>
                      </div>
                      <div className="hidden text-right text-xs text-foreground-muted sm:block">
                        {lastRun ? `최근 추출 ${lastRun}` : "추출 기록 없음"}
                      </div>
                      <ChevronRight className="h-4 w-4 text-foreground-subtle" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
