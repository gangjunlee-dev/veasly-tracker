import { extractSourceOrderNumberFromUrl } from "./parser";

export type DetailLink = {
  url: string;
  text: string;
};

export function normalizeExtractionDateInput(value?: string): string | undefined {
  if (!value) return undefined;

  const trimmed = String(value).trim();
  const match = trimmed.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})/);

  if (!match) return undefined;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function orderDateKeyFromSourceOrderNumber(
  sourceOrderNumber: string
): string | undefined {
  const match = String(sourceOrderNumber ?? "").match(/^(\d{4})(\d{2})(\d{2})/);

  if (!match) return undefined;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function isSourceOrderNumberInDateRange(
  sourceOrderNumber: string,
  since?: string,
  until?: string
): boolean {
  const orderDate = orderDateKeyFromSourceOrderNumber(sourceOrderNumber);
  const sinceDate = normalizeExtractionDateInput(since);
  const untilDate = normalizeExtractionDateInput(until);

  if (!orderDate) return true;
  if (sinceDate && orderDate < sinceDate) return false;
  if (untilDate && orderDate > untilDate) return false;

  return true;
}

export function getSourceOrderNumberFromDetailLink(
  link: DetailLink
): string | undefined {
  return (
    extractSourceOrderNumberFromUrl(link.url) ||
    String(link.text ?? "").match(/\b20\d{12,}\b/)?.[0]
  );
}

export function filterDetailLinksByDateRange(
  links: DetailLink[],
  since?: string,
  until?: string
): {
  links: DetailLink[];
  skipped: number;
} {
  const filtered = links.filter((link) => {
    const sourceOrderNumber = getSourceOrderNumberFromDetailLink(link);

    if (!sourceOrderNumber) return true;

    return isSourceOrderNumberInDateRange(sourceOrderNumber, since, until);
  });

  return {
    links: filtered,
    skipped: links.length - filtered.length
  };
}
