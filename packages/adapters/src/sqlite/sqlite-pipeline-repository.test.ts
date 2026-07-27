import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asId } from "@nodra/domain";
import { migrateDatabase } from "./migrate-database.js";
import { NodraSqliteDatabase } from "./nodra-sqlite-database.js";
import { SqlitePipelineRepository } from "./sqlite-pipeline-repository.js";
import { missions } from "./schema/missions.js";
import { conversationItems, conversations } from "./schema/conversations.js";
import { runs } from "./schema/runs.js";
import { eq, inArray } from "drizzle-orm";

const now = "2026-07-26T21:00:00.000Z";

describe("SqlitePipelineRepository", () => {
  let database: NodraSqliteDatabase;
  let repository: SqlitePipelineRepository;

  beforeEach(async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "nodra-pipeline-")));
    database = NodraSqliteDatabase.open(join(root, "nodra.db"));
    await migrateDatabase(database, resolve("packages/adapters/drizzle"));
    repository = new SqlitePipelineRepository(database);
    database.orm.insert(missions).values([
      mission("mission-a", "READY", 2),
      mission("mission-b", "READY", 2)
    ]).run();
  });

  afterEach(() => database.close());

  it("creates, starts and advances a linear pipeline from existing missions", async () => {
    const created = await repository.create({
      pipelineId: asId("pipeline-a"),
      definitionId: asId("pipeline-a/definition/1"),
      nodeIdPrefix: "pipeline-a/node",
      edgeIdPrefix: "pipeline-a/edge",
      name: "Pipeline A",
      nodes: [
        { nodeKey: "01-first", missionId: asId("mission-a") },
        { nodeKey: "02-second", missionId: asId("mission-b") }
      ],
      context: context("create-pipeline")
    });

    expect(created.definition.nodes.map((node) => node.nodeKey)).toEqual(["01-first", "02-second"]);
    expect(created.definition.edges).toHaveLength(1);

    const startResult = await repository.start({
      pipelineId: asId("pipeline-a"),
      pipelineRunId: asId("pipeline-run-a"),
      nodeRunIdPrefix: "pipeline-run-a/node-run",
      context: context("start-pipeline")
    });

    expect(startResult.pipelineRun.state).toBe("active");
    expect(startResult.pipelineRun.nodes.map((node) => node.state)).toEqual(["ready", "pending"]);

    await repository.advance({
      pipelineRunId: asId("pipeline-run-a"),
      context: context("advance-first"),
      startMission: async () => undefined
    });

    database.orm.update(missions).set({ state: "DONE", version: 3 }).where(eq(missions.id, "mission-a")).run();
    const afterFirst = await repository.advance({
      pipelineRunId: asId("pipeline-run-a"),
      context: context("advance-second"),
      startMission: async () => undefined
    });

    expect(afterFirst.pipelineRun.nodes.map((node) => node.state)).toEqual(["completed", "active"]);

    database.orm.update(missions).set({ state: "DONE", version: 3 }).where(eq(missions.id, "mission-b")).run();
    const completed = await repository.advance({
      pipelineRunId: asId("pipeline-run-a"),
      context: context("advance-complete"),
      startMission: async () => undefined
    });

    expect(completed.pipelineRun.state).toBe("completed");
    expect(completed.pipelineRun.nodes.map((node) => node.state)).toEqual(["completed", "completed"]);
  });

  it("completes ready human nodes when their mission is closed", async () => {
    database.orm.update(missions).set({ executionKind: "human" }).run();
    await repository.create({
      pipelineId: asId("pipeline-human"),
      definitionId: asId("pipeline-human/definition/1"),
      nodeIdPrefix: "pipeline-human/node",
      edgeIdPrefix: "pipeline-human/edge",
      name: "Pipeline human",
      nodes: [
        { nodeKey: "01-first", missionId: asId("mission-a") },
        { nodeKey: "02-second", missionId: asId("mission-b") }
      ],
      context: context("create-human")
    });
    await repository.start({
      pipelineId: asId("pipeline-human"),
      pipelineRunId: asId("pipeline-run-human"),
      nodeRunIdPrefix: "pipeline-run-human/node-run",
      context: context("start-human")
    });
    database.orm.update(missions).set({ state: "DONE", version: 3 }).where(eq(missions.id, "mission-a")).run();

    const result = await repository.advance({
      pipelineRunId: asId("pipeline-run-human"),
      context: context("advance-human"),
      startMission: async () => undefined
    });

    expect(result.pipelineRun.nodes.map((node) => node.state)).toEqual(["completed", "ready"]);
  });

  it("supports multiple predecessors converging into one node", async () => {
    database.orm.insert(missions).values([
      mission("mission-c", "READY", 2),
      mission("mission-d", "READY", 2)
    ]).run();
    database.orm.update(missions).set({ executionKind: "human" }).where(eq(missions.id, "mission-d")).run();
    await repository.create({
      pipelineId: asId("pipeline-join"),
      definitionId: asId("pipeline-join/definition/1"),
      nodeIdPrefix: "pipeline-join/node",
      edgeIdPrefix: "pipeline-join/edge",
      name: "Pipeline join",
      nodes: [
        { nodeKey: "a", missionId: asId("mission-a") },
        { nodeKey: "b", missionId: asId("mission-b") },
        { nodeKey: "c", missionId: asId("mission-c") },
        { nodeKey: "d", missionId: asId("mission-d") }
      ],
      edges: [
        { fromNodeKey: "a", toNodeKey: "d" },
        { fromNodeKey: "b", toNodeKey: "d" },
        { fromNodeKey: "c", toNodeKey: "d" }
      ],
      context: context("create-join")
    });
    const started = await repository.start({
      pipelineId: asId("pipeline-join"),
      pipelineRunId: asId("pipeline-run-join"),
      nodeRunIdPrefix: "pipeline-run-join/node-run",
      context: context("start-join")
    });

    expect(started.pipelineRun.nodes.map((node) => [node.nodeKey, node.state])).toEqual([
      ["a", "ready"],
      ["b", "ready"],
      ["c", "ready"],
      ["d", "pending"]
    ]);

    database.orm.update(missions).set({ state: "DONE", version: 3 })
      .where(inArray(missions.id, ["mission-a", "mission-b"])).run();
    const partial = await repository.advance({
      pipelineRunId: asId("pipeline-run-join"),
      context: context("advance-partial-join"),
      startMission: async () => undefined
    });
    expect(partial.pipelineRun.nodes.find((node) => node.nodeKey === "d")?.state).toBe("pending");

    database.orm.update(missions).set({ state: "DONE", version: 3 })
      .where(eq(missions.id, "mission-c")).run();
    const joined = await repository.advance({
      pipelineRunId: asId("pipeline-run-join"),
      context: context("advance-join"),
      startMission: async () => undefined
    });

    const joinedNode = joined.pipelineRun.nodes.find((node) => node.nodeKey === "d");
    expect(joinedNode?.state).toBe("ready");
    expect(joinedNode?.handovers.map((handover) => handover.fromNodeKey).sort()).toEqual(["a", "b", "c"]);
  });

  it("can switch a started pipeline transition from auto to human", async () => {
    await repository.create({
      pipelineId: asId("pipeline-human-gate"),
      definitionId: asId("pipeline-human-gate/definition/1"),
      nodeIdPrefix: "pipeline-human-gate/node",
      edgeIdPrefix: "pipeline-human-gate/edge",
      name: "Pipeline human gate",
      nodes: [
        { nodeKey: "a", missionId: asId("mission-a") },
        { nodeKey: "b", missionId: asId("mission-b") }
      ],
      context: context("create-human-gate")
    });
    await repository.start({
      pipelineId: asId("pipeline-human-gate"),
      pipelineRunId: asId("pipeline-run-human-gate"),
      nodeRunIdPrefix: "pipeline-run-human-gate/node-run",
      context: context("start-human-gate")
    });
    await repository.setNodeTransitionMode({
      pipelineRunId: asId("pipeline-run-human-gate"),
      nodeKey: "b",
      mode: "human",
      context: context("mode-human")
    });
    database.orm.update(missions).set({ state: "DONE", version: 3 }).where(eq(missions.id, "mission-a")).run();

    const blocked = await repository.advance({
      pipelineRunId: asId("pipeline-run-human-gate"),
      context: context("advance-blocked"),
      startMission: async () => undefined
    });
    expect(blocked.pipelineRun.state).toBe("blocked");
    expect(blocked.pipelineRun.nodes.find((node) => node.nodeKey === "b")?.state).toBe("pending");
    expect(blocked.pipelineRun.nodes.find((node) => node.nodeKey === "b")?.transitionMode).toBe("human");

    const approved = await repository.approveNodeTransition({
      pipelineRunId: asId("pipeline-run-human-gate"),
      nodeKey: "b",
      context: context("approve-human-gate")
    });
    const node = approved.pipelineRun.nodes.find((candidate) => candidate.nodeKey === "b");
    expect(node?.state).toBe("ready");
    expect(node?.transitionMode).toBe("auto");
    expect(node?.handovers).toHaveLength(1);
  });

  it("publishes latest assistant message and injects aggregate handover on successor start", async () => {
    await repository.create({
      pipelineId: asId("pipeline-publish"),
      definitionId: asId("pipeline-publish/definition/1"),
      nodeIdPrefix: "pipeline-publish/node",
      edgeIdPrefix: "pipeline-publish/edge",
      name: "Pipeline publish",
      nodes: [
        { nodeKey: "a", missionId: asId("mission-a") },
        { nodeKey: "b", missionId: asId("mission-b") }
      ],
      context: context("create-publish")
    });
    await repository.start({
      pipelineId: asId("pipeline-publish"),
      pipelineRunId: asId("pipeline-run-publish"),
      nodeRunIdPrefix: "pipeline-run-publish/node-run",
      context: context("start-publish")
    });
    database.orm.insert(conversations).values({
      id: "conversation-a",
      missionId: "mission-a",
      managerId: null,
      providerId: "opencode",
      providerSessionRef: null,
      state: "open",
      createdAt: now,
      deletedAt: null
    }).run();
    database.orm.insert(runs).values({
      id: "run-a",
      missionId: "mission-a",
      managerId: null,
      conversationId: "conversation-a",
      userAttempt: 1,
      state: "SUCCEEDED",
      temporalWorkflowId: "run/run-a",
      temporalRunId: "temporal-run-a",
      providerId: "opencode",
      modelId: "model",
      reasoningEffort: "provider_default",
      createdAt: now
    }).run();
    database.orm.insert(conversationItems).values({
      id: "assistant-a",
      conversationId: "conversation-a",
      ordinal: 0,
      kind: "assistant",
      deliveryState: "acknowledged",
      body: "HANDOVER_FROM_A",
      providerItemRef: "assistant-a",
      createdAt: now,
      acknowledgedAt: now
    }).run();
    await repository.publishNodeHandover({
      pipelineRunId: asId("pipeline-run-publish"),
      nodeKey: "a",
      context: context("publish-a")
    });
    database.orm.update(missions).set({ state: "DONE", version: 3 }).where(eq(missions.id, "mission-a")).run();
    let received: string | null = null;
    const result = await repository.advance({
      pipelineRunId: asId("pipeline-run-publish"),
      context: context("advance-publish"),
      startMission: async (_missionId, handoverPrompt) => { received = handoverPrompt; }
    });

    expect(result.pipelineRun.nodes.find((node) => node.nodeKey === "b")?.handovers[0]?.payload)
      .toMatchObject({ message: "HANDOVER_FROM_A" });
    expect(received).toContain("HANDOVER_FROM_A");
  });

  it("blocks when a mission waits for human validation", async () => {
    await repository.create({
      pipelineId: asId("pipeline-validation"),
      definitionId: asId("pipeline-validation/definition/1"),
      nodeIdPrefix: "pipeline-validation/node",
      edgeIdPrefix: "pipeline-validation/edge",
      name: "Pipeline validation",
      nodes: [
        { nodeKey: "01-first", missionId: asId("mission-a") },
        { nodeKey: "02-second", missionId: asId("mission-b") }
      ],
      context: context("create-validation")
    });
    await repository.start({
      pipelineId: asId("pipeline-validation"),
      pipelineRunId: asId("pipeline-run-validation"),
      nodeRunIdPrefix: "pipeline-run-validation/node-run",
      context: context("start-validation")
    });
    await repository.advance({
      pipelineRunId: asId("pipeline-run-validation"),
      context: context("activate-validation"),
      startMission: async () => undefined
    });
    database.orm.update(missions).set({ state: "VALIDATION", version: 3 }).where(eq(missions.id, "mission-a")).run();

    const result = await repository.advance({
      pipelineRunId: asId("pipeline-run-validation"),
      context: context("advance-validation"),
      startMission: async () => undefined
    });

    expect(result.pipelineRun.state).toBe("blocked");
    expect(result.pipelineRun.nodes.map((node) => node.state)).toEqual(["active", "pending"]);
  });
});

const mission = (id: string, state: "READY" | "DONE", version: number) => ({
  id,
  projectId: null,
  title: id,
  executionKind: "agent" as const,
  state,
  version,
  createdAt: now,
  updatedAt: now
});

const context = (commandId: string) => ({
  commandId: asId(commandId),
  actor: "user" as const,
  occurredAt: now
});
