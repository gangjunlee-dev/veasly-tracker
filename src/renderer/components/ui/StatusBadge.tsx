"use client";

import { cn } from "../../lib/format";

export type StatusTone =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral";

type StatusBadgeProps = {
  label: string;
  tone?: StatusTone;
  dot?: boolean;
  className?: string;
};

const toneStyles: Record<StatusTone, string> = {
  default:
    "bg-surface-2 text-foreground-muted ring-border",
  primary:
    "bg-primary-soft text-primary-soft-foreground ring-primary/20",
  success:
    "bg-success-soft text-success-soft-foreground ring-success/25",
  warning:
    "bg-warning-soft text-warning-soft-foreground ring-warning/25",
  danger:
    "bg-danger-soft text-danger-soft-foreground ring-danger/25",
  info:
    "bg-info-soft text-info-soft-foreground ring-info/25",
  neutral:
    "bg-foreground/5 text-foreground-muted ring-border"
};

const dotStyles: Record<StatusTone, string> = {
  default: "bg-foreground-subtle",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-foreground-subtle"
};

export function StatusBadge({
  label,
  tone = "default",
  dot,
  className
}: StatusBadgeProps) {
  return (
    <span className={cn("vt-chip", toneStyles[tone], className)}>
      {dot ? (
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 rounded-full", dotStyles[tone])}
        />
      ) : null}
      {label}
    </span>
  );
}

const shippingMap: Record<
  string,
  { label: string; tone: StatusTone }
> = {
  PAID: { label: "결제 완료", tone: "primary" },
  READY: { label: "출고 준비", tone: "info" },
  SHIPPED: { label: "배송 중", tone: "info" },
  DELIVERED: { label: "배송 완료", tone: "success" },
  PENDING: { label: "대기", tone: "warning" },
  PAYMENT_ERROR: { label: "결제 오류", tone: "danger" },
  CANCELLED: { label: "취소", tone: "neutral" }
};

export function ShippingStatusBadge({
  status,
  dot = true
}: {
  status?: string | null;
  dot?: boolean;
}) {
  const entry = status ? shippingMap[status] : undefined;
  return (
    <StatusBadge
      label={entry?.label ?? status ?? "정보 없음"}
      tone={entry?.tone ?? "neutral"}
      dot={dot}
    />
  );
}

const warehouseMap: Record<string, { label: string; tone: StatusTone }> = {
  SCANNED: { label: "스캔됨", tone: "info" },
  MATCHED: { label: "매칭 완료", tone: "success" },
  UNMATCHED: { label: "미매칭", tone: "warning" },
  DUPLICATE: { label: "중복 스캔", tone: "neutral" },
  ISSUE: { label: "이슈", tone: "danger" },
  IGNORED: { label: "제외", tone: "neutral" }
};

export function WarehouseStatusBadge({
  status,
  dot = true
}: {
  status?: string | null;
  dot?: boolean;
}) {
  const entry = status ? warehouseMap[status] : undefined;
  return (
    <StatusBadge
      label={entry?.label ?? status ?? "정보 없음"}
      tone={entry?.tone ?? "neutral"}
      dot={dot}
    />
  );
}

const extractionMap: Record<string, { label: string; tone: StatusTone }> = {
  running: { label: "실행 중", tone: "info" },
  success: { label: "성공", tone: "success" },
  failed: { label: "실패", tone: "danger" },
  cancelled: { label: "취소", tone: "neutral" }
};

export function ExtractionStatusBadge({
  status,
  dot = true
}: {
  status?: string | null;
  dot?: boolean;
}) {
  const entry = status ? extractionMap[status] : undefined;
  return (
    <StatusBadge
      label={entry?.label ?? status ?? "-"}
      tone={entry?.tone ?? "neutral"}
      dot={dot}
    />
  );
}
