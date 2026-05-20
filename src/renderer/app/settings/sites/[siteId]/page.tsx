"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Zap } from "lucide-react";
import { AppShell } from "../../../../components/AppShell";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { SiteForm } from "../../../../components/SiteForm";

type Site = {
  id: number;
  code: string;
  name: string;
  username: string;
  enabled: boolean;
};

type ExtractorInfo = {
  code: string;
  name: string;
  description?: string;
  version?: string;
};

export default function EditSitePage() {
  const params = useParams<{ siteId: string }>();
  const siteId = Number(params.siteId);

  const [site, setSite] = useState<Site | null>(null);
  const [extractors, setExtractors] = useState<ExtractorInfo[]>([]);

  const load = useCallback(async () => {
    const [sites, extractorList] = await Promise.all([
      window.api.sites.list(),
      window.api.extractor.available()
    ]);
    const found = (sites as Site[]).find((s) => s.id === siteId) ?? null;
    setSite(found);
    setExtractors(extractorList as ExtractorInfo[]);
  }, [siteId]);

  useEffect(() => {
    if (Number.isFinite(siteId)) {
      void load();
    }
  }, [siteId, load]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="설정 / 쇼핑몰"
        title={site?.name ?? "쇼핑몰 편집"}
        description={
          site
            ? `${site.code} · ${site.username}`
            : "사이트 정보를 불러오는 중…"
        }
        actions={
          <>
            <Link href="/settings/sites">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" />
                목록으로
              </Button>
            </Link>
            {site && (
              <Link href={`/extract/${site.id}`}>
                <Button variant="secondary" size="sm">
                  <Zap className="h-4 w-4" />
                  주문 가져오기
                </Button>
              </Link>
            )}
          </>
        }
      />

      <div className="mt-8 max-w-2xl">
        {site ? (
          <SiteForm mode="edit" initialSite={site} extractors={extractors} />
        ) : (
          <Card className="p-6 text-sm text-foreground-muted">
            사이트를 불러오고 있습니다…
          </Card>
        )}
      </div>
    </AppShell>
  );
}
