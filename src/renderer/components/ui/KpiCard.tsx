"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/format";

type KpiTone = "default" | "primary" | "success" | "warning" | "danger" | "info";

type KpiCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: KpiTone;
  trend?: {
    label: string;
    direction?: "up" | "down" | "flat";
  };
};

const toneStyles: Record<
  KpiTone,
  { icon: string; chip: string }
> = {
  default: {
    icon: "bg-surface-2 text-foreground-muted",
    chip: "bg-surface-2 text-foreground-muted"
  },
  primary: {
    icon: "bg-primary-soft text-primary-soft-foreground",
    chip: "bg-primary-soft text-primary-soft-foreground"
  },
  success: {
    icon: "bg-success-soft text-success-soft-foreground",
    chip: "bg-success-soft text-success-soft-foreground"
  },
  warning: {
    icon: "bg-warning-soft text-warning-soft-foreground",
    chip: "bg-warning-soft text-warning-soft-foreground"
  },
  danger: {
    icon: "bg-danger-soft text-danger-soft-foreground",
    chip: "bg-danger-soft text-danger-soft-foreground"
  },
  info: {
    icon: "bg-info-soft text-info-soft-foreground",
    chip: "bg-info-soft text-info-soft-foreground"
  }
};

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  trend
}: KpiCardProps) {
  const styles = toneStyles[tone];

  return (
    <div className="vt-card flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          {label}
        </span>
        {Icon ? (
          <span
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl",
              styles.icon
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={2.25} />
          </span>
        ) : null}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-foreground">
          {value}
        </span>
        {trend ? (
          <span
            className={cn(
              "text-xs font-semibold",
              trend.direction === "up" && "text-success-soft-foreground",
              trend.direction === "down" && "text-danger-soft-foreground",
              (!trend.direction || trend.direction === "flat") &&
                "text-foreground-muted"
            )}
          >
            {trend.label}
          </span>
        ) : null}
      </div>

      {hint ? (
        <span className="text-xs text-foreground-muted">{hint}</span>
      ) : null}
    </div>
  );
}
