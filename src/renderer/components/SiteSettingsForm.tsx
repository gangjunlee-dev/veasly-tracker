"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SiteSettingsFormSite = {
  id: number;
  code: string;
  name: string;
  username: string;
  enabled: boolean;
};

type SiteSettingsFormProps = {
  site: SiteSettingsFormSite;
};

export function SiteSettingsForm({ site }: SiteSettingsFormProps) {
  const router = useRouter();

  const [name, setName] = useState(site.name);
  const [username, setUsername] = useState(site.username);
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(site.enabled);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setMessage("Saving...");

    try {
      await window.api.sites.update({
        id: site.id,
        name,
        username,
        password: password.trim() ? password : undefined,
        enabled
      } as any);

      setPassword("");
      setMessage("Site settings saved");
      router.refresh();
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Failed to save site");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const ok = window.confirm(
      `Delete ${site.name}? This will also remove related orders.`
    );

    if (!ok) return;

    setDeleting(true);
    setMessage("Deleting...");

    try {
      await window.api.sites.delete({ id: site.id } as any);
      router.push("/sites");
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Failed to delete site");
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Site Settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          쇼핑몰 계정 정보를 수정합니다. 비밀번호는 입력한 경우에만 재암호화 저장됩니다.
        </p>
      </div>

      {message ? (
        <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
          {message}
        </div>
      ) : null}

      <div className="mt-6 grid gap-5">
        <div>
          <label className="text-sm font-bold text-slate-700">Site Code</label>
          <input
            value={site.code}
            disabled
            className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500"
          />
          <p className="mt-1 text-xs text-slate-400">
            Code는 extractor 매칭 키라서 현재 UI에서는 수정하지 않습니다.
          </p>
        </div>

        <div>
          <label className="text-sm font-bold text-slate-700">Mall Name</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
          />
        </div>

        <div>
          <label className="text-sm font-bold text-slate-700">Username</label>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
          />
        </div>

        <div>
          <label className="text-sm font-bold text-slate-700">
            New Password
          </label>
          <input
            type="password"
            value={password}
            placeholder="Leave blank to keep current password"
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
          />
          <p className="mt-1 text-xs text-slate-400">
            저장 시 AES-256-GCM으로 암호화되고, master key는 keytar에 보관됩니다.
          </p>
        </div>

        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <div className="text-sm font-bold text-slate-800">Enabled</div>
            <div className="mt-1 text-xs text-slate-500">
              꺼져 있으면 extractor 실행 버튼이 비활성화됩니다.
            </div>
          </div>

          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-5 w-5 accent-slate-900"
          />
        </label>

        <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-5">
          <button
            type="button"
            disabled={deleting}
            onClick={handleDelete}
            className="rounded-xl border border-rose-200 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete Site"}
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
