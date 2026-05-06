"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "../../../../components/AppShell";
import {
  SiteDetailHeader,
  type SiteDetailHeaderSite
} from "../../../../components/SiteDetailHeader";
import { SiteSettingsForm } from "../../../../components/SiteSettingsForm";

export default function SiteSettingsPage() {
  const params = useParams<{ siteId: string }>();
  const siteId = Number(params.siteId);

  const [site, setSite] = useState<SiteDetailHeaderSite | null>(null);
  const [message, setMessage] = useState("");

  const loadSite = useCallback(async () => {
    try {
      const sites = (await window.api.sites.list()) as SiteDetailHeaderSite[];
      const found = sites.find((item) => item.id === siteId) ?? null;

      setSite(found);

      if (!found) {
        setMessage(`Site not found: ${siteId}`);
      } else {
        setMessage("Settings loaded");
      }
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Failed to load settings");
    }
  }, [siteId]);

  useEffect(() => {
    if (Number.isFinite(siteId)) {
      void loadSite();
    }
  }, [siteId, loadSite]);

  return (
    <AppShell
      title="Site Settings"
      description="쇼핑몰 계정 정보, 비밀번호, 활성화 상태를 관리합니다."
    >
      {message ? (
        <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm font-medium text-blue-800">
          {message}
        </div>
      ) : null}

      {!site ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
          Loading site settings...
        </div>
      ) : (
        <div className="space-y-6">
          <SiteDetailHeader site={site} showExtract={false} />

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <SiteSettingsForm site={site} />

            <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">Security Notes</h2>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <p>
                  비밀번호는 평문으로 저장하지 않고 AES-256-GCM으로 암호화합니다.
                </p>
                <p>
                  master key는 keytar를 통해 OS Credential Manager에 저장됩니다.
                </p>
                <p>
                  Renderer에는 비밀번호나 암호문을 노출하지 않습니다.
                </p>
              </div>

              <div className="mt-6 grid gap-2">
                <Link
                  href={`/sites/${site.id}`}
                  className="rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-bold text-white hover:bg-slate-700"
                >
                  View Site Detail
                </Link>

                <Link
                  href="/sites"
                  className="rounded-xl border border-slate-200 px-4 py-3 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Back to Sites
                </Link>
              </div>
            </aside>
          </div>
        </div>
      )}
    </AppShell>
  );
}