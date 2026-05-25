/**
 * admin.veasly.com NextAuth 인증 모듈.
 *
 * 인증 흐름 (shipping/routes.ts 로직을 Electron 네이티브로 이식):
 * 1. GET  /api/auth/csrf             → csrfToken + 쿠키
 * 2. POST /api/auth/callback/credentials → 로그인 + 세션 쿠키
 * 3. GET  /api/auth/session           → accessToken 획득
 */

import log from "electron-log";

const logger = log.scope("admin-auth");

const ADMIN_BASE = "https://admin.veasly.com";

export interface AdminAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expires?: string;
}

/**
 * admin.veasly.com에 로그인하여 accessToken을 획득합니다.
 */
export async function loginToAdmin(
  username: string,
  password: string
): Promise<AdminAuthTokens> {
  // 1) CSRF 토큰
  logger.info("[Auth] Step 1/3: CSRF 토큰 요청 →", ADMIN_BASE);
  const csrfRes = await fetch(`${ADMIN_BASE}/api/auth/csrf`);
  if (!csrfRes.ok) {
    throw new Error(`CSRF 요청 실패 (HTTP ${csrfRes.status})`);
  }
  const csrfData = (await csrfRes.json()) as { csrfToken: string };
  const csrfToken = csrfData.csrfToken;
  const csrfCookies = extractCookies(csrfRes);
  logger.info("[Auth] Step 1/3: CSRF 토큰 획득 완료");

  // 2) NextAuth 로그인
  logger.info("[Auth] Step 2/3: NextAuth 로그인 중...", username);
  const loginRes = await fetch(
    `${ADMIN_BASE}/api/auth/callback/credentials`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: csrfCookies,
      },
      body: new URLSearchParams({
        providerId: username,
        password,
        redirect: "false",
        csrfToken,
        callbackUrl: `${ADMIN_BASE}/auth/sign-in`,
        json: "true",
      }).toString(),
      redirect: "manual",
    }
  );

  const loginCookies = extractCookies(loginRes);
  const allCookies = mergeCookies(csrfCookies, loginCookies);

  logger.info(`[Auth] Step 2/3: 로그인 응답 HTTP ${loginRes.status}`);

  // 3) 세션에서 accessToken 획득
  logger.info("[Auth] Step 3/3: 세션 토큰 획득 중...");
  const sessionRes = await fetch(`${ADMIN_BASE}/api/auth/session`, {
    headers: { Cookie: allCookies },
  });

  const session = (await sessionRes.json()) as {
    account?: { accessToken?: string; refreshToken?: string };
    expires?: string;
  };

  if (!session?.account?.accessToken) {
    logger.error("[Auth] accessToken 없음 — 세션 응답:", JSON.stringify(session).slice(0, 200));
    throw new Error(
      "로그인은 성공했으나 accessToken을 받지 못했습니다. 계정 정보를 확인해주세요."
    );
  }

  logger.info("[Auth] 로그인 성공, 만료:", session.expires ?? "unknown");
  return {
    accessToken: session.account.accessToken,
    refreshToken: session.account.refreshToken,
    expires: session.expires,
  };
}

function extractCookies(res: Response): string {
  const raw = (res.headers as any).getSetCookie?.() ?? [];
  return raw.map((s: string) => s.split(";")[0]).join("; ");
}

function mergeCookies(a: string, b: string): string {
  return [a, b].filter(Boolean).join("; ");
}
