import { describe, expect, it } from "vitest";
import type { AgentSessionView } from "../types";
import { extractRunFailure, normalizeAgentConversation } from "./agent-conversation-normalizer";

function session(runState: string, events: Array<{ type: string; payload: unknown }>): AgentSessionView {
  return {
    run: {
      id: "run-1",
      missionId: "mission-1",
      conversationId: "conv-1",
      state: runState,
      providerId: "opencode",
      modelId: "openrouter/deepseek/deepseek-v4-flash",
      providerRunRef: null,
      createdAt: "2026-08-02T14:25:49.000Z",
      startedAt: null,
      endedAt: null
    },
    conversation: null,
    config: null,
    items: [],
    events: events.map((event, index) => ({
      id: `evt-${index}`,
      sequence: index,
      type: event.type,
      payload: event.payload,
      sourceAt: null,
      receivedAt: "2026-08-02T14:26:58.000Z"
    }))
  };
}

describe("extractRunFailure", () => {
  it("returns null for a succeeded run", () => {
    const view = session("SUCCEEDED", []);
    expect(extractRunFailure(view)).toBeNull();
  });

  it("extracts the provider message from provider/executionCompleted FAILED with source error", () => {
    const view = session("FAILED", [
      {
        type: "provider/executionCompleted",
        payload: {
          state: "FAILED",
          source: {
            id: "evt-error",
            type: "session.error",
            properties: {
              sessionID: "ses_abc",
              error: { name: "APIError", data: { message: "Key limit exceeded (total limit).", statusCode: 403 } }
            }
          }
        }
      }
    ]);
    expect(extractRunFailure(view)).toEqual({
      title: "Le run a échoué",
      detail: "Key limit exceeded (total limit)."
    });
  });

  it("extracts from a plain session.error event when no terminal event exists", () => {
    const view = session("FAILED", [
      {
        type: "session.error",
        payload: {
          properties: { sessionID: "ses_abc", error: { name: "APIError", data: { message: "requires more credits", statusCode: 402 } } }
        }
      }
    ]);
    expect(extractRunFailure(view)).toEqual({ title: "Le run a échoué", detail: "requires more credits" });
  });

  it("keeps the last failure message when several events carry one", () => {
    const view = session("FAILED", [
      { type: "session.error", payload: { properties: { error: { message: "first" } } } },
      { type: "provider/executionCompleted", payload: { state: "FAILED", error: { message: "second" } } }
    ]);
    expect(extractRunFailure(view)?.detail).toBe("second");
  });

  it("truncates very long messages", () => {
    const long = "x".repeat(600);
    const view = session("FAILED", [{ type: "session.error", payload: { properties: { error: { data: { message: long } } } } }]);
    expect(extractRunFailure(view)?.detail).toHaveLength(501);
  });
});

describe("normalizeAgentConversation error events", () => {
  it("renders the real provider message instead of [object Object]", () => {
    const view = session("FAILED", [
      { type: "session.error", payload: { properties: { sessionID: "ses_abc", error: { name: "APIError", data: { message: "Key limit exceeded (total limit).", statusCode: 403 } } } } }
    ]);
    const events = normalizeAgentConversation(view);
    const errors = events.filter((event) => event.kind === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].text).toBe("Key limit exceeded (total limit).");
  });
});
