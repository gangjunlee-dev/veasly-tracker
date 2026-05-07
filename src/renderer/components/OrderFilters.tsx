"use client";

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
  { label: "All", value: "ALL" },
  { label: "결제완료", value: "PAID" },
  { label: "출고준비", value: "READY" },
  { label: "배송중", value: "SHIPPED" },
  { label: "배송완료", value: "DELIVERED" },
  { label: "대기", value: "PENDING" },
  { label: "결제오류", value: "PAYMENT_ERROR" },
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
  const update = (patch: Partial<OrderFilterState>) => {
    onChange({
      ...value,
      ...patch
    });
  };

  const reset = () => {
    onChange(defaultOrderFilters);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Order Filters</h2>
          <p className="mt-1 text-sm text-slate-500">
            주문번호, 상품명, 상태, 사이트, 기간으로 주문을 필터링합니다.
          </p>
        </div>

        <div className="text-right text-xs text-slate-500">
          {typeof resultCount === "number" && typeof totalCount === "number" ? (
            <span>
              Showing <span className="font-bold text-slate-900">{resultCount}</span> /{" "}
              <span className="font-bold text-slate-900">{totalCount}</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1.4fr_0.9fr_0.9fr_0.9fr_0.9fr_auto]">
        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Search
          </label>
          <input
            value={value.search}
            placeholder="Order no. or product"
            onChange={(event) => update({ search: event.target.value })}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
          />
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Status
          </label>
          <select
            value={value.status}
            onChange={(event) => update({ status: event.target.value })}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {showSiteFilter ? (
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Site
            </label>
            <select
              value={value.siteId}
              onChange={(event) => update({ siteId: event.target.value })}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
            >
              <option value="ALL">All Sites</option>
              {sites.map((site) => (
                <option key={site.id} value={String(site.id)}>
                  {site.name} ({site.code})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="hidden lg:block" />
        )}

        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            From
          </label>
          <input
            type="date"
            value={value.fromDate}
            onChange={(event) => update({ fromDate: event.target.value })}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
          />
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            To
          </label>
          <input
            type="date"
            value={value.toDate}
            onChange={(event) => update({ toDate: event.target.value })}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
          />
        </div>

        <div className="flex items-end">
          <button
            type="button"
            onClick={reset}
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Reset
          </button>
        </div>
      </div>
    </section>
  );
}