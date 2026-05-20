import { describe, expect, it } from "vitest";
import {
  filterDetailLinksByDateRange,
  isSourceOrderNumberInDateRange,
  normalizeExtractionDateInput,
  orderDateKeyFromSourceOrderNumber
} from "./date-filter";

describe("normalizeExtractionDateInput", () => {
  it("returns undefined for empty/missing input", () => {
    expect(normalizeExtractionDateInput(undefined)).toBeUndefined();
    expect(normalizeExtractionDateInput("")).toBeUndefined();
  });

  it("accepts YYYY-MM-DD", () => {
    expect(normalizeExtractionDateInput("2025-03-15")).toBe("2025-03-15");
  });

  it("accepts YYYY.MM.DD", () => {
    expect(normalizeExtractionDateInput("2025.03.15")).toBe("2025-03-15");
  });

  it("accepts YYYY/MM/DD", () => {
    expect(normalizeExtractionDateInput("2025/03/15")).toBe("2025-03-15");
  });

  it("accepts compact YYYYMMDD", () => {
    expect(normalizeExtractionDateInput("20250315")).toBe("2025-03-15");
  });

  it("returns undefined for garbage input", () => {
    expect(normalizeExtractionDateInput("not a date")).toBeUndefined();
  });
});

describe("orderDateKeyFromSourceOrderNumber", () => {
  it("extracts date from 16-digit source order number prefix", () => {
    expect(orderDateKeyFromSourceOrderNumber("2024051200012345")).toBe(
      "2024-05-12"
    );
  });

  it("returns undefined when prefix is not 8 digits", () => {
    expect(orderDateKeyFromSourceOrderNumber("UNKNOWN-1")).toBeUndefined();
  });
});

describe("isSourceOrderNumberInDateRange", () => {
  it("includes order when no since/until given", () => {
    expect(isSourceOrderNumberInDateRange("2024051200012345")).toBe(true);
  });

  it("includes order with no parseable date when bounds set", () => {
    // Conservative: if we can't parse, don't filter out.
    expect(
      isSourceOrderNumberInDateRange("UNKNOWN-1", "2024-01-01", "2024-12-31")
    ).toBe(true);
  });

  it("excludes order earlier than since", () => {
    expect(
      isSourceOrderNumberInDateRange(
        "2023121500012345",
        "2024-01-01",
        undefined
      )
    ).toBe(false);
  });

  it("excludes order later than until", () => {
    expect(
      isSourceOrderNumberInDateRange(
        "2025010100012345",
        undefined,
        "2024-12-31"
      )
    ).toBe(false);
  });

  it("includes order on boundary dates", () => {
    expect(
      isSourceOrderNumberInDateRange(
        "2024010100012345",
        "2024-01-01",
        "2024-12-31"
      )
    ).toBe(true);
  });
});

describe("filterDetailLinksByDateRange", () => {
  it("filters out links whose order date is outside the range", () => {
    const links = [
      {
        url: "https://www.musinsa.com/order/order-detail/2024051200012345",
        text: ""
      },
      {
        url: "https://www.musinsa.com/order/order-detail/2023010100099999",
        text: ""
      }
    ];

    const result = filterDetailLinksByDateRange(
      links,
      "2024-01-01",
      "2024-12-31"
    );
    expect(result.links).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it("keeps links when no date bounds are set", () => {
    const links = [
      {
        url: "https://www.musinsa.com/order/order-detail/2024051200012345",
        text: ""
      }
    ];
    const result = filterDetailLinksByDateRange(links, undefined, undefined);
    expect(result.links).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });
});
