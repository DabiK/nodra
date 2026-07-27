import { asId, DomainError, type Id, type ManagerConfig, type ManagerSnapshot } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { ManagerRepository } from "./manager-repository.js";

export interface UpdateManagerInput {
  id: Id;
  name?: string;
  instruction?: string;
  config?: Partial<ManagerConfig>;
  context: CommandContext;
}

export class UpdateManager {
  constructor(private readonly managers: ManagerRepository) {}

  async execute(input: UpdateManagerInput): Promise<ManagerSnapshot> {
    const manager = await this.managers.load(input.id);
    if (!manager) throw new DomainError(`Manager ${input.id} was not found`, "MANAGER_NOT_FOUND");
    const now = input.context.occurredAt;
    if (input.name !== undefined) manager.rename(input.name, now);
    if (input.instruction !== undefined) manager.updateInstruction(input.instruction, now);
    if (input.config) manager.reconfigure(input.config, now);
    const snapshot = manager.snapshot();
    await this.managers.save({
      manager,
      mode: "update",
      audit: {
        id: asId(`audit/${input.context.commandId}`),
        commandId: input.context.commandId,
        eventType: "MANAGER_UPDATED",
        actor: input.context.actor,
        payload: { schemaVersion: 1, managerId: snapshot.id, state: snapshot.state },
        occurredAt: now
      }
    });
    return snapshot;
  }
}

export class ArchiveManager {
  constructor(private readonly managers: ManagerRepository) {}

  async execute(input: { id: Id; context: CommandContext }): Promise<ManagerSnapshot> {
    const manager = await this.managers.load(input.id);
    if (!manager) throw new DomainError(`Manager ${input.id} was not found`, "MANAGER_NOT_FOUND");
    manager.archive(input.context.occurredAt);
    const snapshot = manager.snapshot();
    await this.managers.save({
      manager,
      mode: "update",
      audit: {
        id: asId(`audit/${input.context.commandId}`),
        commandId: input.context.commandId,
        eventType: "MANAGER_ARCHIVED",
        actor: input.context.actor,
        payload: { schemaVersion: 1, managerId: snapshot.id },
        occurredAt: input.context.occurredAt
      }
    });
    return snapshot;
  }
}
