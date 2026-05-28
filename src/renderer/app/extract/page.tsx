"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, ShoppingBag, Zap } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "../../components/AppShell";
import {
  ExtractionProgressPanel,
  type ProgressItem
} from "../../components/ExtractionProgressPanel";
import { SiteCard, type SiteCardSite } from "../../components/SiteCard";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

type ExtractorInfo = {
  code: string;
  name: string;
  version?: string;
  enabled?: boolean;
  description?: string;
  loginUrl?: string;
  ordersUrl?: string;
};

export default function ExtractPage() {
  const [sites, setSites] = useState<SiteCardSite[]>([]);
  const [extractors, setExtractors] = useState<ExtractorInfo[]>([]);
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);
  const [runningRunId, setRunningRunId] = useState<string | null>(null);

  const extractorByCode = useMemo(
    () => new Map(extractors.map((extractor) => [extractor.code, extractor])),
    [extractors]
  );

  const loadData = useCallback(async () => {
    try {
      const [siteList, extractorList] = await Promise.all([
        window.api.sites.list(),
        window.api.extractor.available()
      ]);
      setSites(siteList as SiteCardSite[]);
      setExtractors(extractorList as ExtractorInfo[]);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "사이트 정보를 불러오지 못했습니다."
      );
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const unsubscribe = window.api.extractor.onProgress((progress) => {
      const item = progress as ProgressItem;
      setProgressItems((current) => [item, ...current].slice(0, 30));

      if (
        item.phase === "success" ||
        item.phase === "error" ||
        item.phase === "failed" ||
        item.phase === "cancelled"
      ) {
        setRunningRunId(null);

        if (item.phase === "success") {
          toast.success(item.message ?? "주문 추출이 완료되었습니다.");
          // 추출 성공 후 sites를 다시 가져와 lastExtractedAt을 화면에 반영.
          void loadData();
        } else {
          toast.error(item.message ?? "추출 실행 중 문제가 발생했습니다.");
        }
      }
    });

    return () => unsubscribe();
  }, [loadData]);

  const handleExtract = async (siteId: number) => {
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;

    try {
      const result = (await window.api.extractor.run({ siteId })) as {
        runId: string;
        alreadyRunning?: boolean;
      };

      if (result.alreadyRunning) {
        toast.warning(`${site.name} 추출이 이미 실행 중입니다.`);
        return;
      }

      setRunningRunId(result.runId);
      setProgressItems((current) => [
        {
          runId: result.runId,
          siteId,
          phase: "queued",
          message: `${site.name} 추출 작업을 대기열에 등록했습니다.`
        },
        ...current
      ]);
      toast.success(`${site.name} 추출을 시작했습니다.`);
    } catch (error) {
      console.error(error);
      setRunningRunId(null);
      toast.error(
        error instanceof Error
          ? error.message
          : "추출 실행에 실패했습니다."
      );
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="주문 가져오기"
        title="쇼핑몰별 자동 추출"
        description="등록된 쇼핑몰에서 주문·송장 데이터를 자동으로 수집합니다. 추출기는 사이트 코드(code)에 따라 자동 매칭됩니다."
        actions={
          <Link href="/settings/sites/new">
            <Button variant="secondary">
              <Plus className="h-4 w-4" />
              쇼핑몰 추가
            </Button>
          </Link>
        }
      />

      <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_400px]">
        <Card>
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-base font-semibold text-foreground">
              등록된 쇼핑몰 ({sites.length})
            </h2>
            <p className="mt-0.5 text-sm text-foreground-muted">
              카드의 &lsquo;지금 추출&rsquo; 버튼을 누르면 해당 쇼핑몰의 최근 주문을 수집합니다.
            </p>
          </div>

          {sites.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={ShoppingBag}
                title="아직 등록된 쇼핑몰이 없습니다"
                description="추출을 시작하려면 먼저 쇼핑몰 계정을 등록해 주세요."
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
            <div className="grid gap-4 p-6 md:grid-cols-2">
              {sites.map((site) => (
                <SiteCard
                  key={site.id}
                  site={site}
                  extractor={extractorByCode.get(site.code)}
                  isRunning={Boolean(runningRunId)}
                  onExtract={handleExtract}
                />
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <ExtractionProgressPanel
            items={progressItems}
            runningRunId={runningRunId}
            onClear={() => setProgressItems([])}
          />

          <Card className="p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                <Zap className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  특정 옵션으로 추출하려면
                </h3>
                <p className="mt-1 text-xs leading-5 text-foreground-muted">
                  사이트 카드의 톱니바퀴 아이콘을 누르면 기간·페이지 수·배경 실행
                  같은 세부 옵션을 지정할 수 있습니다.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
