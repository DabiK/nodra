import { DomainError, type Id } from "@nodra/domain";
import type { ActivityRepository } from "./activity-repository.js";

export class MarkActivityRead {
  constructor(private readonly repository: ActivityRepository) {}

  async execute(input: { relayId: Id; readAt: string }): Promise<void> {
    const marked = await this.repository.markRead(input.relayId, input.readAt);
    if (!marked) {
      throw new DomainError(`Relay item ${input.relayId} was not found`, "ACTIVITY_ITEM_NOT_FOUND");
    }
  }
}
