import { describe, expect, it } from "vitest";
import {
  CONTEXT_RISK_THRESHOLDS,
  assessConversationContext,
  countTruncatedEvents,
  estimateTokensFromText,
  type ConversationContextInput
} from "./conversation-context-service";

function assess(overrides: Partial<ConversationContextInput> = {}) {
  return assessConversationContext({ turnCount: 1, charCount: 100, ...overrides });
}

describe("estimateTokensFromText", () => {
  it("approximates tokens at 4 characters per token", () => {
    expect(estimateTokensFromText(100)).toBe(25);
    expect(estimateTokensFromText(80_000)).toBe(20_000);
  });

  it("never returns zero for empty input", () => {
    expect(estimateTokensFromText(0)).toBe(1);
  });
});

describe("countTruncatedEvents", () => {
  it("counts events with a truthy truncation marker at any depth", () => {
    const events = [
      { type: "run.updated", payload: { state: "running" } },
      { type: "item.updated", payload: { item: { output: "long output", truncated: true } } },
      { type: "item.updated", payload: { properties: { part: { state: { outputTruncated: true } } } } },
      { type: "item.updated", payload: { properties: { part: { state: { outputTruncated: false } } } } }
    ];
    expect(countTruncatedEvents(events)).toBe(2);
  });

  it("counts markers inside arrays and ignores false/absent values", () => {
    const events = [
      { payload: { chunks: [{ done: true, truncated: 1 }, { done: true }] } },
      { payload: { truncated: false } },
      { payload: { note: "truncated" } }
    ];
    expect(countTruncatedEvents(events)).toBe(1);
  });

  it("returns zero for empty or marker-free events", () => {
    expect(countTruncatedEvents([])).toBe(0);
    expect(countTruncatedEvents([{ type: "turn.completed", payload: { usage: {} } }])).toBe(0);
  });
});

describe("assessConversationContext", () => {
  it("returns ok for a short conversation", () => {
    const risk = assess();
    expect(risk.level).toBe("ok");
    expect(risk.reasons).toEqual([]);
    expect(risk.tokenSource).toBe("estimated");
    expect(risk.estimatedTokens).toBe(25);
    expect(risk.truncationRate).toBe(0);
  });

  it("prefers reported tokens over the text estimation", () => {
    const risk = assess({ charCount: 400_000, totalTokens: 12_000 });
    expect(risk.estimatedTokens).toBe(12_000);
    expect(risk.tokenSource).toBe("reported");
    expect(risk.level).toBe("ok");
  });

  it("warns above the token threshold", () => {
    const risk = assess({ charCount: CONTEXT_RISK_THRESHOLDS.warnTokens * 4 });
    expect(risk.level).toBe("warn");
    expect(risk.reasons).toContain("Volume élevé (≈ 80 k tokens)");
  });

  it("reaches critical above the critical token threshold", () => {
    const risk = assess({ charCount: CONTEXT_RISK_THRESHOLDS.criticalTokens * 4 });
    expect(risk.level).toBe("critical");
    expect(risk.reasons.some((reason) => reason.includes("Volume très élevé"))).toBe(true);
  });

  it("warns above the turn threshold", () => {
    const risk = assess({ turnCount: CONTEXT_RISK_THRESHOLDS.warnTurns });
    expect(risk.level).toBe("warn");
    expect(risk.reasons).toContain("Nombre de tours élevé");
    expect(risk.turnCount).toBe(25);
  });

  it("reaches critical above the critical turn threshold", () => {
    const risk = assess({ turnCount: CONTEXT_RISK_THRESHOLDS.criticalTurns });
    expect(risk.level).toBe("critical");
  });

  it("warns above the truncation rate threshold", () => {
    const events = Array.from({ length: 10 }, (_, index) => index < 2 ? { payload: { truncated: true } } : { payload: {} });
    const risk = assess({ events });
    expect(risk.level).toBe("warn");
    expect(risk.truncatedEventCount).toBe(2);
    expect(risk.truncationRate).toBeCloseTo(0.2);
  });

  it("reaches critical above the critical truncation rate", () => {
    const events = Array.from({ length: 10 }, (_, index) => index < 4 ? { payload: { truncated: true } } : { payload: {} });
    const risk = assess({ events });
    expect(risk.level).toBe("critical");
    expect(risk.reasons.some((reason) => reason.includes("Beaucoup d'événements tronqués"))).toBe(true);
  });

  it("critical wins over warn when several criteria trigger", () => {
    const events = Array.from({ length: 10 }, (_, index) => index < 3 ? { payload: { truncated: true } } : { payload: {} });
    const risk = assess({ turnCount: 30, charCount: CONTEXT_RISK_THRESHOLDS.criticalTokens * 4, events });
    expect(risk.level).toBe("critical"); // tokens critiques + troncature critique
    expect(risk.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
