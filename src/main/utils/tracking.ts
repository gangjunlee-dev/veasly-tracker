export function normalizeTrackingNumber(input: string | null | undefined): string {
  if (!input) return "";

  return String(input)
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^0-9A-Za-z-]/g, "")
    .toUpperCase();
}
