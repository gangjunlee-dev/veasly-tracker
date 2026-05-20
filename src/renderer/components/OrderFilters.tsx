"use client";

import { Search, X } from "lucide-react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input, Select } from "./ui/Input";

export type OrderFilterState = {
  search: string;
  status: string;
  siteId: string;
  fromDate: string;
  toDate: string;
};

type SiteOption = {
  id: number;
  name: string;
  code: string;
};

type OrderFiltersProps = {
  value: OrderFilterState;
  onChange: (value: OrderFilterState) => void;
  sites?: SiteOption[];
  showSiteFilter?: boolean;
  resultCount?: number;
  totalCount?: number;
};

const statusOptions = [
  { label: "전체 상태", value: "ALL" },
  { label: "결제 완료", value: "PAID" },
  { label: "출고 준비", value: "READY" },
  { label: "배송 중", value: "SHIPPED" },
  { label: "배송 완료", value: "DELIVERED" },
  { label: "대기", value: "PENDING" },
  { label: "결제 오류", value: "PAYMENT_ERROR" },
  { label: "취소", value: "CANCELLED" }
];

export const defaultOrderFilters: OrderFilterState = {
  search: "",
  status: "ALL",
  siteId: "ALL",
  fromDate: "",
  toDate: ""
};

export function OrderFilters({
  value,
  onChange,
  sites = [],
  showSiteFilter = false,
  resultCount,
  totalCount
}: OrderFiltersProps) {
  const update = (patch: Partial<OrderFilterState>) =>
    onChange({ ...value, ...patch });

  const reset = () => onChange(defaultOrderFilters);

  const showReset =
    value.search ||
    value.status !== "ALL" ||
    value.siteId !== "ALL" ||
    value.fromDate ||
    value.toDate;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <Input
              value={value.search}
              placeholder="주문번호, 상품명, 송장번호 검색"
              onChange={(event) => update({ search: event.target.value })}
              className="pl-9"
            />
          </div>
        </div>

        <Select
          value={value.status}
          onChange={(event) => update({ status: event.target.value })}
          className="w-36"
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        {showSiteFilter && (
          <Select
            value={value.siteId}
            onChange={(event) => update({ siteId: event.target.value })}
            className="w-48"
          >
            <option value="ALL">전체 쇼핑몰</option>
            {sites.map((site) => (
              <option key={site.id} value={String(site.id)}>
                {site.name}
              </option>
            ))}
          </Select>
        )}

        <Input
          type="date"
          value={value.fromDate}
          onChange={(event) => update({ fromDate: event.target.value })}
          className="w-40"
          aria-label="시작일"
        />
        <span className="self-center text-foreground-subtle">~</span>
        <Input
          type="date"
          value={value.toDate}
          onChange={(event) => update({ toDate: event.target.value })}
          className="w-40"
          aria-label="종료일"
        />

        {showReset && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <X className="h-3.5 w-3.5" />
            초기화
          </Button>
        )}

        {typeof resultCount === "number" && typeof totalCount === "number" && (
          <span className="ml-auto text-sm text-foreground-muted">
            <span className="font-semibold text-foreground">
              {resultCount.toLocaleString("ko-KR")}
            </span>{" "}
            / {totalCount.toLocaleString("ko-KR")} 건
          </span>
        )}
      </div>
    </Card>
  );
}
