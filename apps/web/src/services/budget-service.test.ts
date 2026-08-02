import { describe, expect, it } from "vitest";
import {
  formatCostMicros,
  formatTokenCount,
  formatTotalCostMicros,
  microsToUsd,
  runTokenTotal,
  sumCostMicros,
  usageKindLabel
} from "./budget-service";

describe("formatCostMicros", () => {
  it("formats sub-dollar costs with 4 decimals", () => {
    expect(formatCostMicros(12_345)).toBe("$0.0123");
    expect(formatCostMicros(1)).toBe("$0.0000");
    expect(formatCostMicros(999_949)).toBe("$0.9999");
  });

  it("formats dollar-range costs with 2 decimals", () => {
    expect(formatCostMicros(1_234_567)).toBe("$1.23");
    expect(formatCostMicros(123_456_789)).toBe("$123.46");
    expect(formatCostMicros(0)).toBe("$0.0000");
  });

  it("returns null when the cost is unknown", () => {
    expect(formatCostMicros(null)).toBeNull();
    expect(formatCostMicros(undefined)).toBeNull();
  });
});

describe("microsToUsd", () => {
  it("converts micro-dollars to dollars", () => {
    expect(microsToUsd(1_000_000)).toBe(1);
    expect(microsToUsd(500_000)).toBe(0.5);
    expect(microsToUsd(null)).toBeNull();
  });
});

describe("sumCostMicros", () => {
  it("sums known costs and ignores unknown ones", () => {
    expect(sumCostMicros([12_345, null, 6_543, undefined])).toBe(18_888);
  });

  it("returns null when no cost is known", () => {
    expect(sumCostMicros([null, undefined])).toBeNull();
    expect(sumCostMicros([])).toBeNull();
  });
});

describe("formatTotalCostMicros", () => {
  it("formats the aggregated cost", () => {
    expect(formatTotalCostMicros([12_345, 6_543])).toBe("$0.0189");
  });

  it("returns null when no cost is known", () => {
    expect(formatTotalCostMicros([null, undefined])).toBeNull();
  });
});

describe("formatTokenCount", () => {
  it("formats plain counts below a thousand with French separators", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1_234)).toBe("1,2 k");
  });

  it("formats thousands with a k suffix", () => {
    expect(formatTokenCount(1_000)).toBe("1 k");
    expect(formatTokenCount(12_300)).toBe("12,3 k");
    expect(formatTokenCount(12_350)).toBe("12,4 k");
    expect(formatTokenCount(999_950)).toBe("1 M");
  });

  it("formats millions with an M suffix", () => {
    expect(formatTokenCount(1_200_000)).toBe("1,2 M");
    expect(formatTokenCount(12_500_000)).toBe("12,5 M");
  });

  it("returns null when the count is unknown", () => {
    expect(formatTokenCount(null)).toBeNull();
    expect(formatTokenCount(undefined)).toBeNull();
  });
});

describe("runTokenTotal", () => {
  it("sums input, output and cache tokens", () => {
    expect(runTokenTotal({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 10 })).toBe(180);
    expect(runTokenTotal({ inputTokens: 100, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null })).toBe(100);
  });

  it("returns null when no token counter is known", () => {
    expect(runTokenTotal({ inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null })).toBeNull();
    expect(runTokenTotal({})).toBeNull();
  });
});

describe("usageKindLabel", () => {
  it("maps usage kinds to French labels", () => {
    expect(usageKindLabel("reported")).toBe("rapporté par le provider");
    expect(usageKindLabel("estimated")).toBe("estimé");
    expect(usageKindLabel("unavailable")).toBe("indisponible");
  });

  it("returns null for unknown kinds", () => {
    expect(usageKindLabel(null)).toBeNull();
    expect(usageKindLabel("weird")).toBeNull();
  });
});
