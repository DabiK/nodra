import type { Id } from "@nodra/domain";
import type { WorkflowOutboxStore } from "./workflow-outbox-store.js";
import type { WorkflowPort } from "./workflow-port.js";

export interface DispatchCheckpoint {
  accepted(messageId: Id): Promise<void>;
}

export interface DispatchResult {
  accepted: number;
  messageIds: Id[];
}

export class DispatchWorkflowOutbox {
  constructor(
    private readonly store: WorkflowOutboxStore,
    private readonly workflows: WorkflowPort,
    private readonly checkpoint?: DispatchCheckpoint
  ) {}

  async execute(input: { limit: number; occurredAt: string }): Promise<DispatchResult> {
    const messages = await this.store.listPendingStarts(input.limit);
    const messageIds: Id[] = [];
    for (const message of messages) {
      await this.workflows.start(message.input);
      await this.checkpoint?.accepted(message.id);
      await this.store.markPublished(message.id, input.occurredAt);
      messageIds.push(message.id);
    }
    return { accepted: messageIds.length, messageIds };
  }
}
