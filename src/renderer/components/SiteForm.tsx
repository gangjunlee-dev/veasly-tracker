"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/Button";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from "./ui/Card";
import { Field, Input } from "./ui/Input";

type ExtractorInfo = {
  code: string;
  name: string;
  description?: string;
  version?: string;
};

type Site = {
  id: number;
  code: string;
  name: string;
  username: string;
  enabled: boolean;
};

type SiteFormProps = {
  mode: "create" | "edit";
  initialSite?: Site;
  extractors: ExtractorInfo[];
  onSaved?: (site: Site) => void;
};

export function SiteForm({
  mode,
  initialSite,
  extractors,
  onSaved
}: SiteFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit" && Boolean(initialSite);

  const [code, setCode] = useState(initialSite?.code ?? extractors[0]?.code ?? "");
  const [name, setName] = useState(initialSite?.name ?? "");
  const [username, setUsername] = useState(initialSite?.username ?? "");
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(initialSite?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!isEdit && extractors.length > 0 && !code) {
      setCode(extractors[0].code);
    }
  }, [extractors, code, isEdit]);

  const selectedExtractor = extractors.find((e) => e.code === code);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cleanName = name.trim();
    const cleanUsername = username.trim();
    const cleanPassword = password.trim();

    if (!code || !cleanName || !cleanUsername) {
      toast.error("쇼핑몰, 표시 이름, 사용자명은 필수입니다.");
      return;
    }

    if (!isEdit && !cleanPassword) {
      toast.error("새 쇼핑몰 등록에는 비밀번호가 필요합니다.");
      return;
    }

    setSaving(true);
    try {
      if (isEdit && initialSite) {
        const updated = (await window.api.sites.update({
          id: initialSite.id,
          name: cleanName,
          username: cleanUsername,
          password: cleanPassword || undefined,
          enabled
        })) as Site;

        toast.success(`${updated.name} 정보를 저장했습니다.`);
        setPassword("");
        onSaved?.(updated);
        router.refresh();
      } else {
        const created = (await window.api.sites.create({
          code,
          name: cleanName,
          username: cleanUsername,
          password: cleanPassword,
          enabled
        })) as Site;

        toast.success(`${created.name} 을 등록했습니다.`);
        onSaved?.(created);
        router.push("/settings/sites");
      }
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || !initialSite) return;
    const ok = window.confirm(
      `${initialSite.name} 사이트를 삭제하시겠습니까?\n이 사이트로 수집된 모든 주문도 함께 삭제됩니다.`
    );
    if (!ok) return;

    setDeleting(true);
    try {
      await window.api.sites.delete({ id: initialSite.id });
      toast.success(`${initialSite.name} 을 삭제했습니다.`);
      router.push("/settings/sites");
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "삭제에 실패했습니다."
      );
      setDeleting(false);
    }
  };

  const handleResetSession = async () => {
    if (!isEdit || !initialSite) return;
    const ok = window.confirm(
      `${initialSite.name} 의 로그인 세션을 초기화하시겠습니까?\n` +
        "저장된 쿠키와 브라우저 프로필이 삭제되어, 다음 추출 시 새 계정으로 로그인할 수 있습니다.\n" +
        "(주문 데이터는 그대로 유지됩니다)"
    );
    if (!ok) return;

    setResetting(true);
    try {
      await window.api.sites.resetSession({ id: initialSite.id });
      toast.success(
        `${initialSite.name} 세션을 초기화했습니다. 다음 추출 시 새 로그인 화면이 열립니다.`
      );
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "세션 초기화에 실패했습니다."
      );
    } finally {
      setResetting(false);
    }
  };

  return (
    <Card>
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <div>
            <CardTitle>
              {isEdit ? "쇼핑몰 정보 편집" : "새 쇼핑몰 등록"}
            </CardTitle>
            <p className="mt-0.5 text-sm text-foreground-muted">
              비밀번호는 AES-256-GCM으로 암호화되어 OS 키체인에 저장된 마스터 키로
              보호됩니다.
            </p>
          </div>
        </CardHeader>

        <CardBody className="grid gap-5">
          <Field
            label="쇼핑몰 종류"
            hint={
              selectedExtractor?.description ??
              "추출기는 쇼핑몰 코드에 따라 자동 매칭됩니다."
            }
            required
          >
            <select
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={isEdit}
              className="vt-input cursor-pointer appearance-none pr-9"
            >
              {extractors.length === 0 && (
                <option value="">사용 가능한 추출기가 없습니다</option>
              )}
              {extractors.map((extractor) => (
                <option key={extractor.code} value={extractor.code}>
                  {extractor.name} ({extractor.code})
                </option>
              ))}
            </select>
          </Field>

          <Field label="표시 이름" hint="목록에 보일 이름입니다." required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="예: 무신사 메인 계정"
            />
          </Field>

          <Field label="사용자명 / 이메일" required>
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="seller@example.com"
              autoComplete="username"
            />
          </Field>

          <Field
            label={isEdit ? "새 비밀번호" : "비밀번호"}
            hint={
              isEdit
                ? "비밀번호를 변경하려면 입력하세요. 비워두면 기존 비밀번호가 유지됩니다."
                : "쇼핑몰 로그인 비밀번호"
            }
            required={!isEdit}
          >
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isEdit ? "변경하지 않으려면 비워두세요" : "비밀번호"}
              autoComplete="new-password"
            />
          </Field>

          {isEdit && (
            <div className="rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-xs leading-5 text-info-soft-foreground">
              <p className="font-semibold">사용자명·비밀번호 변경 안내</p>
              <p className="mt-1">
                계정 정보를 바꾸면 저장된 브라우저 세션이 자동으로 초기화됩니다.
                다음 추출 시 새 계정 정보로 다시 로그인이 진행됩니다.
              </p>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border"
            />
            <span>
              <span className="block text-sm font-semibold text-foreground">
                활성화
              </span>
              <span className="mt-0.5 block text-xs text-foreground-muted">
                활성화된 쇼핑몰만 자동 추출을 실행할 수 있습니다.
              </span>
            </span>
          </label>

          {isEdit && (
            <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    저장된 로그인 세션 초기화
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-foreground-muted">
                    이전 계정으로 자동 로그인되는 문제가 있을 때 사용하세요.
                    쿠키와 브라우저 프로필을 삭제해 다음 추출 시 새 로그인을 강제합니다.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleResetSession}
                  loading={resetting}
                  disabled={resetting}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  세션 초기화
                </Button>
              </div>
            </div>
          )}
        </CardBody>

        <CardFooter className="justify-between">
          {isEdit ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleDelete}
              loading={deleting}
              disabled={deleting}
            >
              <Trash2 className="h-3.5 w-3.5" />
              사이트 삭제
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={saving}
          >
            <Save className="h-4 w-4" />
            {isEdit ? "변경 사항 저장" : "쇼핑몰 등록"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
