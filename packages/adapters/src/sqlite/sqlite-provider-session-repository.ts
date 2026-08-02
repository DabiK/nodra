import type {
  ActivatedProviderSessionMissionResult,
  ActivateProviderSessionMissionInput,
  AttachProviderSessionInput,
  CreateReadyAgentMissionAndAttachInput,
  CreatedProviderSessionMissionResult,
  LatestSessionRefForMission,
  ObserveProviderSessionInput,
  ProviderSessionAttachmentResult,
  ProviderSessionIdentity,
  ProviderSessionLink,
  ProviderSessionRepository
} from "@nodra/application";
import { asId, DomainError, Mission, type Id } from "@nodra/domain";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { projects, workspaces } from "./schema/core.js";
import { conversations } from "./schema/conversations.js";
import { missionAgentConfigs, missions } from "./schema/missions.js";
import { businessAuditEvents, outbox } from "./schema/operations.js";
import { providerCatalogSnapshots } from "./schema/provider-catalog.js";
import { providerSessionLinks, providerSessions } from "./schema/provider-sessions.js";
import { runs } from "./schema/runs.js";
import { translateSqliteError } from "./sqlite-error-translation.js";

export class SqliteProviderSessionRepository implements ProviderSessionRepository {
  constructor(private readonly database: NodraSqliteDatabase) {}

  async observe(input: ObserveProviderSessionInput): Promise<ProviderSessionIdentity> {
    const providerId = input.providerId.trim();
    if (!providerId) throw new DomainError("A provider identifier is required", "PROVIDER_ID_REQUIRED");
    if (!input.externalSessionRef) {
      throw new DomainError("An external session reference is required", "EXTERNAL_SESSION_REF_REQUIRED");
    }
    try {
      const reusedId = this.database.orm
          .select({ providerId: providerSessions.providerId, externalSessionRef: providerSessions.externalSessionRef })
          .from(providerSessions)
          .where(eq(providerSessions.id, input.id))
          .get();
      if (reusedId && (
        reusedId.providerId !== providerId || reusedId.externalSessionRef !== input.externalSessionRef
      )) {
        throw new DomainError(`Provider session ID ${input.id} is already used`, "PROVIDER_SESSION_ID_CONFLICT");
      }
      const row = this.database.orm.insert(providerSessions).values({
          id: input.id,
          providerId,
          externalSessionRef: input.externalSessionRef,
          ownership: "external_observed" as const,
          firstObservedAt: input.observedAt,
          lastObservedAt: input.observedAt
        })
        .onConflictDoUpdate({
          target: [providerSessions.providerId, providerSessions.externalSessionRef],
          set: {
            lastObservedAt: sql`max(${providerSessions.lastObservedAt}, excluded.last_observed_at)`
          }
        })
        .returning()
        .get();
      return this.toIdentity(row);
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async load(id: Id): Promise<ProviderSessionIdentity | null> {
    try {
      const row = this.database.orm.select().from(providerSessions).where(eq(providerSessions.id, id)).get();
      return row ? this.toIdentity(row) : null;
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async loadActiveLink(providerSessionId: Id): Promise<ProviderSessionLink | null> {
    try {
      const row = this.database.orm
        .select()
        .from(providerSessionLinks)
        .where(and(
          eq(providerSessionLinks.providerSessionId, providerSessionId),
          isNull(providerSessionLinks.detachedAt)
        ))
        .get();
      return row ? this.toLink(row) : null;
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async listActiveLinksForMission(missionId: Id): Promise<ProviderSessionLink[]> {
    try {
      return this.database.orm
        .select()
        .from(providerSessionLinks)
        .where(and(eq(providerSessionLinks.missionId, missionId), isNull(providerSessionLinks.detachedAt)))
        .orderBy(asc(providerSessionLinks.attachedAt), asc(providerSessionLinks.id))
        .all()
        .map((row) => this.toLink(row));
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async latestSessionRefForMission(missionId: Id): Promise<LatestSessionRefForMission | null> {
    try {
      const row = this.database.orm
        .select({
          providerId: conversations.providerId,
          externalSessionRef: conversations.providerSessionRef
        })
        .from(runs)
        .innerJoin(conversations, eq(conversations.id, runs.conversationId))
        .where(eq(runs.missionId, missionId))
        .orderBy(desc(runs.userAttempt), desc(runs.createdAt))
        .limit(1)
        .get();
      if (!row?.externalSessionRef) return null;
      return { providerId: row.providerId, externalSessionRef: row.externalSessionRef };
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async activateMissionControl(input: ActivateProviderSessionMissionInput): Promise<ActivatedProviderSessionMissionResult> {
    const expectedPayload = {
      schemaVersion: 1,
      action: "activate_provider_session_control",
      missionId: input.missionId,
      expectedVersion: input.expectedVersion
    } as const;
    try {
      return this.database.orm.transaction((transaction) => {
        const activeLinks = transaction.select().from(providerSessionLinks).where(and(
          eq(providerSessionLinks.missionId, input.missionId),
          isNull(providerSessionLinks.detachedAt)
        )).orderBy(asc(providerSessionLinks.attachedAt), asc(providerSessionLinks.id)).limit(2).all();
        if (activeLinks.length === 0) {
          throw new DomainError(`Mission ${input.missionId} has no active provider session`, "MISSION_PROVIDER_SESSION_NOT_FOUND");
        }
        if (activeLinks.length > 1) {
          throw new DomainError(`Mission ${input.missionId} has multiple active provider sessions`, "MISSION_PROVIDER_SESSION_AMBIGUOUS");
        }
        const linkRow = activeLinks[0]!;
        const sessionRow = transaction.select().from(providerSessions)
          .where(eq(providerSessions.id, linkRow.providerSessionId)).get();
        const missionRow = transaction.select().from(missions).where(eq(missions.id, input.missionId)).get();
        if (!sessionRow) throw new DomainError(`Provider session ${linkRow.providerSessionId} was not found`, "PROVIDER_SESSION_NOT_FOUND");
        if (!missionRow) throw new DomainError(`Mission ${input.missionId} was not found`, "MISSION_NOT_FOUND");

        const replay = transaction.select().from(businessAuditEvents)
          .where(eq(businessAuditEvents.commandId, input.commandId)).get();
        if (replay) {
          this.assertReplay(replay.payloadJson, expectedPayload, input.commandId);
          return {
            session: this.toIdentity(sessionRow),
            link: this.toLink(linkRow),
            mission: Mission.rehydrate(this.toMissionSnapshot(missionRow)).snapshot()
          };
        }
        if (missionRow.version !== input.expectedVersion) {
          throw new DomainError("Mission version conflict", "MISSION_VERSION_CONFLICT");
        }
        if (missionRow.executionKind !== "agent") {
          throw new DomainError("Only an agent mission can control a provider session", "TRANSITION_FORBIDDEN");
        }
        const mission = Mission.rehydrate(this.toMissionSnapshot(missionRow));
        mission.startAgent(input.occurredAt);
        const missionSnapshot = mission.snapshot();
        transaction.update(missions).set({
          state: missionSnapshot.state,
          version: missionSnapshot.version,
          updatedAt: missionSnapshot.updatedAt
        }).where(eq(missions.id, input.missionId)).run();
        transaction.update(providerSessionLinks).set({ mode: "control" })
          .where(eq(providerSessionLinks.id, linkRow.id)).run();
        const activatedLink = { ...linkRow, mode: "control" as const };
        transaction.insert(businessAuditEvents).values({
          id: `audit/${input.commandId}`,
          aggregateKind: "mission",
          aggregateId: input.missionId,
          commandId: input.commandId,
          eventType: "PROVIDER_SESSION_MISSION_ACTIVATED",
          actor: input.actor,
          payloadJson: JSON.stringify({ ...expectedPayload, providerSessionId: sessionRow.id, linkId: linkRow.id }),
          occurredAt: input.occurredAt
        }).run();
        transaction.insert(outbox).values({
          id: `outbox/${input.commandId}`,
          kind: "mission.changed",
          aggregateId: input.missionId,
          payloadJson: JSON.stringify({
            ...expectedPayload,
            providerSessionId: sessionRow.id,
            linkId: linkRow.id,
            linkMode: "control",
            missionVersion: missionSnapshot.version,
            state: missionSnapshot.state
          }),
          dedupeKey: `mission/${input.missionId}/version/${missionSnapshot.version}/provider-session-control`,
          createdAt: input.occurredAt,
          publishedAt: null
        }).run();
        return {
          session: this.toIdentity(sessionRow),
          link: this.toLink(activatedLink),
          mission: missionSnapshot
        };
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async attachToMission(input: AttachProviderSessionInput): Promise<ProviderSessionAttachmentResult> {
    const expectedPayload = {
      schemaVersion: 1,
      action: "attach",
      providerSessionId: input.providerSessionId,
      missionId: input.missionId
    } as const;
    try {
      return this.database.orm.transaction((transaction) => {
        const replay = transaction
          .select()
          .from(businessAuditEvents)
          .where(eq(businessAuditEvents.commandId, input.commandId))
          .get();
        if (replay) {
          const receipt = this.assertReplay(replay.payloadJson, expectedPayload, input.commandId);
          const sessionRow = transaction.select().from(providerSessions)
            .where(eq(providerSessions.id, input.providerSessionId)).get();
          const linkId = typeof receipt.linkId === "string" ? receipt.linkId : null;
          const linkRow = linkId
            ? transaction.select().from(providerSessionLinks).where(eq(providerSessionLinks.id, linkId)).get()
            : null;
          if (!sessionRow || !linkRow) {
            throw new DomainError("An idempotent attachment result is incomplete", "PERSISTENCE_FAILURE");
          }
          return { session: this.toIdentity(sessionRow), link: this.toLink(linkRow) };
        }

        const sessionRow = transaction.select().from(providerSessions)
          .where(eq(providerSessions.id, input.providerSessionId)).get();
        if (!sessionRow) {
          throw new DomainError(`Provider session ${input.providerSessionId} was not found`, "PROVIDER_SESSION_NOT_FOUND");
        }
        const missionRow = transaction.select({ id: missions.id }).from(missions)
          .where(eq(missions.id, input.missionId)).get();
        if (!missionRow) throw new DomainError(`Mission ${input.missionId} was not found`, "MISSION_NOT_FOUND");

        const activeLink = transaction.select().from(providerSessionLinks).where(and(
          eq(providerSessionLinks.providerSessionId, input.providerSessionId),
          isNull(providerSessionLinks.detachedAt)
        )).get();
        if (activeLink) {
          if (activeLink.missionId !== input.missionId) {
            throw new DomainError(
              `Provider session ${input.providerSessionId} is already attached to mission ${activeLink.missionId}`,
              "PROVIDER_SESSION_LINK_CONFLICT"
            );
          }
          transaction.insert(businessAuditEvents).values({
            id: `audit/${input.commandId}`,
            aggregateKind: "provider_session",
            aggregateId: input.providerSessionId,
            commandId: input.commandId,
            eventType: "PROVIDER_SESSION_ATTACHMENT_CONFIRMED",
            actor: input.actor,
            payloadJson: JSON.stringify({ ...expectedPayload, linkId: activeLink.id }),
            occurredAt: input.occurredAt
          }).run();
          return { session: this.toIdentity(sessionRow), link: this.toLink(activeLink) };
        }

        const linkRow = {
          id: `provider-session-link/${input.commandId}`,
          providerSessionId: input.providerSessionId,
          missionId: input.missionId,
          mode: "read_only" as const,
          attachedAt: input.occurredAt,
          detachedAt: null
        };
        transaction.insert(providerSessionLinks).values(linkRow).run();
        transaction.insert(businessAuditEvents).values({
          id: `audit/${input.commandId}`,
          aggregateKind: "provider_session",
          aggregateId: input.providerSessionId,
          commandId: input.commandId,
          eventType: "PROVIDER_SESSION_ATTACHED",
          actor: input.actor,
          payloadJson: JSON.stringify({ ...expectedPayload, linkId: linkRow.id }),
          occurredAt: input.occurredAt
        }).run();
        transaction.insert(outbox).values({
          id: `outbox/${input.commandId}`,
          kind: "provider-session.changed",
          aggregateId: input.providerSessionId,
          payloadJson: JSON.stringify({ ...expectedPayload, linkId: linkRow.id, mode: linkRow.mode }),
          dedupeKey: `provider-session/${input.providerSessionId}/link/${linkRow.id}`,
          createdAt: input.occurredAt,
          publishedAt: null
        }).run();
        return { session: this.toIdentity(sessionRow), link: this.toLink(linkRow) };
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async createReadyAgentMissionAndAttach(input: CreateReadyAgentMissionAndAttachInput): Promise<CreatedProviderSessionMissionResult> {
    const projectId = input.projectId ?? null;
    const expectedPayload = {
      schemaVersion: 1,
      action: "create_ready_agent_mission_and_attach",
      providerSessionId: input.providerSessionId,
      missionId: input.missionId,
      requestedTitle: input.requestedTitle,
      projectId
    } as const;

    try {
      return this.database.orm.transaction((transaction) => {
        const replay = transaction.select().from(businessAuditEvents)
          .where(eq(businessAuditEvents.commandId, input.commandId)).get();
        if (replay) {
          const receipt = this.assertReplay(replay.payloadJson, expectedPayload, input.commandId);
          const sessionRow = transaction.select().from(providerSessions)
            .where(eq(providerSessions.id, input.providerSessionId)).get();
          const missionRow = transaction.select().from(missions).where(eq(missions.id, input.missionId)).get();
          const linkId = typeof receipt.linkId === "string" ? receipt.linkId : null;
          const linkRow = linkId
            ? transaction.select().from(providerSessionLinks).where(eq(providerSessionLinks.id, linkId)).get()
            : null;
          if (!sessionRow || !missionRow || !linkRow) {
            throw new DomainError("An idempotent mission attachment result is incomplete", "PERSISTENCE_FAILURE");
          }
          const configRow = transaction.select().from(missionAgentConfigs)
            .where(eq(missionAgentConfigs.missionId, input.missionId)).get();
          const workspaceRow = configRow?.workspaceId
            ? transaction.select().from(workspaces).where(eq(workspaces.id, configRow.workspaceId)).get()
            : null;
          if (!configRow || !workspaceRow || workspaceRow.kind !== "repo" || workspaceRow.state !== "ready") {
            throw new DomainError("An idempotent agent mission result is incomplete", "PERSISTENCE_FAILURE");
          }
          return {
            session: this.toIdentity(sessionRow),
            mission: Mission.rehydrate(this.toMissionSnapshot(missionRow)).snapshot(),
            link: this.toLink(linkRow),
            config: this.toAgentConfig(configRow),
            workspace: this.toWorkspace(workspaceRow)
          };
        }

        const sessionRow = transaction.select().from(providerSessions)
          .where(eq(providerSessions.id, input.providerSessionId)).get();
        if (!sessionRow) {
          throw new DomainError(`Provider session ${input.providerSessionId} was not found`, "PROVIDER_SESSION_NOT_FOUND");
        }
        const providerId = sessionRow.providerId;
        const catalog = transaction.select().from(providerCatalogSnapshots)
          .where(eq(providerCatalogSnapshots.providerId, providerId))
          .orderBy(desc(providerCatalogSnapshots.probedAt)).limit(1).get();
        const model = catalog ? this.selectModel(catalog.modelsJson) : null;
        const optionsSchemaVersion = catalog ? this.optionsSchemaVersion(catalog.capabilitiesJson) : null;
        if (!catalog || !model || optionsSchemaVersion === null) {
          throw new DomainError(`Provider ${providerId} has no usable persisted model catalog`, "CAPABILITY_UNAVAILABLE");
        }
        const workspace = transaction.select().from(workspaces).where(eq(workspaces.path, input.cwd)).get();
        if (workspace && (workspace.kind !== "repo" || workspace.state !== "ready")) {
          throw new DomainError(`Workspace ${input.cwd} is not a ready repo workspace`, "WORKSPACE_STATE_CONFLICT");
        }
        const workspaceRow = workspace ?? {
          id: `workspace/provider-session/${input.commandId}`,
          projectId,
          kind: "repo" as const,
          path: input.cwd,
          state: "ready" as const,
          createdAt: input.occurredAt,
          tombstonedAt: null
        };
        const mission = Mission.create({
          id: input.missionId,
          title: input.title,
          executionKind: "agent",
          projectId,
          now: input.occurredAt
        });
        mission.prepare(input.occurredAt);
        const missionSnapshot = mission.snapshot();

        const activeLink = transaction.select().from(providerSessionLinks).where(and(
          eq(providerSessionLinks.providerSessionId, input.providerSessionId),
          isNull(providerSessionLinks.detachedAt)
        )).get();
        if (activeLink) {
          throw new DomainError(
            `Provider session ${input.providerSessionId} is already attached to mission ${activeLink.missionId}`,
            "PROVIDER_SESSION_LINK_CONFLICT"
          );
        }
        if (transaction.select({ id: missions.id }).from(missions).where(eq(missions.id, input.missionId)).get()) {
          throw new DomainError(`Mission ${input.missionId} already exists`, "MISSION_ALREADY_EXISTS");
        }
        if (projectId && !transaction.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) {
          throw new DomainError(`Project ${projectId} was not found`, "PROJECT_NOT_FOUND");
        }

        transaction.insert(missions).values(missionSnapshot).run();
        if (!workspace) transaction.insert(workspaces).values(workspaceRow).run();
        transaction.insert(missionAgentConfigs).values({
          missionId: input.missionId,
          version: 0,
          providerId,
          modelId: model.id,
          reasoningEffort: model.reasoningEffort,
          providerOptionsSchemaVersion: optionsSchemaVersion,
          providerOptionsJson: "{}",
          missionPrompt: input.missionPrompt,
          permissionPreset: "workspace",
          workspaceId: workspaceRow.id,
          autoCommitAuthorized: 0,
          integrationTargetRef: null,
          updatedAt: input.occurredAt
        }).run();
        const linkRow = {
          id: `provider-session-link/${input.commandId}`,
          providerSessionId: input.providerSessionId,
          missionId: input.missionId,
          mode: "read_only" as const,
          attachedAt: input.occurredAt,
          detachedAt: null
        };
        transaction.insert(providerSessionLinks).values(linkRow).run();
        transaction.insert(businessAuditEvents).values({
          id: `audit/${input.commandId}`,
          aggregateKind: "mission",
          aggregateId: input.missionId,
          commandId: input.commandId,
          eventType: "READY_AGENT_MISSION_CREATED_FROM_PROVIDER_SESSION",
          actor: input.actor,
          payloadJson: JSON.stringify({ ...expectedPayload, linkId: linkRow.id }),
          occurredAt: input.occurredAt
        }).run();
        transaction.insert(outbox).values({
          id: `outbox/${input.commandId}`,
          kind: "mission.changed",
          aggregateId: input.missionId,
          payloadJson: JSON.stringify({ ...expectedPayload, missionVersion: missionSnapshot.version, linkId: linkRow.id }),
          dedupeKey: `mission/${input.missionId}/version/${missionSnapshot.version}`,
          createdAt: input.occurredAt,
          publishedAt: null
        }).run();
        return {
          session: this.toIdentity(sessionRow),
          mission: missionSnapshot,
          link: this.toLink(linkRow),
          config: {
            missionId: input.missionId,
            version: 0,
            providerId,
            modelId: model.id,
            reasoningEffort: model.reasoningEffort,
            providerOptions: { schemaVersion: optionsSchemaVersion, value: {} },
            missionPrompt: input.missionPrompt,
            permissionPreset: "workspace",
            workspaceId: asId(workspaceRow.id),
            autoCommitAuthorized: false,
            integrationTargetRef: null,
            updatedAt: input.occurredAt
          },
          workspace: this.toWorkspace(workspaceRow)
        };
      });
    } catch (error) {
      throw translateSqliteError(error);
    }
  }

  async createActiveMissionAndAttach(input: {
    providerSessionId: Id; missionId: Id; title: string; projectId?: Id | null; commandId: Id; actor: "user" | "manager"; occurredAt: string;
  }): Promise<CreatedProviderSessionMissionResult> {
    return this.createReadyAgentMissionAndAttach({
      ...input, requestedTitle: input.title.trim() || null, cwd: process.cwd(), missionPrompt: input.title.trim()
    });
  }

  private toIdentity(row: typeof providerSessions.$inferSelect): ProviderSessionIdentity {
    return {
      id: asId(row.id),
      providerId: row.providerId,
      externalSessionRef: row.externalSessionRef,
      ownership: row.ownership,
      firstObservedAt: row.firstObservedAt,
      lastObservedAt: row.lastObservedAt
    };
  }

  private toLink(row: typeof providerSessionLinks.$inferSelect): ProviderSessionLink {
    return {
      id: asId(row.id),
      providerSessionId: asId(row.providerSessionId),
      missionId: asId(row.missionId),
      mode: row.mode,
      attachedAt: row.attachedAt,
      detachedAt: row.detachedAt
    };
  }

  private toMissionSnapshot(row: typeof missions.$inferSelect): ReturnType<Mission["snapshot"]> {
    return {
      id: asId(row.id),
      projectId: row.projectId ? asId(row.projectId) : null,
      title: row.title,
      executionKind: row.executionKind,
      state: row.state,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private toAgentConfig(row: typeof missionAgentConfigs.$inferSelect): CreatedProviderSessionMissionResult["config"] {
    return {
      missionId: asId(row.missionId), version: row.version, providerId: row.providerId, modelId: row.modelId,
      reasoningEffort: row.reasoningEffort as CreatedProviderSessionMissionResult["config"]["reasoningEffort"],
      providerOptions: { schemaVersion: row.providerOptionsSchemaVersion, value: JSON.parse(row.providerOptionsJson) as Record<string, unknown> },
      missionPrompt: row.missionPrompt,
      permissionPreset: row.permissionPreset as CreatedProviderSessionMissionResult["config"]["permissionPreset"],
      workspaceId: row.workspaceId ? asId(row.workspaceId) : null,
      autoCommitAuthorized: row.autoCommitAuthorized === 1,
      integrationTargetRef: row.integrationTargetRef,
      updatedAt: row.updatedAt
    };
  }

  private toWorkspace(row: typeof workspaces.$inferSelect): CreatedProviderSessionMissionResult["workspace"] {
    return { id: asId(row.id), projectId: row.projectId ? asId(row.projectId) : null, kind: "repo", path: row.path, state: "ready" };
  }

  private selectModel(modelsJson: string): { id: string; reasoningEffort: CreatedProviderSessionMissionResult["config"]["reasoningEffort"] } | null {
    let models: unknown;
    try { models = JSON.parse(modelsJson); } catch { throw new DomainError("Codex catalog models are invalid", "CAPABILITY_UNAVAILABLE"); }
    if (!Array.isArray(models)) throw new DomainError("Codex catalog models are invalid", "CAPABILITY_UNAVAILABLE");
    const candidate = models.find((model) => model && typeof model === "object" && (model as { isDefault?: unknown }).isDefault)
      ?? models[0];
    if (!candidate || typeof candidate !== "object") return null;
    const value = candidate as { id?: unknown; defaultReasoningEffort?: unknown; supportedReasoningEfforts?: unknown };
    if (typeof value.id !== "string" || !value.id) return null;
    const supported = Array.isArray(value.supportedReasoningEfforts)
      ? value.supportedReasoningEfforts.filter((effort): effort is string => typeof effort === "string") : [];
    const reasoningEffort = typeof value.defaultReasoningEffort === "string" && supported.includes(value.defaultReasoningEffort)
      ? value.defaultReasoningEffort
      : supported.includes("provider_default") ? "provider_default" : null;
    return reasoningEffort ? { id: value.id, reasoningEffort: reasoningEffort as CreatedProviderSessionMissionResult["config"]["reasoningEffort"] } : null;
  }

  private optionsSchemaVersion(capabilitiesJson: string): number | null {
    try {
      const value: unknown = JSON.parse(capabilitiesJson);
      return value && typeof value === "object" && typeof (value as { optionsSchemaVersion?: unknown }).optionsSchemaVersion === "number"
        ? (value as { optionsSchemaVersion: number }).optionsSchemaVersion : null;
    } catch {
      return null;
    }
  }

  private assertReplay(
    actualJson: string,
    expected: Readonly<Record<string, unknown>>,
    commandId: Id
  ): Readonly<Record<string, unknown>> {
    let actual: unknown;
    try {
      actual = JSON.parse(actualJson);
    } catch {
      throw new DomainError(`Command ${commandId} has an invalid audit payload`, "PERSISTENCE_FAILURE");
    }
    if (
      !actual
      || typeof actual !== "object"
      || Array.isArray(actual)
      || Object.entries(expected).some(([key, value]) => (
        JSON.stringify((actual as Record<string, unknown>)[key]) !== JSON.stringify(value)
      ))
    ) {
      throw new DomainError(`Command ${commandId} was already used with a different payload`, "COMMAND_ID_CONFLICT");
    }
    return actual as Readonly<Record<string, unknown>>;
  }
}
