/**
 * URL → (siteCode, sourceOrderRef) 추출.
 *
 * Dataset A(admin의 purchase_url)와 Dataset B(추출기 결과)를
 * 같은 키로 비교하기 위한 정규화 단계. 순수 함수만 둔다.
 */

export type OrderRef = {
  siteCode: string;
  ref: string;
};

type SiteRule = {
  siteCode: string;
  matchHost: (hostname: string) => boolean;
  extract: (url: URL) => string | null;
};

const lastPathSegment = (url: URL): string | null => {
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  return last ? decodeURIComponent(last) : null;
};

const SITE_RULES: SiteRule[] = [
  {
    siteCode: "musinsa",
    matchHost: (h) => h.endsWith("musinsa.com"),
    extract: lastPathSegment
  },
  {
    siteCode: "bunjang",
    matchHost: (h) => h.endsWith("bunjang.co.kr"),
    extract: lastPathSegment
  },
  {
    siteCode: "29cm",
    matchHost: (h) => h.endsWith("29cm.co.kr"),
    extract: lastPathSegment
  },
  {
    siteCode: "oliveyoung",
    matchHost: (h) => h.endsWith("oliveyoung.co.kr"),
    extract: (url) => url.searchParams.get("ordNo")
  },
  {
    siteCode: "naverpay",
    matchHost: (h) =>
      h === "pay.naver.com" ||
      h === "orders.pay.naver.com" ||
      h.endsWith(".pay.naver.com"),
    extract: lastPathSegment
  }
];

export function extractOrderRef(input: string | null | undefined): OrderRef | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const rule = SITE_RULES.find((r) => r.matchHost(host));
  if (!rule) return null;

  const ref = rule.extract(url);
  if (!ref) return null;

  const cleaned = ref.trim();
  if (!cleaned) return null;

  return { siteCode: rule.siteCode, ref: cleaned };
}
