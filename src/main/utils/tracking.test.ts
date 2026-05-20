import { describe, expect, it } from "vitest";
import { normalizeTrackingNumber } from "./tracking";

describe("normalizeTrackingNumber", () => {
  it("strips whitespace and uppercases", () => {
    expect(normalizeTrackingNumber("  abc 123  ")).toBe("ABC123");
  });

  it("keeps digits, ascii letters and hyphens", () => {
    expect(normalizeTrackingNumber("LX-123-456-789")).toBe("LX-123-456-789");
  });

  it("removes punctuation and other symbols", () => {
    expect(normalizeTrackingNumber("123/456.789,000")).toBe("123456789000");
  });

  it("collapses inner whitespace including tabs", () => {
    expect(normalizeTrackingNumber("1234\t5678   9")).toBe("123456789");
  });

  it("handles null / undefined / empty inputs as empty string", () => {
    expect(normalizeTrackingNumber(null)).toBe("");
    expect(normalizeTrackingNumber(undefined)).toBe("");
    expect(normalizeTrackingNumber("")).toBe("");
  });

  it("strips non-ascii characters like Korean text", () => {
    expect(normalizeTrackingNumber("운송장 1234-5678")).toBe("1234-5678");
  });
});
