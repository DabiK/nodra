import type { AgentSessionView } from "../types";

export type AgentConversationEvent =
  | { kind: "system"; id: string; text: string; at: string }
  | { kind: "user"; id: string; text: string; at: string }
  | { kind: "assistant"; id: string; text: string; at: string; providerId?: string }
  | { kind: "tool"; id: string; title: string; command?: string; output?: string; status?: string; at: string }
  | { kind: "reasoning"; id: string; text: string; at: string }
  | { kind: "error"; id: string; text: string; at: string };

export interface ConversationStats {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  contextLeftPercent?: number;
  modelId?: string;
  providerId?: string;
  providerSessionRef?: string;
}

type RawEvent = AgentSessionView["events"][number];
type ConversationItem = AgentSessionView["items"][number];

interface CanonicalItem {
  id?: string;
  type?: string;
  text?: string;
  summary?: string;
  command?: unknown;
  aggregated_output?: string;
  output?: string;
  status?: string;
  exit_code?: number;
  changes?: Array<{ kind?: string; type?: string; path?: string; file?: string }>;
  query?: string;
  server?: string;
  tool?: string;
  result?: unknown;
  error?: unknown;
  arguments?: unknown;
}

export function normalizeAgentConversation(session: AgentSessionView | null): AgentConversationEvent[] {
  if (!session) return [];
  const fromItems = normalizeItems(session.items, session);
  const rawEvents = session.events;
  const finalTextPartIds = new Set(
    rawEvents
      .map((event) => payloadRecord(payloadRecord(event.payload)?.properties)?.part)
      .filter(isFinalTextPart)
      .map((part) => String(part.id))
  );
  const completedItemIds = new Set<string>();
  for (const event of rawEvents) {
    const item = canonicalItem(event.payload);
    if (event.type === "item.completed" && item?.id) completedItemIds.add(item.id);
  }
  const toolFinalEventIds = finalToolEventIds(rawEvents);
  const messageRoles = messageRoleIndex(rawEvents);
  const fromEvents = rawEvents.flatMap((event) => normalizeProviderEvent(event, finalTextPartIds, completedItemIds, toolFinalEventIds, messageRoles, session.run.providerId));
  const seen = new Set<string>();
  return [...fromItems, ...fromEvents]
    .filter((event) => {
      const signature = `${event.kind}:${"text" in event ? cleanUserText(event.text) : `${event.title}:${event.command ?? ""}:${event.output ?? ""}`}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .sort((left, right) => left.at.localeCompare(right.at));
}

export function extractConversationStats(session: AgentSessionView | null): ConversationStats {
  const stats: ConversationStats = {
    providerId: session?.run.providerId,
    modelId: session?.run.modelId,
    providerSessionRef: session?.conversation?.providerSessionRef ?? undefined,
    inputTokens: session?.run.inputTokens ?? undefined,
    outputTokens: session?.run.outputTokens ?? undefined,
    cacheReadTokens: session?.run.cacheReadTokens ?? undefined,
    cacheWriteTokens: session?.run.cacheWriteTokens ?? undefined,
    costUsd: session?.run.costMicros == null ? undefined : session.run.costMicros / 1_000_000
  };
  for (const event of session?.events ?? []) {
    const codexUsage = payloadRecord(event.payload)?.usage;
    if (payloadRecord(codexUsage)) {
      const usage = payloadRecord(codexUsage)!;
      stats.inputTokens = numberValue(usage.input_tokens) ?? stats.inputTokens;
      stats.outputTokens = numberValue(usage.output_tokens) ?? stats.outputTokens;
      stats.reasoningTokens = numberValue(usage.reasoning_output_tokens) ?? stats.reasoningTokens;
      stats.cacheReadTokens = numberValue(usage.cached_input_tokens) ?? stats.cacheReadTokens;
    }
    const info = payloadRecord(payloadRecord(payloadRecord(event.payload)?.properties)?.info);
    if (payloadRecord(info)) {
      const infoRecord = payloadRecord(info)!;
      const tokens = payloadRecord(infoRecord.tokens);
      stats.providerId = typeof infoRecord.providerID === "string" ? infoRecord.providerID : stats.providerId;
      stats.modelId = typeof infoRecord.modelID === "string" ? infoRecord.modelID : stats.modelId;
      stats.costUsd = numberValue(infoRecord.cost) ?? stats.costUsd;
      stats.totalTokens = numberValue(tokens?.total) ?? stats.totalTokens;
      stats.inputTokens = numberValue(tokens?.input) ?? stats.inputTokens;
      stats.outputTokens = numberValue(tokens?.output) ?? stats.outputTokens;
      stats.reasoningTokens = numberValue(tokens?.reasoning) ?? stats.reasoningTokens;
      const cache = payloadRecord(tokens?.cache);
      stats.cacheReadTokens = numberValue(cache?.read) ?? stats.cacheReadTokens;
      stats.cacheWriteTokens = numberValue(cache?.write) ?? stats.cacheWriteTokens;
    }
  }
  if (!stats.totalTokens && (stats.inputTokens || stats.outputTokens)) {
    stats.totalTokens = (stats.inputTokens ?? 0) + (stats.outputTokens ?? 0) + (stats.reasoningTokens ?? 0);
  }
  return stats;
}

function normalizeItems(items: ConversationItem[], session: AgentSessionView): AgentConversationEvent[] {
  const result: AgentConversationEvent[] = [];
  const hasUserItem = items.some((item) => (item.kind === "user" || item.kind === "steer") && item.body?.trim());
  const initialPrompt = session.config?.promptMission?.trim() || session.config?.promptEffective?.trim();
  if (!hasUserItem && initialPrompt) {
    result.push({ kind: "user", id: `run-prompt/${session.run.id}`, text: cleanUserText(initialPrompt), at: session.run.createdAt });
  }
  for (const item of items) {
    if (!item.body?.trim()) continue;
    const base = { id: item.id, text: cleanUserText(item.body), at: item.createdAt };
    if (item.kind === "user" || item.kind === "steer") result.push({ kind: "user", ...base });
    else if (item.kind === "assistant" || item.kind === "result") result.push({ kind: "assistant", ...base });
    else if (item.kind === "tool") result.push({ kind: "tool", id: item.id, title: "Outil", output: item.body, at: item.createdAt });
    else if (item.kind === "system") result.push({ kind: "system", ...base });
  }
  return result;
}

function normalizeProviderEvent(event: RawEvent, finalTextPartIds: Set<string>, completedItemIds: Set<string>, toolFinalEventIds: Set<string>, messageRoles: Map<string, string>, providerId: string): AgentConversationEvent[] {
  const at = event.sourceAt ?? event.receivedAt;
  const payload = payloadRecord(event.payload);
  const properties = payloadRecord(payload?.properties);
  const part = payloadRecord(properties?.part);
  const info = payloadRecord(properties?.info);

  if (event.type.includes("session.idle") || event.type.includes("session.status")) return [];
  if (event.type.includes("message.part.delta")) {
    return [];
  }
  if (event.type.includes("message.updated") && info) return [];
  if (event.type.includes("message.part.updated") && part?.type === "tool") {
    if (!toolFinalEventIds.has(event.id)) return [];
    return [toolPartEvent(event.id, part, at)];
  }
  if (event.type.includes("message.part.updated") && part?.type === "text" && typeof part.text === "string") {
    const messageId = typeof part.messageID === "string" ? part.messageID : "";
    const kind = messageRoles.get(messageId) === "user" ? "user" : "assistant";
    const text = kind === "user" ? cleanUserText(part.text) : part.text;
    return text.trim() ? [kind === "user" ? { kind, id: event.id, text, at } : { kind, id: event.id, text, at, providerId }] : [];
  }
  if (event.type === "provider/assistantMessage") {
    const item = payloadRecord(payload?.item);
    const text = typeof item?.text === "string" ? item.text : undefined;
    return text?.trim() ? [{ kind: "assistant", id: event.id, text, at, providerId }] : [];
  }
  if (event.type === "provider/executionCompleted" || event.type === "devflow.run.finished") {
    const state = String(payload?.state ?? payload?.status ?? "").toUpperCase();
    return [{ kind: "system", id: event.id, text: state === "SUCCEEDED" || state === "SUCCEEDED" ? "✓ Travail terminé" : `État · ${state || "terminé"}`, at }];
  }
  if (event.type === "provider/executionStarted" || event.type === "turn.started") return [{ kind: "system", id: event.id, text: "L'agent analyse la demande", at }];
  if (event.type === "turn.completed") {
    const usage = payloadRecord(payload?.usage);
    const input = numberValue(usage?.input_tokens) ?? 0;
    const output = numberValue(usage?.output_tokens) ?? 0;
    const cached = numberValue(usage?.cached_input_tokens) ?? 0;
    return [{ kind: "system", id: event.id, text: `Tour terminé · ${input.toLocaleString("fr-FR")} tokens entrée${cached ? ` · ${cached.toLocaleString("fr-FR")} en cache` : ""} · ${output.toLocaleString("fr-FR")} sortie`, at }];
  }
  if (event.type === "thread.started") return [{ kind: "system", id: event.id, text: "Thread démarré", at }];
  if (event.type === "devflow.user.message") {
    const text = typeof payload?.text === "string" ? visibleUserMessage(payload.text) : "";
    return text.trim() ? [{ kind: "user", id: event.id, text, at }] : [];
  }
  if (event.type === "turn.failed" || event.type === "error" || event.type.includes("failed") || event.type.includes("error")) {
    return [{ kind: "error", id: event.id, text: String(payload?.message ?? payload?.error ?? "Échec du run"), at }];
  }
  const item = canonicalItem(event.payload);
  if (!item) return [];
  if (event.type === "item.started" && item.id && completedItemIds.has(item.id)) return [];
  return normalizeCanonicalItem(event, item, at, providerId);
}

function normalizeCanonicalItem(event: RawEvent, item: CanonicalItem, at: string, providerId: string): AgentConversationEvent[] {
  const running = event.type === "item.started";
  if (item.type === "agent_message" && item.text?.trim()) return [{ kind: "assistant", id: event.id, text: agentMessageText(item.text), at, providerId }];
  if (item.type === "reasoning") return providerId.includes("copilot") ? [] : [{ kind: "reasoning", id: event.id, text: item.text ?? item.summary ?? "Analyse terminée", at }];
  if (item.type === "command_execution") {
    return [{
      kind: "tool",
      id: event.id,
      title: running ? "● Commande en cours" : `⌘ Commande · ${item.status ?? "terminée"}${item.exit_code != null ? ` · code ${item.exit_code}` : ""}`,
      command: stringContent(item.command),
      output: item.aggregated_output ?? item.output,
      status: item.status,
      at
    }];
  }
  if (item.type === "file_change") return [{ kind: "tool", id: event.id, title: "Fichiers modifiés", output: item.changes?.map((change) => `${change.kind ?? change.type ?? "modifié"} · ${change.path ?? change.file ?? ""}`).join("\n") ?? item.text, at }];
  if (item.type === "web_search") return [{ kind: "tool", id: event.id, title: "Recherche web", output: item.query ?? item.text ?? "Recherche terminée", at }];
  if (item.type === "mcp_tool_call") return [{ kind: "tool", id: event.id, title: `MCP · ${item.server ?? ""} ${item.tool ?? ""}`, output: stringContent(item.result ?? item.error ?? item.arguments), at }];
  if (item.type === "collab_tool_call") return [{ kind: "tool", id: event.id, title: "Sous-agent", output: item.text ?? item.status ?? stringContent(item), at }];
  return [];
}

function canonicalItem(payload: unknown): CanonicalItem | null {
  const record = payloadRecord(payload);
  const item = payloadRecord(record?.item);
  if (item) return item as CanonicalItem;
  const properties = payloadRecord(record?.properties);
  const tool = payloadRecord(properties?.tool) ?? payloadRecord(properties?.call);
  if (tool) {
    const name = String(tool.name ?? tool.tool ?? "Outil");
    return { type: "command_execution", tool: name, command: tool.command ?? name, arguments: tool.arguments };
  }
  return null;
}

function agentMessageText(text: string) {
  try {
    const value = JSON.parse(text) as { schemaVersion?: unknown; status?: unknown; outcome?: unknown };
    if (value.schemaVersion === 1 && typeof value.outcome === "string" && ["complete", "partial", "blocked"].includes(String(value.status))) return value.outcome.trim() || text;
  } catch {
    return text;
  }
  return text;
}

function visibleUserMessage(text: string) {
  const marker = "--- USER REQUEST ---";
  if (!text.includes("--- DEVFLOW MANAGER BRIEF ---") || !text.includes(marker)) return text;
  return text.split(marker)[1]?.split("--- END USER REQUEST ---")[0]?.trim() || text;
}

function cleanUserText(text: string) {
  return visibleUserMessage(text)
    .replace(/\s*<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "")
    .trim();
}

function messageRoleIndex(events: RawEvent[]) {
  const roles = new Map<string, string>();
  for (const event of events) {
    if (!event.type.includes("message.updated")) continue;
    const properties = payloadRecord(event.payload)?.properties;
    const info = payloadRecord(payloadRecord(properties)?.info);
    if (!info) continue;
    const id = typeof info.id === "string" ? info.id : "";
    const role = typeof info.role === "string" ? info.role : "";
    if (id && role) roles.set(id, role);
  }
  return roles;
}

const toolStateRank: Record<string, number> = { pending: 0, running: 1, error: 2, completed: 3 };

// A tool part is streamed as several message.part.updated events sharing the
// same part id, moving through pending -> running -> completed. Keep only the
// event id carrying the most advanced state so the feed shows one tool bubble.
function finalToolEventIds(events: RawEvent[]): Set<string> {
  const bestByPart = new Map<string, { eventId: string; rank: number }>();
  for (const event of events) {
    if (!event.type.includes("message.part.updated")) continue;
    const part = payloadRecord(payloadRecord(payloadRecord(event.payload)?.properties)?.part);
    if (part?.type !== "tool") continue;
    const partId = typeof part.id === "string" ? part.id : event.id;
    const state = payloadRecord(part.state);
    const status = typeof state?.status === "string" ? state.status : "pending";
    const rank = toolStateRank[status] ?? 0;
    const current = bestByPart.get(partId);
    if (!current || rank >= current.rank) bestByPart.set(partId, { eventId: event.id, rank });
  }
  return new Set([...bestByPart.values()].map((entry) => entry.eventId));
}

function toolPartEvent(eventId: string, part: Record<string, unknown>, at: string): Extract<AgentConversationEvent, { kind: "tool" }> {
  const toolName = typeof part.tool === "string" ? part.tool : "Outil";
  const state = payloadRecord(part.state);
  const status = typeof state?.status === "string" ? state.status : undefined;
  const input = payloadRecord(state?.input);
  const command = input && Object.keys(input).length > 0 ? stringContent(input) : undefined;
  const rawOutput = state?.output ?? state?.error;
  const output = rawOutput == null ? undefined : stringContent(rawOutput);
  const statusLabel = status === "completed" ? "terminé" : status === "error" ? "erreur" : status === "running" ? "en cours" : "en attente";
  return {
    kind: "tool",
    id: eventId,
    title: `◇ ${toolName} · ${statusLabel}`,
    command,
    output,
    status,
    at
  };
}

function stringContent(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function payloadRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
}

function isFinalTextPart(part: unknown): part is { id: string; type: "text"; text: string } {
  const record = payloadRecord(part);
  return record?.type === "text" && typeof record.id === "string" && typeof record.text === "string";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
