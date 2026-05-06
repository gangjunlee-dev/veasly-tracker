"use client";

import { useEffect, useState } from "react";
import type { Site } from "../../shared/api";

export default function HomePage() {
  const [pingResult, setPingResult] = useState<string>("checking...");
  const [sites, setSites] = useState<Site[]>([]);
  const [status, setStatus] = useState<string>("ready");

  async function refreshSites() {
    const result = await window.api.sites.list();
    setSites(result);
  }

  async function createDemoSite() {
    setStatus("creating demo site...");

    const timestamp = Date.now();

    await window.api.sites.create({
      code: "demo",
      name: `Demo Mall ${timestamp}`,
      username: `demo-${timestamp}`,
      password: "demo-password",
      enabled: true
    });

    await refreshSites();
    setStatus("demo site created");
  }

  useEffect(() => {
    async function bootstrap() {
      try {
        if (typeof window !== "undefined" && window.api?.app?.ping) {
          const result = await window.api.app.ping();
          setPingResult(result);
          await refreshSites();
        } else {
          setPingResult("window.api is not available yet");
        }
      } catch (error) {
        setPingResult(error instanceof Error ? error.message : "unknown error");
      }
    }

    void bootstrap();
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-8 py-16">
        <div className="rounded-2xl border bg-card p-8 shadow-sm">
          <div className="mb-6 inline-flex rounded-full border px-3 py-1 text-sm text-muted-foreground">
            Veasly Tracker · Phase 1
          </div>

          <h1 className="text-4xl font-bold tracking-tight">
            Veasly Tracker
          </h1>

          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            Electron + Next.js + SQLite + AES vault IPC smoke test.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border p-4">
              <div className="text-sm text-muted-foreground">Electron IPC</div>
              <div className="mt-2 font-medium">{pingResult}</div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-sm text-muted-foreground">DB Sites</div>
              <div className="mt-2 font-medium">{sites.length} site(s)</div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-sm text-muted-foreground">Status</div>
              <div className="mt-2 font-medium">{status}</div>
            </div>
          </div>

          <div className="mt-8 flex gap-3">
            <button
              type="button"
              onClick={createDemoSite}
              className="rounded-lg bg-black px-4 py-2 text-white dark:bg-white dark:text-black"
            >
              Create Demo Site
            </button>

            <button
              type="button"
              onClick={refreshSites}
              className="rounded-lg border px-4 py-2"
            >
              Refresh Sites
            </button>
          </div>

          <div className="mt-8 overflow-hidden rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  <th className="p-3">ID</th>
                  <th className="p-3">Code</th>
                  <th className="p-3">Name</th>
                  <th className="p-3">Username</th>
                  <th className="p-3">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.id} className="border-b">
                    <td className="p-3">{site.id}</td>
                    <td className="p-3">{site.code}</td>
                    <td className="p-3">{site.name}</td>
                    <td className="p-3">{site.username}</td>
                    <td className="p-3">{site.enabled ? "Y" : "N"}</td>
                  </tr>
                ))}

                {sites.length === 0 ? (
                  <tr>
                    <td className="p-3 text-muted-foreground" colSpan={5}>
                      No sites yet. Click Create Demo Site.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
