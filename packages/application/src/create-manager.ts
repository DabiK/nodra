import { asId, Manager, type Id, type ManagerSnapshot } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import type { ManagerRepository } from "./manager-repository.js";
import type { ProviderPermissionPreset, ProviderReasoningEffort } from "./provider-model.js";

export interface CreateManagerInput {
  id: Id;
  name: string;
  instruction: string;
  projectId?: Id | null;
  providerId?: string | null;
  modelId?: string | null;
  reasoningEffort?: ProviderReasoningEffort | null;
  permissionPreset?: ProviderPermissionPreset;
  workspaceId?: Id | null;
  context: CommandContext;
}

export class CreateManager {
  constructor(private readonly managers: ManagerRepository) {}

  async execute(input: CreateManagerInput): Promise<ManagerSnapshot> {
    const manager = Manager.create({
      id: input.id,
      name: input.name,
      instruction: input.instruction,
      now: input.context.occurredAt,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
      ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
      ...(input.permissionPreset === undefined ? {} : { permissionPreset: input.permissionPreset }),
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId })
    });
    const snapshot = manager.snapshot();
    await this.managers.save({
      manager,
      mode: "create",
      audit: {
        id: asId(`audit/${input.context.commandId}`),
        commandId: input.context.commandId,
        eventType: "MANAGER_CREATED",
        actor: input.context.actor,
        payload: { schemaVersion: 1, managerId: snapshot.id, state: snapshot.state },
        occurredAt: input.context.occurredAt
      }
    });
    return snapshot;
  }
}
