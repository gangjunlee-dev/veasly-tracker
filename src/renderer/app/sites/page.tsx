"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AddSiteForm } from "../../components/AddSiteForm";
import { AppShell } from "../../components/AppShell";
import {
  ExtractionProgressPanel,
  type ProgressItem
} from "../../components/ExtractionProgressPanel";
import { SiteCard, type SiteCardSite } from "../../components/SiteCard";

type ExtractorInfo = {
  code: string;
  name: string;
  version?: string;
  enabled?: boolean;
  description?: string;
  loginUrl?: string;
  ordersUrl?: string;
};

export default function SitesPage() {
  const [ping, setPing] = useState("checking...");
  const [sites, setSites] = useState<SiteCardSite[]>([]);
  const [extractors, setExtractors] = useState<ExtractorInfo[]>([]);
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);
  const [runningRunId, setRunningRunId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const extractorByCode = useMemo(() => {
    return new Map(extractors.map((extractor) => [extractor.code, extractor]));
  }, [extractors]);

  const loadData = useCallback(async () => {
    try {
      const [pong, siteList, extractorList] = await Promise.all([
        window.api.app.ping(),
        window.api.sites.list(),
        window.api.extractor.available()
      ]);

      setPing(String(pong));
      setSites(siteList as SiteCardSite[]);
      setExtractors(extractorList as ExtractorInfo[]);
      setStatusMessage("Sites loaded");
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error ? error.message : "Failed to load sites");
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
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleCreateDemoSite = async () => {
    setStatusMessage("Creating demo site...");

    try {
      const suffix = Date.now();

      await window.api.sites.create({
        code: "demo",
        name: `Demo Mall ${suffix}`,
        username: `demo-${suffix}`,
        password: "demo-password",
        enabled: true
      });

      await loadData();
      setStatusMessage("Demo site created");
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error ? error.message : "Failed to create demo site");
    }
  };

  const handleExtract = async (siteId: number) => {
    setStatusMessage("Starting extractor...");

    try {
      const result = (await window.api.extractor.run({ siteId })) as { runId: string };

      setRunningRunId(result.runId);
      setProgressItems((current) => [
        {
          runId: result.runId,
          siteId,
          phase: "queued",
          message: "Extraction job queued"
        },
        ...current
      ]);

      setStatusMessage(`Extractor started: ${result.runId}`);
    } catch (error) {
      console.error(error);
      setRunningRunId(null);
      setStatusMessage(error instanceof Error ? error.message : "Failed to run extractor");
    }
  };

  return (
    <AppShell
      title="Sites"
      description="쇼핑몰 계정을 관리하고 사이트별 extractor를 실행합니다."
      rightSlot={
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-right shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-400">
            Electron IPC
          </div>
          <div className="mt-1 font-mono text-sm font-bold text-emerald-700">
            {ping}
          </div>
        </div>
      }
    >
      {statusMessage ? (
        <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm font-medium text-blue-800">
          {statusMessage}
        </div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Registered Sites</h2>
              <p className="mt-1 text-sm text-slate-500">
                등록된 쇼핑몰 계정과 연결 가능한 extractor입니다.
              </p>
            </div>

            <button
              type="button"
              onClick={handleCreateDemoSite}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Quick Demo Site
            </button>
          </div>

          {sites.length === 0 ? (
            <div className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">
              사이트가 없습니다. 오른쪽 Add Site 폼으로 계정을 등록하세요.
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
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
        </div>

        <div className="space-y-6">
          <AddSiteForm onCreated={loadData} />

          <ExtractionProgressPanel
            items={progressItems}
            runningRunId={runningRunId}
            onClear={() => setProgressItems([])}
          />
        </div>
      </section>
    </AppShell>
  );
}