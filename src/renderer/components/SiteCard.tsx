"use client";

import Link from "next/link";
import { ExternalLink, Play, Settings2 } from "lucide-react";
import { Button } from "./ui/Button";
import { StatusBadge } from "./ui/StatusBadge";

export type SiteCardSite = {
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
  version?: string;
  description?: string;
};

type SiteCardProps = {
  site: SiteCardSite;
  extractor?: ExtractorInfo;
  isRunning: boolean;
  onExtract: (siteId: number) => void;
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

export function SiteCard({ site, extractor, isRunning, onExtract }: SiteCardProps) {
  const hasExtractor = Boolean(extractor);
  const canRun = site.enabled && hasExtractor && !isRunning;
  const lastRun = formatRelative(site.lastExtractedAt);

  return (
    <div className="vt-card flex flex-col">
      <div className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-foreground">
              {site.name}
            </h3>
            {site.enabled ? (
              <StatusBadge label="활성" tone="success" dot />
            ) : (
              <StatusBadge label="비활성" tone="neutral" />
            )}
          </div>
          <p className="mt-1 truncate text-xs text-foreground-muted">
            {site.username}
          </p>
        </div>

        {extractor ? (
          <span className="vt-chip bg-primary-soft text-primary-soft-foreground ring-primary/20">
            v{extractor.version ?? "0.0.0"}
          </span>
        ) : (
          <span className="vt-chip bg-warning-soft text-warning-soft-foreground ring-warning/25">
            추출기 없음
          </span>
        )}
      </div>

      <div className="flex-1 border-y border-border bg-surface-2 px-5 py-3 text-xs text-foreground-muted">
        {lastRun ? (
          <p>
            최근 추출{" "}
            <span className="font-semibold text-foreground">{lastRun}</span>
          </p>
        ) : (
          <p>아직 추출 기록이 없습니다.</p>
        )}
        {extractor?.description && (
          <p className="mt-1 line-clamp-2 text-[11px] text-foreground-subtle">
            {extractor.description}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 p-3">
        <Button
          variant="primary"
          className="flex-1"
          disabled={!canRun}
          onClick={() => onExtract(site.id)}
        >
          <Play className="h-3.5 w-3.5" />
          {isRunning ? "실행 중…" : "지금 추출"}
        </Button>
        <Link
          href={`/extract/${site.id}`}
          title="상세 옵션"
          className="vt-button-secondary px-3"
        >
          <Settings2 className="h-4 w-4" />
        </Link>
        <Link
          href={`/settings/sites/${site.id}`}
          title="사이트 설정"
          className="vt-button-ghost px-3"
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
