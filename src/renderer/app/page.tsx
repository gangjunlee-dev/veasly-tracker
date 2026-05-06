"use client";

import { useEffect, useState } from "react";

export default function HomePage() {
  const [pingResult, setPingResult] = useState<string>("checking...");

  useEffect(() => {
    async function runPing() {
      try {
        if (typeof window !== "undefined" && window.api?.app?.ping) {
          const result = await window.api.app.ping();
          setPingResult(result);
        } else {
          setPingResult("window.api is not available yet");
        }
      } catch (error) {
        setPingResult(error instanceof Error ? error.message : "unknown error");
      }
    }

    runPing();
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-8 py-16">
        <div className="rounded-2xl border bg-card p-8 shadow-sm">
          <div className="mb-6 inline-flex rounded-full border px-3 py-1 text-sm text-muted-foreground">
            Veasly Tracker · Phase 0
          </div>

          <h1 className="text-4xl font-bold tracking-tight">
            Veasly Tracker
          </h1>

          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            Electron + Next.js desktop app bootstrap is running.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border p-4">
              <div className="text-sm text-muted-foreground">Electron IPC</div>
              <div className="mt-2 font-medium">{pingResult}</div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-sm text-muted-foreground">Renderer</div>
              <div className="mt-2 font-medium">Next.js 14 App Router</div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-sm text-muted-foreground">Security</div>
              <div className="mt-2 font-medium">
                contextIsolation enabled
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
