"use client";

import { useState, type FormEvent } from "react";

type AddSiteFormProps = {
  onCreated: () => Promise<void> | void;
};

const mallPresets = [
  {
    label: "Demo",
    code: "demo",
    name: "Demo Mall",
    username: "demo-user"
  },
  {
    label: "Cafe24",
    code: "cafe24",
    name: "Cafe24 Mall",
    username: ""
  },
  {
    label: "SmartStore",
    code: "naver-smartstore",
    name: "Naver SmartStore",
    username: ""
  },
  {
    label: "Coupang",
    code: "coupang",
    name: "Coupang Wing",
    username: ""
  },
  {
    label: "Shopee TW",
    code: "shopee-tw",
    name: "Shopee Taiwan",
    username: ""
  }
];

export function AddSiteForm({ onCreated }: AddSiteFormProps) {
  const [code, setCode] = useState("demo");
  const [name, setName] = useState("Demo Mall");
  const [username, setUsername] = useState("demo-user");
  const [password, setPassword] = useState("demo-password");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const applyPreset = (preset: (typeof mallPresets)[number]) => {
    setCode(preset.code);
    setName(preset.name);
    setUsername(preset.username);
    setPassword(preset.code === "demo" ? "demo-password" : "");
    setEnabled(true);
    setMessage(`${preset.label} preset applied`);
  };

  const resetForm = () => {
    setCode("");
    setName("");
    setUsername("");
    setPassword("");
    setEnabled(true);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cleanCode = code.trim().toLowerCase();
    const cleanName = name.trim();
    const cleanUsername = username.trim();
    const cleanPassword = password.trim();

    if (!cleanCode || !cleanName || !cleanUsername || !cleanPassword) {
      setMessage("Code, mall name, username, password are required.");
      return;
    }

    setSaving(true);
    setMessage("Creating site...");

    try {
      await window.api.sites.create({
        code: cleanCode,
        name: cleanName,
        username: cleanUsername,
        password: cleanPassword,
        enabled
      });

      setMessage(`Site created: ${cleanName}`);
      resetForm();
      await onCreated();
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : "Failed to create site");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Add Site</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          쇼핑몰 계정을 등록합니다. 비밀번호는 main process에서 AES-256-GCM으로
          암호화되어 저장됩니다.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {mallPresets.map((preset) => (
          <button
            key={preset.code}
            type="button"
            onClick={() => applyPreset(preset)}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {message ? (
        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
          {message}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
        <div>
          <label className="text-sm font-bold text-slate-700">Mall Code</label>
          <input
            value={code}
            placeholder="demo, cafe24, coupang..."
            onChange={(event) => setCode(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
          />
          <p className="mt-1 text-xs text-slate-400">
            Extractor folder code와 매칭됩니다. 예: src/main/extractors/demo
          </p>
        </div>

        <div>
          <label className="text-sm font-bold text-slate-700">Mall Name</label>
          <input
            value={name}
            placeholder="Demo Mall"
            onChange={(event) => setName(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
          />
        </div>

        <div>
          <label className="text-sm font-bold text-slate-700">Username</label>
          <input
            value={username}
            placeholder="seller@example.com"
            onChange={(event) => setUsername(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
          />
        </div>

        <div>
          <label className="text-sm font-bold text-slate-700">Password</label>
          <input
            type="password"
            value={password}
            placeholder="Password"
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-blue-100 focus:ring-4"
          />
        </div>

        <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <div className="text-sm font-bold text-slate-800">Enabled</div>
            <div className="mt-1 text-xs text-slate-500">
              활성화된 사이트만 extractor 실행이 가능합니다.
            </div>
          </div>

          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-5 w-5 accent-slate-900"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={resetForm}
            className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Reset
          </button>

          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create Site"}
          </button>
        </div>
      </form>
    </section>
  );
}