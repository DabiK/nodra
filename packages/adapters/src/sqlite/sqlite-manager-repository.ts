import type { ManagerRepository, SaveManagerInput } from "@nodra/application";
import { asId, DomainError, Manager, type Id, type ManagerState } from "@nodra/domain";
import { and, desc, eq } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { projects } from "./schema/core.js";
import { managerInstructionVersions, managers } from "./schema/managers.js";
import { businessAuditEvents } from "./schema/operations.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

export class SqliteManagerRepository implements ManagerRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async load(id: Id): Promise<Manager | null> {
    try {
      const row = this.database.orm.select().from(managers).where(eq(managers.id, id)).get();
      if (!row) return null;
      const instruction = this.database.orm
        .select({ instruction: managerInstructionVersions.instruction })
        .from(managerInstructionVersions)
        .where(and(eq(managerInstructionVersions.managerId, id), eq(managerInstructionVersions.isCurrent, 1)))
        .get();
      return Manager.rehydrate({
        id: asId(row.id),
        projectId: row.projectId ? asId(row.projectId) : null,
        name: row.name ?? "",
        instruction: instruction?.instruction ?? "",
        state: row.state as ManagerState,
        providerId: row.providerId,
        modelId: row.modelId,
        reasoningEffort: row.reasoningEffort,
        providerOptions: {
          schemaVersion: row.providerOptionsSchemaVersion,
          value: JSON.parse(row.providerOptionsJson) as Record<string, unknown>
        },
        permissionPreset: row.permissionPreset,
        workspaceId: row.workspaceId ? asId(row.workspaceId) : null,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
        archivedAt: row.archivedAt
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async save(input: SaveManagerInput): Promise<void> {
    const snapshot = input.manager.snapshot();
    try {
      this.database.orm.transaction((transaction) => {
        if (snapshot.projectId) {
          const project = transaction.select({ id: projects.id }).from(projects).where(eq(projects.id, snapshot.projectId)).get();
          if (!project) throw new DomainError(`Project ${snapshot.projectId} was not found`, "PROJECT_NOT_FOUND");
        }

        const consumedCommand = transaction
          .select({ id: businessAuditEvents.id })
          .from(businessAuditEvents)
          .where(eq(businessAuditEvents.commandId, input.audit.commandId))
          .get();
        if (consumedCommand) {
          throw new DomainError(`Command ${input.audit.commandId} was already processed`, "COMMAND_ID_CONFLICT");
        }

        const row = {
          name: snapshot.name,
          projectId: snapshot.projectId,
          state: snapshot.state,
          providerId: snapshot.providerId,
          modelId: snapshot.modelId,
          reasoningEffort: snapshot.reasoningEffort,
          providerOptionsSchemaVersion: snapshot.providerOptions.schemaVersion,
          providerOptionsJson: JSON.stringify(snapshot.providerOptions.value),
          permissionPreset: snapshot.permissionPreset,
          workspaceId: snapshot.workspaceId,
          archivedAt: snapshot.archivedAt
        };

        if (input.mode === "create") {
          const existing = transaction.select({ id: managers.id }).from(managers).where(eq(managers.id, snapshot.id)).get();
          if (existing) throw new DomainError(`Manager ${snapshot.id} already exists`, "MANAGER_ALREADY_EXISTS");
          // Insert as draft first: a `ready`/`active` manager requires a current
          // instruction (DB trigger), but the instruction FK requires the manager
          // row to exist. Seed the instruction, then promote to the real state.
          transaction.insert(managers).values({ id: snapshot.id, ...row, state: "draft", createdAt: snapshot.createdAt }).run();
          transaction.insert(managerInstructionVersions).values({
            managerId: snapshot.id,
            version: 1,
            instruction: snapshot.instruction,
            isCurrent: 1,
            createdAt: snapshot.createdAt
          }).run();
          if (snapshot.state !== "draft") {
            transaction.update(managers).set({ state: snapshot.state }).where(eq(managers.id, snapshot.id)).run();
          }
        } else {
          const updated = transaction.update(managers).set(row).where(eq(managers.id, snapshot.id)).run();
          if (updated.changes !== 1) throw new DomainError(`Manager ${snapshot.id} was not found`, "MANAGER_NOT_FOUND");
          const current = transaction
            .select({ version: managerInstructionVersions.version, instruction: managerInstructionVersions.instruction })
            .from(managerInstructionVersions)
            .where(and(eq(managerInstructionVersions.managerId, snapshot.id), eq(managerInstructionVersions.isCurrent, 1)))
            .get();
          if (!current || current.instruction !== snapshot.instruction) {
            const latest = transaction
              .select({ version: managerInstructionVersions.version })
              .from(managerInstructionVersions)
              .where(eq(managerInstructionVersions.managerId, snapshot.id))
              .orderBy(desc(managerInstructionVersions.version))
              .limit(1)
              .get();
            transaction.update(managerInstructionVersions).set({ isCurrent: 0 })
              .where(and(eq(managerInstructionVersions.managerId, snapshot.id), eq(managerInstructionVersions.isCurrent, 1)))
              .run();
            transaction.insert(managerInstructionVersions).values({
              managerId: snapshot.id,
              version: (latest?.version ?? 0) + 1,
              instruction: snapshot.instruction,
              isCurrent: 1,
              createdAt: snapshot.updatedAt
            }).run();
          }
        }

        transaction.insert(businessAuditEvents).values({
          id: input.audit.id,
          aggregateKind: "manager",
          aggregateId: snapshot.id,
          commandId: input.audit.commandId,
          eventType: input.audit.eventType,
          actor: input.audit.actor,
          payloadJson: JSON.stringify(input.audit.payload),
          occurredAt: input.audit.occurredAt
        }).run();
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }
}
