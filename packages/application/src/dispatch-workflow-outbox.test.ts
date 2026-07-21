import { asId } from "@nodra/domain";
import { describe, expect, it, vi } from "vitest";
import { DispatchWorkflowOutbox } from "./dispatch-workflow-outbox.js";
import type { WorkflowOutboxStore } from "./workflow-outbox-store.js";
import type { WorkflowPort } from "./workflow-port.js";

describe("DispatchWorkflowOutbox", () => {
  it("marks published only after Temporal acceptance", async () => {
    const message = {
      id: asId("outbox-1"),
      dedupeKey: "mission/mission-1",
      input: { missionId: asId("mission-1"), commandId: asId("command-1"), schemaVersion: 1 as const }
    };
    const store: WorkflowOutboxStore = {
      listPendingStarts: vi.fn(async () => [message]),
      markPublished: vi.fn()
    };
    const workflows: WorkflowPort = {
      start: vi.fn(async () => ({ workflowId: "mission/mission-1", runId: "temporal-run-1" })),
      signal: vi.fn(),
      update: vi.fn(),
      query: vi.fn()
    };
    const checkpoint = { accepted: vi.fn(async () => undefined) };
    const dispatcher = new DispatchWorkflowOutbox(store, workflows, checkpoint);
    await expect(dispatcher.execute({ limit: 10, occurredAt: "2026-07-22T10:00:00.000Z" }))
      .resolves.toEqual({ accepted: 1, messageIds: [message.id] });
    expect(workflows.start).toHaveBeenCalledBefore(checkpoint.accepted);
    expect(checkpoint.accepted).toHaveBeenCalledBefore(store.markPublished as ReturnType<typeof vi.fn>);
  });

  it("leaves the message pending when the process crashes after acceptance", async () => {
    const message = {
      id: asId("outbox-2"),
      dedupeKey: "mission/mission-2",
      input: { missionId: asId("mission-2"), commandId: asId("command-2"), schemaVersion: 1 as const }
    };
    const store: WorkflowOutboxStore = {
      listPendingStarts: vi.fn(async () => [message]),
      markPublished: vi.fn()
    };
    const workflows: WorkflowPort = {
      start: vi.fn(async () => ({ workflowId: "mission/mission-2", runId: "temporal-run-2" })),
      signal: vi.fn(),
      update: vi.fn(),
      query: vi.fn()
    };
    const dispatcher = new DispatchWorkflowOutbox(store, workflows, {
      accepted: async () => { throw new Error("simulated process crash"); }
    });
    await expect(dispatcher.execute({ limit: 10, occurredAt: "2026-07-22T10:00:00.000Z" }))
      .rejects.toThrow("simulated process crash");
    expect(store.markPublished).not.toHaveBeenCalled();
  });
});
