import { describe, expect, it } from "vitest";
import type { AgentSessionView } from "../types";
import { normalizeAgentConversation } from "./agent-conversation-normalizer";

function session(providerId: string, events: AgentSessionView["events"]): AgentSessionView {
  return {
    run: {
      id: "run-1",
      missionId: "mission-1",
      conversationId: "conversation-1",
      state: "RUNNING",
      providerId,
      modelId: "model-1",
      providerRunRef: null,
      createdAt: "2026-07-28T12:00:00.000Z",
      startedAt: "2026-07-28T12:00:00.000Z",
      endedAt: null
    },
    conversation: null,
    config: null,
    items: [],
    events
  };
}

function event(sequence: number, type: string, payload: unknown): AgentSessionView["events"][number] {
  return {
    id: `event-${sequence}`,
    sequence,
    type,
    payload,
    sourceAt: `2026-07-28T12:00:0${sequence}.000Z`,
    receivedAt: `2026-07-28T12:00:0${sequence}.000Z`
  };
}

describe("normalizeAgentConversation", () => {
  it("renders the completed Codex camelCase command once", () => {
    const command = {
      type: "commandExecution",
      id: "exec-1",
      command: "rg Marketplace",
      status: "completed",
      aggregatedOutput: "marketplace/result.ts",
      exitCode: 0
    };

    const result = normalizeAgentConversation(session("codex", [
      event(1, "item/started", { item: { ...command, status: "inProgress", aggregatedOutput: null, exitCode: null } }),
      event(2, "item/completed", { item: command })
    ]));

    expect(result).toEqual([expect.objectContaining({
      kind: "tool",
      title: "⌘ Commande · completed · code 0",
      command: "rg Marketplace",
      output: "marketplace/result.ts"
    })]);
  });

  it("keeps rendering an OpenCode streamed tool part", () => {
    const result = normalizeAgentConversation(session("opencode", [
      event(1, "message.part.updated", {
        properties: {
          part: {
            id: "tool-1",
            type: "tool",
            tool: "read",
            state: {
              status: "completed",
              input: { filePath: "README.md" },
              output: "Nodra"
            }
          }
        }
      })
    ]));

    expect(result).toEqual([expect.objectContaining({
      kind: "tool",
      title: "◇ read · terminé",
      output: "Nodra"
    })]);
  });

  it("keeps every Codex user message across mission runs", () => {
    const firstMessage = { type: "userMessage", id: "user-1", content: [{ type: "text", text: "Première instruction" }] };
    const followUpMessage = { type: "userMessage", id: "user-2", content: [{ type: "text", text: "Approfondis les contrats" }] };

    const result = normalizeAgentConversation(session("codex", [
      event(1, "item/started", { item: firstMessage }),
      event(2, "item/completed", { item: firstMessage }),
      event(3, "item/started", { item: followUpMessage }),
      event(4, "item/completed", { item: followUpMessage })
    ]));

    expect(result).toEqual([
      expect.objectContaining({ kind: "user", text: "Première instruction" }),
      expect.objectContaining({ kind: "user", text: "Approfondis les contrats" })
    ]);
  });
});
