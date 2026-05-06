"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../lib/format";

type AppShellProps = {
  children: React.ReactNode;
  title: string;
  description?: string;
  rightSlot?: React.ReactNode;
};

const navItems = [
  {
    href: "/dashboard",
    label: "Dashboard",
    description: "통합 주문 현황"
  },
  {
    href: "/sites",
    label: "Sites",
    description: "쇼핑몰 계정 / 추출"
  }
];

export function AppShell({
  children,
  title,
  description,
  rightSlot
}: AppShellProps) {
  const pathname = usePathname();

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto flex max-w-7xl gap-6 px-6 py-8">
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-600">
                Veasly
              </p>
              <h1 className="mt-2 text-xl font-black text-slate-950">
                Tracker
              </h1>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Cross-border order extraction console
              </p>
            </div>

            <nav className="mt-8 space-y-2">
              {navItems.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "block rounded-2xl px-4 py-3 transition",
                      active
                        ? "bg-slate-900 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                    )}
                  >
                    <div className="text-sm font-bold">{item.label}</div>
                    <div
                      className={cn(
                        "mt-1 text-xs",
                        active ? "text-slate-300" : "text-slate-400"
                      )}
                    >
                      {item.description}
                    </div>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-8 rounded-2xl bg-blue-50 p-4 text-xs leading-5 text-blue-700">
              <div className="font-bold">MVP Status</div>
              <div className="mt-1">
                DB · IPC · Extractor · Orders · CSV export ready
              </div>
            </div>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-blue-600">
                Veasly Tracker
              </p>
              <h2 className="mt-2 text-3xl font-black text-slate-950">
                {title}
              </h2>
              {description ? (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  {description}
                </p>
              ) : null}
            </div>

            {rightSlot}
          </header>

          <div className="mt-8">{children}</div>
        </section>
      </div>
    </main>
  );
}
