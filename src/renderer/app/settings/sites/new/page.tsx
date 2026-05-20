"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "../../../../components/AppShell";
import { Button } from "../../../../components/ui/Button";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { SiteForm } from "../../../../components/SiteForm";

type ExtractorInfo = {
  code: string;
  name: string;
  description?: string;
  version?: string;
};

export default function NewSitePage() {
  const [extractors, setExtractors] = useState<ExtractorInfo[]>([]);

  const load = useCallback(async () => {
    const list = (await window.api.extractor.available()) as ExtractorInfo[];
    setExtractors(list);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="설정 / 쇼핑몰"
        title="새 쇼핑몰 등록"
        description="등록한 정보는 로컬 DB와 OS 키체인에만 보관됩니다."
        actions={
          <Link href="/settings/sites">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
              목록으로
            </Button>
          </Link>
        }
      />

      <div className="mt-8 max-w-2xl">
        <SiteForm mode="create" extractors={extractors} />
      </div>
    </AppShell>
  );
}
