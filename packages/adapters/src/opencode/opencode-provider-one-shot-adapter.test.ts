import { describe, expect, it, vi } from "vitest";
import type { createOpencodeClient } from "@opencode-ai/sdk";
import {
  type OpenCodeProviderOneShotAdapterOptions,
  OpenCodeProviderOneShotAdapter
} from "./opencode-provider-one-shot-adapter.js";

const sessionId = "one-shot-fixture";

interface PromptCall {
  id: string;
  body: Record<string, unknown>;
}

interface MessageInfo {
  id: string;
  role: "user" | "assistant";
  time: { created: number; completed?: number };
  parentID?: string;
}

const messageEntry = (info: MessageInfo, parts: Record<string, unknown>[] = []) => ({ info, parts });

const userInfo = (id: string, created: number): MessageInfo => ({
  id,
  role: "user",
  time: { created }
});

const assistantInfo = (id: string, parentID: string, created: number): MessageInfo => ({
  id,
  role: "assistant",
  time: { created, completed: created + 1 },
  parentID
});

const textPart = (text: string): Record<string, unknown> => ({
  id: `part-${Math.random()}`,
  sessionID: sessionId,
  messageID: "m",
  type: "text",
  text
});

const fakeClient = (options: {
  after?: Array<{ info: MessageInfo; parts: Record<string, unknown>[] }>;
  promptError?: unknown;
  createError?: unknown;
}) => {
  const promptCalls: PromptCall[] = [];
  const deleted: string[] = [];
  let messagesCalls = 0;
  let created: string | null = null;
  const session = {
    create: vi.fn(async () => {
      if (options.createError) throw options.createError;
      created = "one-shot-session";
      return { data: { id: created, title: "", directory: "", time: { created: 1, updated: 1 } } };
    }),
    promptAsync: vi.fn(async ({ path, body }: { path: { id: string }; body: Record<string, unknown> }) => {
      promptCalls.push({ id: path.id, body });
      if (options.promptError) throw options.promptError;
      return { data: undefined };
    }),
    messages: vi.fn(async () => {
      const after = options.after ?? [];
      const user = messageEntry(userInfo("user-prompt", 1), [textPart("Enrichis ce prompt")]);
      messagesCalls += 1;
      if (messagesCalls === 1) return { data: [] };
      return { data: [user, ...after] };
    }),
    delete: vi.fn(async ({ path }: { path: { id: string } }) => {
      deleted.push(path.id);
      return { data: true };
    })
  };
  return { client: { session }, promptCalls, deleted };
};

const adapter = (client: unknown, options: OpenCodeProviderOneShotAdapterOptions = {}) =>
  new OpenCodeProviderOneShotAdapter({
    createClient: () => client as ReturnType<typeof createOpencodeClient>,
    ...options
  });

describe("OpenCodeProviderOneShotAdapter", () => {
  it("creates a session, prompts with the requested model and variant, and returns the assistant text", async () => {
    const fake = fakeClient({
      after: [messageEntry(assistantInfo("assistant-reply", "user-prompt", 2), [textPart("Version enrichie du prompt.")])]
    });
    const result = await adapter(fake.client).oneShot({
      prompt: "Enrichis ce prompt",
      modelId: "openai/gpt-5",
      reasoningEffort: "high"
    });

    expect(result.text).toBe("Version enrichie du prompt.");
    expect(fake.promptCalls).toHaveLength(1);
    expect(fake.promptCalls[0]!.body).toMatchObject({
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "high",
      parts: [{ type: "text", text: "Enrichis ce prompt" }]
    });
    expect(fake.deleted).toEqual(["one-shot-session"]);
  });

  it("keeps the provider default effort when reasoningEffort is provider_default", async () => {
    const fake = fakeClient({
      after: [messageEntry(assistantInfo("assistant-reply", "user-prompt", 2), [textPart("OK")])]
    });
    await adapter(fake.client).oneShot({ prompt: "Salut", reasoningEffort: "provider_default" });

    expect(fake.promptCalls[0]!.body).not.toHaveProperty("variant");
  });

  it("cleans up the session even when the prompt fails", async () => {
    const fake = fakeClient({ promptError: new Error("prompt failed") });
    await expect(adapter(fake.client).oneShot({ prompt: "Salut" })).rejects.toThrow("prompt failed");
    expect(fake.deleted).toEqual(["one-shot-session"]);
  });

  it("rejects a non namespaced model id", async () => {
    const fake = fakeClient({
      after: [messageEntry(assistantInfo("assistant-reply", "user-prompt", 2), [textPart("OK")])]
    });
    await expect(adapter(fake.client).oneShot({ prompt: "Salut", modelId: "not-namespaced" })).rejects.toThrow(
      /not namespaced/
    );
  });
});
