"use client";

export type ExtractionLogRow = {
  id: number;
  siteId: number;
  siteName?: string;
  siteCode?: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
  totalOrders: number;
  newOrders: number;
  updatedOrders: number;
  savedOrders: number;
  errorStack: string | null;
  createdAt: string;
};

type ExtractionLogTableProps = {
  logs: ExtractionLogRow[];
  total: number;
  title?: string;
  onRefresh: () => void;
};

function getStatusClass(status: string) {
  switch (status) {
    case "running":
      return "bg-blue-50 text-blue-700";
    case "success":
      return "bg-green-50 text-green-700";
    case "failed":
      return "bg-rose-50 text-rose-700";
    case "cancelled":
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case "running":
      return "실행중";
    case "success":
      return "성공";
    case "failed":
      return "실패";
    case "cancelled":
      return "취소";
    default:
      return status;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getDuration(startedAt?: string | null, finishedAt?: string | null) {
  if (!startedAt || !finishedAt) return "-";

  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return "-";
  }

  const seconds = Math.round((end - start) / 1000);

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  return `${minutes}m ${rest}s`;
}

export function ExtractionLogTable({
  logs,
  total,
  title = "Extraction Logs",
  onRefresh
}: ExtractionLogTableProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Total {total} log(s)
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh Logs
        </button>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-slate-600">
                  Log ID
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-slate-600">
                  Site
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-slate-600">
                  Status
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-bold text-slate-600">
                  Total
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-bold text-slate-600">
                  New
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-bold text-slate-600">
                  Updated
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-slate-600">
                  Started
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-slate-600">
                  Duration
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-bold text-slate-600">
                  Message
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    아직 추출 로그가 없습니다.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">
                      #{log.id}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      <div className="font-semibold text-slate-900">
                        {log.siteName ?? `Site ${log.siteId}`}
                      </div>
                      <div className="text-xs text-slate-500">
                        {log.siteCode ?? "-"}
                      </div>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${getStatusClass(
                          log.status
                        )}`}
                      >
                        {getStatusLabel(log.status)}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right font-bold text-slate-900">
                      {log.totalOrders}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                      {log.newOrders}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                      {log.updatedOrders}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {formatDateTime(log.startedAt)}
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                      {getDuration(log.startedAt, log.finishedAt)}
                    </td>

                    <td className="min-w-72 px-4 py-3 text-slate-600">
                      <div className="line-clamp-2">
                        {log.status === "failed"
                          ? log.errorStack || log.message || "-"
                          : log.message || "-"}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}